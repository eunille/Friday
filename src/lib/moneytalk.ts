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
  ACCOUNT_TYPES,
  categoryOf,
  parseAmount,
  type Account,
  type AccountType,
  type Category,
  type IncomeSource,
  type Txn,
  type TxnKind,
  // Extension included: this module is also run directly by Node for its
  // checks, and Node's ESM loader will not resolve an extensionless path the
  // way Metro does.
} from "./budget.ts";

/** What the text did not actually say and had to be filled in. */
export type Guess = "account" | "category" | "kind";

/**
 * What to call each of those on screen.
 *
 * Kept beside the type so the two cannot drift. "Assumed kind" was the type
 * name leaking into the interface — it means nothing to someone logging lunch.
 */
export const GUESS_LABELS: Readonly<Record<Guess, string>> = {
  account: "which wallet",
  category: "what for",
  kind: "in or out",
};

/** A parsed line, with whatever had to be guessed rather than read. */
export type Draft = {
  txn: Txn;
  /** Fields the text did not actually specify. The screen marks these. */
  guessed: readonly Guess[];
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
  "commission",
  "payout",
  "earned",
  "credited",
  "cashback",
  "dividend",
  "dividends",
  "interest",
  "sold",
  "won",
  "natanggap",
  "plus",
];

/** Which income source a line names, so it is not all filed under "Other". */
const SOURCE_WORDS: Readonly<Record<IncomeSource, readonly string[]>> = {
  salary: ["salary", "sahod", "sweldo", "payroll"],
  freelance: ["freelance", "client", "gig", "commission", "raket"],
  business: ["business", "sales", "negosyo", "payout"],
  allowance: ["allowance", "baon", "padala"],
  other: [],
};

const TRANSFER_WORDS = [
  "transfer",
  "transferred",
  "moved",
  "move",
  // Spelled as norm() folds them — see there.
  "cashin",
  "cashout",
  "sent",
  "send",
  "withdrew",
  "withdraw",
  "withdrawal",
  "lipat",
  "padala",
];

const SAVED_WORDS = ["saved", "ipon", "naipon", "put away", "set aside"];

/**
 * Money arriving somewhere without being *earned*.
 *
 * "Added 1500 to my emergency fund" used to read as an expense *out* of that
 * wallet — the exact opposite of what happened, and the worst thing this can
 * do. It is income to the ledger, but it is not the same claim as "salary":
 * the money may well have come from another wallet, so the kind is always
 * flagged for confirmation rather than filed quietly as earnings.
 */
const DEPOSIT_WORDS = [
  "added",
  "add",
  "deposit",
  "deposited",
  "topped up",
  "top up",
  "topup",
  "loaded",
  "put in",
  "put into",
  "dagdag",
  "nilagay",
];

const SPEND_WORDS = [
  "spent",
  "spend",
  "spended",
  "spending",
  "paid",
  "pay",
  "bought",
  "buy",
  "used",
  "bayad",
  "nagbayad",
  "gastos",
  "gumastos",
  "binili",
  "bumili",
  "minus",
  "deduct",
  "deducted",
  "subtract",
  "less",
  "bawas",
  "binawas",
  "charged",
  "fee",
];

/**
 * Wallets that hold value rather than spend it. Paying into one — the card
 * bill, an MP2 contribution, buying Bitcoin — moves money you still own, so
 * it is a transfer, not spending that shrinks your net worth.
 */
const HOLDS: ReadonlySet<AccountType> = new Set(["credit", "mp2", "crypto", "stocks"]);
const INVESTED: ReadonlySet<AccountType> = new Set(["mp2", "crypto", "stocks"]);

const PAY_WORDS = ["paid", "pay", "bayad", "nagbayad", "bought", "buy", "binili", "bumili"];
const INVEST_WORDS = ["invest", "invested", "contributed", "contribution", "hulog", "save"];
const SELL_WORDS = ["sold", "sell", "benta", "binenta"];
const WITHDRAW_WORDS = ["withdrew", "withdraw", "withdrawal", "cashout", "atm"];

/**
 * Words that mark the wallet as the *source* of the money: "250 gym from
 * savings", "1500 using my gcash". Naming where it came out of is itself a
 * claim that it went out, so these save the user confirming a kind the
 * sentence already made obvious.
 */
const SOURCE_MARKERS = ["from", "using", "via", "with", "thru", "through", "galing"];

/**
 * When it happened. Now, unless the line says otherwise.
 *
 * Only yesterday is understood, because that is the one people actually write
 * — you log last night's dinner this morning. "Three tuesdays ago" is a date
 * picker's job, and the row can be edited after saving.
 */
function findWhen(text: string, now: Date): Date {
  if (!/\b(yesterday|kahapon|kagabi)\b/.test(text)) return now;
  const then = new Date(now);
  then.setDate(then.getDate() - 1);
  return then;
}

/**
 * Lowercased, punctuation out — except what amounts use, "+" and "-" among
 * them. "Cash in" and "cash out" are folded to one word first, because "cash"
 * on its own is a wallet: left apart, "cash out 1000 from bpi" named the Cash
 * wallet as the source.
 */
function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.,₱+-]/gu, " ")
    .replace(/\bcash[\s-]?(in|out)\b/g, "cash$1");
}

/**
 * What people call a wallet besides its name and type. Nobody says "crypto"
 * when they mean their Bitcoin, or "credit" when they mean the card.
 */
const TYPE_ALIASES: Partial<Record<AccountType, readonly string[]>> = {
  credit: ["credit card", "card"],
  mp2: ["mp2", "pag-ibig", "pagibig", "pag ibig"],
  crypto: ["bitcoin", "btc", "ethereum", "eth", "usdt", "solana", "coins.ph", "binance"],
  stocks: ["stock", "stocks", "shares", "col financial", "pse"],
  landbank: ["lbp"],
  metrobank: ["metro bank"],
  gotyme: ["go tyme"],
  seabank: ["sea bank"],
};

/**
 * Every word that means this wallet, longest first. "Other" is left out: as a
 * type or label it is also an ordinary English word, and "other 200" is not a
 * wallet.
 */
function aliasesOf(account: Account): string[] {
  const names = [
    account.name,
    ...(account.type === "other" ? [] : [account.type, ACCOUNT_TYPES[account.type]?.label ?? ""]),
    ...(TYPE_ALIASES[account.type] ?? []),
  ];
  return [...new Set(names.map((name) => name.toLowerCase().trim()))].filter(
    (name) => name.length >= 2
  );
}

/**
 * The alias as a whole word. Substring matching made "eth" a wallet inside
 * "something" and "card" one inside "discarded".
 */
function wordRe(alias: string, flags = ""): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(alias)}(?![\\p{L}\\p{N}])`, `u${flags}`);
}

/** Longest alias first, so "bpi savings" is not beaten by a bare "bpi". */
function findAccount(text: string, accounts: readonly Account[]): Account | null {
  const candidates = accounts
    .flatMap((account) => aliasesOf(account).map((alias) => ({ account, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const { account, alias } of candidates) {
    if (wordRe(alias).test(text)) return account;
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

/** Which income source the line names, if any. Everything else is "other". */
function findSource(text: string): IncomeSource | null {
  for (const [source, words] of Object.entries(SOURCE_WORDS) as [
    IncomeSource,
    readonly string[],
  ][]) {
    for (const word of words) {
      if (new RegExp(`(^|\\s)${word}(\\s|$|[.,])`).test(text)) return source;
    }
  }
  return null;
}

/** Whole words only: "sent" is not in "present", nor "plus" in "surplus". */
function has(text: string, words: readonly string[]): boolean {
  return words.some((word) => wordRe(word).test(text));
}

/**
 * The first money-looking number in the line.
 *
 * Numbers glued to letters are skipped — "grab2go" is a name, not two pesos —
 * and the first is taken, because people write the amount before the trailing
 * detail far more often than after it.
 */
function findAmount(text: string): { amount: number; sign: "+" | "-" | null } | null {
  // A sign, a peso mark written any of the ways people write it (₱, php, p),
  // the number, then "k"/"m" shorthand or a trailing "pesos".
  const match =
    /(?:^|\s)([+-])?\s*(?:₱|php|p)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d+)?)\s*(k|m)?(?:\s*(?:php|pesos?))?(?=\s|$|[.,;!?])/.exec(
      text
    );
  if (!match) return null;
  const [, sign, digits, scale] = match;
  const amount = scale
    ? Math.round(Number(digits.replace(/,/g, "")) * (scale === "k" ? 1_000 : 1_000_000) * 100)
    : parseAmount(digits);
  if (amount === null || !Number.isFinite(amount)) return null;
  return { amount, sign: (sign as "+" | "-" | undefined) ?? null };
}

/**
 * Splits a line into the half naming where money came from and the half naming
 * where it went, in whichever order they were written.
 *
 * "Sent 2000 to emergency fund from everyday" is as natural as "from everyday
 * to emergency fund", and the old version assumed the second: it split on the
 * first "to" and took everything before as the source, which read that
 * sentence exactly backwards and moved the money the wrong way.
 *
 * One marker is enough — "transferred 1000 gcash to bpi" names its source
 * before it ever says "to".
 */
function transferHalves(text: string): { from: string; to: string } | null {
  const fromAt = /\bfrom\b/.exec(text)?.index ?? -1;
  // "into" has to be listed explicitly: \bto\b does not match inside it.
  const toAt = /\b(?:to|into)\b/.exec(text)?.index ?? -1;

  if (fromAt >= 0 && toAt >= 0) {
    return fromAt < toAt
      ? { from: text.slice(fromAt, toAt), to: text.slice(toAt) }
      : { from: text.slice(fromAt), to: text.slice(toAt, fromAt) };
  }
  if (toAt >= 0) return { from: text.slice(0, toAt), to: text.slice(toAt) };
  if (fromAt >= 0) return { from: text.slice(fromAt), to: text.slice(0, fromAt) };
  return null;
}

/** Regex-safe: a wallet may legitimately be called "Cash (USD)". */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The line with every wallet name and type blanked out.
 *
 * Wallets are named for their purpose now — "Ipon", "Bills", "Savings",
 * "Emergency fund" — and those same words are how this module reads *intent*.
 * Without separating them, "gym 250 from ipon" sees the wallet's own name as
 * the verb "ipon", to save, and files a gym session as income; "netflix 499
 * from bills" files a subscription under utilities because "bill" is a
 * utilities keyword.
 *
 * Which wallet is still matched against the full text. Only the questions
 * about intent — what kind, what category, what source — are asked of what is
 * left once the wallet names are out of the way.
 */
function withoutAccounts(text: string, accounts: readonly Account[]): string {
  let rest = text;
  for (const account of accounts) {
    for (const alias of aliasesOf(account)) rest = rest.replace(wordRe(alias, "g"), " ");
  }
  return rest;
}

/**
 * Grammar, not content. Pronouns, prepositions and the verbs of spending —
 * everything a person says to make a sentence sound like a sentence, none of
 * which tells you anything the parsed fields do not already hold.
 */
const FILLER =
  /\b(i|my|me|mine|we|our|a|an|the|of|is|was|po|na|ko|ng|sa|yung|ung|lang|for|from|to|into|in|at|on|using|via|with|thru|through|galing|today|yesterday|kanina|spent|spend|spended|spending|paid|pay|bought|buy|used|saved|added|add|deposit|deposited|topped|top|up|put|sent|send|got|get|transfer|transferred|moved|move|withdrew|withdraw|minus|deduct|deducted|less|plus|earned|received|invested|invest|cash in|cash out|pesos?|php)\b/gi;

/**
 * A short label from the line: the words that are neither amount nor wallet.
 * "Starbucks 250 from gcash" leaves "Starbucks", which is what belongs on the
 * row — the amount is already the amount.
 */
function describe(raw: string, accounts: readonly Account[]): string {
  // The whole amount as findAmount reads it — sign, peso mark and "k" too, or
  // "2.5k lunch" leaves a stray "K" on the row.
  let stripped = raw.replace(
    /(?<![\p{L}])[+-]?(?:₱|php|p)?\s*\d[\d,]*(?:\.\d+)?(?:\s*[km](?![\p{L}]))?/giu,
    " "
  );
  for (const account of accounts) {
    // Every alias, not just the name. Stripping only the name left "I spended
    // my gcash" on the row, because "gcash" is how the wallet was actually
    // referred to. Escaped, or a wallet called "Cash (USD)" throws on a bad
    // regex rather than saving.
    for (const alias of aliasesOf(account)) stripped = stripped.replace(wordRe(alias, "gi"), " ");
  }
  const words = stripped
    .replace(FILLER, " ")
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
  const found = findAmount(text);
  if (found === null || found.amount <= 0) return null;
  const { amount, sign } = found;

  const at = findWhen(text, now).toISOString();
  const id = `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const transfer = (from: Account, to: Account): Draft => ({
    txn: { id, kind: "transfer", amount, accountId: from.id, toAccountId: to.id, at },
    guessed: [],
    source: raw,
  });

  // Transfer is checked first: it is the only kind needing two accounts, and
  // "moved 2000 from maribank to gcash" also contains words the others match.
  // Intent is read from the line minus the wallet names — see withoutAccounts.
  const intent = withoutAccounts(text, accounts);

  const halves = transferHalves(text);
  if (halves) {
    const from = findAccount(halves.from, accounts);
    const to = findAccount(halves.to, accounts);
    if (
      from &&
      to &&
      from.id !== to.id &&
      // Two wallets named is not enough on its own: "paid bills 2000 from
      // gcash" with a wallet called Bills is spending. It takes a word for
      // moving money, or money going into something that holds value (the
      // card bill, MP2, Bitcoin), or coming back out of an investment.
      (has(intent, TRANSFER_WORDS) ||
        has(intent, SAVED_WORDS) ||
        has(intent, DEPOSIT_WORDS) ||
        has(intent, INVEST_WORDS) ||
        (has(intent, PAY_WORDS) && HOLDS.has(to.type)) ||
        (has(intent, SELL_WORDS) && INVESTED.has(from.type)))
    ) {
      return transfer(from, to);
    }
  }

  // One end named, the other implied: a withdrawal lands in your Cash wallet,
  // a cash-in comes out of it. "withdrew 1000 from bpi" is not spending.
  const cash = accounts.find((account) => account.type === "cash");
  if (cash && has(intent, WITHDRAW_WORDS)) {
    const from = findAccount(halves ? halves.from : text, accounts);
    if (from && from.id !== cash.id) return transfer(from, cash);
  }
  if (cash && has(intent, ["cashin"])) {
    const to = findAccount(halves ? halves.to : text, accounts);
    if (to && to.id !== cash.id) return transfer(cash, to);
  }

  const guessed: Guess[] = [];
  const account = findAccount(text, accounts);
  if (!account) guessed.push("account");

  // "Saved 5000 in MariBank" and "added 1500 to my emergency fund" are both
  // money *arriving*, which the ledger can only hold as income — but neither is
  // the same claim as "salary". Either may really have come out of another
  // wallet, so they are filed as income and the kind is always flagged, never
  // quietly recorded as earnings.
  const earned = has(intent, INCOME_WORDS);
  const putAway = has(intent, SAVED_WORDS);
  const movedIn = has(intent, DEPOSIT_WORDS);
  const spent = has(intent, SPEND_WORDS);
  // A written sign is the plainest claim there is: "+500 gcash", "-120 maya".
  const kind: TxnKind =
    sign === "+"
      ? "income"
      : sign === "-"
        ? "expense"
        : (earned || putAway || movedIn) && !(spent && !earned)
          ? "income"
          : "expense";

  const category = kind === "expense" ? findCategory(intent) : null;
  if (kind === "expense" && !category) guessed.push("category");

  // An expense is only a guess when nothing in the sentence says so. Three
  // things do, and any one is enough: a spending verb, naming the wallet the
  // money came *out* of, or naming what it was spent on. "250 gym from
  // savings" says it twice over, and used to be flagged anyway.
  if (sign) {
    // Stated outright; nothing to confirm.
  } else if (kind === "income" && (putAway || movedIn) && !earned) guessed.push("kind");
  else if (
    kind === "expense" &&
    !spent &&
    !(account && has(text, SOURCE_MARKERS)) &&
    !category
  ) {
    guessed.push("kind");
  }

  const note = describe(raw, accounts);

  return {
    txn: {
      id,
      kind,
      amount,
      accountId: (account ?? accounts[0]).id,
      at,
      ...(kind === "expense" ? { category: category ?? ("other" as Category) } : {}),
      ...(kind === "income" ? { source: findSource(intent) ?? "other" } : {}),
      ...(note ? { note } : {}),
    },
    guessed,
    source: raw,
  };
}

/**
 * "lunch 150 and coffee 120 from gcash" is two things bought from one wallet.
 * Split on "and", "&" or a comma-and-space — only when every piece has its own
 * amount, so "bread and butter 80" stays one row — and a piece that names no
 * wallet borrows the one the line does name.
 */
function splitItems(line: string, accounts: readonly Account[]): string[] {
  const pieces = line.split(/\s*(?:,\s+|\s&\s|\band\b)\s*/i).filter(Boolean);
  if (pieces.length < 2 || !pieces.every((piece) => findAmount(norm(piece)))) return [line];

  const named = pieces.find((piece) => findAccount(norm(piece), accounts));
  if (!named) return pieces;
  const wallet = findAccount(norm(named), accounts)!;
  // The words that named it — "from gcash" — so the borrowing piece reads the
  // same way the naming one did.
  const phrase =
    /\b(?:from|using|via|with|thru|through|to|into|in|sa|galing)\b.*$/i.exec(named)?.[0] ??
    wallet.name;
  return pieces.map((piece) =>
    findAccount(norm(piece), accounts) ? piece : `${piece} ${phrase}`
  );
}

/** Every line that carried an amount. One message can log several at once. */
export function parseMessage(
  message: string,
  accounts: readonly Account[],
  now = new Date()
): Draft[] {
  return message
    .split(/[\n;]+/)
    .flatMap((line) => splitItems(line, accounts))
    .map((line) => parseLine(line, accounts, now))
    .filter((draft): draft is Draft => draft !== null);
}

/** "set gcash to 1500", "bitcoin is now worth 52k": what a wallet holds now. */
export type BalanceSet = { accountId: string; balance: number; source: string };

/**
 * A statement of what a wallet holds, rather than something that happened.
 *
 * This is how an investment is kept honest offline: Bitcoin went up, so you
 * say what it is worth now. It changes the balance and logs nothing, because
 * a price moving is not income or spending — filing it as either would put
 * the market in your monthly budget.
 */
export function parseBalance(line: string, accounts: readonly Account[]): BalanceSet | null {
  const text = norm(line.trim()).replace(/[.!?]+$/, "");
  const said =
    /^(?:set|update|change|correct|make)\s+(?:my\s+)?(.+?)\s+(?:balance\s+)?(?:to|=|at)\s+(.+)$/.exec(
      text
    ) ??
    /^(?:my\s+)?(.+?)\s+(?:balance\s+(?:is\s+)?(?:now\s+)?|(?:is\s+)?now\s+(?:worth\s+|at\s+)?|is\s+worth\s+|worth\s+|=\s*)(.+)$/.exec(
      text
    );
  if (!said) return null;
  const account = findAccount(said[1], accounts);
  // Only the amount after the verb — "set gcash to 1500" has no other number
  // to confuse it with, and nothing else may be left over.
  const found = findAmount(said[2]);
  if (!account || !found || found.sign === "-" || said[2].replace(/[\d,.₱+\skmphpesos]/gi, "")) {
    return null;
  }
  return { accountId: account.id, balance: found.amount, source: line.trim() };
}

/** One line of plain English for a draft, used in the confirmation. */
export function summarise(draft: Draft, accounts: readonly Account[]): string {
  const name = (id?: string): string => accounts.find((account) => account.id === id)?.name ?? "?";
  const { txn } = draft;

  if (txn.kind === "transfer")
    return `Move from ${name(txn.accountId)} to ${name(txn.toAccountId)}`;
  if (txn.kind === "income") return `Income into ${name(txn.accountId)}`;
  return `${categoryOf(txn.category).label} from ${name(txn.accountId)}`;
}
