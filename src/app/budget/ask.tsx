import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useMemo, useRef, useState, type JSX } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Composer } from "../../components/composer";
import { PageHeader } from "../../components/screen";
import { DataGate, useAI } from "../../lib/ai";
import {
  ACCOUNT_TYPES,
  CATEGORIES,
  balanceOf,
  byCategory,
  monthKey,
  netWorth,
  peso,
  totalsFor,
  type Account,
  type Category,
  type Txn,
} from "../../lib/budget";
import { listAccounts, listTxns, saveTxn } from "../../lib/ledger";
import { GUESS_LABELS, parseMessage, summarise, type Draft } from "../../lib/moneytalk";
import { useKeyboardOverlap, usePalette } from "../../lib/theme";

/**
 * Questions answered from the ledger, by counting.
 *
 * Every one of these is arithmetic over rows the user entered themselves. None
 * of it goes near the model: a question about your own money has exactly one
 * correct answer, and a sentence that reads well but totals wrong is worse than
 * no answer at all.
 */
function answer(
  question: string,
  accounts: readonly Account[],
  txns: readonly Txn[]
): string | null {
  const text = question.toLowerCase();
  const month = monthKey(new Date().toISOString());
  const totals = totalsFor(txns, month);

  const wantsSpend = /\bspen[dt]|spending|gastos|nagastos\b/.test(text);
  const wantsHave = /\bhave|balance|left|total|net worth|pera\b/.test(text);
  const wantsSaved = /\bsaved?|ipon|put aside\b/.test(text);
  const wantsMost = /\bmost|biggest|largest|highest\b/.test(text);

  if (wantsMost && wantsSpend) {
    const rows = byCategory(txns, month);
    if (rows.length === 0) return "Nothing logged this month yet.";
    return `${CATEGORIES[rows[0].category].label}, at ${peso(rows[0].total)} this month.`;
  }

  // A named wallet beats the general question, so "how much is in GCash" is
  // answered about GCash rather than about everything.
  const named = accounts.find(
    (account) =>
      text.includes(account.name.toLowerCase()) || text.includes(account.type.toLowerCase())
  );
  if (named && (wantsHave || wantsSpend)) {
    return `${named.name} holds ${peso(balanceOf(named, txns))}.`;
  }

  const category = (Object.keys(CATEGORIES) as Category[]).find((key) =>
    text.includes(CATEGORIES[key].label.toLowerCase())
  );
  if (category && wantsSpend) {
    const row = byCategory(txns, month).find((entry) => entry.category === category);
    return `${peso(row?.total ?? 0)} on ${CATEGORIES[category].label} this month.`;
  }

  if (wantsSaved) {
    return totals.net > 0
      ? `${peso(totals.net)} more came in than went out this month.`
      : `Nothing put aside this month — ${peso(-totals.net)} more went out than came in.`;
  }
  if (wantsSpend) return `${peso(totals.expense)} out this month, across every wallet.`;
  if (wantsHave) return `${peso(netWorth(accounts, txns))} across ${accounts.length} accounts.`;

  return null;
}

/**
 * The money assistant's own face: the same creature as the chef, in a
 * deerstalker with a magnifying glass.
 *
 * A separate avatar rather than reusing Mascot, because this one does a
 * different job. The chef answers questions about your notes; this one goes
 * through your spending. Same character, so the app still feels like one app.
 */
function Detective({ size = 30 }: { size?: number }): JSX.Element {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="items-center justify-center overflow-hidden rounded-full"
      style={{ width: size, height: size, backgroundColor: "#16181D" }}
    >
      <Image
        source={require("../../../assets/images/detective-avatar.png")}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    </View>
  );
}

type Turn =
  | { role: "you"; text: string }
  | { role: "bot"; text: string }
  | { role: "drafts"; drafts: Draft[]; done: boolean };

function DraftRow({
  draft,
  accounts,
  first,
}: {
  draft: Draft;
  accounts: readonly Account[];
  first: boolean;
}): JSX.Element {
  const palette = usePalette();
  const account = accounts.find((item) => item.id === draft.txn.accountId);
  const brand = account ? ACCOUNT_TYPES[account.type].colour : palette.muted;
  const icon =
    draft.txn.kind === "transfer"
      ? "swap-horizontal"
      : draft.txn.kind === "income"
        ? "arrow-down"
        : CATEGORIES[draft.txn.category ?? "other"].icon;
  const label = summarise(draft, accounts);

  return (
    <View
      className={`flex-row items-center gap-3 px-3 py-2.5 ${first ? "" : "border-t border-border"}`}
    >
      <View
        className="h-8 w-8 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${brand}1A` }}
      >
        <Ionicons name={icon as never} size={15} color={brand} />
      </View>
      <View className="flex-1">
        <Typography.Paragraph className="font-ui-medium text-[13.5px]" numberOfLines={1}>
          {draft.txn.note?.trim() || label}
        </Typography.Paragraph>
        <Typography.Paragraph className="font-ui text-muted text-[11px]" numberOfLines={1}>
          {label}
        </Typography.Paragraph>
      </View>
      <View className="items-end">
        <Text
          style={{ fontFamily: "Archivo_600SemiBold", fontSize: 13.5, color: palette.foreground }}
        >
          {peso(draft.txn.amount)}
        </Text>
        {/* Names the fields it had to assume. Without this a row looks equally
            certain about the wallet it invented and the amount it actually
            read, which is the failure mode worth designing against. */}
        {draft.guessed.length > 0 && (
          <Text style={{ fontFamily: "Archivo_500Medium", fontSize: 9.5, color: palette.warning }}>
            {/* Named in the user's terms, not the type's. "assumed kind" was
                the field name leaking out of the parser. */}
            guessed {draft.guessed.map((field) => GUESS_LABELS[field]).join(", ")}
          </Text>
        )}
      </View>
    </View>
  );
}

function BudgetChat(): JSX.Element {
  const { db } = useAI();
  const router = useRouter();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { overlap, onLayout } = useKeyboardOverlap();
  const listRef = useRef<ScrollView>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");

  const refresh = useCallback(() => {
    if (!db) return;
    void listAccounts(db).then(setAccounts);
    void listTxns(db).then(setTxns);
  }, [db]);

  // On focus, not just on mount. Pushed screens stay mounted underneath, so a
  // balance read once at mount still showed the old number after logging
  // something in Budget and coming back — the screen was never told to look
  // again.
  useFocusEffect(refresh);

  const live = useMemo(() => accounts.filter((account) => !account.archived), [accounts]);

  const send = useCallback(() => {
    const text = input.trim();
    if (text === "") return;
    setInput("");

    const drafts = parseMessage(text, live);
    setTurns((previous) => [
      ...previous,
      { role: "you", text },
      drafts.length > 0
        ? { role: "drafts", drafts, done: false }
        : {
            role: "bot",
            text:
              answer(text, live, txns) ??
              "I did not find an amount in that. Try something like “Starbucks 250 from GCash”, or ask what you spent this month.",
          },
    ]);
  }, [input, live, txns]);

  const commit = useCallback(
    (index: number) => {
      const turn = turns[index];
      if (!db || turn?.role !== "drafts") return;
      void Promise.all(turn.drafts.map((draft) => saveTxn(db, draft.txn))).then(() => {
        setTurns((previous) =>
          previous.map((item, position) =>
            position === index && item.role === "drafts" ? { ...item, done: true } : item
          )
        );
        refresh();
      });
    },
    [db, turns, refresh]
  );

  const discard = useCallback((index: number) => {
    setTurns((previous) => previous.filter((_, position) => position !== index));
  }, []);

  return (
    <View className="flex-1 bg-background" onLayout={onLayout}>
      <PageHeader title="Budget" onBack={() => router.back()} />

      <ScrollView
        ref={listRef}
        className="flex-1 px-4"
        contentContainerClassName="pt-4 pb-4 gap-3"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      >
        {turns.length === 0 && (
          <View className="items-center gap-3 pt-6">
            <Detective size={56} />
            <Typography.Paragraph className="text-center font-read text-muted text-[14.5px] leading-[23px]">
              Type what you spent and it goes in the ledger. Several at once is fine, one per line.
              Nothing is saved until you say so.
            </Typography.Paragraph>
            <View className="gap-1.5 self-stretch rounded-2xl border border-border bg-surface p-3.5">
              {[
                "gym 250 from savings",
                "spent 1500 using my gcash yesterday",
                "added 1500 to my emergency fund",
                "sent 2000 to bills from everyday",
                "what did I spend most on?",
              ].map(
                (example) => (
                  <Pressable
                    key={example}
                    accessibilityRole="button"
                    accessibilityLabel={`Use example: ${example}`}
                    onPress={() => setInput(example)}
                  >
                    <Typography.Paragraph className="font-ui text-muted text-[12.5px]">
                      {example}
                    </Typography.Paragraph>
                  </Pressable>
                )
              )}
            </View>
          </View>
        )}

        {turns.map((turn, index) => {
          if (turn.role === "you") {
            return (
              <View
                key={index}
                className="max-w-[85%] self-end rounded-[18px] rounded-br-md bg-surface-tertiary px-3.5 py-2.5"
              >
                <Typography.Paragraph className="font-ui text-[13.5px] leading-[20px]">
                  {turn.text}
                </Typography.Paragraph>
              </View>
            );
          }

          if (turn.role === "bot") {
            return (
              <View key={index} className="flex-row gap-2.5">
                <Detective />
                <View className="flex-1 rounded-[18px] rounded-bl-md border border-border bg-surface px-3.5 py-3">
                  <Typography.Paragraph className="font-read text-[14.5px] leading-[23px]">
                    {turn.text}
                  </Typography.Paragraph>
                </View>
              </View>
            );
          }

          return (
            <View key={index} className="flex-row gap-2.5">
              <Detective />
              <View className="flex-1 gap-2.5 rounded-[18px] rounded-bl-md border border-border bg-surface p-3">
                <View className="flex-row items-center gap-1.5 self-start rounded-full bg-on-device-soft px-2.5 py-1">
                  <Ionicons
                    name={turn.done ? "checkmark-circle" : "reader-outline"}
                    size={12}
                    color={palette.onDevice}
                  />
                  <Text
                    style={{
                      fontFamily: "Archivo_600SemiBold",
                      fontSize: 10,
                      color: palette.onDevice,
                    }}
                  >
                    {turn.done ? "LOGGED" : "READY"}
                  </Text>
                </View>

                <Typography.Paragraph className="font-read text-[14px] leading-[22px]">
                  {turn.done ? "Logged" : "Ready to log"} {turn.drafts.length} transaction
                  {turn.drafts.length === 1 ? "" : "s"}
                  {turn.done ? "." : " — check them first."}
                </Typography.Paragraph>

                <View className="overflow-hidden rounded-xl border border-border">
                  {turn.drafts.map((draft, position) => (
                    <DraftRow
                      key={draft.txn.id}
                      draft={draft}
                      accounts={live}
                      first={position === 0}
                    />
                  ))}
                </View>

                {!turn.done && (
                  <View className="flex-row gap-2">
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => discard(index)}
                      className="min-h-[38px] justify-center rounded-full border border-border px-3.5 active:opacity-70"
                    >
                      <Text
                        style={{
                          fontFamily: "Archivo_600SemiBold",
                          fontSize: 12.5,
                          color: palette.muted,
                        }}
                      >
                        Cancel
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => commit(index)}
                      className="min-h-[38px] flex-1 items-center justify-center rounded-full active:opacity-80"
                      style={{ backgroundColor: palette.accent }}
                    >
                      <Text
                        style={{
                          fontFamily: "Archivo_600SemiBold",
                          fontSize: 12.5,
                          color: palette.accentForeground,
                        }}
                      >
                        Log {turn.drafts.length === 1 ? "it" : "them"}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <Composer
        value={input}
        onChange={setInput}
        onSend={send}
        editable={live.length > 0}
        placeholder={live.length === 0 ? "Add a wallet first" : "Lunch 250 from GCash…"}
        overlap={overlap}
        bottomInset={insets.bottom}
        footnote={
          /* Not the usual "AI can make mistakes" line, because this is not a
             model. It reads the numbers by rule and shows every row before it
             writes any of them. */
          <Typography.Paragraph className="text-center font-ui text-[10px] text-muted-soft">
            Read on this phone by rule, not by a model. Nothing is saved until you tap Log.
          </Typography.Paragraph>
        }
      />
    </View>
  );
}

export default function BudgetChatScreen(): JSX.Element {
  return (
    <DataGate>
      <BudgetChat />
    </DataGate>
  );
}
