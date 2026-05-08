# convex-better-auth-368-repro

Ran into an issue where `useConvexAuth().isAuthenticated` never flips to `true` after a successful sign-in. Reproduced on a fresh minimal Expo SDK 56 canary setup (`2026-05-05+`) with React `19.2.3` and React Native `0.85.3`. The Better Auth session lands cleanly, `authClient.useSession()` reflects the new state, and `/convex/token` returns a valid JWT, but `useConvexAuth().isAuthenticated` never settles and the websocket stays paused. Same thing on sign-up and sign-out, every auth state change leaves the bridge stuck.

Filed the fix as [`get-convex/better-auth#368`](https://github.com/get-convex/better-auth/pull/368). This repo is the runnable repro: single Expo app, swap one line of `package.json` to flip between vanilla `0.12.2` (broken) and the patched build (fixed).

| Vanilla `0.12.2` (broken) | Patched build (fixed) |
|---|---|
| ![bridge stuck](screenshots/bridge-stuck.png) | ![bridge working](screenshots/bridge-working.png) |

Same app, same Convex deployment, same Better Auth session. Only the `@convex-dev/better-auth` version in `package.json` differs.

## Why it happens

Tracked the root cause to an Expo update ([`expo/expo#45345`](https://github.com/expo/expo/pull/45345)) that dropped an old Babel transform (`@babel/plugin-transform-async-to-generator`) from the Hermes V1 preset on May 5. The transform was quietly hiding a timing bug in the bridge: it forced async functions to wait one extra tick before resolving, which kept two back-to-back auth calls from racing. Without it, the second call lands while the first is still mid-flight, Convex sees a stale config version, and silently skips reconnecting the socket. Wrapping the function body in an explicit `new Promise(executor)` restores that one-tick delay, so the second call waits for the first to finish.

The race, step by step:

1. `fetchAccessToken` resolves with the JWT and calls `setCachedToken(token)`.
2. The `/convex/token` response's `Set-Cookie` runs through Better Auth's fetch interceptor.
3. That triggers a re-render. `sessionId` updates.
4. The `[sessionId]` dep on `fetchAccessToken`'s `useCallback` rebuilds the function.
5. `ConvexAuthStateFirstEffect` sees a new `fetchAccessToken` and calls `client.setAuth` a second time.
6. Convex's `fetchTokenAndGuardAgainstRace` (`authentication_manager.ts`) bumps `configVersion` on entry. The original `await` from step 1 sees the stale value and returns `isFromOutdatedConfig: true`.
7. `setConfig` bails without `resumeSocket()`. Chain repeats.

Why the transform masked it: regenerator's `_asyncToGenerator` wraps the body in `new Promise(executor)`, and the constructor's `resolve(thenable)` schedules a `NewPromiseResolveThenableJob` microtask. Native async returning a thenable should do the same per the spec, but Hermes V1's native pipeline appears to elide it. With the hop in place the second `setAuth` lands after `setConfig` finishes. Without it, it lands during the await window.

`pendingTokenRef` caching, `cachedToken` state, the catch/finally, and the `[sessionId]` dependency all stay. `AuthTokenFetcher` contract preserved.

## Run

You need an iOS simulator (or device) and your own Convex deployment.

```bash
npm install
cp .env.example .env.local
# fill in EXPO_PUBLIC_CONVEX_URL, EXPO_PUBLIC_CONVEX_SITE_URL, CONVEX_DEPLOYMENT
npx convex dev      # one terminal, leave running
npm run ios         # another terminal
```

First launch shows the Expo dev client tutorial. Tap "Continue" to dismiss. The app then auto-signs-up with `repro-${Date.now()}@example.com` and starts logging `[bridge]` lines to the metro console. The big colored banner reflects the bridge state in real time.

## Toggle the fix

The repo defaults to vanilla `0.12.2` (broken). To see the fix, swap one line in `package.json`:

```jsonc
// broken (vanilla npm)
"@convex-dev/better-auth": "0.12.2"

// fixed (patched build from PR #368)
"@convex-dev/better-auth": "file:./patches/convex-dev-better-auth-0.12.2.tgz"
```

Do a clean install after editing. Plain `npm install` won't swap because both sides advertise version `0.12.2` and npm thinks `node_modules` is already up to date:

```bash
npm install --force
# or: rm -rf node_modules package-lock.json && npm install
```

Then `npm run ios` again. The native binary doesn't need to rebuild because the change is JS-only. Metro picks up the new bridge code on the next bundle.

To swap back, reverse the package.json edit and run the clean install again.

## Expected output

**Broken** (vanilla `0.12.2`): banner stays red on `BRIDGE STUCK` after the session lands.
```
[bridge] {"useConvexAuth.isAuthenticated": false, "useConvexAuth.isLoading": true,  "useSession.hasSession": false, "useSession.isPending": true}
[bridge] {"useConvexAuth.isAuthenticated": false, "useConvexAuth.isLoading": true,  "useSession.hasSession": true,  "useSession.isPending": false}
[bridge] {"useConvexAuth.isAuthenticated": false, "useConvexAuth.isLoading": false, "useSession.hasSession": true,  "useSession.isPending": false}
```

**Fixed** (patched build): banner flips to green `BRIDGE WORKING` once the session lands.
```
[bridge] {"useConvexAuth.isAuthenticated": false, "useConvexAuth.isLoading": true,  "useSession.hasSession": false, "useSession.isPending": true}
[bridge] {"useConvexAuth.isAuthenticated": false, "useConvexAuth.isLoading": true,  "useSession.hasSession": true,  "useSession.isPending": false}
[bridge] {"useConvexAuth.isAuthenticated": true,  "useConvexAuth.isLoading": false, "useSession.hasSession": true,  "useSession.isPending": false}
```

The `Sign in` and `Sign out` buttons exercise the same code path so you can watch the banner cycle across all three transitions.

## Versions pinned

- `expo` `56.0.0-canary-20260506-03817f5` (any post-`expo/expo#45345` canary)
- `react` `19.2.3`, `react-native` `0.85.3`
- `@convex-dev/better-auth` `0.12.2`
- `better-auth` `1.6.9`, `@better-auth/expo` `1.6.9`
- `convex` `^1.37.0`

No `babel.config.js` overrides. No `expo-modules-core` or `expo-jsi` pin. `.npmrc` ships `legacy-peer-deps=true` because npm semver excludes prereleases from normal ranges, so canary versions don't satisfy `@better-auth/expo`'s `expo-constants@">=17.0.0"` peer.

## Bisect (Hermes V1 plugin set vs `useConvexAuth.isAuthenticated`)

| Plugin set | Result |
|---|---|
| pre-#45345 baseline (regenerator wrapping for async) | true |
| post-#45345 baseline (native async) | false |
| post-#45345 + ALL 11 dropped transforms re-added globally | true |
| post-#45345 + ONLY `transform-async-to-generator` re-added globally | true |
| post-#45345 + 10 dropped transforms re-added EXCEPT `transform-async-to-generator` | false |
| post-#45345 + `transform-async-to-generator` applied to `node_modules/@convex-dev/better-auth/dist/react/` only | true |
| post-#45345 + `transform-async-to-generator` applied to `convex/*`, `better-auth/*`, `@better-auth/*` but NOT this bridge | false |
| post-#45345 + PR #368's source patch, no babel changes | true |

The bridge file is the entire surface. Convex client and Better Auth client are unaffected.

## Alternatives tried

Tried five other source-level shapes and none of them fix the bug on Hermes V1 native async:

1. `useState(cachedToken)` → `useRef`. Drops one re-render trigger. Better Auth's `Set-Cookie` store update still triggers a render via `useSession` and races. Doesn't fix.
2. `[sessionId]` → `[userId]` on `useCallback`. Doesn't rebuild on session rotation. First `setConfig` cycle still fails. Doesn't fix.
3. `.then((x) => x)` appended to the chain. Promise-of-same-realm short-circuits, no hop manifests. Doesn't fix.
4. Keep `async`, change `return pendingTokenRef.current` → `return await pendingTokenRef.current`. On V8 with await fusion this is a no-op. On Hermes V1 native async it doesn't add a microtask hop in practice. Doesn't fix.
5. Keep `async`, return `new Promise(...)` from inside the async body. Outer async wrapping short-circuits the inner thenable-adoption microtask. Doesn't fix.

Only dropping `async` and wrapping the entire body in `new Promise(executor)` works. The Promise constructor's thenable-adoption microtask is the spec-defined point where scheduling fires deterministically across engines.

## What the patch changes

`patches/PR-368.patch` is the source diff (single file, `src/react/index.tsx`). Drops `async`, wraps the body in `new Promise(executor)`. Twenty-six insertions, twenty-two deletions.

`patches/convex-dev-better-auth-0.12.2.tgz` is the built tarball from [`@ramonclaudio/convex-better-auth`](https://github.com/ramonclaudio/convex-better-auth) on branch `fix/react-bridge-hermes-async-race`. Rebuild:

```bash
git clone https://github.com/ramonclaudio/convex-better-auth.git
cd convex-better-auth
git checkout fix/react-bridge-hermes-async-race
npm install && npm run build
npm pack --pack-destination /path/to/this/repro/patches/
```

## License

MIT, by [Ramon Claudio](https://github.com/ramonclaudio).
