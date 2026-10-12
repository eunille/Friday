import type { DB } from "@op-engineering/op-sqlite";

/**
 * Habits: what you mean to do on which days, and whether you did.
 *
 * Days are local "YYYY-MM-DD" keys, never ISO timestamps. A habit is done on a
 * day as the person lived it; a UTC instant would file a 7am run in Manila
 * under the previous day. The keys also sort as strings, so every range check
 * here is a plain comparison.
 *
 * The arithmetic is pure so habits.check.ts can run it without a phone; the
 * storage at the bottom is the only part that knows SQLite exists.
 */

export type Habit = {
  id: string;
  name: string;
  /** An Ionicons name. Guessed from the name by iconFor, overridable. */
  icon: string;
  /** Weekdays it is planned for, 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** A single day instead of a weekly pattern. */
  once?: string;
  /** Day it was added. Earlier days were never planned, so never missed. */
  start: string;
};

/** Which habits were done when, as `${day}|${habitId}`. */
export type Checks = ReadonlySet<string>;

export const checkKey = (day: string, habitId: string): string => `${day}|${habitId}`;

/* ------------------------------------------------------------------ dates --- */

const pad = (n: number): string => String(n).padStart(2, "0");

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/** By calendar day, not by 86,400,000ms, so a DST change cannot skip one. */
export function addDays(key: string, n: number): string {
  const date = fromKey(key);
  return dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + n));
}

/** The Monday on or before this day. */
export function weekStart(key: string): string {
  return addDays(key, -((fromKey(key).getDay() + 6) % 7));
}

/* --------------------------------------------------------------- progress --- */

export function isDue(habit: Habit, day: string): boolean {
  if (habit.once) return habit.once === day;
  return day >= habit.start && habit.days.includes(fromKey(day).getDay());
}

export function dayScore(
  habits: readonly Habit[],
  checks: Checks,
  day: string
): { due: number; done: number } {
  let due = 0;
  let done = 0;
  for (const habit of habits) {
    if (!isDue(habit, day)) continue;
    due += 1;
    if (checks.has(checkKey(day, habit.id))) done += 1;
  }
  return { due, done };
}

/**
 * Share of planned check-ins that happened between two days, inclusive. Null
 * when nothing was planned — "0%" would read as a failure that never happened.
 */
export function rateBetween(
  habits: readonly Habit[],
  checks: Checks,
  from: string,
  to: string
): number | null {
  let due = 0;
  let done = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const score = dayScore(habits, checks, day);
    due += score.due;
    done += score.done;
  }
  return due === 0 ? null : done / due;
}

/**
 * Planned days in a row this habit was done, counting back from today.
 *
 * Today not done yet does not break it — the day is not over. Days it was not
 * planned for are stepped over: a Mon/Wed/Fri habit is not broken by Tuesday.
 */
export function streak(habit: Habit, checks: Checks, today: string): number {
  if (habit.once) return checks.has(checkKey(habit.once, habit.id)) ? 1 : 0;
  // Every year starts from zero; last year's run stays in last year's report.
  const floor = maxDay(habit.start, yearStart(today));
  let count = 0;
  for (let day = today; day >= floor; day = addDays(day, -1)) {
    if (!isDue(habit, day)) continue;
    if (checks.has(checkKey(day, habit.id))) count += 1;
    else if (day !== today) break;
  }
  return count;
}

const maxDay = (a: string, b: string): string => (a > b ? a : b);
const minDay = (a: string, b: string): string => (a < b ? a : b);
const yearStart = (day: string): string => `${day.slice(0, 4)}-01-01`;

/** First day anything was planned, or today when nothing ever was. */
export function firstDay(habits: readonly Habit[], today: string): string {
  return habits.reduce((min, habit) => minDay(min, habit.once ?? habit.start), today);
}

/**
 * One calendar year's runs of perfect days — every planned habit done.
 *
 * Scoped to a year because the counters reset each January: `current` is the
 * run still going at the end of the range (today, for this year), `best` the
 * longest in it, `perfect` how many perfect days it held. Days with nothing
 * planned are skipped rather than counted or reset, the same as `streak`.
 * Today only extends a run; it cannot end one until it is over.
 */
export function perfectStreaks(
  habits: readonly Habit[],
  checks: Checks,
  year: number,
  today: string
): { current: number; best: number; perfect: number } {
  const from = maxDay(`${year}-01-01`, firstDay(habits, today));
  const to = minDay(`${year}-12-31`, today);
  let run = 0;
  let best = 0;
  let perfect = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const { due, done } = dayScore(habits, checks, day);
    if (due === 0) continue;
    if (done === due) {
      perfect += 1;
      best = Math.max(best, (run += 1));
    } else if (day !== today) run = 0;
  }
  return { current: run, best, perfect };
}

export type Scope = "day" | "week" | "month" | "year";

/** Every planned check-in in the range is done, and there was at least one. */
function allDone(habits: readonly Habit[], checks: Checks, from: string, to: string): boolean {
  return rateBetween(habits, checks, from, to) === 1;
}

/**
 * The biggest stretch that checking something off on `day` just finished.
 *
 * A week is only finished once every planned day in it is done, so the week
 * celebration lands on its last planned day, not on Monday. Same for month and
 * year. Called after a check goes on, so anything complete is newly complete.
 */
export function celebrate(habits: readonly Habit[], checks: Checks, day: string): Scope | null {
  if (!allDone(habits, checks, day, day)) return null;
  const date = fromKey(day);
  const y = date.getFullYear();
  const m = date.getMonth();
  if (allDone(habits, checks, `${y}-01-01`, `${y}-12-31`)) return "year";
  if (allDone(habits, checks, dayKey(new Date(y, m, 1)), dayKey(new Date(y, m + 1, 0)))) {
    return "month";
  }
  const monday = weekStart(day);
  if (allDone(habits, checks, monday, addDays(monday, 6))) return "week";
  return "day";
}

/* ------------------------------------------------------------------ icons --- */

/**
 * First match wins, so the specific comes before the general: "water the
 * plants" is gardening, not drinking. Word-start anchors keep "bread" from
 * matching "read".
 */
const ICON_RULES: [RegExp, string][] = [
  [/\b(plant|garden|flower)/, "flower"],
  [/\b(water|hydrat|drink)/, "water"],
  [/\b(bike|cycl)/, "bicycle"],
  [/\b(run|jog|walk|step|hike)/, "walk"],
  [/\b(gym|lift|workout|exercise|push.?up|squat|plank|abs|train)/, "barbell"],
  [/\b(swim|pool)/, "boat"],
  [/\b(yoga|stretch|meditat|breath|mindful)/, "leaf"],
  [/\b(sleep|bed|nap)/, "bed"],
  [/\b(wake|early|alarm)/, "alarm"],
  [/\b(journal|diary|write|writing|gratitude)/, "journal"],
  [/\b(read|book|novel|chapter)/, "book"],
  [/\b(study|learn|review|homework|class|lesson|quiz|flashcard)/, "school"],
  [/\b(code|coding|program|leetcode)/, "code-slash"],
  [/\b(guitar|piano|music|sing|instrument)/, "musical-notes"],
  [/\b(draw|paint|sketch|art)/, "brush"],
  [/\b(language|spanish|japanese|korean|english|french|vocab|duolingo)/, "language"],
  [/\b(save|saving|budget|money|spend|invest)/, "wallet"],
  [/\b(coffee|tea)\b/, "cafe"],
  [/\b(eat|fruit|veg|salad|cook|meal|breakfast|protein|diet)/, "nutrition"],
  [/\b(vitamin|medicine|meds|pill|supplement)/, "medkit"],
  [/\b(clean|tidy|laundry|dishes|declutter)/, "sparkles"],
  [/\b(call|family|mom|dad|friend|text)/, "call"],
  [/\b(pray|bible|church|devotion)/, "heart"],
  [/\b(phone|screen|social|scroll|tiktok)/, "phone-portrait"],
  [/\b(teeth|floss|skin|shower|groom)/, "happy"],
  [/\b(sun|outside|outdoor|nature)/, "sunny"],
  [/\b(dog|cat|pet)/, "paw"],
  [/\b(work|project|focus|deep)/, "briefcase"],
];

/** Picked while the name is typed, so a new habit never arrives as a blank dot. */
export function iconFor(name: string): string {
  const text = name.toLowerCase();
  return ICON_RULES.find(([pattern]) => pattern.test(text))?.[1] ?? "checkmark-done";
}

/** Everything the rules can produce, for picking one by hand. */
export const HABIT_ICONS = [...new Set([...ICON_RULES.map(([, icon]) => icon), "checkmark-done"])];

/* ---------------------------------------------------------------- storage --- */

export async function createHabitTables(db: DB): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS habits (
       id        TEXT PRIMARY KEY,
       name      TEXT NOT NULL,
       icon      TEXT NOT NULL,
       days      TEXT NOT NULL,
       once      TEXT,
       start     TEXT NOT NULL,
       createdAt TEXT NOT NULL
     )`
  );
  // The pair is the key, so checking twice is a no-op rather than a double count.
  await db.execute(
    `CREATE TABLE IF NOT EXISTS habit_checks (
       habitId TEXT NOT NULL,
       day     TEXT NOT NULL,
       PRIMARY KEY (habitId, day)
     )`
  );
}

type HabitRow = {
  id: string;
  name: string;
  icon: string;
  days: string;
  once: string | null;
  start: string;
};

export async function listHabits(db: DB): Promise<Habit[]> {
  const result = await db.execute(
    "SELECT id, name, icon, days, once, start FROM habits ORDER BY createdAt ASC"
  );
  return (result.rows as unknown as HabitRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    icon: row.icon,
    days: row.days === "" ? [] : row.days.split(",").map(Number),
    ...(row.once ? { once: row.once } : {}),
    start: row.start,
  }));
}

export async function saveHabit(db: DB, habit: Habit): Promise<void> {
  await db.execute(
    `INSERT INTO habits (id, name, icon, days, once, start, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name,
                                   icon = excluded.icon,
                                   days = excluded.days,
                                   once = excluded.once`,
    [
      habit.id,
      habit.name.trim(),
      habit.icon,
      habit.days.join(","),
      habit.once ?? null,
      habit.start,
      new Date().toISOString(),
    ]
  );
}

/** Its check-ins go with it, or they would count toward a habit nobody can see. */
export async function deleteHabit(db: DB, id: string): Promise<void> {
  await db.execute("DELETE FROM habit_checks WHERE habitId = ?", [id]);
  await db.execute("DELETE FROM habits WHERE id = ?", [id]);
}

/**
 * Every check-in ever.
 *
 * ponytail: the whole table. Five habits for three years is about 5,000 short
 * rows. If it ever gets slow, bound it by day — the heatmap only reads ~20 weeks.
 */
export async function listChecks(db: DB): Promise<Set<string>> {
  const result = await db.execute("SELECT habitId, day FROM habit_checks");
  return new Set(
    (result.rows as unknown as { habitId: string; day: string }[]).map((row) =>
      checkKey(row.day, row.habitId)
    )
  );
}

export async function setCheck(db: DB, habitId: string, day: string, on: boolean): Promise<void> {
  await db.execute(
    on
      ? "INSERT OR IGNORE INTO habit_checks (habitId, day) VALUES (?, ?)"
      : "DELETE FROM habit_checks WHERE habitId = ? AND day = ?",
    [habitId, day]
  );
}
