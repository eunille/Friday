/**
 * The native floor, faked, for the browser preview only.
 *
 * Metro swaps the packages that have no web build for this file when
 * platform === "web" (see metro.config.js). Nothing else changes: every screen,
 * component, style and piece of layout stays the one real source, so the
 * preview cannot drift from the app the way a hand-written mock would.
 *
 * What it does NOT do, and must never pretend to: run the model, read a label,
 * transcribe speech, or keep anything. The preview is for looking at the
 * interface. Behaviour is only ever true on a device.
 *
 * ponytail: a Map of arrays and a keyword match over the handful of SQL shapes
 * the app actually issues — not a SQLite build for the browser. The queries are
 * a closed set written by us, so a real parser would be code handling
 * statements that will never arrive.
 */

type Row = Record<string, unknown>;

const tables = new Map<string, Row[]>();

function table(name: string): Row[] {
  const rows = tables.get(name);
  if (rows) return rows;
  const fresh: Row[] = [];
  tables.set(name, fresh);
  return fresh;
}

const now = new Date();
function daysAgo(days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/**
 * Demo content, so the preview shows a populated interface rather than five
 * empty states. Invented figures — nobody should mistake these for real money.
 */
tables.set("accounts", [
  { id: "w1", name: "GCash", type: "gcash", openingBalance: 570_000, archived: 0 },
  { id: "w2", name: "Maya", type: "maya", openingBalance: 318_000, archived: 0 },
  { id: "w3", name: "BPI Savings", type: "bpi", openingBalance: 1_995_000, archived: 0 },
  { id: "w4", name: "MariBank", type: "maribank", openingBalance: 840_000, archived: 0 },
  { id: "w5", name: "Cash", type: "cash", openingBalance: 120_000, archived: 0 },
]);

tables.set("txns", [
  {
    id: "t1",
    kind: "expense",
    amount: 25_000,
    accountId: "w1",
    toAccountId: null,
    category: "food",
    source: null,
    note: "Starbucks",
    at: daysAgo(0),
  },
  {
    id: "t2",
    kind: "expense",
    amount: 7_000,
    accountId: "w5",
    toAccountId: null,
    category: "transport",
    source: null,
    note: "Bus",
    at: daysAgo(0),
  },
  {
    id: "t3",
    kind: "expense",
    amount: 15_600,
    accountId: "w3",
    toAccountId: null,
    category: "food",
    source: null,
    note: "Lunch",
    at: daysAgo(1),
  },
  {
    id: "t4",
    kind: "transfer",
    amount: 200_000,
    accountId: "w4",
    toAccountId: "w1",
    category: null,
    source: null,
    note: null,
    at: daysAgo(2),
  },
  {
    id: "t5",
    kind: "income",
    amount: 3_200_000,
    accountId: "w3",
    toAccountId: null,
    category: null,
    source: "salary",
    note: "Payday",
    at: daysAgo(4),
  },
  {
    id: "t6",
    kind: "expense",
    amount: 49_900,
    accountId: "w2",
    toAccountId: null,
    category: "subscriptions",
    source: null,
    note: "Spotify",
    at: daysAgo(6),
  },
  {
    id: "t7",
    kind: "expense",
    amount: 132_000,
    accountId: "w1",
    toAccountId: null,
    category: "shopping",
    source: null,
    note: null,
    at: daysAgo(9),
  },
]);

for (const empty of ["notes", "chats", "quiz_results", "vectors", "settings"]) table(empty);

/** The statement shapes the app issues, matched by keyword rather than parsed. */
function run(sql: string, args: unknown[] = []): { rows: Row[] } {
  const text = sql.trim().replace(/\s+/g, " ");
  const name = /\b(?:FROM|INTO|UPDATE|TABLE(?: IF NOT EXISTS)?)\s+([A-Za-z_]+)/i.exec(text)?.[1];

  if (/^CREATE/i.test(text)) {
    if (name) table(name);
    return { rows: [] };
  }
  if (!name) return { rows: [] };
  const rows = table(name);

  if (/^SELECT/i.test(text)) {
    if (/COUNT\(\*\)/i.test(text)) return { rows: [{ n: rows.length }] };
    const copy = [...rows];
    if (/ORDER BY\s+\w+\s+DESC/i.test(text)) {
      const key = /ORDER BY\s+(\w+)/i.exec(text)?.[1] ?? "at";
      copy.sort((a, b) => String(b[key] ?? "").localeCompare(String(a[key] ?? "")));
    }
    // WHERE id = ? is the only filter the preview has to honour; the screens do
    // the rest of the narrowing in JS anyway.
    if (/WHERE id = \?/i.test(text) && args.length > 0) {
      return { rows: copy.filter((row) => row.id === args[0]) };
    }
    return { rows: copy };
  }

  if (/^DELETE/i.test(text)) {
    const keep = /WHERE/i.test(text) ? rows.filter((row) => !args.includes(row.id)) : [];
    tables.set(name, keep);
    return { rows: [] };
  }

  // INSERT and UPDATE both arrive as upserts, and the id is always bound first.
  if (/^(INSERT|UPDATE|REPLACE)/i.test(text)) {
    const id = String(args[0] ?? "");
    const index = rows.findIndex((row) => row.id === id);
    // Columns in declaration order, which is the order the app binds them.
    const columns = /\(([^)]+)\)\s*VALUES/i.exec(text)?.[1];
    const next: Row = { id };
    if (columns) {
      columns.split(",").forEach((column, position) => {
        next[column.trim()] = args[position] ?? null;
      });
    }
    if (index === -1) rows.push(next);
    else rows[index] = { ...rows[index], ...next };
    return { rows: [] };
  }

  return { rows: [] };
}

const db = {
  execute: (sql: string, args: unknown[] = []) => Promise.resolve(run(sql, args)),
  close: () => undefined,
};

export function open(): typeof db {
  return db;
}

/** Nothing to search on the preview, so retrieval answers empty. */
export class OPSQLiteVectorStore {
  db = db;
  load(): Promise<this> {
    return Promise.resolve(this);
  }
  similaritySearch(): Promise<unknown[]> {
    return Promise.resolve([]);
  }
}

export class ExecuTorchEmbeddings {
  load(): Promise<this> {
    return Promise.resolve(this);
  }
  unload(): Promise<void> {
    return Promise.resolve();
  }
}

export class ExecuTorchLLM {
  load(): Promise<this> {
    return Promise.resolve(this);
  }
  unload(): Promise<void> {
    return Promise.resolve();
  }
}

const UNAVAILABLE =
  "This is the browser preview, so the model is not running. Open the app on a phone to actually ask it something.";

export class RAG {
  load(): Promise<this> {
    return Promise.resolve(this);
  }
  async generate({ callback }: { callback?: (token: string) => void } = {}): Promise<string> {
    // Says so plainly rather than returning a plausible-looking answer, which
    // is the one genuinely harmful thing a preview could do.
    callback?.(UNAVAILABLE);
    return UNAVAILABLE;
  }
  splitAddGenerate(): Promise<string> {
    return Promise.resolve(UNAVAILABLE);
  }
}

export function uuidv4(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function initExecutorch(): void {
  /* nothing to start in a browser */
}

const source = (): Record<string, string> => ({});
export const models = {
  text_embedding: { all_minilm_l6_v2: source },
  llm: { qwen2_5_0_5b: source, qwen2_5_1_5b: source, qwen3_1_7b: source },
  ocr: {},
  stt: {},
};

export const ExpoResourceFetcher = {
  cancelFetching: () => Promise.resolve(),
  listDownloadedFiles: () => Promise.resolve([] as string[]),
};

export function useOCR(): {
  forward: () => Promise<never[]>;
  isReady: boolean;
  downloadProgress: number;
} {
  return { forward: () => Promise.resolve([]), isReady: false, downloadProgress: 0 };
}

export function useSpeechToText(): {
  transcribe: () => Promise<string>;
  isReady: boolean;
  downloadProgress: number;
} {
  return { transcribe: () => Promise.resolve(""), isReady: false, downloadProgress: 0 };
}

/* -------------------------------------------------- expo-notifications --- */

/**
 * A browser tab has no tray worth scheduling into, and the preview exists for
 * looking at screens rather than waiting a day for a reminder. These resolve as
 * if permission were refused, so the Settings switch shows its blocked state
 * instead of claiming to have scheduled something it did not.
 */
export function setNotificationHandler(): void {
  /* nothing to handle in a browser */
}

export function getPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  return Promise.resolve({ granted: false, canAskAgain: false });
}

export function requestPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  return Promise.resolve({ granted: false, canAskAgain: false });
}

export function cancelAllScheduledNotificationsAsync(): Promise<void> {
  return Promise.resolve();
}

export function scheduleNotificationAsync(): Promise<string> {
  return Promise.resolve("");
}

export const SchedulableTriggerInputTypes = { DATE: "date" } as const;

export default { open, models, initExecutorch };
