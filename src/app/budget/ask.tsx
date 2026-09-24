import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useMemo, useRef, useState, type JSX } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Composer } from "../../components/composer";
import { Mascot, PageHeader } from "../../components/screen";
import { DataGate, useAI } from "../../lib/ai";
import {
  ACCOUNT_TYPES,
  CATEGORIES,
  categoryOf,
  balanceOf,
  byCategory,
  monthKey,
  monthsEnding,
  netWorth,
  openingFor,
  peso,
  totalsFor,
  type Account,
  type Category,
  type Txn,
} from "../../lib/budget";
import { listAccounts, listTxns, saveAccount, saveTxn } from "../../lib/ledger";
import {
  GUESS_LABELS,
  parseBalance,
  parseMessage,
  summarise,
  type BalanceSet,
  type Draft,
} from "../../lib/moneytalk";
import { useKeyboardOverlap, usePalette } from "../../lib/theme";

/**
 * The model's brief for anything the ledger cannot answer by counting — "how
 * do I start an emergency fund?", "is MP2 worth it?". It gets the person's own
 * figures so the advice is about their month, and is told not to make up any
 * others: every number it may quote is in the context.
 */
const COACH = [
  "You are Friday, a friendly money coach for someone in the Philippines.",
  "Give practical, specific advice in at most five short bullet points.",
  "Use only the figures in the context when you mention numbers; never invent balances or totals.",
  "You may explain Philippine options like Pag-IBIG MP2, SSS, digital banks, and index funds in general terms, but do not recommend specific stocks or coins.",
].join("\n");

/** Enough for five bullets. A small model past this is only repeating itself. */
const COACH_TOKENS = 320;

/** The person's month as the model will read it. */
function snapshot(accounts: readonly Account[], txns: readonly Txn[]): string {
  const month = monthKey(new Date().toISOString());
  const totals = totalsFor(txns, month);
  const top = byCategory(txns, month)
    .slice(0, 4)
    .map((row) => `${categoryOf(row.category).label} ${peso(row.total)}`)
    .join(", ");
  return [
    `Net worth: ${peso(netWorth(accounts, txns))}.`,
    `This month: ${peso(totals.income)} in, ${peso(totals.expense)} out.`,
    top ? `Biggest spending this month: ${top}.` : "No spending logged this month.",
    `Wallets: ${accounts
      .map((account) => `${account.name} (${ACCOUNT_TYPES[account.type].label}) ${peso(balanceOf(account, txns))}`)
      .join("; ")}.`,
  ].join("\n");
}

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
  const wantsHave = /\bhave|balance|left|total|net worth|worth|pera\b/.test(text);
  const wantsSaved = /\bsaved?|ipon|put aside\b/.test(text);
  const wantsMost = /\bmost|biggest|largest|highest\b/.test(text);
  const wantsList = /\b(?:wallets|accounts|balances)\b/.test(text);

  // "Last month" is the other period people actually ask about.
  const lastMonth = /\blast month|nakaraang buwan\b/.test(text);
  const period = lastMonth ? monthsEnding(month, 2)[0] : month;
  const periodName = lastMonth ? "last month" : "this month";

  if (wantsList) {
    if (accounts.length === 0) return "No wallets yet.";
    return accounts
      .map((account) => `${account.name}: ${peso(balanceOf(account, txns))}`)
      .concat(`Net worth: ${peso(netWorth(accounts, txns))}`)
      .join("\n");
  }

  if (wantsMost && wantsSpend) {
    const rows = byCategory(txns, period);
    if (rows.length === 0) return `Nothing logged ${periodName}.`;
    return `${categoryOf(rows[0].category).label}, at ${peso(rows[0].total)} ${periodName}.`;
  }

  // Today, which is what "how much have I spent" usually means by evening.
  if (wantsSpend && /\btoday|ngayon\b/.test(text)) {
    const day = new Date().toISOString().slice(0, 10);
    const spent = txns
      .filter((txn) => txn.kind === "expense" && txn.at.slice(0, 10) === day)
      .reduce((total, txn) => total + txn.amount, 0);
    return `${peso(spent)} out today.`;
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
    text.includes(categoryOf(key).label.toLowerCase())
  );
  if (category && wantsSpend) {
    const row = byCategory(txns, period).find((entry) => entry.category === category);
    return `${peso(row?.total ?? 0)} on ${categoryOf(category).label} ${periodName}.`;
  }

  const inPeriod = lastMonth ? totalsFor(txns, period) : totals;
  if (wantsSaved) {
    return inPeriod.net > 0
      ? `${peso(inPeriod.net)} more came in than went out ${periodName}.`
      : `Nothing put aside ${periodName} — ${peso(-inPeriod.net)} more went out than came in.`;
  }
  if (wantsSpend) return `${peso(inPeriod.expense)} out ${periodName}, across every wallet.`;
  if (wantsHave) return `${peso(netWorth(accounts, txns))} across ${accounts.length} accounts.`;

  return null;
}

type Turn =
  | { role: "you"; text: string }
  | { role: "bot"; text: string }
  | { role: "drafts"; drafts: Draft[]; done: boolean }
  | { role: "balance"; set: BalanceSet; was: number; done: boolean };

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
        : categoryOf(draft.txn.category).icon;
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
  const { db, rag } = useAI();
  const [thinking, setThinking] = useState(false);
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

  /**
   * Anything the rules cannot place goes to the model, with the person's own
   * figures attached. Streamed into the last turn, like the Tutor.
   */
  const coach = useCallback(
    async (question: string) => {
      if (!rag) {
        setTurns((previous) => [
          ...previous,
          {
            role: "bot",
            text: "The model is still getting ready, so I can only log and count right now. Try again in a moment.",
          },
        ]);
        return;
      }
      setThinking(true);
      setTurns((previous) => [...previous, { role: "bot", text: "" }]);
      const write = (text: string): void =>
        setTurns((previous) =>
          previous.map((turn, at) =>
            at === previous.length - 1 && turn.role === "bot" ? { ...turn, text } : turn
          )
        );
      let out = "";
      let tokens = 0;
      try {
        await rag.generate({
          input: [
            { role: "system", content: COACH },
            { role: "user", content: `Context:\n${snapshot(live, txns)}\n\nQuestion: ${question}` },
          ],
          augmentedGeneration: false,
          callback: (token) => {
            out += token;
            tokens += 1;
            write(out);
            if (tokens === COACH_TOKENS) void rag.interrupt();
          },
        });
        write(out.trim() || "I couldn't put an answer together for that. Try asking it another way.");
      } catch (error) {
        write(`Couldn't answer that: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setThinking(false);
      }
    },
    [rag, live, txns]
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (text === "" || thinking) return;
    setInput("");

    // "Set gcash to 1500", "bitcoin is now worth 52k" — what a wallet holds,
    // not something that happened. Checked first: it has an amount too.
    const set = parseBalance(text, live);
    if (set) {
      const account = live.find((item) => item.id === set.accountId);
      setTurns((previous) => [
        ...previous,
        { role: "you", text },
        { role: "balance", set, was: account ? balanceOf(account, txns) : 0, done: false },
      ]);
      return;
    }

    const drafts = parseMessage(text, live);
    if (drafts.length > 0) {
      setTurns((previous) => [
        ...previous,
        { role: "you", text },
        { role: "drafts", drafts, done: false },
      ]);
      return;
    }

    setTurns((previous) => [...previous, { role: "you", text }]);
    const counted = answer(text, live, txns);
    if (counted) setTurns((previous) => [...previous, { role: "bot", text: counted }]);
    else void coach(text);
  }, [input, live, txns, thinking, coach]);

  const setBalance = useCallback(
    (index: number) => {
      const turn = turns[index];
      if (!db || turn?.role !== "balance") return;
      const account = live.find((item) => item.id === turn.set.accountId);
      if (!account) return;
      // The opening balance moves so the derived balance lands on the number
      // given — see openingFor. Nothing is logged: a price moving is neither
      // income nor spending.
      void saveAccount(db, {
        ...account,
        openingBalance: openingFor(account.id, txns, turn.set.balance),
      }).then(() => {
        setTurns((previous) =>
          previous.map((item, position) =>
            position === index && item.role === "balance" ? { ...item, done: true } : item
          )
        );
        refresh();
      });
    },
    [db, turns, live, txns, refresh]
  );

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
            <Mascot pose="earn" size={68} />
            <Typography.Paragraph className="text-center font-read text-muted text-[14.5px] leading-[23px]">
              Say what you spent, earned or moved and it goes in the ledger — several at once is
              fine. Ask about your money, or for tips. Nothing is saved until you say so.
            </Typography.Paragraph>
            <View className="gap-1.5 self-stretch rounded-2xl border border-border bg-surface p-3.5">
              {[
                "lunch 150 and coffee 120 from gcash",
                "withdrew 2k from bpi",
                "paid 2000 to mp2 from bpi",
                "bitcoin is now worth 52k",
                "what did I spend most on last month?",
                "how do I build an emergency fund?",
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
                <Mascot pose="savings" size={38} />
                <View className="flex-1 rounded-[18px] rounded-bl-md border border-border bg-surface px-3.5 py-3">
                  <Typography.Paragraph
                    className={`font-read text-[14.5px] leading-[23px] ${turn.text ? "" : "text-muted"}`}
                  >
                    {turn.text || "Thinking on device…"}
                  </Typography.Paragraph>
                </View>
              </View>
            );
          }

          if (turn.role === "balance") {
            const account = live.find((item) => item.id === turn.set.accountId);
            const change = turn.set.balance - turn.was;
            return (
              <View key={index} className="flex-row gap-2.5">
                <Mascot pose="savings" size={38} />
                <View className="flex-1 gap-2.5 rounded-[18px] rounded-bl-md border border-border bg-surface p-3">
                  <Typography.Paragraph className="font-read text-[14px] leading-[22px]">
                    {turn.done
                      ? `${account?.name ?? "Wallet"} now holds ${peso(turn.set.balance)}.`
                      : `Set ${account?.name ?? "this wallet"} to ${peso(turn.set.balance)}? It holds ${peso(turn.was)} now — ${peso(change, { sign: true })}.`}
                  </Typography.Paragraph>
                  {!turn.done && (
                    <>
                      <Typography.Paragraph className="font-ui text-[11px] text-muted">
                        Changes the balance only. Nothing is logged as income or spending.
                      </Typography.Paragraph>
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
                          onPress={() => setBalance(index)}
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
                            Update balance
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>
              </View>
            );
          }

          return (
            <View key={index} className="flex-row gap-2.5">
              <Mascot pose="savings" size={38} />
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
                  {`${turn.done ? "Logged" : "Ready to log"} ${turn.drafts.length} transaction${
                    turn.drafts.length === 1 ? "" : "s"
                  }${turn.done ? "." : " — check them first."}`}
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
        busy={thinking}
        onStop={() => void rag?.interrupt()}
        placeholder={live.length === 0 ? "Add a wallet first" : "Lunch 250 from GCash…"}
        overlap={overlap}
        bottomInset={insets.bottom}
        footnote={
          /* Amounts are read by rule and every row is shown before it is
             written; only tips come from the model, which is told to quote no
             figure it was not given. */
          <Typography.Paragraph className="text-center font-ui text-[10px] text-muted-soft">
            Amounts are read by rule, never by the model. Tips are general, not financial advice.
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
