import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useConfirm } from "../../components/dialog";
import { syncAlerts } from "../../lib/alerts";
import { IconButton, PageHeader, SectionTitle } from "../../components/screen";
import { ModelGate, newNoteId, useAI } from "../../lib/ai";
import {
  ACCOUNT_TYPES,
  CATEGORIES,
  dueDates,
  forecast,
  netWorth,
  parseAmount,
  peso,
  type Account,
  type Category,
  type Every,
  type Recurring,
  type Txn,
} from "../../lib/budget";
import {
  deleteRecurring,
  listAccounts,
  listRecurring,
  listTxns,
  runDue,
  saveRecurring,
} from "../../lib/ledger";
import { usePalette } from "../../lib/theme";

const EVERY: { key: Every; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
];

const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

/** How far ahead the forecast looks. A bill cycle is measured in months. */
const AHEAD_DAYS = 30;

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

function Editor({
  draft,
  accounts,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Recurring;
  accounts: readonly Account[];
  onChange: (next: Recurring) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}): JSX.Element {
  const palette = usePalette();
  const [amount, setAmount] = useState(() =>
    draft.amount === 0 ? "" : String(draft.amount / 100)
  );
  const editing = draft.amount > 0;
  const valid = draft.label.trim() !== "" && (parseAmount(amount) ?? 0) > 0;

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
              {editing ? "Edit repeat" : "New repeat"}
            </Typography.Heading>
            <IconButton name="close" label="Close" tone="muted" onPress={onClose} />
          </View>

          <TextInput
            value={draft.label}
            onChangeText={(label) => onChange({ ...draft, label })}
            placeholder="What it is — Netflix, rent, salary"
            placeholderTextColor={palette.muted}
            className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui text-[15px] text-foreground"
          />

          <TextInput
            value={amount}
            onChangeText={(text) => {
              setAmount(text);
              onChange({ ...draft, amount: parseAmount(text) ?? 0 });
            }}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={palette.muted}
            className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui-bold text-[26px] text-foreground"
          />

          <View className="flex-row gap-2">
            {(["expense", "income"] as const).map((kind) => (
              <Chip
                key={kind}
                label={kind === "expense" ? "Goes out" : "Comes in"}
                on={draft.kind === kind}
                onPress={() =>
                  onChange({
                    ...draft,
                    kind,
                    category: kind === "expense" ? (draft.category ?? "subscriptions") : undefined,
                  })
                }
              />
            ))}
          </View>

          <View className="gap-2">
            <Typography.Paragraph className="font-ui-medium text-muted text-[12px]">
              How often
            </Typography.Paragraph>
            <View className="flex-row flex-wrap gap-2">
              {EVERY.map((option) => (
                <Chip
                  key={option.key}
                  label={option.label}
                  on={draft.every === option.key}
                  onPress={() => onChange({ ...draft, every: option.key })}
                />
              ))}
            </View>
          </View>

          <View className="gap-2">
            <Typography.Paragraph className="font-ui-medium text-muted text-[12px]">
              Account
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

          {draft.kind === "expense" && (
            <View className="gap-2">
              <Typography.Paragraph className="font-ui-medium text-muted text-[12px]">
                Category
              </Typography.Paragraph>
              <View className="flex-row flex-wrap gap-2">
                {CATEGORY_KEYS.map((category) => (
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

function Bills(): JSX.Element {
  const { db, alerts } = useAI();
  const router = useRouter();
  const palette = usePalette();
  const confirm = useConfirm();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [rules, setRules] = useState<Recurring[]>([]);
  const [draft, setDraft] = useState<Recurring | null>(null);
  const [caughtUp, setCaughtUp] = useState<number | null>(null);

  const refresh = useCallback(() => {
    if (!db) return;
    void listAccounts(db).then(setAccounts);
    void listTxns(db).then(setTxns);
    void listRecurring(db).then((next) => {
      setRules(next);
      // Rescheduled from whatever the rules are now, so a reminder can never
      // outlive the bill it was for. No-op when reminders are switched off.
      if (alerts) void syncAlerts(next);
    });
  }, [db, alerts]);

  useEffect(refresh, [refresh]);

  const live = useMemo(() => accounts.filter((account) => !account.archived), [accounts]);
  // Pinned once per mount. Re-reading the clock every render would make the
  // forecast window creep while the screen sat open.
  const now = useMemo(() => new Date(), []);
  const until = useMemo(() => new Date(now.getTime() + AHEAD_DAYS * 86_400_000), [now]);

  const ahead = useMemo(
    () => forecast(netWorth(live, txns), rules, now, until),
    [live, txns, rules, now, until]
  );

  // Counted the same way the runner counts it, so the button never offers to
  // write rows that `runDue` will then decline to write.
  const owed = useMemo(
    () => rules.reduce((sum, rule) => sum + dueDates(rule, now).length, 0),
    [rules, now]
  );

  const catchUp = useCallback(() => {
    if (!db) return;
    void runDue(db).then((written) => {
      setCaughtUp(written);
      refresh();
    });
  }, [db, refresh]);

  const commit = useCallback(() => {
    if (!db || !draft) return;
    void saveRecurring(db, draft).then(() => {
      setDraft(null);
      refresh();
    });
  }, [db, draft, refresh]);

  const remove = useCallback(() => {
    if (!db || !draft) return;
    const target = draft;
    setDraft(null);
    confirm.ask({
      title: `Delete ${target.label}?`,
      message: "It stops repeating. Anything it already logged stays in the ledger.",
      action: "Delete",
      destructive: true,
      onConfirm: () => void deleteRecurring(db, target.id).then(refresh),
    });
  }, [db, draft, confirm, refresh]);

  return (
    <View className="flex-1 bg-background">
      <PageHeader
        title="Repeats"
        onBack={() => router.back()}
        right={
          <IconButton
            name="add"
            label="Add a repeat"
            bordered
            disabled={live.length === 0}
            onPress={() =>
              setDraft({
                id: newNoteId(),
                label: "",
                kind: "expense",
                amount: 0,
                accountId: live[0].id,
                category: "subscriptions",
                every: "monthly",
                from: new Date().toISOString(),
              })
            }
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
              IN {AHEAD_DAYS} DAYS
            </Text>
            <Text
              style={{
                color: ahead.short ? palette.danger : palette.inkForeground,
                fontFamily: "Archivo_600SemiBold",
                fontSize: 30,
              }}
            >
              {peso(ahead.end)}
            </Text>
          </View>
          <Text
            style={{
              color: palette.inkForeground,
              opacity: 0.55,
              fontFamily: "Archivo_400Regular",
              fontSize: 12,
            }}
          >
            {rules.length === 0
              ? "Add what repeats and this becomes a real number."
              : `${peso(ahead.now)} now, ${peso(ahead.incoming)} due in, ${peso(ahead.outgoing)} due out`}
          </Text>
          {ahead.short && (
            <View className="flex-row items-center gap-1.5">
              <Ionicons name="warning" size={13} color={palette.danger} />
              <Text
                style={{ color: palette.danger, fontFamily: "Archivo_600SemiBold", fontSize: 11.5 }}
              >
                What repeats costs more than you have.
              </Text>
            </View>
          )}
        </View>

        {owed > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add ${owed} due repeats to the ledger`}
            onPress={catchUp}
            className="flex-row items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 active:opacity-70"
          >
            <Ionicons name="download-outline" size={19} color={palette.accent} />
            <View className="flex-1">
              <Typography.Paragraph className="font-ui-medium text-[14px]">
                {owed} repeat{owed === 1 ? "" : "s"} came due
              </Typography.Paragraph>
              <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
                Add them to the ledger.
              </Typography.Paragraph>
            </View>
          </Pressable>
        )}

        {caughtUp !== null && owed === 0 && (
          <Typography.Paragraph className="font-ui text-[12.5px] text-on-device">
            {caughtUp === 0 ? "Nothing was due." : `${caughtUp} added to the ledger.`}
          </Typography.Paragraph>
        )}

        <View className="gap-2.5">
          <SectionTitle>What repeats</SectionTitle>
          {rules.length === 0 ? (
            <Typography.Paragraph className="font-read text-muted text-[14px] leading-[22px]">
              {live.length === 0
                ? "Add a wallet first — a repeat has to come out of somewhere."
                : "Nothing yet. Rent, Netflix, your salary: anything landing on the same day each month."}
            </Typography.Paragraph>
          ) : (
            <View className="overflow-hidden rounded-2xl border border-border bg-surface">
              {rules.map((rule, index) => {
                const account = live.find((item) => item.id === rule.accountId);
                const brand = account ? ACCOUNT_TYPES[account.type].colour : palette.muted;
                return (
                  <Pressable
                    key={rule.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${rule.label}, ${peso(rule.amount)} ${rule.every}`}
                    onPress={() => setDraft(rule)}
                    className={`min-h-[58px] flex-row items-center gap-3 px-3.5 py-2.5 active:bg-surface-tertiary ${
                      index === 0 ? "" : "border-t border-border"
                    }`}
                  >
                    <View
                      className="h-9 w-9 items-center justify-center rounded-xl"
                      style={{ backgroundColor: `${brand}1A` }}
                    >
                      <Ionicons
                        name={
                          rule.kind === "income"
                            ? "arrow-down"
                            : (CATEGORIES[rule.category ?? "other"].icon as never)
                        }
                        size={16}
                        color={brand}
                      />
                    </View>
                    <View className="flex-1">
                      <Typography.Paragraph
                        className="font-ui-medium text-[14px]"
                        numberOfLines={1}
                      >
                        {rule.label}
                      </Typography.Paragraph>
                      <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
                        {EVERY.find((option) => option.key === rule.every)?.label} ·{" "}
                        {account?.name ?? "Unknown"}
                      </Typography.Paragraph>
                    </View>
                    <Text
                      style={{
                        fontFamily: "Archivo_600SemiBold",
                        fontSize: 14.5,
                        color: rule.kind === "income" ? palette.onDevice : palette.foreground,
                      }}
                    >
                      {peso(rule.kind === "income" ? rule.amount : -rule.amount, { sign: true })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {rules.length > 0 && (
          <Typography.Paragraph className="font-ui text-muted text-[11px] leading-[17px]">
            The figure above counts only what repeats. Ordinary spending is not guessed at — a
            projection built from last month&apos;s average is a guess wearing the costume of a
            fact, and this is a number people make decisions on.
          </Typography.Paragraph>
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

export default function BillsScreen(): JSX.Element {
  return (
    <ModelGate>
      <Bills />
    </ModelGate>
  );
}
