import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useMemo, useRef, useState, type JSX } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { Confetti } from "../../components/confetti";
import { useConfirm } from "../../components/dialog";
import { Chip, Drawer, Field, SheetHead } from "../../components/money";
import { IconButton, Mascot, PageHeader, SectionTitle, stagger } from "../../components/screen";
import { DataGate, newNoteId, useAI } from "../../lib/ai";
import {
  HABIT_ICONS,
  addDays,
  celebrate,
  checkKey,
  dayKey,
  dayScore,
  deleteHabit,
  firstDay,
  fromKey,
  iconFor,
  isDue,
  listChecks,
  listHabits,
  perfectStreaks,
  rateBetween,
  saveHabit,
  setCheck,
  streak,
  weekStart,
  type Checks,
  type Habit,
  type Scope,
} from "../../lib/habits";
import { ON_INK, usePalette, type NavTheme } from "../../lib/theme";

type Tab = "plan" | "progress";

/** Monday first, as the week strip and the heatmap rows read. */
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const PRESETS: { label: string; days: number[] }[] = [
  { label: "Every day", days: [0, 1, 2, 3, 4, 5, 6] },
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Weekends", days: [0, 6] },
];

/** One tap to a first habit, for the screen that has none. */
const STARTERS = ["Drink 8 glasses of water", "Read 10 pages", "Walk 20 minutes", "Sleep by 11"];

/** Heatmap square, in dp. Small, but a whole year still has to scroll. */
const HEAT_CELL = 14;

const sameDays = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((day) => b.includes(day));

/**
 * A colour per habit, from its id, so it keeps it across launches without a
 * column. Chip-sized only — see the colour note in global.css.
 */
function tintOf(id: string, palette: NavTheme): string {
  const hues = [
    palette.onDevice,
    palette.plan,
    palette.wallets,
    palette.ask,
    palette.money,
    palette.warning,
  ];
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hues[hash % hues.length]!;
}

function when(habit: Habit): string {
  if (habit.once) {
    return fromKey(habit.once).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  const preset = PRESETS.find((option) => sameDays(option.days, habit.days));
  if (preset) return preset.label;
  return ORDER.filter((day) => habit.days.includes(day))
    .map((day) => SHORT[day])
    .join(", ");
}

function Ring({
  share,
  size,
  stroke,
  colour,
  track,
}: {
  share: number;
  size: number;
  stroke: number;
  colour: string;
  track: string;
}): JSX.Element {
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size} style={{ position: "absolute" }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
      {share > 0 && (
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colour}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${length * Math.min(1, share)} ${length}`}
          // From twelve o'clock, like every progress ring people already know.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </Svg>
  );
}

/** The calendar: one week, a ring per day, swiped by arrows. */
function WeekStrip({
  selected,
  today,
  habits,
  checks,
  onPick,
}: {
  selected: string;
  today: string;
  habits: readonly Habit[];
  checks: Checks;
  onPick: (day: string) => void;
}): JSX.Element {
  const palette = usePalette();
  const monday = weekStart(selected);
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));

  return (
    <View className="gap-3 rounded-2xl border border-border bg-surface p-3">
      <View className="flex-row items-center gap-1">
        <Typography.Paragraph className="flex-1 pl-1.5 font-ui-bold text-[15px]">
          {fromKey(selected).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </Typography.Paragraph>
        {monday !== weekStart(today) && (
          <Pressable
            accessibilityRole="button"
            onPress={() => onPick(today)}
            className="rounded-full border border-border px-3 py-1.5 active:opacity-70"
          >
            <Text
              style={{ fontFamily: "Archivo_600SemiBold", fontSize: 12, color: palette.foreground }}
            >
              Today
            </Text>
          </Pressable>
        )}
        <IconButton
          name="chevron-back"
          label="Previous week"
          onPress={() => onPick(addDays(selected, -7))}
        />
        <IconButton
          name="chevron-forward"
          label="Next week"
          onPress={() => onPick(addDays(selected, 7))}
        />
      </View>

      <View className="flex-row">
        {days.map((day) => {
          const { due, done } = dayScore(habits, checks, day);
          const on = day === selected;
          const date = fromKey(day);
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${date.toDateString()}, ${done} of ${due} done`}
              onPress={() => onPick(day)}
              className="flex-1 items-center gap-1.5 rounded-2xl py-2"
              style={{ backgroundColor: on ? palette.accent : "transparent" }}
            >
              <Text
                style={{
                  fontFamily: "Archivo_500Medium",
                  fontSize: 11,
                  color: on ? palette.accentForeground : palette.muted,
                }}
              >
                {LETTER[date.getDay()]}
              </Text>
              <View className="h-[34px] w-[34px] items-center justify-center">
                <Ring
                  share={due === 0 ? 0 : done / due}
                  size={34}
                  stroke={3}
                  colour={palette.onDevice}
                  track={on ? "rgba(127,127,127,0.35)" : palette.border}
                />
                <Text
                  style={{
                    fontFamily: day === today ? "Archivo_600SemiBold" : "Archivo_500Medium",
                    fontSize: 13,
                    color: on
                      ? palette.accentForeground
                      : day === today
                        ? palette.onDevice
                        : palette.foreground,
                  }}
                >
                  {date.getDate()}
                </Text>
              </View>
              {/* A dot for a day that is planned, so an empty ring on a
                  free day does not read as a missed one. */}
              <View
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor:
                    due === 0 ? "transparent" : on ? palette.accentForeground : palette.mutedSoft,
                }}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function HabitRow({
  habit,
  done,
  locked,
  run,
  first,
  onToggle,
  onEdit,
}: {
  habit: Habit;
  done: boolean;
  locked: boolean;
  run: number;
  first: boolean;
  onToggle: () => void;
  onEdit: () => void;
}): JSX.Element {
  const palette = usePalette();
  const tint = tintOf(habit.id, palette);

  return (
    <View
      className={`min-h-[64px] flex-row items-center gap-3 px-3.5 py-2.5 ${first ? "" : "border-t border-border"}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${habit.name}`}
        onPress={onEdit}
        className="flex-1 flex-row items-center gap-3 active:opacity-70"
      >
        <View
          className="h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${tint}22` }}
        >
          <Ionicons name={habit.icon as never} size={19} color={tint} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text
            numberOfLines={1}
            style={{
              fontFamily: "Archivo_600SemiBold",
              fontSize: 14.5,
              color: done ? palette.muted : palette.foreground,
              textDecorationLine: done ? "line-through" : "none",
            }}
          >
            {habit.name}
          </Text>
          <View className="flex-row items-center gap-2">
            <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
              {when(habit)}
            </Typography.Paragraph>
            {run > 1 && (
              <View className="flex-row items-center gap-0.5">
                <Ionicons name="flame" size={11} color={palette.ask} />
                <Text
                  style={{ fontFamily: "Archivo_600SemiBold", fontSize: 11, color: palette.ask }}
                >
                  {run}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done, disabled: locked }}
        accessibilityLabel={locked ? `${habit.name}, not due yet` : habit.name}
        disabled={locked}
        onPress={onToggle}
        hitSlop={8}
        className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
        style={{
          backgroundColor: done ? palette.onDevice : "transparent",
          borderWidth: done ? 0 : 2,
          borderColor: palette.border,
          opacity: locked ? 0.35 : 1,
        }}
      >
        {done ? (
          <Ionicons name="checkmark" size={20} color="#fff" />
        ) : locked ? (
          <Ionicons name="time-outline" size={15} color={palette.muted} />
        ) : null}
      </Pressable>
    </View>
  );
}

function HabitSheet({
  habit,
  isNew,
  day,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  habit: Habit;
  isNew: boolean;
  /** The day the calendar is on, for "just this day". */
  day: string;
  onChange: (next: Habit) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}): JSX.Element {
  const palette = usePalette();
  // The icon follows the name until someone picks one by hand; after that a
  // rename leaves their choice alone.
  const [auto, setAuto] = useState(isNew);
  const valid = habit.name.trim() !== "" && (habit.once !== undefined || habit.days.length > 0);
  const tint = tintOf(habit.id, palette);
  const onceDay = habit.once ?? day;

  const plan = (days: number[]): void => {
    const { once: _once, ...rest } = habit;
    onChange({ ...rest, days });
  };

  return (
    <Drawer onClose={onClose}>
      <SheetHead title={isNew ? "New habit" : "Edit habit"} onClose={onClose} />
      <ScrollView
        contentContainerClassName="px-5 pt-4 pb-2 gap-4"
        keyboardShouldPersistTaps="handled"
      >
        <Field label="What you want to do">
          <View className="flex-row items-center gap-2.5">
            <View
              className="h-[50px] w-[50px] items-center justify-center rounded-xl"
              style={{ backgroundColor: `${tint}22` }}
            >
              <Ionicons name={habit.icon as never} size={24} color={tint} />
            </View>
            <TextInput
              value={habit.name}
              onChangeText={(name) =>
                onChange({ ...habit, name, icon: auto ? iconFor(name) : habit.icon })
              }
              autoFocus={isNew}
              placeholder="Read 10 pages, drink water…"
              placeholderTextColor={palette.muted}
              className="flex-1 rounded-xl border border-border bg-background px-3.5 py-3 font-ui text-[15px] text-foreground"
            />
          </View>
        </Field>

        <Field
          label="Icon"
          hint={auto ? "Picked from the name. Tap one to choose your own." : undefined}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-5">
            <View className="flex-row gap-2 px-5">
              {HABIT_ICONS.map((icon) => {
                const on = icon === habit.icon;
                return (
                  <Pressable
                    key={icon}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={icon}
                    onPress={() => {
                      setAuto(false);
                      onChange({ ...habit, icon });
                    }}
                    className="h-11 w-11 items-center justify-center rounded-xl border"
                    style={{
                      borderColor: on ? tint : palette.border,
                      backgroundColor: on ? `${tint}22` : "transparent",
                    }}
                  >
                    <Ionicons name={icon as never} size={19} color={on ? tint : palette.muted} />
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </Field>

        <Field label="When">
          <View className="flex-row flex-wrap gap-2">
            {PRESETS.map((option) => (
              <Chip
                key={option.label}
                label={option.label}
                on={!habit.once && sameDays(option.days, habit.days)}
                onPress={() => plan(option.days)}
              />
            ))}
            <Chip
              label={`Just ${fromKey(onceDay).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
              on={habit.once !== undefined}
              onPress={() => onChange({ ...habit, days: [], once: onceDay })}
            />
          </View>
          {/* Any mix of days, for the gym-three-times-a-week kind of plan. */}
          <View className="flex-row gap-1.5 pt-1">
            {ORDER.map((weekday) => {
              const on = !habit.once && habit.days.includes(weekday);
              return (
                <Pressable
                  key={weekday}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={SHORT[weekday]}
                  onPress={() =>
                    plan(
                      on
                        ? habit.days.filter((item) => item !== weekday)
                        : [...(habit.once ? [] : habit.days), weekday]
                    )
                  }
                  className="h-10 flex-1 items-center justify-center rounded-xl border"
                  style={{
                    backgroundColor: on ? palette.accent : "transparent",
                    borderColor: on ? palette.accent : palette.border,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Archivo_600SemiBold",
                      fontSize: 12.5,
                      color: on ? palette.accentForeground : palette.muted,
                    }}
                  >
                    {LETTER[weekday]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <View className="flex-row gap-2 pt-1">
          {!isNew && (
            <Pressable
              accessibilityRole="button"
              onPress={onDelete}
              className="min-h-[48px] justify-center rounded-full border border-border px-4 active:opacity-70"
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
            className="min-h-[48px] flex-1 items-center justify-center rounded-full active:opacity-80"
            style={{ backgroundColor: palette.accent, opacity: valid ? 1 : 0.4 }}
          >
            <Text
              style={{
                fontFamily: "Archivo_600SemiBold",
                fontSize: 14,
                color: palette.accentForeground,
              }}
            >
              {isNew ? "Add habit" : "Save"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Drawer>
  );
}

function Stat({
  icon,
  tint,
  value,
  label,
}: {
  icon: string;
  tint: string;
  value: string;
  label: string;
}): JSX.Element {
  const palette = usePalette();
  return (
    <View className="flex-1 gap-1.5 rounded-2xl border border-border bg-surface p-3">
      <View
        className="h-7 w-7 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${tint}22` }}
      >
        <Ionicons name={icon as never} size={15} color={tint} />
      </View>
      <Text
        style={{
          color: palette.foreground,
          fontFamily: "Archivo_600SemiBold",
          fontSize: 19,
          letterSpacing: -0.3,
        }}
      >
        {value}
      </Text>
      <Text style={{ color: palette.muted, fontFamily: "Archivo_400Regular", fontSize: 11 }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The GitHub-style year at a glance: a column per week, a row per weekday,
 * green deepening with the share of the day's plan that got done. A day with
 * nothing planned stays faint rather than grey — it was not missed. Tapping a
 * day opens it on the calendar.
 *
 * One calendar year, scrolled sideways and parked on its latest week: 53
 * columns do not fit a phone at a size worth tapping, and the recent end is
 * the part you came to see.
 */
function Heatmap({
  habits,
  checks,
  year,
  today,
  onPick,
}: {
  habits: readonly Habit[];
  checks: Checks;
  year: number;
  today: string;
  onPick: (day: string) => void;
}): JSX.Element {
  const palette = usePalette();
  const from = `${year}-01-01`;
  const to = `${year}-12-31` < today ? `${year}-12-31` : today;
  const first = weekStart(from);
  const count =
    Math.round((fromKey(weekStart(to)).getTime() - fromKey(first).getTime()) / 6.048e8) + 1;
  const weeks = Array.from({ length: count }, (_, index) => addDays(first, index * 7));
  const column = { width: HEAT_CELL, gap: 3 };
  const scroller = useRef<ScrollView>(null);

  const fill = (day: string): { colour: string; opacity: number } => {
    const { due, done } = dayScore(habits, checks, day);
    if (due === 0) return { colour: palette.border, opacity: 0.45 };
    if (done === 0) return { colour: palette.pressOffset, opacity: 1 };
    return {
      colour: palette.onDevice,
      opacity: [0.3, 0.55, 0.8, 1][Math.ceil((done / due) * 4) - 1]!,
    };
  };

  return (
    <View className="gap-1.5">
      <View className="flex-row gap-[3px]">
        <View className="w-[13px] gap-[3px]" style={{ paddingTop: 16 }}>
          {ORDER.map((weekday, row) => (
            <View key={weekday} className="justify-center" style={{ height: HEAT_CELL }}>
              {row % 2 === 0 && (
                <Text
                  style={{ fontFamily: "Archivo_400Regular", fontSize: 8.5, color: palette.muted }}
                >
                  {LETTER[weekday]}
                </Text>
              )}
            </View>
          ))}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // Parked on the latest week, once there is a width to scroll; a
          // past year opens on December too.
          ref={scroller}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
          className="flex-1"
        >
          <View className="flex-row" style={{ gap: column.gap }}>
            {weeks.map((monday, index) => {
              // A month's name over the first full column of it. Absolute so
              // it can run past its narrow column instead of being cut short.
              const firstOfMonth = ORDER.map((_, row) => addDays(monday, row)).find(
                (day) => day.endsWith("-01") && day >= from
              );
              return (
                <View key={monday} style={{ width: column.width, gap: column.gap }}>
                  <View style={{ height: 13 }}>
                    {firstOfMonth && index < weeks.length - 1 && (
                      <Text
                        style={{
                          position: "absolute",
                          left: 0,
                          width: 40,
                          fontFamily: "Archivo_400Regular",
                          fontSize: 9.5,
                          color: palette.muted,
                        }}
                      >
                        {fromKey(firstOfMonth).toLocaleDateString(undefined, { month: "short" })}
                      </Text>
                    )}
                  </View>
                  {ORDER.map((_, row) => {
                    const day = addDays(monday, row);
                    // Outside the year, or not lived yet: an empty slot, so
                    // the grid keeps its shape without claiming anything.
                    if (day < from || day > to) {
                      return <View key={day} style={{ height: HEAT_CELL }} />;
                    }
                    const { colour, opacity } = fill(day);
                    return (
                      <Pressable
                        key={day}
                        accessibilityRole="button"
                        accessibilityLabel={fromKey(day).toDateString()}
                        onPress={() => onPick(day)}
                        className="rounded-[3px]"
                        style={{
                          height: HEAT_CELL,
                          backgroundColor: colour,
                          opacity,
                          borderWidth: day === today ? 1.5 : 0,
                          borderColor: palette.foreground,
                        }}
                      />
                    );
                  })}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
      <View className="flex-row items-center justify-end gap-1 pt-1">
        <Text style={{ fontFamily: "Archivo_400Regular", fontSize: 10, color: palette.muted }}>
          Less
        </Text>
        {[0, 0.3, 0.55, 0.8, 1].map((level) => (
          <View
            key={level}
            className="h-[10px] w-[10px] rounded-[2px]"
            style={{
              backgroundColor: level === 0 ? palette.pressOffset : palette.onDevice,
              opacity: level === 0 ? 1 : level,
            }}
          />
        ))}
        <Text style={{ fontFamily: "Archivo_400Regular", fontSize: 10, color: palette.muted }}>
          More
        </Text>
      </View>
    </View>
  );
}

type BarRow = { key: string; label: string; rate: number | null; now: boolean };

/** Follow-through per stretch, one bar each, the current one in green. */
function Bars({ rows }: { rows: readonly BarRow[] }): JSX.Element {
  const palette = usePalette();
  // Twelve months need the room more than they need gaps.
  const tight = rows.length > 8;

  return (
    <View className={`flex-row items-end ${tight ? "gap-1" : "gap-2"}`} style={{ height: 120 }}>
      {rows.map((row) => (
        <View key={row.key} className="flex-1 items-center gap-1">
          <Text style={{ fontFamily: "Archivo_500Medium", fontSize: 9, color: palette.muted }}>
            {row.rate === null ? "" : `${Math.round(row.rate * 100)}`}
          </Text>
          <View
            className="w-full justify-end overflow-hidden rounded-md bg-surface-tertiary"
            style={{ height: 76 }}
          >
            <View
              style={{
                height: `${Math.max(row.rate ?? 0, 0.02) * 100}%`,
                backgroundColor: row.now ? palette.onDevice : palette.plan,
                opacity: row.rate === null ? 0 : 1,
              }}
            />
          </View>
          <Text
            numberOfLines={1}
            style={{ fontFamily: "Archivo_400Regular", fontSize: 9, color: palette.muted }}
          >
            {row.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The last eight weeks, this one on the right. */
function weekRows(habits: readonly Habit[], checks: Checks, today: string): BarRow[] {
  const current = weekStart(today);
  return Array.from({ length: 8 }, (_, index) => {
    const monday = addDays(current, -7 * (7 - index));
    const sunday = addDays(monday, 6);
    return {
      key: monday,
      label:
        monday === current
          ? "Now"
          : fromKey(monday).toLocaleDateString(undefined, { month: "numeric", day: "numeric" }),
      rate: rateBetween(habits, checks, monday, sunday < today ? sunday : today),
      now: monday === current,
    };
  });
}

/** January to December of one year; months not lived yet stay empty. */
function monthRows(
  habits: readonly Habit[],
  checks: Checks,
  year: number,
  today: string
): BarRow[] {
  return Array.from({ length: 12 }, (_, month) => {
    const from = dayKey(new Date(year, month, 1));
    const last = dayKey(new Date(year, month + 1, 0));
    return {
      key: from,
      label: fromKey(from).toLocaleDateString(undefined, { month: "narrow" }),
      rate: from > today ? null : rateBetween(habits, checks, from, last < today ? last : today),
      now: from <= today && today <= last,
    };
  });
}

function Habits(): JSX.Element {
  const { db } = useAI();
  const router = useRouter();
  const palette = usePalette();
  const confirm = useConfirm();

  const [habits, setHabits] = useState<Habit[]>([]);
  const [checks, setChecks] = useState<Set<string>>(new Set());
  const [today, setToday] = useState(() => dayKey(new Date()));
  const [selected, setSelected] = useState(today);
  const [tab, setTab] = useState<Tab>("plan");
  const [draft, setDraft] = useState<Habit | null>(null);
  const [party, setParty] = useState<{ scope: Scope; id: number } | null>(null);

  const refresh = useCallback(() => {
    if (!db) return;
    // Re-read the date too: the screen can sit open across midnight.
    setToday(dayKey(new Date()));
    void listHabits(db).then(setHabits);
    void listChecks(db).then(setChecks);
  }, [db]);

  useFocusEffect(refresh);

  const due = useMemo(() => habits.filter((habit) => isDue(habit, selected)), [habits, selected]);
  const todayScore = useMemo(() => dayScore(habits, checks, today), [habits, checks, today]);
  const thisYear = fromKey(today).getFullYear();
  // Null means "this year", so the report follows the calendar across New
  // Year rather than staying pinned to the year the screen was opened in.
  const [picked, setPicked] = useState<number | null>(null);
  const year = picked ?? thisYear;
  const isNow = year === thisYear;
  /** The report's range: all of a past year, this year up to today. */
  const yearFrom = `${year}-01-01`;
  const yearTo = isNow ? today : `${year}-12-31`;

  /** Every year anything was planned in, newest first, for the picker. */
  const years = useMemo(() => {
    const first = fromKey(firstDay(habits, today)).getFullYear();
    return Array.from({ length: thisYear - first + 1 }, (_, index) => thisYear - index);
  }, [habits, today, thisYear]);

  // Counters reset every January; the hero always speaks for this year.
  const now = useMemo(
    () => perfectStreaks(habits, checks, thisYear, today),
    [habits, checks, thisYear, today]
  );
  const report = useMemo(
    () => perfectStreaks(habits, checks, year, today),
    [habits, checks, year, today]
  );
  const yearRate = useMemo(
    () => rateBetween(habits, checks, yearFrom, yearTo),
    [habits, checks, yearFrom, yearTo]
  );

  /** Most consistent first, over the chosen year or since the habit began. */
  const ranking = useMemo(
    () =>
      habits
        .filter((habit) => !habit.once && habit.start <= yearTo)
        .map((habit) => ({
          habit,
          rate: rateBetween(
            [habit],
            checks,
            habit.start > yearFrom ? habit.start : yearFrom,
            yearTo
          ),
          // A streak only means anything while it can still grow.
          run: isNow ? streak(habit, checks, today) : 0,
        }))
        .filter((row) => row.rate !== null)
        .sort((a, b) => b.rate! - a.rate! || b.run - a.run),
    [habits, checks, today, yearFrom, yearTo, isNow]
  );

  /** Which weekday you keep best and worst in the chosen year. Needs two to compare. */
  const weekdays = useMemo(() => {
    const totals = new Map<number, { due: number; done: number }>();
    for (let day = yearFrom; day <= yearTo; day = addDays(day, 1)) {
      const score = dayScore(habits, checks, day);
      if (score.due === 0) continue;
      const weekday = fromKey(day).getDay();
      const sum = totals.get(weekday) ?? { due: 0, done: 0 };
      totals.set(weekday, { due: sum.due + score.due, done: sum.done + score.done });
    }
    const rated = [...totals].map(([weekday, sum]) => ({ weekday, rate: sum.done / sum.due }));
    if (rated.length < 2) return null;
    rated.sort((a, b) => b.rate - a.rate);
    const best = rated[0]!;
    const worst = rated[rated.length - 1]!;
    return best.rate === worst.rate ? null : { best, worst };
  }, [habits, checks, yearFrom, yearTo]);

  const pick = useCallback((day: string) => {
    setSelected(day);
    setTab("plan");
  }, []);

  const toggle = useCallback(
    (habit: Habit) => {
      if (!db || selected > today) return;
      const key = checkKey(selected, habit.id);
      const on = !checks.has(key);
      const next = new Set(checks);
      if (on) next.add(key);
      else next.delete(key);
      // Shown at once, written behind. A tick that waits on the disk feels
      // like it did not take.
      setChecks(next);
      void setCheck(db, habit.id, selected, on);
      if (on) {
        const scope = celebrate(habits, next, selected);
        if (scope) setParty({ scope, id: Date.now() });
      }
    },
    [db, selected, today, checks, habits]
  );

  const endParty = useCallback(() => setParty(null), []);

  const start = useCallback(
    (name = "") =>
      setDraft({
        id: newNoteId(),
        name,
        icon: iconFor(name),
        days: [0, 1, 2, 3, 4, 5, 6],
        // A habit planned on a past day counts from that day, so ticking it
        // there is not "before it existed".
        start: selected < today ? selected : today,
      }),
    [selected, today]
  );

  const commit = useCallback(() => {
    if (!db || !draft) return;
    void saveHabit(db, draft).then(() => {
      setDraft(null);
      refresh();
    });
  }, [db, draft, refresh]);

  const remove = useCallback(() => {
    if (!db || !draft) return;
    const target = draft;
    setDraft(null);
    confirm.ask({
      title: `Delete ${target.name}?`,
      message:
        "Its history goes with it, and your streaks and charts are worked out again without it.",
      action: "Delete",
      destructive: true,
      onConfirm: () => void deleteHabit(db, target.id).then(refresh),
    });
  }, [db, draft, confirm, refresh]);

  const left = todayScore.due - todayScore.done;
  const selectedDate = fromKey(selected);

  return (
    <View className="flex-1 bg-background">
      <PageHeader
        title="Habits"
        onBack={() => router.back()}
        right={<IconButton name="add" label="Add a habit" onPress={() => start()} />}
      />

      <ScrollView contentContainerClassName="px-4 pt-4 pb-16 gap-4">
        {stagger(
          <>
            {/* Today, always, whichever tab or day is showing — the one
                question this screen exists to answer. */}
            <View
              className="flex-row items-center gap-4 rounded-[22px] p-4"
              style={{ backgroundColor: palette.ink }}
            >
              <View className="h-[68px] w-[68px] items-center justify-center">
                <Ring
                  share={todayScore.due === 0 ? 0 : todayScore.done / todayScore.due}
                  size={68}
                  stroke={7}
                  colour={ON_INK.ready}
                  track={ON_INK.faint}
                />
                <Text
                  style={{ color: ON_INK.bright, fontFamily: "Archivo_600SemiBold", fontSize: 16 }}
                >
                  {todayScore.due === 0
                    ? "–"
                    : `${Math.round((todayScore.done / todayScore.due) * 100)}%`}
                </Text>
              </View>
              <View className="flex-1 gap-0.5">
                <Text style={{ color: ON_INK.dim, fontFamily: "Archivo_500Medium", fontSize: 12 }}>
                  Today
                </Text>
                <Text
                  style={{ color: ON_INK.bright, fontFamily: "Archivo_600SemiBold", fontSize: 21 }}
                >
                  {todayScore.due === 0
                    ? "Nothing planned"
                    : left === 0
                      ? "All done"
                      : `${todayScore.done} of ${todayScore.due} done`}
                </Text>
                <View className="flex-row items-center gap-1">
                  {now.current > 0 && <Ionicons name="flame" size={12} color={palette.ask} />}
                  <Text
                    style={{ color: ON_INK.dim, fontFamily: "Archivo_400Regular", fontSize: 12 }}
                  >
                    {now.current > 0
                      ? `${now.current} perfect day${now.current === 1 ? "" : "s"} in a row`
                      : left > 0
                        ? `${left} to go. You've got this.`
                        : "Plan something and it shows here."}
                  </Text>
                </View>
              </View>
              <Mascot pose={left === 0 && todayScore.due > 0 ? "hero" : "stretch"} size={50} />
            </View>

            <View className="flex-row gap-1 rounded-full border border-border bg-surface p-1">
              {(["plan", "progress"] as const).map((key) => {
                const on = tab === key;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    onPress={() => setTab(key)}
                    className="min-h-[36px] flex-1 items-center justify-center rounded-full"
                    style={{ backgroundColor: on ? palette.accent : "transparent" }}
                  >
                    <Text
                      style={{
                        fontFamily: "Archivo_600SemiBold",
                        fontSize: 12.5,
                        color: on ? palette.accentForeground : palette.muted,
                      }}
                    >
                      {key === "plan" ? "Calendar" : "Progress"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {tab === "plan" && (
              <View className="gap-4">
                <WeekStrip
                  selected={selected}
                  today={today}
                  habits={habits}
                  checks={checks}
                  onPick={setSelected}
                />

                <View className="flex-row items-baseline justify-between">
                  <SectionTitle>
                    {selected === today
                      ? "Today"
                      : selectedDate.toLocaleDateString(undefined, {
                          weekday: "long",
                          month: "short",
                          day: "numeric",
                        })}
                  </SectionTitle>
                  {due.length > 0 && (
                    <Typography.Paragraph className="font-ui-medium text-muted text-[12px]">
                      {selected > today
                        ? `${due.length} planned`
                        : `${dayScore(habits, checks, selected).done} of ${due.length} done`}
                    </Typography.Paragraph>
                  )}
                </View>

                {habits.length === 0 ? (
                  <View className="items-center gap-3 rounded-2xl border border-border bg-surface p-5">
                    <Mascot pose="stretch" size={64} />
                    <Typography.Paragraph className="text-center font-read text-muted text-[15px] leading-6">
                      Start with one small thing. Pick a starter or write your own.
                    </Typography.Paragraph>
                    <View className="flex-row flex-wrap justify-center gap-2">
                      {STARTERS.map((name) => (
                        <Pressable
                          key={name}
                          accessibilityRole="button"
                          onPress={() => start(name)}
                          className="flex-row items-center gap-1.5 rounded-full border border-border px-3 py-2 active:bg-surface-tertiary"
                        >
                          <Ionicons name={iconFor(name) as never} size={14} color={palette.muted} />
                          <Text
                            style={{
                              fontFamily: "Archivo_500Medium",
                              fontSize: 12.5,
                              color: palette.foreground,
                            }}
                          >
                            {name}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : due.length === 0 ? (
                  <Typography.Paragraph className="py-2 text-center font-read text-muted text-[15px] leading-6">
                    Nothing planned for this day. A free day is allowed.
                  </Typography.Paragraph>
                ) : (
                  <View className="overflow-hidden rounded-2xl border border-border bg-surface">
                    {due.map((habit, index) => (
                      <HabitRow
                        key={habit.id}
                        habit={habit}
                        first={index === 0}
                        done={checks.has(checkKey(selected, habit.id))}
                        locked={selected > today}
                        run={streak(habit, checks, today)}
                        onToggle={() => toggle(habit)}
                        onEdit={() => setDraft(habit)}
                      />
                    ))}
                  </View>
                )}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add a habit"
                  onPress={() => start()}
                  className="min-h-[48px] flex-row items-center justify-center gap-2 rounded-2xl border border-border border-dashed active:bg-surface-tertiary"
                >
                  <Ionicons name="add" size={18} color={palette.muted} />
                  <Text
                    style={{ fontFamily: "Archivo_500Medium", fontSize: 13, color: palette.muted }}
                  >
                    {selected > today ? "Plan a habit for this day" : "Add a habit"}
                  </Text>
                </Pressable>
              </View>
            )}

            {tab === "progress" && (
              <View className="gap-4">
                {/* Each year is its own report. The counters start again every
                    January; earlier years stay here to look back on. */}
                {years.length > 1 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-4">
                    <View className="flex-row gap-2 px-4">
                      {years.map((option) => (
                        <Chip
                          key={option}
                          label={option === thisYear ? `${option} · now` : `${option}`}
                          on={option === year}
                          onPress={() => setPicked(option === thisYear ? null : option)}
                        />
                      ))}
                    </View>
                  </ScrollView>
                )}

                <View className="flex-row gap-2.5">
                  {isNow ? (
                    <Stat
                      icon="flame"
                      tint={palette.ask}
                      value={`${report.current}`}
                      label="perfect days in a row"
                    />
                  ) : (
                    <Stat
                      icon="star"
                      tint={palette.ask}
                      value={`${report.perfect}`}
                      label="perfect days"
                    />
                  )}
                  <Stat
                    icon="trophy"
                    tint={palette.warning}
                    value={`${report.best}`}
                    label={isNow ? "best run this year" : "best run"}
                  />
                  <Stat
                    icon="pulse"
                    tint={palette.onDevice}
                    value={yearRate === null ? "–" : `${Math.round(yearRate * 100)}%`}
                    label={isNow ? "kept this year" : `kept in ${year}`}
                  />
                </View>

                <View className="gap-3 rounded-2xl border border-border bg-surface p-3.5">
                  <Typography.Paragraph className="font-ui-bold text-[14px]">
                    {isNow ? "Consistency this year" : `Consistency in ${year}`}
                  </Typography.Paragraph>
                  <Heatmap
                    habits={habits}
                    checks={checks}
                    year={year}
                    today={today}
                    onPick={pick}
                  />
                  {weekdays && (
                    <Typography.Paragraph className="font-ui text-muted text-[12px]">
                      Strongest on {LONG[weekdays.best.weekday]}s (
                      {Math.round(weekdays.best.rate * 100)}%) · weakest on{" "}
                      {LONG[weekdays.worst.weekday]}s ({Math.round(weekdays.worst.rate * 100)}%)
                    </Typography.Paragraph>
                  )}
                </View>

                {isNow && (
                  <View className="gap-3 rounded-2xl border border-border bg-surface p-3.5">
                    <Typography.Paragraph className="font-ui-bold text-[14px]">
                      Week by week
                    </Typography.Paragraph>
                    <Bars rows={weekRows(habits, checks, today)} />
                  </View>
                )}

                <View className="gap-3 rounded-2xl border border-border bg-surface p-3.5">
                  <Typography.Paragraph className="font-ui-bold text-[14px]">
                    Month by month
                  </Typography.Paragraph>
                  <Bars rows={monthRows(habits, checks, year, today)} />
                </View>

                <View className="gap-2.5">
                  <SectionTitle>Most consistent</SectionTitle>
                  {ranking.length === 0 ? (
                    <Typography.Paragraph className="font-read text-muted text-[14px] leading-[22px]">
                      Tick a few days off and your habits line up here, steadiest first.
                    </Typography.Paragraph>
                  ) : (
                    <View className="gap-3.5 rounded-2xl border border-border bg-surface p-3.5">
                      {ranking.map(({ habit, rate, run }) => {
                        const share = rate ?? 0;
                        const tint =
                          share >= 0.8
                            ? palette.onDevice
                            : share >= 0.5
                              ? palette.plan
                              : palette.warning;
                        return (
                          <Pressable
                            key={habit.id}
                            accessibilityRole="button"
                            accessibilityLabel={`${habit.name}, ${Math.round(share * 100)} percent`}
                            onPress={() => setDraft(habit)}
                            className="gap-1.5 active:opacity-70"
                          >
                            <View className="flex-row items-center gap-2">
                              <Ionicons
                                name={habit.icon as never}
                                size={15}
                                color={tintOf(habit.id, palette)}
                              />
                              <Typography.Paragraph
                                className="flex-1 font-ui-medium text-[13.5px]"
                                numberOfLines={1}
                              >
                                {habit.name}
                              </Typography.Paragraph>
                              {run > 1 && (
                                <View className="flex-row items-center gap-0.5">
                                  <Ionicons name="flame" size={12} color={palette.ask} />
                                  <Text
                                    style={{
                                      fontFamily: "Archivo_600SemiBold",
                                      fontSize: 11.5,
                                      color: palette.ask,
                                    }}
                                  >
                                    {run}
                                  </Text>
                                </View>
                              )}
                              <Text
                                style={{
                                  fontFamily: "Archivo_600SemiBold",
                                  fontSize: 12.5,
                                  color: tint,
                                }}
                              >
                                {Math.round(share * 100)}%
                              </Text>
                            </View>
                            <View className="h-[6px] w-full overflow-hidden rounded-full bg-surface-tertiary">
                              <View
                                className="h-full rounded-full"
                                style={{ width: `${share * 100}%`, backgroundColor: tint }}
                              />
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {draft && (
        <HabitSheet
          key={draft.id}
          habit={draft}
          day={selected}
          isNew={!habits.some((habit) => habit.id === draft.id)}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={commit}
          onDelete={remove}
        />
      )}
      {party && <Confetti key={party.id} scope={party.scope} onDone={endParty} />}
      {confirm.dialog}
    </View>
  );
}

export default function HabitsScreen(): JSX.Element {
  return (
    <DataGate>
      <Habits />
    </DataGate>
  );
}
