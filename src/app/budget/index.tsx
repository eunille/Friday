import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useMemo, useState, type JSX } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Svg, { G, Rect } from "react-native-svg";

import { useConfirm } from "../../components/dialog";
import {
  ActionSheet,
  Chip,
  TxnEditor,
  TxnRow,
  WalletCard,
  WalletEditor,
  type Action,
} from "../../components/money";
import { IconButton, PageHeader } from "../../components/screen";
import { DataGate, newNoteId, useAI } from "../../lib/ai";
import {
  CATEGORIES,
  balanceOf,
  byCategory,
  monthKey,
  monthsEnding,
  netWorth,
  peso,
  totalsFor,
  type Account,
  type Txn,
  type TxnKind,
} from "../../lib/budget";
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

const FILTERS: { key: "all" | TxnKind; label: string }[] = [
  { key: "all", label: "All" },
  { key: "expense", label: "Expense" },
  { key: "income", label: "Income" },
  { key: "transfer", label: "Transfer" },
];

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

/** One figure in the hero, with its arrow. */
function HeroStat({
  icon,
  label,
  value,
  colour,
}: {
  icon: string;
  label: string;
  value: number;
  colour: string;
}): JSX.Element {
  return (
    <View className="flex-row items-center gap-1.5">
      <Ionicons name={icon as never} size={13} color={colour} style={{ opacity: 0.75 }} />
      <Text style={{ color: colour, fontFamily: "Archivo_600SemiBold", fontSize: 14 }}>
        {peso(value)}
      </Text>
      <Text style={{ color: colour, opacity: 0.7, fontFamily: "Archivo_400Regular", fontSize: 12 }}>
        {label}
      </Text>
    </View>
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
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<"all" | TxnKind>("all");

  const refresh = useCallback(() => {
    if (!db) return;
    void listAccounts(db).then(setAccounts);
    void listTxns(db).then(setTxns);
  }, [db]);

  // On focus, not just on mount. Pushed screens stay mounted underneath, so a
  // balance read once at mount still showed the old number after logging
  // something in Ask and coming back — the screen had never been told to look
  // again.
  useFocusEffect(refresh);

  const live = useMemo(() => accounts.filter((account) => !account.archived), [accounts]);
  const month = monthKey(new Date().toISOString());
  const totals = useMemo(() => totalsFor(txns, month), [txns, month]);
  const shown = useMemo(
    () => (filter === "all" ? txns : txns.filter((txn) => txn.kind === filter)),
    [txns, filter]
  );

  /**
   * What you have, what you owe, and the difference.
   *
   * Kept apart rather than summed into one figure, because a card balance is
   * money owed: adding it to the wallets would report a debt as savings. Net
   * worth is the honest headline; held and owed are what explain it.
   */
  const { held, owed } = useMemo(() => {
    let inHand = 0;
    let onCards = 0;
    for (const account of live) {
      const balance = balanceOf(account, txns);
      if (account.type === "credit") onCards += Math.abs(balance);
      else inHand += balance;
    }
    return { held: inHand, owed: onCards };
  }, [live, txns]);

  const worth = useMemo(() => netWorth(live, txns), [live, txns]);

  /** How many of the last six months have anything in them. */
  const active = useMemo(
    () =>
      monthsEnding(month, 6).filter((key) => {
        const totals = totalsFor(txns, key);
        return totals.income > 0 || totals.expense > 0;
      }).length,
    [txns, month]
  );

  const startWallet = useCallback(() => {
    setWallet({ id: newNoteId(), name: "", type: "gcash", openingBalance: 0 });
  }, []);

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

  /**
   * Everything the + can start.
   *
   * The three that need a wallet to write against are left out until there is
   * one rather than shown greyed: a disabled row still has to be read and ruled
   * out, and on a first run every one of them would be.
   */
  const actions: Action[] = [
    {
      key: "wallet",
      icon: "wallet",
      label: "New wallet",
      hint: "A bank, e-wallet, cash or card",
      tint: palette.wallets,
      onPress: startWallet,
    },
    ...(live.length > 0
      ? [
          {
            key: "ask",
            icon: "chatbubble-ellipses" as const,
            label: "Log with Ask",
            hint: "Type what you spent and it files it",
            tint: palette.ask,
            onPress: () => router.push("/budget/ask"),
          },
          {
            key: "plan",
            icon: "flag" as const,
            label: "Budget or goal",
            hint: "A monthly limit or a savings goal",
            tint: palette.plan,
            onPress: () => router.push("/budget/plan"),
          },
          {
            key: "bills",
            icon: "repeat" as const,
            label: "Repeating bill",
            hint: "Something that goes out every month",
            tint: palette.warning,
            onPress: () => router.push("/budget/bills"),
          },
        ]
      : []),
  ];

  return (
    <View className="flex-1 bg-background">
      <PageHeader
        title="Money"
        onBack={() => router.back()}
        right={<IconButton name="add" label="Add" bordered onPress={() => setAdding(true)} />}
      />

      <ScrollView contentContainerClassName="px-4 pt-4 pb-10 gap-4">
        {/* The one saturated surface in the app. Money is the subject of this
            screen, so the headline carries the colour and everything below it
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
              Net worth
            </Text>
            <Text
              style={{
                color: palette.moneyForeground,
                fontFamily: "Archivo_600SemiBold",
                fontSize: 34,
                letterSpacing: -0.5,
              }}
            >
              {peso(worth)}
            </Text>
          </View>
          <View className="flex-row flex-wrap gap-x-5 gap-y-1">
            {/* Only worth spelling out when a card makes them differ from the
                headline. With no card, held is the headline again. */}
            {owed > 0 && (
              <>
                <HeroStat icon="wallet" label="held" value={held} colour={palette.moneyForeground} />
                <HeroStat icon="card" label="owed" value={owed} colour={palette.moneyForeground} />
              </>
            )}
            <HeroStat
              icon="arrow-down"
              label="in this month"
              value={totals.income}
              colour={palette.moneyForeground}
            />
            <HeroStat
              icon="arrow-up"
              label="out this month"
              value={totals.expense}
              colour={palette.moneyForeground}
            />
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
                  onPress={() =>
                    router.push({
                      pathname: "/budget/wallet/[id]",
                      params: { id: account.id },
                    })
                  }
                />
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add a wallet"
                onPress={startWallet}
                className="h-[98px] w-[110px] items-center justify-center gap-1.5 rounded-[18px] border border-border border-dashed active:bg-surface-tertiary"
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
              {FILTERS.map((option) => (
                <Chip
                  key={option.key}
                  label={option.label}
                  on={filter === option.key}
                  onPress={() => setFilter(option.key)}
                />
              ))}
            </View>

            {shown.length === 0 ? (
              <Typography.Paragraph className="pt-4 text-center font-read text-muted text-[15px] leading-6">
                Nothing logged yet. Open Ask and type what you spent — &ldquo;250 lunch
                gcash&rdquo; is enough.
              </Typography.Paragraph>
            ) : (
              <View className="overflow-hidden rounded-2xl border border-border bg-surface">
                {shown.map((txn, index) => (
                  <TxnRow
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

      {adding && <ActionSheet actions={actions} onClose={() => setAdding(false)} />}
      {draft && (
        <TxnEditor
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
          txns={txns}
          isNew={!accounts.some((account) => account.id === wallet.id)}
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
