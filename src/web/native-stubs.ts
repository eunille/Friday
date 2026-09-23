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
  { id: "w1", name: "Everyday", type: "gcash", openingBalance: 570_000, archived: 0 },
  { id: "w2", name: "Bills", type: "maya", openingBalance: 318_000, archived: 0 },
  { id: "w3", name: "Ipon", type: "bpi", openingBalance: 1_995_000, archived: 0 },
  { id: "w4", name: "Emergency", type: "maribank", openingBalance: 840_000, archived: 0 },
  { id: "w5", name: "Pocket", type: "cash", openingBalance: 120_000, archived: 0 },
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
  // Last month, so the preview has a position to have moved *from* — without
  // one the net-worth badge correctly shows nothing and cannot be looked at.
  {
    id: "t8",
    kind: "income",
    amount: 2_900_000,
    accountId: "w3",
    toAccountId: null,
    category: null,
    source: "salary",
    note: null,
    at: daysAgo(40),
  },
  {
    id: "t9",
    kind: "expense",
    amount: 860_000,
    accountId: "w3",
    toAccountId: null,
    category: "housing",
    source: null,
    note: "Rent",
    at: daysAgo(38),
  },
]);

for (const empty of ["notes", "chats", "quiz_results", "vectors", "settings"]) table(empty);

type Metadata = { sourceId: string; kind: string; title: string; createdAt: string };

/** A vectors row carries its source as a JSON blob; the app reads it with json_extract. */
function readMetadata(row: Row): Metadata {
  try {
    return JSON.parse(String(row.metadata ?? "{}")) as Metadata;
  } catch {
    return { sourceId: "", kind: "", title: "", createdAt: "" };
  }
}

/** The statement shapes the app issues, matched by keyword rather than parsed. */
function run(sql: string, args: unknown[] = []): { rows: Row[] } {
  const text = sql.trim().replace(/\s+/g, " ");
  const name = /\b(?:FROM|INTO|UPDATE|TABLE(?: IF NOT EXISTS)?)\s+([A-Za-z_]+)/i.exec(text)?.[1];

  if (/^CREATE/i.test(text)) {
    if (name) table(name);
    return { rows: [] };
  }
  if (!name) return { rows: [] };

  // The keyword index is an FTS5 virtual table, and its `'rebuild'` is a
  // command, not a row. Treated as an ordinary table, the rebuild planted an
  // empty `{ id: "" }` that the keyword search then returned with no text —
  // a row real SQLite cannot produce, and one that crashed chat-with-notes in
  // the preview only. An empty index is a state the app genuinely handles:
  // the vector half carries the search on its own.
  if (name === "chunk_fts") return { rows: [] };
  const rows = table(name);

  if (/^SELECT/i.test(text)) {
    // Anchored, and only without a GROUP BY. Matching COUNT(*) anywhere meant
    // listSources — "SELECT json_extract(...), COUNT(*) ... GROUP BY ..." —
    // came back as one row holding just { n }, so the Library rendered a
    // phantom pack with no id and React warned about the missing key. The
    // preview is meant to fail the way the app does, not in ways of its own.
    if (/^SELECT\s+COUNT\(\*\)/i.test(text) && !/GROUP BY/i.test(text)) {
      return { rows: [{ n: rows.length }] };
    }
    // listSources: one row per sourceId, counting its chunks. It used to
    // answer empty, which was fine while a pack could only arrive over the
    // network; now that the Library ships a catalogue, an empty answer would
    // show every starter as never installed no matter how often you added it.
    if (/GROUP BY/i.test(text)) {
      const kind = String(args[0] ?? "");
      const groups = new Map<string, Row>();
      for (const row of rows) {
        const meta = readMetadata(row);
        if (meta.kind !== kind) continue;
        const found = groups.get(meta.sourceId);
        if (found) found.chunks = Number(found.chunks) + 1;
        else {
          groups.set(meta.sourceId, {
            id: meta.sourceId,
            title: meta.title,
            createdAt: meta.createdAt,
            chunks: 1,
          });
        }
      }
      return { rows: [...groups.values()] };
    }
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
    if (/json_extract\(metadata/i.test(text)) {
      tables.set(
        name,
        rows.filter((row) => !args.includes(readMetadata(row).sourceId))
      );
      return { rows: [] };
    }
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
  // Retrieval embeds the query itself now rather than leaving it to the
  // store. The preview's SELECT ignores the distance anyway, so any vector
  // will do — it only has to exist.
  embed(): Promise<number[]> {
    return Promise.resolve([0]);
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
  /**
   * Chunks on blank lines and writes a row each, with no embedding — enough
   * for the Library to show a pack as installed and count its passages, and
   * for retrieval to find them. The preview's SELECT ignores the distance, so
   * what comes back is unranked, not wrong.
   */
  splitAddDocument({
    document,
    metadataGenerator,
  }: {
    document: string;
    metadataGenerator?: (chunks: string[]) => Record<string, unknown>[];
  }): Promise<string[]> {
    const chunks = document.split(/\n\s*\n/).filter((chunk) => chunk.trim() !== "");
    const metadata = metadataGenerator?.(chunks) ?? chunks.map(() => ({}));
    const ids = chunks.map((chunk, index) => {
      const id = uuidv4();
      // `document`, as the real table names it — OPSQLiteVectorStore creates
      // `vectors(id, document, embedding, metadata)`. This was `content`, so
      // every reader of the column (readSource, retrieval) got undefined back
      // in the preview and nowhere else.
      void run("INSERT INTO vectors (id, document, metadata) VALUES (?, ?, ?)", [
        id,
        chunk,
        JSON.stringify(metadata[index] ?? {}),
      ]);
      return id;
    });
    return Promise.resolve(ids);
  }
}

export function uuidv4(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function initExecutorch(): void {
  /* nothing to start in a browser */
}

const source = (): Record<string, string> => ({});

/**
 * Keys must match what the app actually reaches for, not what seems reasonable.
 * A missing one is not a type error here — it is `undefined` being called at
 * runtime, which takes the whole screen down with it.
 */
export const models = {
  text_embedding: { all_minilm_l6_v2: source },
  llm: { qwen2_5_0_5b: source, qwen2_5_1_5b: source, qwen2_5_3b: source },
  speech_to_text: { whisper_tiny_en: source },
};

/** scan.tsx takes this straight off the package, not out of `models`. */
export const OCR_ENGLISH = {};

/* ------------------------------------------------- react-native-audio-api --- */

export const AudioManager = {
  // Refused rather than granted: a browser tab has no recorder wired up here,
  // and reporting success would leave the mic button spinning forever.
  requestRecordingPermissions: () => Promise.resolve("Denied"),
  setAudioSessionOptions: () => undefined,
};

export class AudioRecorder {
  onAudioReady(): void {
    /* never fires: nothing is being recorded */
  }
  start(): Promise<boolean> {
    return Promise.resolve(false);
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
}

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
