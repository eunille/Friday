import assert from "node:assert/strict";

import type { Account } from "./budget.ts";
import { GUESS_LABELS, parseBalance, parseLine, parseMessage } from "./moneytalk.ts";

const accounts: Account[] = [
  { id: "g", name: "GCash", type: "gcash", openingBalance: 0 },
  { id: "m", name: "Maya", type: "maya", openingBalance: 0 },
  { id: "b", name: "BPI Savings", type: "bpi", openingBalance: 0 },
  { id: "c", name: "Cash", type: "cash", openingBalance: 0 },
  { id: "mb", name: "MariBank", type: "maribank", openingBalance: 0 },
];

const at = new Date("2026-09-18T04:00:00.000Z");
const read = (line: string) => parseLine(line, accounts, at);

/* ------------------------------------------------------- the happy path --- */

const coffee = read("Starbucks 250 from gcash");
assert.ok(coffee);
assert.equal(coffee.txn.kind, "expense");
assert.equal(coffee.txn.amount, 25_000, "250 pesos is 25000 centavos");
assert.equal(coffee.txn.accountId, "g");
assert.equal(coffee.txn.category, "food", "Starbucks is a food keyword");
assert.equal(coffee.txn.note, "Starbucks", "neither the amount nor the wallet is the label");
// Was ["kind"]. Naming a food keyword *and* the wallet it came "from" states
// spending twice over, so asking the user to confirm it was noise.
assert.deepEqual(coffee.guessed, [], "a category plus a source wallet is not a guess");

const bus = read("Bus 70 from cash");
assert.equal(bus?.txn.category, "transport");
assert.equal(bus?.txn.accountId, "c");
assert.equal(bus?.txn.amount, 7_000);

// The reference message, all three lines at once.
const batch = parseMessage(
  "Starbucks 250 from gcash\nBus 70 from cash\nLunch 156 fron bpi",
  accounts,
  at
);
assert.equal(batch.length, 3, "one message, three transactions");
assert.deepEqual(
  batch.map((draft) => draft.txn.amount),
  [25_000, 7_000, 15_600]
);
// "fron" is a typo for "from" and must not stop the wallet being found.
assert.equal(batch[2].txn.accountId, "b");
// Every draft needs its own id, or saving three rows saves one of them thrice.
assert.equal(new Set(batch.map((draft) => draft.txn.id)).size, 3);

/* ---------------------------------------------------------- no guessing --- */

// A sentence with no number is a question. Inventing an amount is the single
// worst thing this could do, so it declines instead.
assert.equal(read("how much did I spend on food?"), null);
assert.equal(read("hello"), null);
assert.equal(read(""), null);
assert.equal(read("spent 0 on nothing"), null, "zero is not a transaction");

// With no accounts there is nothing to charge it against.
assert.equal(parseLine("Starbucks 250", [], at), null);

/* ------------------------------------------------------------ transfers --- */

const moved = read("I transferred 2000 from MariBank to GCash");
assert.ok(moved);
assert.equal(moved.txn.kind, "transfer");
assert.equal(moved.txn.accountId, "mb", "from the half before 'to'");
assert.equal(moved.txn.toAccountId, "g", "to the half after it");
assert.equal(moved.txn.amount, 200_000);
assert.equal(moved.txn.category, undefined, "a transfer is not spending and has no category");
assert.deepEqual(moved.guessed, [], "both ends were named, so nothing was guessed");

// Same wallet at both ends is not a transfer; it falls through rather than
// producing a row that moves money to itself.
assert.notEqual(read("transfer 500 from gcash to gcash")?.txn.kind, "transfer");

// Only one end named cannot be a transfer either.
assert.notEqual(read("moved 300 to maya")?.txn.kind, "transfer");

/* -------------------------------------------------------------- income --- */

const pay = read("Salary 32000 to BPI Savings");
assert.equal(pay?.txn.kind, "income");
assert.equal(pay?.txn.accountId, "b");
assert.equal(pay?.txn.amount, 3_200_000);

// Filipino for payday has to work as well as the English does.
assert.equal(read("sahod 25000 sa gcash")?.txn.kind, "income");

// Saving is money arriving, which the ledger can only hold as income — but it
// is flagged, because they may have meant a transfer out of another wallet.
const ipon = read("I saved 5000 today in MariBank");
assert.equal(ipon?.txn.kind, "income");
assert.equal(ipon?.txn.accountId, "mb");
assert.ok(ipon?.guessed.includes("kind"), "a save is never silently taken as income");

/* ------------------------------------------------------- reading traps --- */

// "BPI Savings" must win over a bare "bpi" when both could match.
assert.equal(read("Lunch 156 from BPI Savings")?.txn.accountId, "b");

// A number welded to a word is part of a name, not the amount.
assert.equal(read("grab2go 150 from maya")?.txn.amount, 15_000, "150, not 2");

// Thousands separators and the peso mark.
assert.equal(read("rent ₱12,500 from bpi")?.txn.amount, 1_250_000);
assert.equal(read("bought shoes 1,299.50 from gcash")?.txn.amount, 129_950);

// "gas" must not fire on "Vegas", nor "load" on "download".
assert.notEqual(read("Vegas trip 5000 from gcash")?.txn.category, "transport");
assert.notEqual(read("download 199 from maya")?.txn.category, "subscriptions");

// An unnamed wallet falls back to the first account and says so, so the screen
// can mark it rather than the user finding out in the ledger a week later.
const vague = read("spent 120 on merienda");
assert.equal(vague?.txn.accountId, "g", "falls back to the first account");
assert.ok(vague?.guessed.includes("account"));
assert.equal(vague?.txn.category, "food", "but merienda still reads as food");
assert.ok(!vague?.guessed.includes("kind"), "'spent' is explicit, so the kind was not guessed");

// An expense with no recognisable category lands in Other and admits it.
const odd = read("paid 800 from maya");
assert.equal(odd?.txn.category, "other");
assert.ok(odd?.guessed.includes("category"));

// Semicolons split lines too, so one typed line can hold two transactions.
assert.equal(parseMessage("coffee 120 from gcash; jeep 15 from cash", accounts, at).length, 2);

// Blank lines between entries must not produce empty drafts.
assert.equal(parseMessage("coffee 120 from gcash\n\n\nbus 20 from cash", accounts, at).length, 2);

/* -------------------------------------------------- which way money went --- */

// The bug this section exists for: "added N to X" used to file an expense
// *out* of X. Money named as arriving must never leave.
const added = read("added 1500 to my maribank");
assert.equal(added?.txn.kind, "income", "money added to a wallet goes in, not out");
assert.equal(added?.txn.accountId, "mb");
assert.ok(
  added?.guessed.includes("kind"),
  "but it is not the same claim as earning it — it may have come from another wallet"
);

for (const line of ["topped up 500 to cash", "deposited 2000 in bpi", "put in 300 to maya"]) {
  assert.equal(read(line)?.txn.kind, "income", line);
}

// A save still reads as arriving, and is still flagged.
const saved = read("saved 5000 in maribank");
assert.equal(saved?.txn.kind, "income");
assert.ok(saved?.guessed.includes("kind"));

// Earning it is a confident claim, and the source is read rather than dumped
// into "other".
const earnings = read("got my salary 32000 in bpi");
assert.equal(earnings?.txn.kind, "income");
assert.equal(earnings?.txn.source, "salary");
assert.deepEqual(earnings?.guessed, [], "'salary' names both the kind and the source");
assert.equal(read("allowance 2000 in gcash")?.txn.source, "allowance");
assert.equal(read("received 5000 in maya")?.txn.source, "other", "no source named");

/* ---------------------------------------------- transfers, either order --- */

// "to Y from X" is as natural as "from X to Y", and used to be read backwards:
// the old split took everything before the first "to" as the source, which put
// the money in the wrong wallet and took it out of the other.
const backwards = read("sent 2000 to maribank from gcash");
assert.equal(backwards?.txn.kind, "transfer");
assert.equal(backwards?.txn.accountId, "g", "money left GCash");
assert.equal(backwards?.txn.toAccountId, "mb", "and arrived at MariBank");

const forwards = read("sent 2000 from gcash to maribank");
assert.equal(forwards?.txn.accountId, "g", "the other order must agree");
assert.equal(forwards?.txn.toAccountId, "mb");

assert.equal(read("withdrew 1000 from bpi to cash")?.txn.kind, "transfer");
assert.equal(read("transferred 1000 gcash to maya")?.txn.toAccountId, "m", "one marker is enough");

// A transfer needs two *different* wallets. Naming one twice is not a move.
assert.notEqual(read("moved 500 from gcash to gcash")?.txn.kind, "transfer");

/* --------------------------------------------------------------- labels --- */

// The wallet was referred to by type, not by name, and the note kept it: the
// row used to read "I spended my gcash".
assert.equal(read("i spended 1500 using my gcash")?.txn.note, undefined);
assert.equal(
  read("paid netflix 499 maya")?.txn.note,
  "Netflix",
  "the brand survives, the rest goes"
);
assert.equal(read("grab going home 180 gcash")?.txn.note, "Grab going home");

// A wallet name holding regex metacharacters must not blow up the note pass.
const awkward: Account[] = [{ id: "x", name: "Cash (USD)", type: "cash", openingBalance: 0 }];
assert.equal(parseLine("lunch 250 from cash (usd)", awkward, at)?.txn.note, "Lunch");

/* -------------------------------------------- fewer pointless questions --- */

// Saying what it was spent on, or which wallet it came out of, is saying it
// was spent. Neither should need confirming.
assert.ok(!read("gym 250 from bpi")?.guessed.includes("kind"));
assert.ok(!read("1500 using my gcash")?.guessed.includes("kind"), "'using' names the source");
assert.ok(!read("lunch 250")?.guessed.includes("kind"), "a category is a claim of spending");

// But a bare amount against a bare wallet still is a guess.
assert.ok(read("200 gcash")?.guessed.includes("kind"));

/* ------------------------------------------------------------------ when --- */

// You log last night's dinner in the morning, so the one date phrase worth
// understanding is yesterday — otherwise it lands in the wrong month's totals
// on the first of the month.
const late = read("dinner 450 from gcash yesterday");
assert.equal(late?.txn.at.slice(0, 10), "2026-09-17", "the day before the fixed clock");
assert.equal(read("kahapon 200 jeep from cash")?.txn.at.slice(0, 10), "2026-09-17");

// Anything else is now, rather than a guess at a date.
assert.equal(read("dinner 450 from gcash")?.txn.at.slice(0, 10), "2026-09-18");

// Crossing a month boundary must roll the month, not produce day zero.
const firstOfMonth = parseLine(
  "lunch 250 from gcash yesterday",
  accounts,
  new Date("2026-10-01T04:00:00.000Z")
);
assert.equal(firstOfMonth?.txn.at.slice(0, 10), "2026-09-30");

// Every field the screen can flag has something to call it.
for (const field of ["account", "category", "kind"] as const) {
  assert.ok(GUESS_LABELS[field].length > 0, field);
}

/* ------------------------------- wallet names that are also keywords --- */

// Wallets are named for their purpose now, so their names collide with the
// vocabulary this module reads intent from. Caught in the live UI: "gym 250
// from ipon" filed a gym session as INCOME, because "ipon" is both the
// wallet's name and the Filipino verb for saving.
const purposeful: Account[] = [
  { id: "i", name: "Ipon", type: "bpi", openingBalance: 0 },
  { id: "bl", name: "Bills", type: "maya", openingBalance: 0 },
  { id: "ev", name: "Everyday", type: "gcash", openingBalance: 0 },
  { id: "sv", name: "Savings", type: "maribank", openingBalance: 0 },
];
const byPurpose = (line: string) => parseLine(line, purposeful, at);

const gym = byPurpose("gym 250 from ipon");
assert.equal(gym?.txn.kind, "expense", "the wallet is called Ipon; nobody saved anything");
assert.equal(gym?.txn.accountId, "i");
assert.equal(gym?.txn.category, "health");

// "bill" is a utilities keyword and "Bills" is a wallet. The subscription must
// still be a subscription.
const sub = byPurpose("netflix 499 from bills");
assert.equal(sub?.txn.category, "subscriptions");
assert.equal(sub?.txn.accountId, "bl");

// "Savings" as a wallet name must not read as the act of saving either.
assert.equal(byPurpose("lunch 180 from savings")?.txn.kind, "expense");

// And the words still work when they are genuinely verbs rather than wallets.
assert.equal(byPurpose("saved 1000 to everyday")?.txn.kind, "income");

/* ------------------------------------------ more ways to say an amount --- */

assert.equal(read("lunch 1.5k from gcash")?.txn.amount, 150_000, "k shorthand");
assert.equal(read("rent 12k from bpi")?.txn.amount, 1_200_000);
assert.equal(read("coffee p150 from maya")?.txn.amount, 15_000, "P for peso");
assert.equal(read("coffee 150 pesos from maya")?.txn.amount, 15_000);
assert.equal(read("lunch 2.5k from gcash")?.txn.note, "Lunch", "no stray K on the row");

// A sign is the plainest statement of direction, and needs no confirming.
const plus = read("+500 gcash");
assert.equal(plus?.txn.kind, "income");
assert.deepEqual(plus?.guessed, []);
const minus = read("-120 maya");
assert.equal(minus?.txn.kind, "expense");
assert.ok(!minus?.guessed.includes("kind"));
assert.equal(read("minus 200 gcash")?.txn.kind, "expense");
assert.ok(!read("minus 200 gcash")?.guessed.includes("kind"), "'minus' says it");
assert.equal(read("deduct 300 from bpi")?.txn.kind, "expense");
assert.equal(read("plus 1000 to maya")?.txn.kind, "income");

// Whole words: "sent" is not inside "present", nor "plus" inside "surplus".
assert.notEqual(read("surplus 500 cash")?.txn.kind, "income");

/* --------------------------------------------- several in one sentence --- */

const two = parseMessage("lunch 150 and coffee 120 from gcash", accounts, at);
assert.equal(two.length, 2);
assert.deepEqual(
  two.map((draft) => draft.txn.accountId),
  ["g", "g"],
  "the piece without a wallet borrows the one the line named"
);
assert.equal(two[0].txn.category, "food");
assert.equal(parseMessage("jeep 15, bus 40 from cash", accounts, at).length, 2);
// Only one amount: one row, however many "and"s.
assert.equal(parseMessage("bread and butter 80 from cash", accounts, at).length, 1);

/* ------------------------------ withdrawals, cash-ins, held-value wallets --- */

const atm = read("withdrew 1000 from bpi");
assert.equal(atm?.txn.kind, "transfer", "a withdrawal lands in Cash, it is not spending");
assert.equal(atm?.txn.accountId, "b");
assert.equal(atm?.txn.toAccountId, "c");
assert.equal(read("cash out 500 gcash")?.txn.toAccountId, "c");
const cashIn = read("cash in 500 to gcash");
assert.equal(cashIn?.txn.kind, "transfer");
assert.equal(cashIn?.txn.accountId, "c");
assert.equal(cashIn?.txn.toAccountId, "g");

const held: Account[] = [
  ...accounts,
  { id: "cc", name: "BDO Card", type: "credit", openingBalance: 0 },
  { id: "mp", name: "MP2", type: "mp2", openingBalance: 0 },
  { id: "btc", name: "Coins", type: "crypto", openingBalance: 0 },
  { id: "st", name: "COL", type: "stocks", openingBalance: 0 },
  { id: "bl", name: "Bills", type: "maya", openingBalance: 0 },
];
const hold = (line: string) => parseLine(line, held, at);

// Paying the card, an MP2 contribution, buying Bitcoin: money you still own.
const card = hold("paid credit card 5000 from bpi");
assert.equal(card?.txn.kind, "transfer");
assert.equal(card?.txn.toAccountId, "cc");
assert.equal(hold("paid 2000 to pag-ibig mp2 from bpi")?.txn.toAccountId, "mp");
const btc = hold("bought 5000 bitcoin from gcash");
assert.equal(btc?.txn.kind, "transfer", "buying Bitcoin moves money, it does not spend it");
assert.equal(btc?.txn.accountId, "g");
assert.equal(btc?.txn.toAccountId, "btc");
const sold = hold("sold 3000 btc to gcash");
assert.equal(sold?.txn.accountId, "btc");
assert.equal(sold?.txn.toAccountId, "g");
assert.equal(hold("invested 10k in stocks from bpi")?.txn.toAccountId, "st");

// But paying for something *named like* a wallet is still spending.
const bills = hold("paid bills 2000 from gcash");
assert.equal(bills?.txn.kind, "expense", "a wallet called Bills is not where the money went");

// Short aliases only as whole words: "eth" is not inside "something".
assert.notEqual(hold("something 200 from cash")?.txn.accountId, "btc");

/* ---------------------------------------------------------- set a balance --- */

assert.deepEqual(parseBalance("set gcash to 1500", accounts), {
  accountId: "g",
  balance: 150_000,
  source: "set gcash to 1500",
});
assert.equal(parseBalance("bitcoin is now worth 52k", held)?.balance, 5_200_000);
assert.equal(parseBalance("my bpi balance is 20,000", accounts)?.accountId, "b");
assert.equal(parseBalance("maya now 800", accounts)?.balance, 80_000);
// Not balances: a transaction, a question, an unknown wallet.
for (const line of ["sent 500 to gcash", "how much is in gcash", "set lunch to 200", "gcash 500"]) {
  assert.equal(parseBalance(line, accounts), null, line);
}

console.log("moneytalk: all checks passed");
