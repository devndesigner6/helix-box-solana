import { useConnection } from "@/contexts/ConnectionContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useLocalSearchParams, useRouter } from "expo-router";
import { payForAgentSession } from "@/lib/solana-payment";
import { ArrowLeft, Wallet } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

type Plan = "hour" | "week";

export default function Payment() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const { connect, getPairedSessions, resumeSession, getSessionPaymentStatus } = useConnection();
  const { colors, fonts } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activatePaidSession = async () => {
    if (!code) throw new Error("CLI pairing code is missing");
    const pairedSession = (await getPairedSessions()).find((session) => session.sessionCode === code);
    if (pairedSession) await resumeSession(pairedSession);
    else await connect(code);
    router.replace({ pathname: "/workspace", params: { code } });
  };

  const pay = async (plan: Plan) => {
    if (!code) return;
    setBusy(true); setError(null);
    try {
      const current = await getSessionPaymentStatus(code);
      if (current.paid && current.paidUntil > Date.now()) {
        await activatePaidSession();
        return;
      }
      await payForAgentSession(code, plan);
      await activatePaidSession();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment could not be confirmed. Check session status before paying again.");
    } finally { setBusy(false); }
  };

  return <View style={{ flex: 1, backgroundColor: colors.bg.base, padding: 24, justifyContent: "center", gap: 16 }}>
    <Pressable onPress={() => router.back()} hitSlop={10} style={{ position: "absolute", top: 52, left: 20 }}><ArrowLeft color={colors.fg.default} size={22} /></Pressable>
    <View style={{ gap: 8 }}>
      <Wallet color={colors.fg.default} size={28} />
      <Text style={{ color: colors.fg.default, fontFamily: fonts.sans.semibold, fontSize: 25 }}>Activate HelixBox</Text>
      <Text style={{ color: colors.fg.muted, fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 21 }}>Choose access for your connected CLI session. Your editor stays free until you start an agent session.</Text>
    </View>
    <Text style={{ color: colors.fg.muted, fontFamily: fonts.sans.regular, fontSize: 13 }}>Approve the USDC payment in MetaMask on Solana Mainnet.</Text>
    <View style={{ gap: 10 }}>
      <Pressable disabled={busy} onPress={() => pay("hour")} style={{ backgroundColor: colors.bg.raised, borderRadius: 12, padding: 15, opacity: busy ? .55 : 1 }}><Text style={{ color: colors.fg.default, fontFamily: fonts.sans.semibold }}>Pay $0.25 USDC / 1 hour</Text></Pressable>
      <Pressable disabled={busy} onPress={() => pay("week")} style={{ backgroundColor: colors.bg.raised, borderRadius: 12, padding: 15, opacity: busy ? .55 : 1 }}><Text style={{ color: colors.fg.default, fontFamily: fonts.sans.semibold }}>Pay $2 USDC / 7 days</Text></Pressable>
    </View>
    {error && <Text style={{ color: colors.fg.muted, fontFamily: fonts.sans.regular, fontSize: 13 }}>{error}</Text>}
  </View>;
}
