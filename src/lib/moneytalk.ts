/**
 * Reading money out of a sentence. No React, no SQL, no model.
 *
 * "Starbucks 250 from gcash" becomes an expense of ₱250 against GCash, filed
 * under Food, by rules — not by asking a 0.5B model to emit a function call.
 *
 * That is the whole design. A small model asked for structured output gets it
 * right most of the time, and its failures are quiet: it files ₱2,500 against
 * the wrong wallet, or drops a digit, and the ledger is simply wrong. Rules
 * fail visibly, and everything here is only ever *proposed* — the user confirms
 * before a single row is written.
 *
 * The model still has a job, answering "what did I spend most on?" in a
 * sentence. It just never decides what a number means.
 */

import {
  CATEGORIES,
  parseAmount,
  type Account,
  type Category,
  type Txn,
  type TxnKind,
  // Extension included: this module is also run directly by Node for its
  // checks, and Node's ESM loader will not resolve an extensionless path the
  // way Metro does.
} from "./budget.ts";

/** A parsed line, with whatever had to be guessed rather than read. */
export type Draft = {
  txn: Txn;
  /** Fields the text did not actually specify. The screen marks these. */
  guessed: readonly ("account" | "category" | "kind")[];
  /** The line it came from, so the user can see what was read. */
  source: string;
};

/**
 * Words that pin a category.
 *
 * Filipino terms are in here deliberately — "merienda", "sahod", "kain",
 * "kuryente", "load". A tracker for someone in Manila that only understands
 * "lunch" is one that makes them translate their own spending before it reads.
 */
const KEYWORDS: Readonly<Record<Category, readonly string[]>> = {
  food: [
    "food",
    "lunch",
    "dinner",
    "breakfast",
    "snack",
    "merienda",
    "kain",
    "coffee",
    "starbucks",
    "jollibee",
    "mcdo",
    "mcdonalds",
    "grocery",
    "groceries",
    "palengke",
    "restaurant",
    "milktea",
    "pizza",
    "ulam",
    "baon",
  ],
  transport: [
    "transport",
    "grab",
    "bus",
    "jeep",
    "jeepney",
    "taxi",
    "tricycle",
    "trike",
    "fare",
    "gas",
    "fuel",
    "petrol",
    "mrt",
    "lrt",
    "toll",
    "parking",
    "angkas",
  ],
  housing: ["rent", "mortgage", "dorm", "boarding"],
  utilities: [
    "electric",
    "electricity",
    "meralco",
    "water",
    "maynilad",
    "internet",
    "wifi",
    "pldt",
    "converge",
    "bill",
    "kuryente",
    "tubig",
  ],
  shopping: ["shopping", "shopee", "lazada", "clothes", "shoes", "uniqlo", "damit"],
  fun: ["movie", "cinema", "game", "concert", "ktv", "videoke", "inuman"],
  health: [
    "medicine",
    "gamot",
    "doctor",
    "hospital",
    "clinic",
    "pharmacy",
    "mercury",
    "watsons",
    "gym",
    "dentist",
    "checkup",
  ],
  subscriptions: [
    "subscription",
    "spotify",
    "netflix",
    "youtube",
    "icloud",
    "canva",
    "load",
    "prepaid",
    "postpaid",
  ],
  debt: ["loan", "utang", "debt", "installment", "amortization"],
  education: ["tuition", "school", "book", "libro", "matricula", "enrollment", "seminar"],
  other: [],
};

const INCOME_WORDS = [
  "salary",
  "sahod",
  "sweldo",
  "received",
  "income",
  "allowance",
  "refund",
  "bonus",
  "kita",
];
const TRANSFER_WORDS = ["transfer", "transferred", "moved", "move", "cash in", "cash out"];
const SAVED_WORDS = ["saved", "ipon", "naipon", "put away", "set aside"];
const SPEND_WORDS = ["spent", "paid", "bought", "bayad", "gastos", "binili"];

function norm(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s.,₱-]/gu, " ");
}

/** Longest alias first, so "bpi savings" is not beaten by a bare "bpi". */
function findAccount(text: string, accounts: readonly Account[]): Account | null {
  const candidates = accounts
    .flatMap((account) =>
      [account.name.toLowerCase(), account.type.toLowerCase()].map((alias) => ({ account, alias }))
    )
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const { account, alias } of candidates) {
    if (alias.length >= 2 && text.includes(alias)) return account;
  }
  return null;
}

function findCategory(text: string): Category | null {
  for (const [category, words] of Object.entries(KEYWORDS) as [Category, readonly string[]][]) {
    for (const word of words) {
      // Word-boundary matched, or "gas" fires on "Vegas" and "load" on "download".
      if (new RegExp(`(^|\\s)${word}(\\s|$|[.,])`).test(text)) return category;
    }
  }
  return null;
}

function has(text: string, words: readonly string[]): boolean {
  return words.some((word) => text.includes(word));
}

/**
 * The first money-looking number in the line.
 *
 * Numbers glued to letters are skipped — "grab2go" is a name, not two pesos —
 * and the first is taken, because people write the amount before the trailing
 * detail far more often than after it.
 */
function findAmount(text: string): number | null {
  const match =
    /(?:^|\s)₱?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?=\s|$|[.,;])/.exec(text);
  return match ? parseAmount(match[1]) : null;
}

/** Splits "… from X to Y" so each half is searched for its own account. */
function transferHalves(text: string): { from: string; to: string } | null {
  const match = /\bto\b/.exec(text);
  return match ? { from: text.slice(0, match.index), to: text.slice(match.index) } : null;
}

/**
 * A short label from the line: the words that are neither amount nor wallet.
 * "Starbucks 250 from gcash" leaves "Starbucks", which is what belongs on the
 * row — the amount is already the amount.
 */
function describe(raw: string, accounts: readonly Account[]): string {
  let stripped = raw.replace(/₱?\s*\d[\d,]*(\.\d{1,2})?/g, " ");
  for (const account of accounts) {
    stripped = stripped.replace(new RegExp(account.name, "gi"), " ");
  }
  const words = stripped
    .replace(
      /\b(from|to|in|at|on|for|using|via|with|spent|paid|bought|saved|today|yesterday)\b/gi,
      " "
    )
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");
  return words.length > 1 ? words[0].toUpperCase() + words.slice(1) : "";
}

/**
 * Reads one line. Returns null when it holds no amount — a sentence with no
 * number is a question, not a transaction, and inventing one would be the worst
 * thing this could do.
 */
export function parseLine(
  line: string,
  accounts: readonly Account[],
  now = new Date()
): Draft | null {
  const raw = line.trim();
  if (raw === "" || accounts.length === 0) return null;

  const text = norm(raw);
  const amount = findAmount(text);
  if (amount === null || amount <= 0) return null;

  const at = now.toISOString();
  const id = `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // Transfer is checked first: it is the only kind needing two accounts, and
  // "moved 2000 from maribank to gcash" also contains words the others match.
  const halves = transferHalves(text);
  if (has(text, TRANSFER_WORDS) && halves) {
    const from = findAccount(halves.from, accounts);
    const to = findAccount(halves.to, accounts);
    if (from && to && from.id !== to.id) {
      return {
        txn: { id, kind: "transfer", amount, accountId: from.id, toAccountId: to.id, at },
        guessed: [],
        source: raw,
      };
    }
  }

  const guessed: ("account" | "category" | "kind")[] = [];
  const account = findAccount(text, accounts);
  if (!account) guessed.push("account");

  // "Saved 5000 in MariBank" is money arriving, which the ledger can only hold
  // as income — but it is not the same claim as "salary". They may well have
  // meant a transfer out of another wallet, so a save is always flagged and
  // never silently filed as earnings.
  const earned = has(text, INCOME_WORDS);
  const putAway = has(text, SAVED_WORDS);
  const kind: TxnKind = earned || putAway ? "income" : "expense";
  if (putAway && !earned) guessed.push("kind");
  else if (kind === "expense" && !has(text, SPEND_WORDS)) guessed.push("kind");

  const category = kind === "expense" ? findCategory(text) : null;
  if (kind === "expense" && !category) guessed.push("category");

  const note = describe(raw, accounts);

  return {
    txn: {
      id,
      kind,
      amount,
      accountId: (account ?? accounts[0]).id,
      at,
      ...(kind === "expense" ? { category: category ?? ("other" as Category) } : {}),
      ...(kind === "income" ? { source: "other" as const } : {}),
      ...(note ? { note } : {}),
    },
    guessed,
    source: raw,
  };
}

/** Every line that carried an amount. One message can log several at once. */
export function parseMessage(
  message: string,
  accounts: readonly Account[],
  now = new Date()
): Draft[] {
  return message
    .split(/[\n;]+/)
    .map((line) => parseLine(line, accounts, now))
    .filter((draft): draft is Draft => draft !== null);
}

/** One line of plain English for a draft, used in the confirmation. */
export function summarise(draft: Draft, accounts: readonly Account[]): string {
  const name = (id?: string): string => accounts.find((account) => account.id === id)?.name ?? "?";
  const { txn } = draft;

  if (txn.kind === "transfer")
    return `Move from ${name(txn.accountId)} to ${name(txn.toAccountId)}`;
  if (txn.kind === "income") return `Income into ${name(txn.accountId)}`;
  return `${CATEGORIES[txn.category ?? "other"].label} from ${name(txn.accountId)}`;
}
