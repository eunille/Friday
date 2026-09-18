import assert from "node:assert/strict";

import {
  balanceOf,
  budgetStatus,
  byCategory,
  effectOn,
  goalForecast,
  monthsBetween,
  netWorth,
  parseAmount,
  peso,
  pesoShort,
  project,
  savingsStreak,
  totalsFor,
  type Account,
  type Txn,
} from "./budget.ts";

const gcash: Account = { id: "g", name: "GCash", type: "gcash", openingBalance: 500_000 };
const bpi: Account = { id: "b", name: "BPI", type: "bpi", openingBalance: 1_000_000 };
const card: Account = { id: "c", name: "Visa", type: "credit", openingBalance: 200_000 };

let next = 0;
function txn(partial: Omit<Txn, "id">): Txn {
  next += 1;
  return { id: `t${next}`, ...partial };
}

/* ---------------------------------------------------------------- money --- */

// Centavos in, centavos out. The whole feature rests on this never being float
// pesos, so the parser is where it has to be exact.
assert.equal(parseAmount("250"), 25_000);
assert.equal(parseAmount("250.50"), 25_050);
assert.equal(parseAmount("₱1,250.50"), 125_050);
assert.equal(parseAmount("1250php"), 125_000);
assert.equal(parseAmount("-20"), -2_000);

// One decimal digit is tenths, not hundredths: "250.5" is ₱250.50, not ₱250.05.
assert.equal(parseAmount("250.5"), 25_050);

// Three decimals is a mistyped thousands separator far more often than it is a
// fraction of a centavo, so it is refused rather than silently rounded.
assert.equal(parseAmount("1.234"), null);
assert.equal(parseAmount(""), null);
assert.equal(parseAmount("lunch"), null);

assert.equal(peso(125_050), "₱1,250.50");
assert.equal(peso(0), "₱0.00");
assert.equal(peso(5), "₱0.05");
assert.equal(peso(-2_000), "-₱20.00");
assert.equal(peso(25_000, { sign: true }), "+₱250.00");
// The sign option must never turn a negative into "+-".
assert.equal(peso(-2_000, { sign: true }), "-₱20.00");

assert.equal(pesoShort(81_839_164), "₱818k");
assert.equal(pesoShort(250_000_000), "₱2.5M");
// Small amounts fall through to the exact form rather than rounding to "₱0k".
assert.equal(pesoShort(25_000), "₱250.00");

/* ------------------------------------------------------------ transfers --- */

// The one rule called out by name: moving money is not spending it.
const transfer = txn({
  kind: "transfer",
  amount: 200_000,
  accountId: "b",
  toAccountId: "g",
  at: "2026-09-10T00:00:00.000Z",
});

assert.equal(effectOn(transfer, "b"), -200_000);
assert.equal(effectOn(transfer, "g"), 200_000);
// Sums to zero across the pair: the total did not move, only its location.
assert.equal(effectOn(transfer, "b") + effectOn(transfer, "g"), 0);
// And it is invisible to an account that was not involved.
assert.equal(effectOn(transfer, "c"), 0);

const afterTransfer = totalsFor([transfer], "2026-09");
assert.equal(afterTransfer.expense, 0, "a transfer must never count as spending");
assert.equal(afterTransfer.income, 0, "nor as income on the receiving side");

const before = netWorth([gcash, bpi], []);
assert.equal(
  netWorth([gcash, bpi], [transfer]),
  before,
  "net worth cannot change because money moved between two accounts"
);

/* ------------------------------------------------------------- balances --- */

const ledger = [
  transfer,
  txn({ kind: "income", amount: 3_000_000, accountId: "b", at: "2026-09-01T00:00:00.000Z" }),
  txn({
    kind: "expense",
    amount: 25_000,
    accountId: "g",
    category: "food",
    at: "2026-09-11T00:00:00.000Z",
  }),
  txn({
    kind: "expense",
    amount: 7_000,
    accountId: "g",
    category: "transport",
    at: "2026-09-11T00:00:00.000Z",
  }),
  // Last month, so every "this month" figure has to exclude it.
  txn({
    kind: "expense",
    amount: 900_000,
    accountId: "b",
    category: "shopping",
    at: "2026-08-20T00:00:00.000Z",
  }),
];

assert.equal(balanceOf(gcash, ledger), 500_000 + 200_000 - 25_000 - 7_000);
assert.equal(balanceOf(bpi, ledger), 1_000_000 - 200_000 + 3_000_000 - 900_000);

// An account with nothing recorded against it keeps exactly its opening balance.
assert.equal(balanceOf({ ...gcash, id: "empty" }, ledger), 500_000);

const month = totalsFor(ledger, "2026-09");
assert.equal(month.income, 3_000_000);
assert.equal(month.expense, 32_000, "August's spending must not leak into September");
assert.equal(month.net, month.income - month.expense);

// A credit card balance is money owed, so it pulls net worth down.
assert.ok(netWorth([gcash, card], []) < netWorth([gcash], []));

/* ----------------------------------------------------------- categories --- */

const spend = byCategory(ledger, "2026-09");
assert.deepEqual(
  spend.map((row) => row.category),
  ["food", "transport"],
  "biggest first, and August's shopping excluded"
);
assert.equal(spend[0].total, 25_000);
// Transfers carry no category and must not surface as a spending row.
assert.ok(!spend.some((row) => row.total === 200_000));

/* -------------------------------------------------------------- budgets --- */

const food = budgetStatus({ category: "food", limit: 100_000, month: "2026-09" }, ledger);
assert.equal(food.spent, 25_000);
assert.equal(food.left, 75_000);
assert.equal(food.band, "under");

const tight = budgetStatus({ category: "food", limit: 30_000, month: "2026-09" }, ledger);
assert.equal(tight.band, "near", "250 of a 300 budget is 83%, inside the last fifth");

const blown = budgetStatus({ category: "food", limit: 20_000, month: "2026-09" }, ledger);
assert.equal(blown.band, "over");
assert.ok(blown.left < 0, "over budget has to read as negative, not clamp to zero");
assert.ok(blown.share > 1, "and the share keeps going so the overspend is visible");

// A zero limit must not divide by zero.
const zero = budgetStatus({ category: "food", limit: 0, month: "2026-09" }, ledger);
assert.ok(Number.isFinite(zero.share));
assert.equal(zero.band, "over");
const unspent = budgetStatus({ category: "health", limit: 0, month: "2026-09" }, ledger);
assert.equal(unspent.band, "under", "spending nothing against a zero limit is not over");

/* -------------------------------------------------------------- savings --- */

const fund = { id: "e", name: "Emergency", target: 10_000_000, saved: 3_000_000 };

const steady = goalForecast(fund, 1_000_000);
assert.equal(steady.remaining, 7_000_000);
assert.equal(steady.months, 7, "70,000 left at 10,000 a month is 7 months");
assert.ok(Math.abs(steady.progress - 0.3) < 1e-9);

// Rounds up: a partial month still has to be lived through.
assert.equal(goalForecast(fund, 3_000_000).months, 3);

// Saving nothing cannot produce a date. Null means "cannot say", not "soon".
assert.equal(goalForecast(fund, 0).months, null);
assert.equal(goalForecast({ ...fund, saved: fund.target }, 1_000_000).months, null);
assert.equal(goalForecast({ ...fund, saved: fund.target * 2 }, 0).progress, 1, "clamped at 1");

const dated = goalForecast(
  { ...fund, by: "2027-03-15" },
  1_000_000,
  new Date("2026-09-18T00:00:00.000Z")
);
assert.equal(dated.needPerMonth, Math.ceil(7_000_000 / 6));

// A deadline already gone asks for the whole remainder now, rather than
// dividing by zero or handing back a negative monthly target.
const late = goalForecast(
  { ...fund, by: "2026-01-01" },
  1_000_000,
  new Date("2026-09-18T00:00:00.000Z")
);
assert.equal(late.needPerMonth, 7_000_000);

assert.equal(monthsBetween(new Date("2026-09-18"), new Date("2027-03-15")), 6);
assert.equal(monthsBetween(new Date("2026-09-18"), new Date("2026-01-01")), 0, "never negative");

assert.equal(project(3_000_000, 1_000_000, 12), 15_000_000);
assert.equal(project(3_000_000, 1_000_000, -5), 3_000_000, "negative months cannot rewind");

/* --------------------------------------------------------------- streak --- */

const saved = new Map([
  ["2026-09", 500_000],
  ["2026-08", 500_000],
  ["2026-07", 500_000],
  // Nothing in June: the streak stops here.
  ["2026-05", 500_000],
]);
assert.equal(savingsStreak(saved, "2026-09"), 3);

// Nothing saved this month yet means no streak is claimed for it.
assert.equal(savingsStreak(saved, "2026-10"), 0);
assert.equal(savingsStreak(new Map(), "2026-09"), 0);

// Crossing a year boundary must not break the walk backwards.
assert.equal(
  savingsStreak(
    new Map([
      ["2027-01", 1],
      ["2026-12", 1],
      ["2026-11", 1],
    ]),
    "2027-01"
  ),
  3
);

console.log("budget: all checks passed");
