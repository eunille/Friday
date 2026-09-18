import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useConfirm } from "../../components/dialog";
import { IconButton, PageHeader } from "../../components/screen";
import { ModelGate, newNoteId, useAI } from "../../lib/ai";
import {
  ACCOUNT_TYPES,
  CATEGORIES,
  INCOME_SOURCES,
  balanceOf,
  monthKey,
  netWorth,
  parseAmount,
  peso,
  totalsFor,
  type Account,
  type Category,
  type IncomeSource,
  type Txn,
  type TxnKind,
} from "../../lib/budget";
import { relativeDate } from "../../lib/formats";
import { deleteTxn, listAccounts, listTxns, saveTxn } from "../../lib/ledger";
import { usePalette } from "../../lib/theme";

const KINDS: { kind: TxnKind; label: string }[] = [
  { kind: "expense", label: "Expense" },
  { kind: "income", label: "Income" },
  { kind: "transfer", label: "Transfer" },
];

const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];
const SOURCE_KEYS = Object.keys(INCOME_SOURCES) as IncomeSource[];

/** A fresh expense, dated now, against whichever account comes first. */
function blank(accountId: string): Txn {
  return {
    id: newNoteId(),
    kind: "expense",
    amount: 0,
    accountId,
    category: "food",
    at: new Date().toISOString(),
  };
}

function Chip({
  label,
  on,
  tint,
  onPress,
}: {
  label: string;
  on: boolean;
  tint?: string;
  onPress: () => void;
}): JSX.Element {
  const palette = usePalette();
  const colour = tint ?? palette.accent;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      className="min-h-[36px] justify-center rounded-full border px-3.5"
      style={{
        backgroundColor: on ? colour : "transparent",
        borderColor: on ? colour : palette.border,
      }}
    >
      <Text
        style={{
          fontFamily: "Archivo_600SemiBold",
          fontSize: 12.5,
          color: on ? (tint ? "#fff" : palette.accentForeground) : palette.muted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Add or edit one transaction.
 *
 * Transfer swaps the category row for a second account picker, because a
 * transfer has no category — it is not spending, and offering one would invite
 * filing money you still have under Food.
 */
function Editor({
  draft,
  accounts,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Txn;
  accounts: readonly Account[];
  onChange: (next: Txn) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}): JSX.Element {
  const palette = usePalette();

  // Seeded once, never synced back. An effect mirroring `draft` would re-run on
  // every keystroke and rewrite what is being typed.
  const [amount, setAmount] = useState(() =>
    draft.amount === 0 ? "" : String(draft.amount / 100)
  );
  const editing = draft.amount > 0;

  const parsed = parseAmount(amount);
  const valid =
    parsed !== null &&
    parsed > 0 &&
    (draft.kind !== "transfer" || (!!draft.toAccountId && draft.toAccountId !== draft.accountId));

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
        <ScrollView
          className="max-h-[88%] rounded-t-[26px] border border-border bg-surface"
          contentContainerClassName="p-5 pb-8 gap-4"
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-row items-center justify-between">
            <Typography.Heading type="h2" className="font-ui-bold text-[19px]">
              {editing ? "Edit transaction" : "New transaction"}
            </Typography.Heading>
            <IconButton name="close" label="Close" tone="muted" onPress={onClose} />
          </View>

          <View className="flex-row gap-2">
            {KINDS.map(({ kind, label }) => (
              <Chip
                key={kind}
                label={label}
                on={draft.kind === kind}
                onPress={() =>
                  onChange({
                    ...draft,
                    kind,
                    // Each kind carries a different third field, so the other
                    // two are cleared rather than left to be written to the row.
                    category: kind === "expense" ? (draft.category ?? "food") : undefined,
                    source: kind === "income" ? (draft.source ?? "salary") : undefined,
                    toAccountId: kind === "transfer" ? draft.toAccountId : undefined,
                  })
                }
              />
            ))}
          </View>

          <TextInput
            value={amount}
            onChangeText={(text) => {
              setAmount(text);
              onChange({ ...draft, amount: parseAmount(text) ?? 0 });
            }}
            keyboardType="decimal-pad"
            autoFocus
            placeholder="0.00"
            placeholderTextColor={palette.muted}
            className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui-bold text-[26px] text-foreground"
          />

          <View className="gap-2">
            <Typography.Paragraph className="font-ui-medium text-muted text-[12px]">
              {draft.kind === "transfer" ? "From" : "Account"}
            </Typography.Paragraph>
            <View className="flex-row flex-wrap gap-2">
              {accounts.map((account) => (
                <Chip
                  key={account.id}
                  label={account.name}
                  tint={ACCOUNT_TYPES[account.type].colour}
                  on={draft.accountId === account.id}
                  onPress={() => onChange({ ...draft, accountId: account.id })}
                />
              ))}
            </View>
          </View>

          {draft.kind === "transfer" ? (
            <View className="gap-2">
              <Typography.Paragraph className="font-ui-medium text-muted text-[12px]">
                To
              </Typography.Paragraph>
              <View className="flex-row flex-wrap gap-2">
                {accounts
                  .filter((account) => account.id !== draft.accountId)
                  .map((account) => (
                    <Chip
                      key={account.id}
                      label={account.name}
                      tint={ACCOUNT_TYPES[account.type].colour}
                      on={draft.toAccountId === account.id}
                      onPress={() => onChange({ ...draft, toAccountId: account.id })}
                    />
                  ))}
              </View>
            </View>
          ) : (
            <View className="gap-2">
              <Typography.Paragraph className="font-ui-medium text-muted text-[12px]">
                {draft.kind === "income" ? "Source" : "Category"}
              </Typography.Paragraph>
              <View className="flex-row flex-wrap gap-2">
                {draft.kind === "income"
                  ? SOURCE_KEYS.map((source) => (
                      <Chip
                        key={source}
                        label={INCOME_SOURCES[source].label}
                        on={draft.source === source}
                        onPress={() => onChange({ ...draft, source })}
                      />
                    ))
                  : CATEGORY_KEYS.map((category) => (
                      <Chip
                        key={category}
                        label={CATEGORIES[category].label}
                        on={draft.category === category}
                        onPress={() => onChange({ ...draft, category })}
                      />
                    ))}
              </View>
            </View>
          )}

          <TextInput
            value={draft.note ?? ""}
            onChangeText={(note) => onChange({ ...draft, note })}
            placeholder="Note (optional)"
            placeholderTextColor={palette.muted}
            className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui text-[15px] text-foreground"
          />

          <View className="flex-row gap-2">
            {editing && (
              <Pressable
                accessibilityRole="button"
                onPress={onDelete}
                className="min-h-[46px] justify-center rounded-full border border-border px-4 active:opacity-70"
              >
                <Text
                  style={{ fontFamily: "Archivo_600SemiBold", fontSize: 14, color: palette.danger }}
                >
                  Delete
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={!valid}
              onPress={onSave}
              className="min-h-[46px] flex-1 items-center justify-center rounded-full active:opacity-80"
              style={{ backgroundColor: palette.accent, opacity: valid ? 1 : 0.4 }}
            >
              <Text
                style={{
                  fontFamily: "Archivo_600SemiBold",
                  fontSize: 14,
                  color: palette.accentForeground,
                }}
              >
                Save
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** One line in the ledger. */
function Row({
  txn,
  accounts,
  onPress,
  first,
}: {
  txn: Txn;
  accounts: readonly Account[];
  onPress: () => void;
  first: boolean;
}): JSX.Element {
  const palette = usePalette();
  const from = accounts.find((account) => account.id === txn.accountId);
  const to = accounts.find((account) => account.id === txn.toAccountId);

  const title =
    txn.kind === "transfer"
      ? `${from?.name ?? "?"} → ${to?.name ?? "?"}`
      : txn.kind === "income"
        ? INCOME_SOURCES[txn.source ?? "other"].label
        : CATEGORIES[txn.category ?? "other"].label;

  const icon =
    txn.kind === "transfer"
      ? "swap-horizontal"
      : txn.kind === "income"
        ? "arrow-down"
        : CATEGORIES[txn.category ?? "other"].icon;

  const tint =
    txn.kind === "transfer"
      ? palette.muted
      : txn.kind === "income"
        ? palette.onDevice
        : palette.foreground;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${peso(txn.amount)}`}
      onPress={onPress}
      className={`min-h-[58px] flex-row items-center gap-3 px-3.5 py-2.5 active:bg-surface-tertiary ${
        first ? "" : "border-t border-border"
      }`}
    >
      <View
        className="h-9 w-9 items-center justify-center rounded-xl"
        style={{ backgroundColor: from ? `${ACCOUNT_TYPES[from.type].colour}1A` : palette.border }}
      >
        <Ionicons
          name={icon as never}
          size={16}
          color={from ? ACCOUNT_TYPES[from.type].colour : palette.muted}
        />
      </View>
      <View className="flex-1">
        <Typography.Paragraph className="font-ui-medium text-[14px]" numberOfLines={1}>
          {txn.note?.trim() || title}
        </Typography.Paragraph>
        <Typography.Paragraph className="font-ui text-muted text-[11.5px]" numberOfLines={1}>
          {relativeDate(txn.at)} · {txn.kind === "transfer" ? title : (from?.name ?? "Unknown")}
        </Typography.Paragraph>
      </View>
      {/* A transfer carries no sign: nothing was gained or lost, so either one
          would be a lie about the total. */}
      <Text style={{ fontFamily: "Archivo_600SemiBold", fontSize: 14.5, color: tint }}>
        {txn.kind === "transfer"
          ? peso(txn.amount)
          : peso(txn.kind === "income" ? txn.amount : -txn.amount, { sign: true })}
      </Text>
    </Pressable>
  );
}

function Budget(): JSX.Element {
  const { db } = useAI();
  const router = useRouter();
  const palette = usePalette();
  const confirm = useConfirm();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [draft, setDraft] = useState<Txn | null>(null);
  const [filter, setFilter] = useState<"all" | TxnKind>("all");

  const refresh = useCallback(() => {
    if (!db) return;
    void listAccounts(db).then(setAccounts);
    void listTxns(db).then(setTxns);
  }, [db]);

  useEffect(refresh, [refresh]);

  const live = useMemo(() => accounts.filter((account) => !account.archived), [accounts]);
  const month = monthKey(new Date().toISOString());
  const totals = useMemo(() => totalsFor(txns, month), [txns, month]);
  const shown = useMemo(
    () => (filter === "all" ? txns : txns.filter((txn) => txn.kind === filter)),
    [txns, filter]
  );

  const commit = useCallback(() => {
    if (!db || !draft) return;
    void saveTxn(db, draft).then(() => {
      setDraft(null);
      refresh();
    });
  }, [db, draft, refresh]);

  const remove = useCallback(() => {
    if (!db || !draft) return;
    const target = draft;
    setDraft(null);
    confirm.ask({
      title: "Delete this transaction?",
      message: `${peso(target.amount)} comes back out of every balance and total it is counted in.`,
      action: "Delete",
      destructive: true,
      onConfirm: () => void deleteTxn(db, target.id).then(refresh),
    });
  }, [db, draft, confirm, refresh]);

  const held = useMemo(
    () => live.reduce((sum, account) => sum + balanceOf(account, txns), 0),
    [live, txns]
  );

  return (
    <View className="flex-1 bg-background">
      <PageHeader
        title="Money"
        onBack={() => router.back()}
        right={
          <IconButton
            name="add"
            label="Add transaction"
            bordered
            disabled={live.length === 0}
            onPress={() => setDraft(blank(live[0].id))}
          />
        }
      />

      <ScrollView contentContainerClassName="px-4 pt-4 pb-10 gap-4">
        <View className="gap-3 rounded-[22px] p-4" style={{ backgroundColor: palette.ink }}>
          <View>
            <Text
              style={{
                color: palette.inkForeground,
                opacity: 0.6,
                fontFamily: "Archivo_600SemiBold",
                fontSize: 10.5,
                letterSpacing: 1,
              }}
            >
              TOTAL BALANCE
            </Text>
            <Text
              style={{
                color: palette.inkForeground,
                fontFamily: "Archivo_600SemiBold",
                fontSize: 30,
              }}
            >
              {peso(netWorth(live, txns))}
            </Text>
          </View>
          <View className="flex-row gap-6">
            {[
              { label: "In this month", value: totals.income },
              { label: "Out this month", value: totals.expense },
            ].map((item) => (
              <View key={item.label}>
                <Text
                  style={{
                    color: palette.inkForeground,
                    opacity: 0.55,
                    fontFamily: "Archivo_400Regular",
                    fontSize: 11,
                  }}
                >
                  {item.label}
                </Text>
                <Text
                  style={{
                    color: palette.inkForeground,
                    fontFamily: "Archivo_600SemiBold",
                    fontSize: 15,
                  }}
                >
                  {peso(item.value)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open accounts"
          onPress={() => router.push("/budget/accounts")}
          className="min-h-[56px] flex-row items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 active:bg-surface-tertiary"
        >
          <Ionicons name="wallet-outline" size={19} color={palette.muted} />
          <View className="flex-1">
            <Typography.Paragraph className="font-ui-medium text-[14.5px]">
              Accounts
            </Typography.Paragraph>
            <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
              {live.length === 0
                ? "Add your first wallet"
                : `${live.length} wallet${live.length === 1 ? "" : "s"} · ${peso(held)} held`}
            </Typography.Paragraph>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.muted} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log money by typing it"
          disabled={live.length === 0}
          onPress={() => router.push("/budget/ask")}
          className="min-h-[56px] flex-row items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 active:bg-surface-tertiary"
          style={{ opacity: live.length === 0 ? 0.5 : 1 }}
        >
          <Ionicons name="chatbubble-outline" size={19} color={palette.muted} />
          <View className="flex-1">
            <Typography.Paragraph className="font-ui-medium text-[14.5px]">
              Ask
            </Typography.Paragraph>
            <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
              Type “Starbucks 250 from GCash” and it files itself.
            </Typography.Paragraph>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.muted} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open recurring bills and forecast"
          disabled={live.length === 0}
          onPress={() => router.push("/budget/bills")}
          className="min-h-[56px] flex-row items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 active:bg-surface-tertiary"
          style={{ opacity: live.length === 0 ? 0.5 : 1 }}
        >
          <Ionicons name="repeat-outline" size={19} color={palette.muted} />
          <View className="flex-1">
            <Typography.Paragraph className="font-ui-medium text-[14.5px]">
              Repeats
            </Typography.Paragraph>
            <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
              Bills, salary, and what you are left with.
            </Typography.Paragraph>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.muted} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open spending charts"
          disabled={txns.length === 0}
          onPress={() => router.push("/budget/charts")}
          className="min-h-[56px] flex-row items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 active:bg-surface-tertiary"
          style={{ opacity: txns.length === 0 ? 0.5 : 1 }}
        >
          <Ionicons name="stats-chart-outline" size={19} color={palette.muted} />
          <View className="flex-1">
            <Typography.Paragraph className="font-ui-medium text-[14.5px]">
              Charts
            </Typography.Paragraph>
            <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
              In against out, and where it went.
            </Typography.Paragraph>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.muted} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open budgets and savings goals"
          onPress={() => router.push("/budget/plan")}
          className="min-h-[56px] flex-row items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 active:bg-surface-tertiary"
        >
          <Ionicons name="flag-outline" size={19} color={palette.muted} />
          <View className="flex-1">
            <Typography.Paragraph className="font-ui-medium text-[14.5px]">
              Plan
            </Typography.Paragraph>
            <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
              Monthly limits and what you are saving for.
            </Typography.Paragraph>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.muted} />
        </Pressable>

        {live.length === 0 ? (
          <Typography.Paragraph className="pt-4 text-center font-read text-muted text-[15px] leading-6">
            Add a wallet first — every transaction has to come out of somewhere.
          </Typography.Paragraph>
        ) : (
          <>
            <View className="flex-row gap-2">
              {(["all", "expense", "income", "transfer"] as const).map((key) => (
                <Chip
                  key={key}
                  label={key === "all" ? "All" : (KINDS.find((k) => k.kind === key)?.label ?? key)}
                  on={filter === key}
                  onPress={() => setFilter(key)}
                />
              ))}
            </View>

            {shown.length === 0 ? (
              <Typography.Paragraph className="pt-4 text-center font-read text-muted text-[15px] leading-6">
                Nothing logged yet. Tap + to record what you spent.
              </Typography.Paragraph>
            ) : (
              <View className="overflow-hidden rounded-2xl border border-border bg-surface">
                {shown.map((txn, index) => (
                  <Row
                    key={txn.id}
                    txn={txn}
                    accounts={accounts}
                    first={index === 0}
                    onPress={() => setDraft(txn)}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {draft && (
        <Editor
          key={draft.id}
          draft={draft}
          accounts={live}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={commit}
          onDelete={remove}
        />
      )}
      {confirm.dialog}
    </View>
  );
}

export default function BudgetScreen(): JSX.Element {
  return (
    <ModelGate>
      <Budget />
    </ModelGate>
  );
}
