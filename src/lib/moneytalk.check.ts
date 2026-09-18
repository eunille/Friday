import assert from "node:assert/strict";

import type { Account } from "./budget.ts";
import { parseLine, parseMessage } from "./moneytalk.ts";

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
assert.deepEqual(coffee.guessed, ["kind"], "nothing said 'spent', so the kind was assumed");

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

console.log("moneytalk: all checks passed");
