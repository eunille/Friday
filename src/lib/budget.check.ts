import assert from "node:assert/strict";

import {
  accountFlow,
  balanceOf,
  categoriesInUse,
  categoryOf,
  budgetStatus,
  byCategory,
  dueDates,
  effectOn,
  forecast,
  goalForecast,
  monthlyRepeat,
  monthsBetween,
  monthsEnding,
  movementOn,
  netWorth,
  netWorthAt,
  netWorthChange,
  openingFor,
  parseAmount,
  peso,
  pesoShort,
  project,
  savingsStreak,
  totalsFor,
  type Account,
  type Recurring,
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

/* --------------------------------------------------- correcting a wallet --- */

// The point of openingFor: the editor shows the balance a person can check
// against their bank's own app, and typing a number in must leave exactly that
// number — not re-add everything logged since the wallet was opened.
for (const target of [500_000, 0, 1, -250_000]) {
  const corrected = { ...gcash, openingBalance: openingFor("g", ledger, target) };
  assert.equal(balanceOf(corrected, ledger), target, `correcting GCash to ${target}`);
}

// Saving without touching the amount must not move the balance. This is the
// round trip that was broken: the field held the opening balance while the card
// showed the real one, so re-saving quietly reset the wallet.
const untouched = balanceOf(gcash, ledger);
assert.equal(
  balanceOf({ ...gcash, openingBalance: openingFor("g", ledger, untouched) }, ledger),
  untouched,
  "re-saving an unchanged balance is a no-op"
);

// A brand new wallet has no movement, so what you type is what you get.
assert.equal(openingFor("fresh", ledger, 42_000), 42_000);
assert.equal(movementOn("fresh", ledger), 0);

// Movement is the transfer out plus both expenses — and it is exactly the gap
// between opening and current, which is what makes the subtraction valid.
assert.equal(movementOn("g", ledger), balanceOf(gcash, ledger) - gcash.openingBalance);
assert.equal(movementOn("g", ledger), 200_000 - 25_000 - 7_000);

/* ------------------------------------------------- one wallet's statement --- */

// The transfer into GCash counts as money in here, though it is not income
// anywhere else. From inside one wallet it genuinely arrived.
const gFlow = accountFlow("g", ledger, "2026-09");
assert.equal(gFlow.inward, 200_000, "the transfer in, which totalsFor deliberately ignores");
assert.equal(gFlow.outward, 32_000, "both expenses");

// And the other end of that same transfer is money out of BPI.
const bFlow = accountFlow("b", ledger, "2026-09");
assert.equal(bFlow.inward, 3_000_000, "salary only");
assert.equal(bFlow.outward, 200_000, "the transfer out");

// The whole point of including transfers: in minus out has to be the change in
// the balance, or the statement would not reconcile against the number above it.
assert.equal(
  gFlow.inward - gFlow.outward,
  movementOn("g", ledger),
  "September holds every GCash row, so flow and movement must agree"
);

// A month with nothing in it is zero both ways, not NaN.
const quiet = accountFlow("g", ledger, "2026-07");
assert.equal(quiet.inward, 0);
assert.equal(quiet.outward, 0);

// An account nothing was ever filed against reads empty rather than throwing.
assert.deepEqual(accountFlow("nobody", ledger, "2026-09"), { inward: 0, outward: 0 });

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

/* --------------------------------------------------------------- months --- */

assert.deepEqual(monthsEnding("2026-09", 3), ["2026-07", "2026-08", "2026-09"], "oldest first");
assert.equal(monthsEnding("2026-09", 12).length, 12);
assert.equal(monthsEnding("2026-09", 1)[0], "2026-09", "a run of one is the month itself");

// Walking back past January has to roll the year, not produce "2026-00".
assert.deepEqual(monthsEnding("2027-01", 3), ["2026-11", "2026-12", "2027-01"]);
// And back past a whole year.
assert.equal(monthsEnding("2027-01", 14)[0], "2025-12");

/* ------------------------------------------------------------ recurring --- */

const netflix: Recurring = {
  id: "r1",
  label: "Netflix",
  kind: "expense",
  amount: 54_900,
  accountId: "g",
  category: "subscriptions",
  every: "monthly",
  from: "2026-09-01T00:00:00.000Z",
};

// Never run before: everything from the start date up to today is owed.
assert.equal(dueDates(netflix, new Date("2026-11-15")).length, 3, "Sep, Oct, Nov");

// Already run through October: only November is left. This is what stops a bill
// being written twice when the screen is opened twice in a day.
assert.equal(
  dueDates({ ...netflix, lastRun: "2026-10-01T00:00:00.000Z" }, new Date("2026-11-15")).length,
  1
);

// Caught up to today means nothing is due.
assert.equal(
  dueDates({ ...netflix, lastRun: "2026-11-01T00:00:00.000Z" }, new Date("2026-11-15")).length,
  0
);

// A rule that starts in the future is not owed anything yet.
assert.equal(dueDates({ ...netflix, from: "2027-01-01" }, new Date("2026-11-15")).length, 0);

// Missing a month means two rows on the next open, not one merged one.
assert.equal(
  dueDates({ ...netflix, lastRun: "2026-09-01T00:00:00.000Z" }, new Date("2026-11-15")).length,
  2
);

const weekly: Recurring = { ...netflix, every: "weekly", from: "2026-09-01T00:00:00.000Z" };
assert.equal(dueDates(weekly, new Date("2026-09-29")).length, 5, "Sep 1, 8, 15, 22, 29");

// The walk is bounded, so a daily rule left running for years cannot hang the
// screen it is drawn on.
assert.ok(dueDates({ ...netflix, every: "daily" }, new Date("2030-01-01")).length <= 400);

/* ------------------------------------------------------------- forecast --- */

const salary: Recurring = {
  id: "r2",
  label: "Salary",
  kind: "income",
  amount: 3_200_000,
  accountId: "b",
  every: "monthly",
  from: "2026-09-15T00:00:00.000Z",
};

const ahead = forecast(500_000, [salary, netflix], new Date("2026-09-10"), new Date("2026-10-31"));
assert.equal(ahead.incoming, 6_400_000, "two paydays: Sep 15 and Oct 15");
assert.equal(ahead.outgoing, 54_900, "one Netflix left in the window, Oct 1");
assert.equal(ahead.end, ahead.now + ahead.incoming - ahead.outgoing);
assert.equal(ahead.short, false);

// The part worth having: a window where the bills outrun the balance.
const squeezed = forecast(10_000, [netflix], new Date("2026-09-10"), new Date("2026-12-31"));
assert.ok(squeezed.short, "10,000 centavos cannot cover three months of a 54,900 bill");
assert.ok(squeezed.end < 0);

// No rules at all is not a forecast of ruin, it is simply no change.
const idle = forecast(500_000, [], new Date("2026-09-10"), new Date("2026-12-31"));
assert.equal(idle.end, 500_000);
assert.equal(idle.short, false);

/* ------------------------------------------------- categories of one's own --- */

// A shipped category keeps its written label and icon.
assert.equal(categoryOf("food").label, "Food");
assert.equal(categoryOf("food").icon, "fast-food");

// One the owner invented has no entry to look up. It must still draw, because
// the alternative is `.label` of undefined thrown inside a list of their money.
assert.equal(categoryOf("tithe").label, "Tithe");
assert.equal(categoryOf("date night").label, "Date night");
assert.ok(categoryOf("tithe").icon.length > 0, "and something to draw for it");

// Missing altogether is the same as "other", which is what the ledger stores
// when nothing was named.
assert.equal(categoryOf(undefined).label, categoryOf("other").label);
assert.equal(categoryOf("").label, "Other");

// Spending filed under an invented category still totals, because byCategory
// never needed the key to be one of the eleven.
const invented = [
  txn({ kind: "expense", amount: 50_000, accountId: "g", category: "tithe", at: "2026-09-05T00:00:00.000Z" }),
  txn({ kind: "expense", amount: 20_000, accountId: "g", category: "tithe", at: "2026-09-06T00:00:00.000Z" }),
];
assert.deepEqual(byCategory(invented, "2026-09"), [{ category: "tithe", total: 70_000 }]);

// The picker offers the shipped ones plus whatever has already been used, so a
// category invented once can be chosen again without retyping it.
const offered = categoriesInUse([...invented, { category: "food" }, {}]);
assert.deepEqual(offered.own, ["tithe"], "shipped ones are not repeated as custom");
assert.ok(offered.known.includes("food"));
assert.equal(offered.known.length, 11);

/* --------------------------------------------------- what repeats costs --- */

const netflix2: Recurring = {
  id: "n",
  label: "Netflix",
  kind: "expense",
  amount: 54_900,
  accountId: "g",
  every: "monthly",
  from: "2026-09-01T00:00:00.000Z",
};
const domain: Recurring = { ...netflix2, id: "d", label: "Domain", amount: 120_000, every: "yearly" };
const pay2: Recurring = { ...netflix2, id: "p", label: "Salary", kind: "income", amount: 3_200_000 };

const rate = monthlyRepeat([netflix2, domain, pay2]);
assert.equal(rate.incoming, 3_200_000, "income is kept apart from what goes out");
// A yearly bill is a twelfth of itself per month, not its whole amount.
assert.equal(rate.outgoing, 54_900 + Math.round(120_000 / 12));

// A weekly bill is 52/12 of itself, not four times — the difference is a whole
// payment a year, which is exactly the kind of quiet error this must not make.
const perWeek = monthlyRepeat([{ ...netflix2, every: "weekly", amount: 10_000 }]);
assert.equal(perWeek.outgoing, Math.round(10_000 * (52 / 12)));
assert.ok(perWeek.outgoing > 40_000, "and more than four weeks' worth");

// Nothing repeating is zero both ways, not NaN.
assert.deepEqual(monthlyRepeat([]), { outgoing: 0, incoming: 0 });

// Still integer centavos after the division — a rate that drifts a fraction is
// a rate that stops adding up.
assert.ok(Number.isInteger(monthlyRepeat([domain]).outgoing));

/* ------------------------------------------------ net worth over time --- */

// The whole reason no history table is needed: an opening balance is what was
// there before the first row, so replaying only the rows up to a date gives
// the position as it stood then.
const history: Txn[] = [
  txn({ kind: "income", amount: 1_000_000, accountId: "g", at: "2026-08-10T00:00:00.000Z" }),
  txn({ kind: "expense", amount: 200_000, accountId: "g", category: "food", at: "2026-08-20T00:00:00.000Z" }),
  txn({ kind: "income", amount: 500_000, accountId: "g", at: "2026-09-05T00:00:00.000Z" }),
];
const septStart = "2026-09-01T00:00:00.000Z";

// Before anything happened at all.
assert.equal(netWorthAt([gcash], history, "2026-08-01T00:00:00.000Z"), 500_000);
// After August, before September.
assert.equal(netWorthAt([gcash], history, septStart), 500_000 + 1_000_000 - 200_000);
// And "now" is just the whole ledger.
assert.equal(netWorthAt([gcash], history, "2099-01-01T00:00:00.000Z"), netWorth([gcash], history));

const moved = netWorthChange([gcash], history, "2026-09");
assert.ok(moved);
assert.equal(moved.from, 1_300_000, "where it stood on 1 September");
assert.equal(moved.delta, 500_000, "September's income");
assert.equal(moved.now, moved.from + moved.delta);
assert.ok(Math.abs(moved.share! - 500_000 / 1_300_000) < 1e-9);

// A transaction dated exactly at the boundary belongs to the new month, not
// the baseline — otherwise the first day of a month never counts as movement.
const onTheFirst = [...history, txn({ kind: "income", amount: 100_000, accountId: "g", at: septStart })];
assert.equal(netWorthChange([gcash], onTheFirst, "2026-09")!.delta, 600_000);

// Nothing recorded before this month is no history, not a flat month. A first
// run must show nothing rather than a confident "0%".
assert.equal(netWorthChange([gcash], [history[2]], "2026-09"), null);
assert.equal(netWorthChange([gcash], [], "2026-09"), null);

// Starting from zero makes every gain infinite; starting from a debt makes a
// recovery read as a loss. Both report no percentage rather than a wrong one.
const fromNothing: Account = { id: "z", name: "New", type: "cash", openingBalance: 0 };
const zeroStart = netWorthChange(
  [fromNothing],
  [
    txn({ kind: "expense", amount: 0, accountId: "z", at: "2026-08-31T00:00:00.000Z" }),
    txn({ kind: "income", amount: 400_000, accountId: "z", at: "2026-09-02T00:00:00.000Z" }),
  ],
  "2026-09"
);
assert.ok(zeroStart);
assert.equal(zeroStart.share, null, "no baseline to divide by");
assert.equal(zeroStart.delta, 400_000, "but the amount is still true");

console.log("budget: all checks passed");
