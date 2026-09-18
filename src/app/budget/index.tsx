import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Svg, { G, Rect } from "react-native-svg";

import { useConfirm } from "../../components/dialog";
import { IconButton, PageHeader } from "../../components/screen";
import { DataGate, newNoteId, useAI } from "../../lib/ai";
import {
  ACCOUNT_TYPES,
  CATEGORIES,
  INCOME_SOURCES,
  balanceOf,
  byCategory,
  monthKey,
  monthsEnding,
  netWorth,
  parseAmount,
  peso,
  totalsFor,
  type Account,
  type AccountType,
  type Category,
  type IncomeSource,
  type Txn,
  type TxnKind,
} from "../../lib/budget";
import { relativeDate } from "../../lib/formats";
import {
  countTxns,
  deleteAccount,
  deleteTxn,
  listAccounts,
  listTxns,
  saveAccount,
  saveTxn,
} from "../../lib/ledger";
import { usePalette } from "../../lib/theme";

const KINDS: { kind: TxnKind; label: string }[] = [
  { kind: "expense", label: "Expense" },
  { kind: "income", label: "Income" },
  { kind: "transfer", label: "Transfer" },
];

const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];
const WALLET_TYPES = Object.keys(ACCOUNT_TYPES) as AccountType[];
const SOURCE_KEYS = Object.keys(INCOME_SOURCES) as IncomeSource[];

/**
 * In against out, six months, drawn small.
 *
 * Deliberately unlabelled. At this size axis figures are unreadable and the
 * point is the silhouette — whether the dark bars are outgrowing the light
 * ones. The Charts screen carries the same thing with its numbers.
 */
function SixMonths({ txns, month }: { txns: readonly Txn[]; month: string }): JSX.Element {
  const palette = usePalette();
  const W = 300;
  const H = 54;
  const rows = monthsEnding(month, 6).map((key) => totalsFor(txns, key));
  // Floored at 1 so a run of empty months divides by something instead of
  // producing NaN heights that quietly render nothing at all.
  const peak = Math.max(1, ...rows.map((row) => Math.max(row.income, row.expense)));
  const slot = W / rows.length;

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      {rows.map((row, index) => {
        const centre = slot * index + slot / 2;
        const income = (row.income / peak) * (H - 4);
        const expense = (row.expense / peak) * (H - 4);
        return (
          <G key={index}>
            <Rect
              x={centre - 11}
              y={H - income}
              width={9}
              height={income}
              rx={2}
              fill={palette.onDevice}
            />
            <Rect
              x={centre + 2}
              y={H - expense}
              width={9}
              height={expense}
              rx={2}
              fill={palette.money}
            />
          </G>
        );
      })}
    </Svg>
  );
}

/** Where this month went, as one bar rather than a ring — it costs less height. */
function Split({ txns, month }: { txns: readonly Txn[]; month: string }): JSX.Element {
  const palette = usePalette();
  const rows = byCategory(txns, month).slice(0, 4);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  if (total === 0) return <View />;

  return (
    <View className="gap-2">
      <View className="h-2 flex-row gap-0.5 overflow-hidden rounded-full">
        {rows.map((row, index) => (
          <View
            key={row.category}
            style={{
              flex: row.total,
              backgroundColor: palette.foreground,
              opacity: 1 - index * 0.2,
            }}
          />
        ))}
      </View>
      <View className="flex-row flex-wrap gap-x-3 gap-y-1">
        {rows.map((row, index) => (
          <View key={row.category} className="flex-row items-center gap-1.5">
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 2,
                backgroundColor: palette.foreground,
                opacity: 1 - index * 0.2,
              }}
            />
            <Typography.Paragraph className="font-ui text-muted text-[10.5px]">
              {CATEGORIES[row.category].label} {Math.round((row.total / total) * 100)}%
            </Typography.Paragraph>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * One wallet, as a card you can swipe past.
 *
 * Brand colour, white type: you find GCash by its blue rather than by reading
 * five labels. These are the only saturated things on the screen apart from the
 * balance above them.
 */
function WalletCard({
  account,
  balance,
  onPress,
}: {
  account: Account;
  balance: number;
  onPress: () => void;
}): JSX.Element {
  const brand = ACCOUNT_TYPES[account.type];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${account.name}, ${peso(balance)}`}
      onPress={onPress}
      className="h-[92px] w-[150px] justify-between rounded-[18px] p-3 active:opacity-85"
      style={{ backgroundColor: brand.colour }}
    >
      <View className="flex-row items-center gap-1.5">
        <View className="h-5 w-5 items-center justify-center rounded-md bg-white/25">
          <Text style={{ color: "#fff", fontFamily: "Archivo_600SemiBold", fontSize: 10 }}>
            {account.name.slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <Text
          numberOfLines={1}
          style={{ flex: 1, color: "#fff", fontFamily: "Archivo_600SemiBold", fontSize: 12.5 }}
        >
          {account.name}
        </Text>
      </View>
      <Text style={{ color: "#fff", fontFamily: "Archivo_600SemiBold", fontSize: 16 }}>
        {peso(balance)}
      </Text>
    </Pressable>
  );
}

/** Add and edit are the same three fields, so they are the same sheet. */
function WalletEditor({
  draft,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Account;
  onChange: (next: Account) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}): JSX.Element {
  const palette = usePalette();

  // Seeded once, never synced back. The caller remounts this per wallet, so an
  // effect mirroring `draft` would re-run on every keystroke and rewrite what is
  // being typed — "250." would become "250" under the cursor.
  const [amount, setAmount] = useState(() =>
    draft.openingBalance === 0 ? "" : String(draft.openingBalance / 100)
  );
  const existing = draft.name.trim() !== "";

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
        <View className="gap-4 rounded-t-[26px] border border-border bg-surface p-5 pb-8">
          <View className="flex-row items-center justify-between">
            <Typography.Heading type="h2" className="font-ui-bold text-[19px]">
              {existing ? "Edit wallet" : "New wallet"}
            </Typography.Heading>
            <IconButton name="close" label="Close" tone="muted" onPress={onClose} />
          </View>

          <TextInput
            value={draft.name}
            onChangeText={(name) => onChange({ ...draft, name })}
            placeholder="Wallet name"
            placeholderTextColor={palette.muted}
            className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui text-[15px] text-foreground"
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
            <View className="flex-row gap-2 px-1">
              {WALLET_TYPES.map((type) => {
                const brand = ACCOUNT_TYPES[type];
                const on = draft.type === type;
                return (
                  <Pressable
                    key={type}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() =>
                      onChange({
                        ...draft,
                        type,
                        // An untouched name follows the type, so picking GCash
                        // fills in "GCash" and most wallets need no typing.
                        name: draft.name.trim() === "" ? brand.label : draft.name,
                      })
                    }
                    className="min-h-[36px] justify-center rounded-full border px-3.5"
                    style={{
                      backgroundColor: on ? brand.colour : "transparent",
                      borderColor: on ? brand.colour : palette.border,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "Archivo_600SemiBold",
                        fontSize: 12.5,
                        color: on ? "#fff" : palette.muted,
                      }}
                    >
                      {brand.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View className="gap-1.5">
            <TextInput
              value={amount}
              onChangeText={(text) => {
                setAmount(text);
                onChange({ ...draft, openingBalance: parseAmount(text) ?? 0 });
              }}
              keyboardType="decimal-pad"
              placeholder="Starting balance"
              placeholderTextColor={palette.muted}
              className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui text-[15px] text-foreground"
            />
            <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
              What is in it right now. Everything you log from here moves it.
            </Typography.Paragraph>
          </View>

          <View className="flex-row gap-2">
            {existing && (
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
              disabled={!existing}
              onPress={onSave}
              className="min-h-[46px] flex-1 items-center justify-center rounded-full active:opacity-80"
              style={{ backgroundColor: palette.accent, opacity: existing ? 1 : 0.4 }}
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
        </View>
      </View>
    </Modal>
  );
}

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
          {/* A transfer already says both ends on the line above, so repeating
              the route here would print it twice. */}
          {relativeDate(txn.at)}
          {txn.kind === "transfer" ? "" : ` · ${from?.name ?? "Unknown"}`}
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
  const [wallet, setWallet] = useState<Account | null>(null);
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

  const saveWallet = useCallback(() => {
    if (!db || !wallet) return;
    void saveAccount(db, wallet).then(() => {
      setWallet(null);
      refresh();
    });
  }, [db, wallet, refresh]);

  const dropWallet = useCallback(() => {
    if (!db || !wallet) return;
    const target = wallet;
    void countTxns(db, target.id).then((count) => {
      // The sheet closes first: two stacked modals on Android leave the
      // backdrop behind when the inner one goes.
      setWallet(null);
      confirm.ask({
        title: `Delete ${target.name}?`,
        message:
          count > 0
            ? `${count} transaction${count === 1 ? "" : "s"} recorded against it go too, or the totals would stop matching the list that is meant to explain them.`
            : "Nothing has been recorded against it yet.",
        action: "Delete",
        destructive: true,
        onConfirm: () => void deleteAccount(db, target.id).then(refresh),
      });
    });
  }, [db, wallet, confirm, refresh]);

  /** How many of the last six months have anything in them. */
  const active = useMemo(
    () =>
      monthsEnding(month, 6).filter((key) => {
        const totals = totalsFor(txns, key);
        return totals.income > 0 || totals.expense > 0;
      }).length,
    [txns, month]
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
            // Read through a guard rather than as live[0].id inline. The React
            // Compiler hoists that subexpression out of the closure and
            // evaluates it during render, where `disabled` cannot protect it —
            // so with no accounts yet the screen threw before it could draw.
            onPress={() => {
              const first = live[0];
              if (first) setDraft(blank(first.id));
            }}
          />
        }
      />

      <ScrollView contentContainerClassName="px-4 pt-4 pb-10 gap-4">
        {/* The one saturated surface in the app. Money is the subject of this
            screen, so the balance carries the colour and everything below it
            stays quiet — one bold thing reads as emphasis, six read as noise. */}
        <View className="gap-3 rounded-[22px] p-4" style={{ backgroundColor: palette.money }}>
          <View>
            <Text
              style={{
                color: palette.moneyForeground,
                opacity: 0.75,
                fontFamily: "Archivo_500Medium",
                fontSize: 12,
              }}
            >
              Total balance
            </Text>
            <Text
              style={{
                color: palette.moneyForeground,
                fontFamily: "Archivo_600SemiBold",
                fontSize: 34,
                letterSpacing: -0.5,
              }}
            >
              {peso(netWorth(live, txns))}
            </Text>
          </View>
          <View className="flex-row flex-wrap gap-x-5 gap-y-1">
            {[
              { icon: "arrow-down", label: "in this month", value: totals.income },
              { icon: "arrow-up", label: "out this month", value: totals.expense },
            ].map((item) => (
              <View key={item.label} className="flex-row items-center gap-1.5">
                <Ionicons
                  name={item.icon as never}
                  size={13}
                  color={palette.moneyForeground}
                  style={{ opacity: 0.75 }}
                />
                <Text
                  style={{
                    color: palette.moneyForeground,
                    fontFamily: "Archivo_600SemiBold",
                    fontSize: 14,
                  }}
                >
                  {peso(item.value)}
                </Text>
                <Text
                  style={{
                    color: palette.moneyForeground,
                    opacity: 0.7,
                    fontFamily: "Archivo_400Regular",
                    fontSize: 12,
                  }}
                >
                  {item.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* The wallets themselves, not a door to them. They are the first thing
            anyone wants from a money screen, and a horizontal run keeps any
            number of them to one card's height instead of pushing the rest of
            the dashboard off the screen. */}
        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <Typography.Heading type="h3" className="font-ui-bold text-[14px]">
              Wallets
            </Typography.Heading>
            {/* Count only. The total sits in the hero directly above, and for
                anyone without a credit card it is the identical number. */}
            {live.length > 0 && (
              <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
                {live.length} wallet{live.length === 1 ? "" : "s"}
              </Typography.Paragraph>
            )}
          </View>

          {/* Negative margin then inner padding, so cards can run to the screen
              edge while the first one still lines up with everything above. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-4">
            <View className="flex-row gap-2.5 px-4">
              {live.map((account) => (
                <WalletCard
                  key={account.id}
                  account={account}
                  balance={balanceOf(account, txns)}
                  onPress={() => setWallet(account)}
                />
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add a wallet"
                onPress={() =>
                  setWallet({ id: newNoteId(), name: "", type: "gcash", openingBalance: 0 })
                }
                className="h-[92px] w-[110px] items-center justify-center gap-1.5 rounded-[18px] border border-border border-dashed active:bg-surface-tertiary"
              >
                <Ionicons name="add" size={20} color={palette.muted} />
                <Text
                  style={{ fontFamily: "Archivo_500Medium", fontSize: 11, color: palette.muted }}
                >
                  {live.length === 0 ? "Add a wallet" : "Add"}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>

        {/* Navigation, not content. Three tiles rather than stacked full-width
            cards: these are doors, and a door does not need a paragraph
            explaining it. Each keeps its own hue, so the colour answers "where
            does this go" before the label has been read. */}
        <View className="flex-row gap-2.5">
          {[
            {
              key: "ask",
              icon: "chatbubble-ellipses",
              label: "Ask",
              tint: palette.ask,
              go: () => router.push("/budget/ask"),
              off: live.length === 0,
            },
            {
              key: "bills",
              icon: "repeat",
              label: "Repeats",
              tint: palette.warning,
              go: () => router.push("/budget/bills"),
              off: live.length === 0,
            },
            {
              key: "plan",
              icon: "flag",
              label: "Plan",
              tint: palette.plan,
              go: () => router.push("/budget/plan"),
              off: false,
            },
          ].map((tile) => (
            <Pressable
              key={tile.key}
              accessibilityRole="button"
              accessibilityLabel={tile.label}
              disabled={tile.off}
              onPress={tile.go}
              className="flex-1 items-center gap-1.5 rounded-2xl border border-border bg-surface py-3 active:bg-surface-tertiary"
              style={{ opacity: tile.off ? 0.45 : 1 }}
            >
              <View
                className="h-9 w-9 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${tile.tint}22` }}
              >
                <Ionicons name={tile.icon as never} size={17} color={tile.tint} />
              </View>
              <Text style={{ fontFamily: "Archivo_500Medium", fontSize: 11, color: palette.muted }}>
                {tile.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* The dashboard, in place rather than one tap away. The shape of the
            month is the reason to open this screen, so it should not be hiding
            behind a row labelled Charts. */}
        {txns.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open full charts"
            onPress={() => router.push("/budget/charts")}
            className="gap-3 rounded-2xl border border-border bg-surface p-3.5 active:opacity-80"
          >
            <View className="flex-row items-center justify-between">
              {/* Names what is actually drawn. The bars wait for a second
                  month, so a fixed "Six months" would be a heading over
                  something else. */}
              <Typography.Paragraph className="font-ui-bold text-[14px]">
                {active >= 2 ? "Six months" : "Where it went"}
              </Typography.Paragraph>
              <View className="flex-row items-center gap-1">
                <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
                  All charts
                </Typography.Paragraph>
                <Ionicons name="chevron-forward" size={13} color={palette.muted} />
              </View>
            </View>
            {/* A run of six bars where five are empty reads as a broken chart
                rather than a new ledger, so it waits until there is a shape to
                show. The split below works from one month. */}
            {active >= 2 && <SixMonths txns={txns} month={month} />}
            <Split txns={txns} month={month} />
          </Pressable>
        )}

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
      {wallet && (
        <WalletEditor
          key={wallet.id}
          draft={wallet}
          onChange={setWallet}
          onClose={() => setWallet(null)}
          onSave={saveWallet}
          onDelete={dropWallet}
        />
      )}
      {confirm.dialog}
    </View>
  );
}

export default function BudgetScreen(): JSX.Element {
  return (
    <DataGate>
      <Budget />
    </DataGate>
  );
}
