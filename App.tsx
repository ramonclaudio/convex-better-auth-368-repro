import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient, useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";
import {
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { authClient } from "./lib/auth-client";

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  expectAuth: true,
  unsavedChangesWarning: false,
});

function Repro() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { data: session, isPending } = authClient.useSession();

  const [email, setEmail] = useState(`repro-${Date.now()}@example.com`);
  const [password, setPassword] = useState("Reproduction1234!");
  const [name, setName] = useState("Repro User");
  const [status, setStatus] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);
  const [autoTriggered, setAutoTriggered] = useState(false);

  useEffect(() => {
    console.log("[bridge]", {
      "useConvexAuth.isAuthenticated": isAuthenticated,
      "useConvexAuth.isLoading": isLoading,
      "useSession.hasSession": !!session?.session,
      "useSession.isPending": isPending,
    });
  }, [isAuthenticated, isLoading, session, isPending]);

  useEffect(() => {
    if (autoTriggered || isPending || session?.session) return;
    setAutoTriggered(true);
    void signUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending, session, autoTriggered]);

  const signUp = async () => {
    setStatus("signing up");
    setError(null);
    try {
      const res = await authClient.signUp.email({ email, password, name });
      if (res.error) throw new Error(res.error.message);
      setStatus("signed up");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  const signIn = async () => {
    setStatus("signing in");
    setError(null);
    try {
      const res = await authClient.signIn.email({ email, password });
      if (res.error) throw new Error(res.error.message);
      setStatus("signed in");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  const signOut = async () => {
    setStatus("signing out");
    setError(null);
    try {
      await authClient.signOut();
      setStatus("signed out");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  const bridgeState = (() => {
    if (isPending || isLoading) {
      return { label: "INITIALIZING", sub: "Waiting for session and token", bg: "#888" };
    }
    if (!session?.session) {
      return { label: "SIGNED OUT", sub: "No active session", bg: "#666" };
    }
    if (!isAuthenticated) {
      return {
        label: "BRIDGE STUCK",
        sub: "Better Auth has a session but useConvexAuth never settles. Bug repros.",
        bg: "#c0392b",
      };
    }
    return {
      label: "BRIDGE WORKING",
      sub: "Session and Convex auth both live. Fix applied.",
      bg: "#27ae60",
    };
  })();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Convex + Better Auth bridge race repro</Text>

      <View style={[styles.banner, { backgroundColor: bridgeState.bg }]}>
        <Text style={styles.bannerLabel}>{bridgeState.label}</Text>
        <Text style={styles.bannerSub}>{bridgeState.sub}</Text>
      </View>

      <View style={styles.box}>
        <Text style={styles.h2}>useConvexAuth</Text>
        <Text style={styles.row}>
          isAuthenticated: <Text style={styles.value}>{String(isAuthenticated)}</Text>
        </Text>
        <Text style={styles.row}>
          isLoading: <Text style={styles.value}>{String(isLoading)}</Text>
        </Text>
      </View>

      <View style={styles.box}>
        <Text style={styles.h2}>authClient.useSession</Text>
        <Text style={styles.row}>
          hasSession: <Text style={styles.value}>{String(!!session?.session)}</Text>
        </Text>
        <Text style={styles.row}>
          isPending: <Text style={styles.value}>{String(isPending)}</Text>
        </Text>
        <Text style={styles.row}>
          user.email: <Text style={styles.value}>{session?.user?.email ?? "null"}</Text>
        </Text>
      </View>

      <View style={styles.box}>
        <Text style={styles.h2}>Status</Text>
        <Text style={styles.row}>
          status: <Text style={styles.value}>{status}</Text>
        </Text>
        {error ? <Text style={styles.error}>error: {error}</Text> : null}
      </View>

      <View style={styles.box}>
        <Text style={styles.h2}>Credentials</Text>
        <TextInput
          style={styles.input}
          placeholder="email"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="password (min 10 chars)"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <TextInput
          style={styles.input}
          placeholder="name (sign up)"
          autoCapitalize="none"
          autoCorrect={false}
          value={name}
          onChangeText={setName}
        />
      </View>

      <View style={styles.actions}>
        <Button title="Sign up" onPress={signUp} />
        <Button title="Sign in" onPress={signIn} />
        <Button title="Sign out" onPress={signOut} />
      </View>
    </ScrollView>
  );
}

export default function App() {
  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      <Repro />
    </ConvexBetterAuthProvider>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 80, gap: 16, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "700" },
  banner: { padding: 16, borderRadius: 10, gap: 4 },
  bannerLabel: { color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: 0.5 },
  bannerSub: { color: "#fff", fontSize: 13, opacity: 0.9 },
  h2: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
  box: { padding: 12, borderWidth: 1, borderColor: "#ddd", borderRadius: 8, gap: 4 },
  row: { fontSize: 14, fontFamily: "Menlo" },
  value: { fontWeight: "700" },
  error: { color: "#c00", fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    padding: 10,
    marginVertical: 4,
    fontSize: 15,
  },
  actions: { flexDirection: "row", gap: 12, justifyContent: "space-between" },
});
