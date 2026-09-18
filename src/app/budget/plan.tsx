import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useConfirm } from "../../components/dialog";
import { IconButton, PageHeader, SectionTitle } from "../../components/screen";
import { ModelGate, newNoteId, useAI } from "../../lib/ai";
import {
  CATEGORIES,
  budgetStatus,
  goalForecast,
  monthKey,
  monthsEnding,
  parseAmount,
  peso,
  project,
  savingsStreak,
  totalsFor,
  type BudgetBand,
  type Category,
  type Goal,
  type Txn,
} from "../../lib/budget";
import {
  deleteBudget,
  deleteGoal,
  listBudgets,
  listGoals,
  listTxns,
  saveBudget,
  saveGoal,
  type StoredBudget,
} from "../../lib/ledger";
import { usePalette } from "../../lib/theme";

const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

function Bar({ share, band }: { share: number; band: BudgetBand }): JSX.Element {
  const palette = usePalette();
  const tint =
    band === "over" ? palette.danger : band === "near" ? palette.warning : palette.onDevice;

  return (
    <View className="h-[6px] w-full overflow-hidden rounded-full bg-surface-tertiary">
      {/* Clamped for drawing only. A bar cannot show 140% honestly, so the
          figure beside it carries the overspend — a bar that just stopped at
          the end would read as landing exactly on target. */}
      <View
        className="h-full rounded-full"
        style={{ width: `${Math.min(1, share) * 100}%`, backgroundColor: tint }}
      />
    </View>
  );
}

function AmountSheet({
  title,
  label,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  label: string;
  initial: number;
  onClose: () => void;
  onSave: (centavos: number) => void;
}): JSX.Element {
  const palette = usePalette();
  const [text, setText] = useState(() => (initial === 0 ? "" : String(initial / 100)));
  const parsed = parseAmount(text);
  const valid = parsed !== null && parsed > 0;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
        <View className="gap-4 rounded-t-[26px] border border-border bg-surface p-5 pb-8">
          <View className="flex-row items-center justify-between">
            <Typography.Heading type="h2" className="font-ui-bold text-[19px]">
              {title}
            </Typography.Heading>
            <IconButton name="close" label="Close" tone="muted" onPress={onClose} />
          </View>
          <TextInput
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            autoFocus
            placeholder={label}
            placeholderTextColor={palette.muted}
            className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui-bold text-[26px] text-foreground"
          />
          <Pressable
            accessibilityRole="button"
            disabled={!valid}
            onPress={() => valid && onSave(parsed)}
            className="min-h-[46px] items-center justify-center rounded-full active:opacity-80"
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
      </View>
    </Modal>
  );
}

function GoalSheet({
  goal,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  goal: Goal;
  onChange: (next: Goal) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}): JSX.Element {
  const palette = usePalette();
  const [target, setTarget] = useState(() => (goal.target === 0 ? "" : String(goal.target / 100)));
  const [saved, setSaved] = useState(() => (goal.saved === 0 ? "" : String(goal.saved / 100)));
  const existing = goal.target > 0;
  const valid = goal.name.trim() !== "" && (parseAmount(target) ?? 0) > 0;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
        <View className="gap-4 rounded-t-[26px] border border-border bg-surface p-5 pb-8">
          <View className="flex-row items-center justify-between">
            <Typography.Heading type="h2" className="font-ui-bold text-[19px]">
              {existing ? "Edit goal" : "New goal"}
            </Typography.Heading>
            <IconButton name="close" label="Close" tone="muted" onPress={onClose} />
          </View>

          <TextInput
            value={goal.name}
            onChangeText={(name) => onChange({ ...goal, name })}
            placeholder="What you are saving for"
            placeholderTextColor={palette.muted}
            className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui text-[15px] text-foreground"
          />
          <TextInput
            value={target}
            onChangeText={(text) => {
              setTarget(text);
              onChange({ ...goal, target: parseAmount(text) ?? 0 });
            }}
            keyboardType="decimal-pad"
            placeholder="Target amount"
            placeholderTextColor={palette.muted}
            className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui text-[15px] text-foreground"
          />
          <TextInput
            value={saved}
            onChangeText={(text) => {
              setSaved(text);
              onChange({ ...goal, saved: parseAmount(text) ?? 0 });
            }}
            keyboardType="decimal-pad"
            placeholder="Put away so far"
            placeholderTextColor={palette.muted}
            className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui text-[15px] text-foreground"
          />

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
        </View>
      </View>
    </Modal>
  );
}

function Plan(): JSX.Element {
  const { db } = useAI();
  const router = useRouter();
  const palette = usePalette();
  const confirm = useConfirm();

  const month = monthKey(new Date().toISOString());
  const [txns, setTxns] = useState<Txn[]>([]);
  const [budgets, setBudgets] = useState<StoredBudget[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [goalDraft, setGoalDraft] = useState<Goal | null>(null);

  const refresh = useCallback(() => {
    if (!db) return;
    void listTxns(db).then(setTxns);
    void listBudgets(db, month).then(setBudgets);
    void listGoals(db).then(setGoals);
  }, [db, month]);

  useEffect(refresh, [refresh]);

  // Worst first: the one about to be blown is the reason to open this screen.
  const statuses = useMemo(
    () =>
      budgets
        .map((budget) => ({
          stored: budget,
          status: budgetStatus(
            { category: budget.category, limit: budget.limit, month: budget.month },
            txns
          ),
        }))
        .sort((a, b) => b.status.share - a.status.share),
    [budgets, txns]
  );

  /**
   * What each month actually put aside: income minus spending, floored at zero.
   *
   * A month that went backwards is a month that saved nothing, not a negative
   * saving rate. Letting it go negative would drag the average under zero and
   * forecast a goal receding further away the longer you kept at it.
   */
  const saved = useMemo(() => {
    const map = new Map<string, number>();
    for (const key of monthsEnding(month, 12)) {
      map.set(key, Math.max(0, totalsFor(txns, key).net));
    }
    return map;
  }, [txns, month]);

  // Averaged over months that saved something, so a year of empty history does
  // not divide a real rate down to nothing.
  const rate = useMemo(() => {
    const months = [...saved.values()].filter((value) => value > 0);
    if (months.length === 0) return 0;
    return Math.round(months.reduce((sum, value) => sum + value, 0) / months.length);
  }, [saved]);

  const streak = useMemo(() => savingsStreak(saved, month), [saved, month]);

  const setLimit = useCallback(
    (category: Category, limit: number) => {
      if (!db) return;
      const existing = budgets.find((budget) => budget.category === category);
      void saveBudget(db, { id: existing?.id ?? newNoteId(), category, limit, month }).then(() => {
        setEditing(null);
        refresh();
      });
    },
    [db, budgets, month, refresh]
  );

  const dropBudget = useCallback(
    (stored: StoredBudget) => {
      confirm.ask({
        title: `Stop tracking ${CATEGORIES[stored.category].label}?`,
        message: "The spending stays where it is; only the limit goes.",
        action: "Remove",
        destructive: true,
        onConfirm: () => {
          if (db) void deleteBudget(db, stored.id).then(refresh);
        },
      });
    },
    [db, confirm, refresh]
  );

  const commitGoal = useCallback(() => {
    if (!db || !goalDraft) return;
    void saveGoal(db, goalDraft).then(() => {
      setGoalDraft(null);
      refresh();
    });
  }, [db, goalDraft, refresh]);

  const dropGoal = useCallback(() => {
    if (!db || !goalDraft) return;
    const target = goalDraft;
    setGoalDraft(null);
    confirm.ask({
      title: `Delete ${target.name}?`,
      message: "The goal goes; money you actually moved is untouched.",
      action: "Delete",
      destructive: true,
      onConfirm: () => void deleteGoal(db, target.id).then(refresh),
    });
  }, [db, goalDraft, confirm, refresh]);

  const untracked = CATEGORY_KEYS.filter(
    (category) => !budgets.some((budget) => budget.category === category)
  );

  return (
    <View className="flex-1 bg-background">
      <PageHeader title="Plan" onBack={() => router.back()} />

      <ScrollView contentContainerClassName="px-4 pt-4 pb-10 gap-5">
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
              PUTTING ASIDE
            </Text>
            <Text
              style={{
                color: palette.inkForeground,
                fontFamily: "Archivo_600SemiBold",
                fontSize: 28,
              }}
            >
              {peso(rate)}
              <Text style={{ fontSize: 14, opacity: 0.6 }}> a month</Text>
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
            {rate === 0
              ? "Log some income and spending and this works itself out."
              : streak > 0
                ? `${streak} month${streak === 1 ? "" : "s"} in a row · ${peso(project(0, rate, 12))} over a year at this rate`
                : `Nothing put aside yet this month · ${peso(project(0, rate, 12))} over a year at this rate`}
          </Text>
        </View>

        <View className="gap-2.5">
          <SectionTitle>This month&apos;s limits</SectionTitle>
          {statuses.length === 0 ? (
            <Typography.Paragraph className="font-read text-muted text-[14px] leading-[22px]">
              No limits set. Pick a category below and say what you want to keep it under.
            </Typography.Paragraph>
          ) : (
            <View className="gap-3.5 rounded-2xl border border-border bg-surface p-3.5">
              {statuses.map(({ stored, status }) => (
                <Pressable
                  key={stored.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${CATEGORIES[status.category].label} limit, ${peso(status.spent)} of ${peso(status.limit)}`}
                  onPress={() => setEditing(status.category)}
                  onLongPress={() => dropBudget(stored)}
                  className="gap-1.5 active:opacity-70"
                >
                  <View className="flex-row items-center gap-2">
                    <Ionicons
                      name={CATEGORIES[status.category].icon as never}
                      size={14}
                      color={palette.muted}
                    />
                    <Typography.Paragraph className="flex-1 font-ui-medium text-[13.5px]">
                      {CATEGORIES[status.category].label}
                    </Typography.Paragraph>
                    <Text
                      style={{
                        fontFamily: "Archivo_600SemiBold",
                        fontSize: 12.5,
                        color:
                          status.band === "over"
                            ? palette.danger
                            : status.band === "near"
                              ? palette.warning
                              : palette.muted,
                      }}
                    >
                      {status.band === "over"
                        ? `${peso(-status.left)} over`
                        : `${peso(status.left)} left`}
                    </Text>
                  </View>
                  <Bar share={status.share} band={status.band} />
                  <Typography.Paragraph className="font-ui text-muted text-[11px]">
                    {peso(status.spent)} of {peso(status.limit)}
                  </Typography.Paragraph>
                </Pressable>
              ))}
            </View>
          )}

          {untracked.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
              <View className="flex-row gap-2 px-1">
                {untracked.map((category) => (
                  <Pressable
                    key={category}
                    accessibilityRole="button"
                    accessibilityLabel={`Set a limit for ${CATEGORIES[category].label}`}
                    onPress={() => setEditing(category)}
                    className="min-h-[34px] flex-row items-center gap-1.5 rounded-full border border-border px-3 active:opacity-70"
                  >
                    <Ionicons name="add" size={13} color={palette.muted} />
                    <Text
                      style={{
                        fontFamily: "Archivo_600SemiBold",
                        fontSize: 12,
                        color: palette.muted,
                      }}
                    >
                      {CATEGORIES[category].label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}
        </View>

        <View className="gap-2.5">
          <View className="flex-row items-center justify-between">
            <SectionTitle>Saving for</SectionTitle>
            <IconButton
              name="add"
              label="Add a goal"
              bordered
              onPress={() => setGoalDraft({ id: newNoteId(), name: "", target: 0, saved: 0 })}
            />
          </View>

          {goals.length === 0 ? (
            <Typography.Paragraph className="font-read text-muted text-[14px] leading-[22px]">
              Nothing yet. An emergency fund is the usual first one.
            </Typography.Paragraph>
          ) : (
            goals.map((goal) => {
              const forecast = goalForecast(goal, rate);
              return (
                <Pressable
                  key={goal.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${goal.name}, ${Math.round(forecast.progress * 100)} percent`}
                  onPress={() => setGoalDraft(goal)}
                  className="gap-2 rounded-2xl border border-border bg-surface p-3.5 active:opacity-70"
                >
                  <View className="flex-row items-center justify-between">
                    <Typography.Paragraph className="font-ui-bold text-[14px]">
                      {goal.name}
                    </Typography.Paragraph>
                    <Typography.Paragraph className="font-ui-medium text-muted text-[12px]">
                      {Math.round(forecast.progress * 100)}%
                    </Typography.Paragraph>
                  </View>
                  <Bar share={forecast.progress} band="under" />
                  <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
                    {peso(goal.saved)} of {peso(goal.target)}
                    {forecast.remaining === 0
                      ? " · done"
                      : forecast.months !== null
                        ? ` · about ${forecast.months} month${forecast.months === 1 ? "" : "s"} to go`
                        : " · put something aside to see when"}
                  </Typography.Paragraph>
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>

      {editing && (
        <AmountSheet
          key={editing}
          title={`${CATEGORIES[editing].label} limit`}
          label="Monthly limit"
          initial={budgets.find((budget) => budget.category === editing)?.limit ?? 0}
          onClose={() => setEditing(null)}
          onSave={(centavos) => setLimit(editing, centavos)}
        />
      )}
      {goalDraft && (
        <GoalSheet
          key={goalDraft.id}
          goal={goalDraft}
          onChange={setGoalDraft}
          onClose={() => setGoalDraft(null)}
          onSave={commitGoal}
          onDelete={dropGoal}
        />
      )}
      {confirm.dialog}
    </View>
  );
}

export default function PlanScreen(): JSX.Element {
  return (
    <ModelGate>
      <Plan />
    </ModelGate>
  );
}
