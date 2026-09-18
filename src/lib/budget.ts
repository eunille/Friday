/**
 * Money, accounts and the arithmetic over them. No React, no SQL, no I/O.
 *
 * Everything here is pure so it can be checked without a phone — see
 * budget.check.ts. The screens in later phases read from this; nothing here
 * reads from them.
 *
 * Two rules the rest of the feature depends on:
 *
 * 1. Money is an integer number of centavos, always. Floats cannot hold 0.1,
 *    so a peso-valued balance drifts a fraction every time it is touched, and a
 *    savings goal short by a centavo a month is visibly wrong by year end.
 *
 * 2. A balance is derived, never stored. Opening balance plus the signed sum of
 *    what happened. A stored running balance is a second source of truth that
 *    silently disagrees with the first the moment a write is interrupted.
 */

/* ---------------------------------------------------------------- money --- */

/** Centavos. 100 = ₱1.00. */
export type Centavos = number;

const CENTAVOS_PER_PESO = 100;

/**
 * Reads an amount out of text, in centavos.
 *
 * Deliberately strict about the decimal part: money written by a person has at
 * most two, and "1.234" is far more likely to be a thousands separator typed
 * with the wrong key than a fraction of a centavo.
 */
export function parseAmount(text: string): Centavos | null {
  // Strip the currency mark, spaces and thousands separators, but keep the dot.
  const cleaned = text.replace(/php/gi, "").replace(/[₱\s,]/g, "");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;

  const [, sign, whole, fraction = ""] = match;
  const centavos = Number(whole) * CENTAVOS_PER_PESO + Number(fraction.padEnd(2, "0"));
  return sign === "-" ? -centavos : centavos;
}

/** "₱1,250.50". A negative keeps its sign outside the mark: "-₱20.00". */
export function peso(centavos: Centavos, { sign = false }: { sign?: boolean } = {}): string {
  const negative = centavos < 0;
  const whole = Math.floor(Math.abs(centavos) / CENTAVOS_PER_PESO);
  const rest = Math.abs(centavos) % CENTAVOS_PER_PESO;
  const lead = negative ? "-" : sign ? "+" : "";
  return `${lead}₱${whole.toLocaleString("en-US")}.${String(rest).padStart(2, "0")}`;
}

/** Shorthand for headline figures: "₱818.4k", "₱1.2M". Never for a ledger row. */
export function pesoShort(centavos: Centavos): string {
  const pesos = Math.abs(centavos) / CENTAVOS_PER_PESO;
  const lead = centavos < 0 ? "-₱" : "₱";
  if (pesos >= 1_000_000) return `${lead}${(pesos / 1_000_000).toFixed(1)}M`;
  if (pesos >= 10_000) return `${lead}${Math.round(pesos / 1000)}k`;
  return peso(centavos);
}

/* ------------------------------------------------------------- accounts --- */

/**
 * Brand colours, because a wallet you recognise by colour is faster to pick out
 * of a grid than one you have to read. These are the only saturated colours in
 * the app — everything around them stays on the monochrome palette, which is
 * what keeps the screen from turning into a paint chart.
 */
export const ACCOUNT_TYPES = {
  gcash: { label: "GCash", group: "E-wallets", colour: "#007DFE" },
  maya: { label: "Maya", group: "E-wallets", colour: "#00C17B" },
  maribank: { label: "MariBank", group: "Banks", colour: "#12B3A8" },
  bdo: { label: "BDO", group: "Banks", colour: "#00539F" },
  bpi: { label: "BPI", group: "Banks", colour: "#A6192E" },
  unionbank: { label: "UnionBank", group: "Banks", colour: "#F47920" },
  cash: { label: "Cash", group: "Cash", colour: "#2E7D5B" },
  credit: { label: "Credit Card", group: "Credit", colour: "#6C4BD1" },
  other: { label: "Other", group: "Other", colour: "#5A6270" },
} as const;

export type AccountType = keyof typeof ACCOUNT_TYPES;

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  /** What was in it before the first recorded transaction. */
  openingBalance: Centavos;
  archived?: boolean;
};

/* ----------------------------------------------------------- categories --- */

export const CATEGORIES = {
  food: { label: "Food", icon: "fast-food" },
  transport: { label: "Transport", icon: "car" },
  housing: { label: "Housing", icon: "home" },
  utilities: { label: "Utilities", icon: "bulb" },
  shopping: { label: "Shopping", icon: "cart" },
  fun: { label: "Entertainment", icon: "game-controller" },
  health: { label: "Health", icon: "medkit" },
  subscriptions: { label: "Subscriptions", icon: "phone-portrait" },
  debt: { label: "Debt", icon: "card" },
  education: { label: "Education", icon: "school" },
  other: { label: "Other", icon: "ellipsis-horizontal" },
} as const;

export type Category = keyof typeof CATEGORIES;

export const INCOME_SOURCES = {
  salary: { label: "Salary" },
  freelance: { label: "Freelance" },
  business: { label: "Business" },
  allowance: { label: "Allowance" },
  other: { label: "Other" },
} as const;

export type IncomeSource = keyof typeof INCOME_SOURCES;

/* --------------------------------------------------------- transactions --- */

export type TxnKind = "income" | "expense" | "transfer";

export type Txn = {
  id: string;
  kind: TxnKind;
  /**
   * Always positive. The kind decides direction; a signed amount would let a
   * "negative expense" exist and quietly mean income.
   */
  amount: Centavos;
  accountId: string;
  /** Transfers only: where the money went. */
  toAccountId?: string;
  category?: Category;
  source?: IncomeSource;
  note?: string;
  /** ISO-8601, same as every other timestamp in the app. */
  at: string;
};

/**
 * What one transaction does to one account.
 *
 * Transfers are why this is its own function. Money moving from GCash to BPI is
 * not spending — the total is unchanged and only the location differs — so a
 * transfer subtracts from one account, adds to the other, and contributes
 * nothing to expenses anywhere.
 */
export function effectOn(txn: Txn, accountId: string): Centavos {
  if (txn.kind === "income") return txn.accountId === accountId ? txn.amount : 0;
  if (txn.kind === "expense") return txn.accountId === accountId ? -txn.amount : 0;
  if (txn.accountId === accountId) return -txn.amount;
  return txn.toAccountId === accountId ? txn.amount : 0;
}

export function balanceOf(account: Account, txns: readonly Txn[]): Centavos {
  return txns.reduce((total, txn) => total + effectOn(txn, account.id), account.openingBalance);
}

/**
 * Everything, added up. A credit card counts against you: a balance on one is
 * money owed, not money held.
 */
export function netWorth(accounts: readonly Account[], txns: readonly Txn[]): Centavos {
  return accounts
    .filter((account) => !account.archived)
    .reduce((total, account) => {
      const balance = balanceOf(account, txns);
      return total + (account.type === "credit" ? -Math.abs(balance) : balance);
    }, 0);
}

/* -------------------------------------------------------------- periods --- */

/** "2026-09". The month key everything is bucketed by. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function inMonth(txn: Txn, month: string): boolean {
  return monthKey(txn.at) === month;
}

/**
 * `count` month keys ending at `month`, oldest first.
 *
 * Built through Date.UTC rather than by subtracting from the month number, so
 * walking back past January rolls the year instead of producing "2026-00".
 */
export function monthsEnding(month: string, count: number): string[] {
  const [year, index] = month.split("-").map(Number);
  const months: string[] = [];
  for (let step = count - 1; step >= 0; step -= 1) {
    months.push(new Date(Date.UTC(year, index - 1 - step, 1)).toISOString().slice(0, 7));
  }
  return months;
}

export type Totals = { income: Centavos; expense: Centavos; net: Centavos };

/** Transfers are excluded from both sides — see `effectOn`. */
export function totalsFor(txns: readonly Txn[], month: string): Totals {
  let income = 0;
  let expense = 0;
  for (const txn of txns) {
    if (!inMonth(txn, month)) continue;
    if (txn.kind === "income") income += txn.amount;
    if (txn.kind === "expense") expense += txn.amount;
  }
  return { income, expense, net: income - expense };
}

/** Spend per category for a month, biggest first, transfers excluded. */
export function byCategory(
  txns: readonly Txn[],
  month: string
): { category: Category; total: Centavos }[] {
  const totals = new Map<Category, Centavos>();
  for (const txn of txns) {
    if (txn.kind !== "expense" || !inMonth(txn, month)) continue;
    const category = txn.category ?? "other";
    totals.set(category, (totals.get(category) ?? 0) + txn.amount);
  }
  return [...totals]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/* -------------------------------------------------------------- budgets --- */

export type Budget = { category: Category; limit: Centavos; month: string };

export type BudgetBand = "under" | "near" | "over";

export type BudgetStatus = {
  category: Category;
  limit: Centavos;
  spent: Centavos;
  /** Negative once the limit is passed. */
  left: Centavos;
  /** 0..1 for the bar, and past 1 so "over" can be shown honestly. */
  share: number;
  band: BudgetBand;
};

/** Near is the last fifth: late enough to matter, early enough to act on. */
const NEAR = 0.8;

export function budgetStatus(budget: Budget, txns: readonly Txn[]): BudgetStatus {
  const spent = txns
    .filter(
      (txn) =>
        txn.kind === "expense" &&
        inMonth(txn, budget.month) &&
        (txn.category ?? "other") === budget.category
    )
    .reduce((total, txn) => total + txn.amount, 0);

  // A zero limit is a category the user asked to spend nothing on, so anything
  // at all is over it — and dividing by it would give Infinity or NaN.
  const share = budget.limit > 0 ? spent / budget.limit : spent > 0 ? 1 : 0;

  return {
    category: budget.category,
    limit: budget.limit,
    spent,
    left: budget.limit - spent,
    share,
    band: share >= 1 ? "over" : share >= NEAR ? "near" : "under",
  };
}

/* -------------------------------------------------------------- savings --- */

export type Goal = {
  id: string;
  name: string;
  target: Centavos;
  saved: Centavos;
  /** Optional deadline, ISO date. */
  by?: string;
};

export type GoalForecast = {
  /** 0..1, clamped — a goal cannot be more than met, for display purposes. */
  progress: number;
  remaining: Centavos;
  /**
   * Whole months at the given rate, or null when the rate is zero or the goal
   * is already met. Null means "cannot say", never "soon".
   */
  months: number | null;
  /** What it would take per month to land on `by`, when a deadline is set. */
  needPerMonth: Centavos | null;
};

export function goalForecast(goal: Goal, monthlyRate: Centavos, now = new Date()): GoalForecast {
  const remaining = Math.max(0, goal.target - goal.saved);
  const progress = goal.target > 0 ? Math.min(1, goal.saved / goal.target) : 0;
  const months =
    remaining === 0 ? null : monthlyRate > 0 ? Math.ceil(remaining / monthlyRate) : null;

  let needPerMonth: Centavos | null = null;
  if (goal.by && remaining > 0) {
    const left = monthsBetween(now, new Date(goal.by));
    // A deadline already passed, or inside this month, needs the whole thing
    // now — not a division by zero and not a negative monthly target.
    needPerMonth = left > 0 ? Math.ceil(remaining / left) : remaining;
  }

  return { progress, remaining, months, needPerMonth };
}

/** Whole months from `from` to `to`, floored at 0. */
export function monthsBetween(from: Date, to: Date): number {
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return Math.max(0, months);
}

/**
 * What the balance would be after `months` more at this rate.
 *
 * Deliberately flat, not compounded: this is a savings account in a phone app,
 * and quoting interest the user never told us about would be a made-up number
 * dressed as a projection.
 */
export function project(current: Centavos, monthlyRate: Centavos, months: number): Centavos {
  return current + monthlyRate * Math.max(0, months);
}

/**
 * How many months in a row, counting back from `month`, had money put away.
 *
 * Counts back rather than forward so a gap two years ago cannot end a streak
 * that has run since. The current month counts only if something was saved in
 * it, so the streak never claims a month that has not finished happening.
 */
export function savingsStreak(saved: ReadonlyMap<string, Centavos>, month: string): number {
  let streak = 0;
  const parts = month.split("-").map(Number);
  let year = parts[0];
  let index = parts[1];

  for (;;) {
    const key = `${year}-${String(index).padStart(2, "0")}`;
    if ((saved.get(key) ?? 0) <= 0) return streak;
    streak += 1;
    index -= 1;
    if (index === 0) {
      index = 12;
      year -= 1;
    }
  }
}
