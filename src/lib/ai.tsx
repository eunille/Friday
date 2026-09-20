import { Ionicons } from "@expo/vector-icons";
import type { DB } from "@op-engineering/op-sqlite";
import { ExecuTorchEmbeddings, ExecuTorchLLM } from "@react-native-rag/executorch";
import { OPSQLiteVectorStore } from "@react-native-rag/op-sqlite";
import { Button, Spinner, Typography } from "heroui-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { View } from "react-native";
import { initExecutorch, models } from "react-native-executorch";
import { ExpoResourceFetcher } from "react-native-executorch-expo-resource-fetcher";
import { RAG, uuidv4 } from "react-native-rag";

import { MascotAtWork, useCookingWord } from "../components/cooking";
import { joinChunks } from "./formats";
import { createLedgerTables } from "./ledger";
import { usePalette } from "./theme";

// ExecuTorch 0.9+ ships no downloader of its own — an adapter must be
// registered before anything tries to load a model. Module scope, so this runs
// on import, well before the provider's effects fire.
initExecutorch({ resourceFetcher: ExpoResourceFetcher });

const DB_NAME = "offline-ai";

/** Namespace for the "this model's files are on disk" flags in `settings`. */
const FETCHED = "fetched:";
const REMEMBER_FETCHED =
  "INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value";

export const TIERS = {
  tiny: {
    label: "Tiny",
    name: "Qwen2.5 0.5B",
    size: "400 MB",
    note: "Fastest to get running.",
    model: models.llm.qwen2_5_0_5b,
  },
  lite: {
    label: "Lite",
    name: "Qwen2.5 1.5B",
    size: "1.1 GB",
    note: "Noticeably better answers.",
    model: models.llm.qwen2_5_1_5b,
  },
  standard: {
    label: "Standard",
    name: "Qwen2.5 3B",
    size: "1.9 GB",
    note: "Wants about 3 GB of free memory.",
    model: models.llm.qwen2_5_3b,
  },
} as const;

/**
 * ponytail: default to the smallest model rather than the largest the RAM
 * allows. The binding constraint on first run is the download, not the device —
 * the fetcher has no resume, so one stalled connection discards the whole
 * transfer. 0.4 GB gets a working app in minutes; upgrading is one tap in
 * Library, by which point the app already works.
 */
const DEFAULT_TIER: Tier = "tiny";

export type Tier = keyof typeof TIERS;
export type SourceKind = "note" | "pack";

/** A knowledge pack, reconstructed from the chunks it produced. */
export type Source = {
  id: string;
  title: string;
  createdAt: string;
  chunks: number;
};

/** A note, as the person wrote it. Chunks in `vectors` are derived from this. */
export type Note = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * One thing the phone has to fetch, and where it has got to.
 *
 * `later` is not a queue: Whisper and the OCR pair are only pulled the first
 * time the mic or the camera is used. They are on this list anyway, because a
 * fresh install deserves to know the whole bill before it starts paying it —
 * "0.4 GB" is a very different decision from "0.4 GB now and 0.27 GB the first
 * time you tap the mic".
 */
export type Step = {
  key: string;
  name: string;
  size: string;
  state: "done" | "now" | "later";
  /** 0..1, and only meaningful while this one is the download in flight. */
  progress: number;
};

export type AIStatus =
  // `fetching` separates the two waits that look identical from outside: a
  // one-off download over the network, and reading files already on disk into
  // memory. Progress cannot tell them apart, because a warm start never reports
  // any, so 0% means both "not started yet" and "nothing to download".
  | { kind: "loading"; stage: string; progress: number; fetching: boolean; steps: readonly Step[] }
  | { kind: "ready" }
  | { kind: "error"; message: string };

/* -------------------------------------------------------------------------
   How the model is told to behave
   ------------------------------------------------------------------------- */

export const LENGTHS = {
  brief: { label: "Brief", note: "A few sentences." },
  balanced: { label: "Balanced", note: "A short paragraph or two." },
  detailed: { label: "Detailed", note: "As much as the question needs." },
} as const;

export const TONES = {
  plain: { label: "Plain", note: "Everyday words." },
  friendly: { label: "Friendly", note: "Warm and conversational." },
  technical: { label: "Technical", note: "Precise, uses the proper terms." },
} as const;

/**
 * Appearance is kept apart from AISettings on purpose: that type is entirely
 * *what the model is told*, and the settings screen renders it back verbatim.
 * A display preference does not belong in a prompt.
 */
export const APPEARANCES = {
  system: { label: "Match my phone", note: "Follows the Android setting." },
  light: { label: "Light", note: "Warm paper, all day." },
  dark: { label: "Dark", note: "Easier at night." },
} as const;

export type Appearance = keyof typeof APPEARANCES;

export type AISettings = {
  length: keyof typeof LENGTHS;
  tone: keyof typeof TONES;
  /** Anything the person wants added verbatim. */
  instructions: string;
};

export const DEFAULT_SETTINGS: AISettings = {
  length: "balanced",
  tone: "plain",
  instructions: "",
};

const LENGTH_RULE: Record<AISettings["length"], string> = {
  brief: "Answer in at most three sentences.",
  balanced: "Answer in at most two short paragraphs.",
  detailed: "Answer thoroughly, but stop once the question is fully answered.",
};

/**
 * The point at which an answer is cut off, whatever it was asked for.
 *
 * A 0.5B model treats "at most three sentences" as a suggestion and often
 * ignores it, which is the whole of "the length setting does nothing". Asking
 * is not enforcing, so generation is stopped here and the tail is trimmed back
 * to the last finished sentence.
 *
 * Set well above the wording so the cap only fires when the instruction was
 * already disregarded — a limit that trips on a well-behaved answer would make
 * the setting feel broken in the other direction.
 */
export const LENGTH_TOKENS: Record<AISettings["length"], number> = {
  brief: 160,
  balanced: 420,
  detailed: 1200,
};

const TONE_RULE: Record<AISettings["tone"], string> = {
  plain: "Use plain, everyday language.",
  friendly: "Be warm and conversational.",
  technical: "Be precise and use correct technical terms.",
};

/**
 * Everything else the app fetches, so the Library can say what a phone will
 * pull down and when.
 *
 * Sizes are the real content-length of each .pte, read from the model host
 * rather than estimated — Whisper in particular is far larger than it sounds,
 * and someone on mobile data deserves to know that before tapping the mic.
 *
 * None of these are chosen: they arrive when the feature that needs them is
 * first used. Listing them is about warning, not configuring.
 */
export const EXTRAS = [
  {
    key: "embeddings",
    name: "MiniLM L6 v2",
    size: "87 MB",
    note: "Finds the passages that answer a question.",
    when: "With the first launch — nothing works without it.",
  },
  {
    key: "speech",
    name: "Whisper tiny (English)",
    size: "222 MB",
    note: "Turns speech into text for the mic.",
    when: "The first time you dictate.",
  },
  {
    key: "ocr",
    name: "CRAFT + CRNN (English)",
    size: "37 MB",
    note: "Reads text out of a photo.",
    when: "The first time you scan something.",
  },
] as const;

/**
 * Builds the system message sent ahead of every question.
 *
 * The two middle rules are not preferences, they are repairs. A 0.5B model
 * left to itself will restate the same clause three ways and then close by
 * offering more help, which is most of why answers felt long. Saying so
 * directly costs a few tokens and removes both.
 *
 * None of this is binding — see LENGTH_TOKENS for the part that is.
 */
export function systemPrompt(settings: AISettings): string {
  return [
    "You are a helpful assistant running entirely on the user's phone.",
    TONE_RULE[settings.tone],
    "Never repeat a point you have already made, in any wording.",
    "Do not end with an offer of further help or a summary of what you just said.",
    // Last, because a small model weights the end of its instructions most
    // heavily, and length is the rule it most often lets go of.
    LENGTH_RULE[settings.length],
    settings.instructions.trim(),
  ]
    .filter(Boolean)
    .join(" ");
}

/** The three files a tier downloads, for progress and for cancelling. */
function tierSources(tier: Tier): unknown[] {
  const { modelSource, tokenizerSource, tokenizerConfigSource } = TIERS[tier].model();
  return [modelSource, tokenizerSource, tokenizerConfigSource];
}

type AIContextValue = {
  rag: RAG | null;
  store: OPSQLiteVectorStore | null;
  db: DB | null;
  status: AIStatus;
  tier: Tier | null;
  setTier: (tier: Tier) => void;
  settings: AISettings;
  setSettings: (settings: AISettings) => void;
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
  alerts: boolean;
  setAlerts: (alerts: boolean) => void;
  /** Bumped after every write so list screens know to re-query. */
  revision: number;
  invalidate: () => void;
  /** Re-attempt a failed model load. Downloads already on disk are reused. */
  retry: () => void;
  /** Abort the running download and fall back to the last model that worked. */
  cancelDownload: () => void;
};

const AIContext = createContext<AIContextValue | null>(null);

export function useAI(): AIContextValue {
  const value = useContext(AIContext);
  if (!value) throw new Error("useAI must be used inside <AIProvider>");
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AIProvider({ children }: { children: ReactNode }): JSX.Element {
  const [store, setStore] = useState<OPSQLiteVectorStore | null>(null);
  const [tier, setTierState] = useState<Tier | null>(null);
  const [settings, setSettingsState] = useState<AISettings>(DEFAULT_SETTINGS);
  const [appearance, setAppearanceState] = useState<Appearance>("system");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Tagged with what it belongs to, so a stale percentage never leaks into the
  // next phase's label.
  const [download, setDownload] = useState<{ of: Tier | "embeddings"; progress: number } | null>(
    null
  );
  // Which models have finished downloading at least once, so a later start can
  // say it is loading rather than offering to cancel a download that is not
  // happening. Persisted, because it has to survive the process that learnt it.
  //
  // ponytail: a remembered flag, not a look at the disk. It is only written
  // after a load succeeds, so an install that predates this code spends one
  // more start showing the download screen before it learns. If that matters,
  // ExpoResourceFetcher.listDownloadedFiles() answers exactly — at the cost of
  // matching its local paths back to each tier's source URLs by basename.
  const [fetched, setFetched] = useState<ReadonlySet<string>>(() => new Set());
  // Off until asked for. Notification permission is requested when this is
  // turned on, never at startup.
  const [alerts, setAlertsState] = useState(false);
  // Tagged with the tier it was built for: on a tier switch the old instance is
  // ignored immediately rather than being handed out until the new one loads.
  const [loaded, setLoaded] = useState<{ tier: Tier; rag: RAG } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const rag = loaded && loaded.tier === tier ? loaded.rag : null;

  // Boot: embedding model + vector store + saved preferences. Runs once.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const embeddings = new ExecuTorchEmbeddings({
          ...models.text_embedding.all_minilm_l6_v2(),
          onDownloadProgress: (progress) => {
            if (!cancelled) setDownload({ of: "embeddings", progress });
          },
        });

        const vectorStore = new OPSQLiteVectorStore({ name: DB_NAME, embeddings });
        await vectorStore.load();
        if (cancelled) return;

        const db = vectorStore.db;
        await db.execute(
          "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        );
        await db.execute(
          `CREATE TABLE IF NOT EXISTS notes (
             id        TEXT PRIMARY KEY,
             title     TEXT NOT NULL,
             body      TEXT NOT NULL,
             createdAt TEXT NOT NULL,
             updatedAt TEXT NOT NULL
           )`
        );
        await db.execute(
          `CREATE TABLE IF NOT EXISTS chats (
             id        TEXT PRIMARY KEY,
             title     TEXT NOT NULL,
             body      TEXT NOT NULL,
             turns     INTEGER NOT NULL,
             updatedAt TEXT NOT NULL
           )`
        );
        await db.execute(
          `CREATE TABLE IF NOT EXISTS quiz_results (
             id      TEXT PRIMARY KEY,
             noteId  TEXT NOT NULL,
             title   TEXT NOT NULL,
             score   INTEGER NOT NULL,
             total   INTEGER NOT NULL,
             takenAt TEXT NOT NULL
           )`
        );
        await createLedgerTables(db);
        await backfillNotes(db);
        if (cancelled) return;

        const saved = await db.execute("SELECT key, value FROM settings");
        const byKey = new Map(saved.rows.map((row: any) => [row.key as string, row.value]));
        if (cancelled) return;

        // Getting past vectorStore.load() is itself proof the embedding model is
        // on disk, so record it now rather than leaving the next start to guess.
        const already = new Set(
          [...byKey.keys()]
            .filter((key) => key.startsWith(FETCHED))
            .map((key) => key.slice(FETCHED.length))
        );
        already.add("embeddings");
        setFetched(already);
        void db.execute(REMEMBER_FETCHED, [`${FETCHED}embeddings`]);

        const savedTier = byKey.get("tier");
        setStore(vectorStore);
        setSettingsState(readSettings(byKey.get("ai")));
        setAlertsState(byKey.get("alerts") === "1");
        const savedAppearance = byKey.get("appearance");
        if (typeof savedAppearance === "string" && savedAppearance in APPEARANCES) {
          setAppearanceState(savedAppearance as Appearance);
        }
        setTierState(
          typeof savedTier === "string" && savedTier in TIERS ? (savedTier as Tier) : DEFAULT_TIER
        );
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // LLM: rebuilt whenever the tier changes, or when the user retries a failed
  // download. `attempt` exists purely to re-run this effect on retry.
  useEffect(() => {
    if (!store || !tier) return;
    let cancelled = false;
    void attempt;

    const llm = new ExecuTorchLLM({
      ...TIERS[tier].model(),
      onDownloadProgress: (progress) => {
        if (!cancelled) setDownload({ of: tier, progress });
      },
    });

    llm
      .load()
      .then(() => {
        if (cancelled) {
          void llm.unload();
          return;
        }
        // Both halves are already loaded, so RAG.load() would only repeat
        // idempotent work — construct and go.
        setLoaded({ tier, rag: new RAG({ vectorStore: store, llm }) });
        setError(null);
        // Loading returned, so the weights are on disk whether they arrived just
        // now or months ago. Next start can say so instead of offering Cancel.
        setFetched((prev) => (prev.has(tier) ? prev : new Set(prev).add(tier)));
        void store.db.execute(REMEMBER_FETCHED, [`${FETCHED}${tier}`]);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });

    return () => {
      cancelled = true;
      void llm.unload();
    };
  }, [store, tier, attempt]);

  const setTier = useCallback(
    (next: Tier) => {
      setTierState(next);
      void store?.db.execute(
        "INSERT INTO settings (key, value) VALUES ('tier', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [next]
      );
    },
    [store]
  );

  const setSettings = useCallback(
    (next: AISettings) => {
      setSettingsState(next);
      void store?.db.execute(
        "INSERT INTO settings (key, value) VALUES ('ai', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [JSON.stringify(next)]
      );
    },
    [store]
  );

  const setAlerts = useCallback(
    (next: boolean) => {
      setAlertsState(next);
      void store?.db.execute(
        "INSERT INTO settings (key, value) VALUES ('alerts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [next ? "1" : "0"]
      );
    },
    [store]
  );

  const setAppearance = useCallback(
    (next: Appearance) => {
      setAppearanceState(next);
      void store?.db.execute(
        "INSERT INTO settings (key, value) VALUES ('appearance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [next]
      );
    },
    [store]
  );

  const invalidate = useCallback(() => setRevision((r) => r + 1), []);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((a) => a + 1);
  }, []);

  const cancelDownload = useCallback(() => {
    if (tier) {
      // Rejects the in-flight load, which surfaces through the catch above.
      void Promise.resolve(
        ExpoResourceFetcher.cancelFetching(...(tierSources(tier) as never[]))
      ).catch(() => {});
    }

    // The previous model was unloaded when the tier changed, so its RAG is a
    // dead handle — drop it and let the effect rebuild, rather than briefly
    // reporting ready with an instance that would throw on first use.
    const previous = loaded?.tier ?? null;
    setLoaded(null);

    if (previous && previous !== tier) {
      setTier(previous);
      setError(null);
    } else {
      setError("Download cancelled.");
    }
  }, [tier, loaded, setTier]);

  const value = useMemo<AIContextValue>(() => {
    // Derived, not stored: React owns the truth, so there is nothing to keep in
    // sync and no setState in an effect body.
    // A live progress report proves a download; otherwise trust the flag. The
    // fallback when neither applies is "fetching", because a first run has to
    // be told it needs the network before it is asked to wait for one.
    const isFetching = (what: Tier | "embeddings"): boolean =>
      download?.of === what || !fetched.has(what);

    /**
     * The whole bill, in the order the phone works through it.
     *
     * Built here rather than in the gate so there is one account of what is
     * downloaded and what is not — the gate only draws it.
     */
    const step = (key: string, name: string, size: string, done: boolean): Step => ({
      key,
      name,
      size,
      state: done ? "done" : "now",
      progress: download?.of === key ? download.progress : 0,
    });

    const steps: Step[] = [
      step("embeddings", EXTRAS[0].name, EXTRAS[0].size, fetched.has("embeddings")),
      ...(tier ? [step(tier, TIERS[tier].name, TIERS[tier].size, fetched.has(tier))] : []),
      // Never tracked as downloaded, because nothing downloads them until the
      // feature is used. Saying "later" is the honest state for both.
      ...EXTRAS.slice(1).map(
        (extra): Step => ({
          key: extra.key,
          name: extra.name,
          size: extra.size,
          state: "later",
          progress: 0,
        })
      ),
    ];

    const status: AIStatus = error
      ? { kind: "error", message: error }
      : rag
        ? { kind: "ready" }
        : !store
          ? {
              kind: "loading",
              stage: isFetching("embeddings")
                ? "Downloading embedding model"
                : "Opening your notes",
              progress: download?.of === "embeddings" ? download.progress : 0,
              fetching: isFetching("embeddings"),
              steps,
            }
          : {
              kind: "loading",
              // "Preparing X" is a promise about a download. On a warm start the
              // name alone is the honest label, and the screen supplies the verb.
              stage: !tier
                ? "Starting up"
                : isFetching(tier)
                  ? `Preparing ${TIERS[tier].name}`
                  : TIERS[tier].name,
              progress: download?.of === tier ? download.progress : 0,
              fetching: tier ? isFetching(tier) : false,
              steps,
            };

    return {
      rag,
      store,
      db: store?.db ?? null,
      status,
      tier,
      setTier,
      settings,
      setSettings,
      appearance,
      setAppearance,
      alerts,
      setAlerts,
      revision,
      invalidate,
      retry,
      cancelDownload,
    };
  }, [
    rag,
    store,
    tier,
    error,
    download,
    setTier,
    settings,
    setSettings,
    appearance,
    setAppearance,
    alerts,
    setAlerts,
    revision,
    invalidate,
    retry,
    cancelDownload,
    fetched,
  ]);

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}

function readSettings(value: unknown): AISettings {
  if (typeof value !== "string") return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(value) as Partial<AISettings>;
    return {
      length: parsed.length && parsed.length in LENGTHS ? parsed.length : DEFAULT_SETTINGS.length,
      tone: parsed.tone && parsed.tone in TONES ? parsed.tone : DEFAULT_SETTINGS.tone,
      instructions: typeof parsed.instructions === "string" ? parsed.instructions : "",
    };
  } catch {
    // A corrupt blob is not worth failing boot over.
    return DEFAULT_SETTINGS;
  }
}

/**
 * Notes written before the `notes` table existed live only as embedded chunks.
 * Reconstruct them once so they open in the editor like anything else. Runs on
 * every boot but matches nothing after the first.
 */
async function backfillNotes(db: DB): Promise<void> {
  const orphans = await db.execute(
    `SELECT json_extract(metadata, '$.sourceId')  AS id,
            json_extract(metadata, '$.title')     AS title,
            json_extract(metadata, '$.createdAt') AS createdAt
     FROM vectors
     WHERE json_extract(metadata, '$.kind') = 'note'
       AND json_extract(metadata, '$.sourceId') NOT IN (SELECT id FROM notes)
     GROUP BY json_extract(metadata, '$.sourceId')`
  );

  for (const row of orphans.rows as unknown as Source[]) {
    const body = await readSource(db, row.id);
    await db.execute(
      "INSERT OR IGNORE INTO notes (id, title, body, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
      [row.id, row.title ?? "Untitled", body, row.createdAt, row.createdAt]
    );
  }
}

/**
 * The warm start: files on disk, nothing to download, nothing to cancel.
 *
 * No progress bar, because there is no progress to report — a bar that jumps to
 * 1% and then sits there reads as a hang, which is exactly the impression this
 * screen exists to avoid. The mascot and the changing word carry it instead.
 */
function Warming({ stage }: { stage: string }): JSX.Element {
  const word = useCookingWord();

  return (
    <View className="items-center gap-5">
      <MascotAtWork />
      <Typography.Heading
        type="h2"
        accessibilityLiveRegion="polite"
        className="font-ui-bold text-[26px] tracking-tight"
      >
        {word}…
      </Typography.Heading>
      <Typography.Paragraph className="text-center font-read text-muted text-[15px] leading-6">
        Loading {stage} from this phone. No network needed.
      </Typography.Paragraph>
    </View>
  );
}

/**
 * The whole bill, on the one screen that has the person's attention.
 *
 * A single bar naming one file answers "how long" and not "how much", and the
 * two that arrive later — the voice model and the pair behind the camera —
 * would otherwise turn up as a surprise download weeks after install. Better
 * to say so once, here, than to be asked later why the mic wants the network.
 */
function Manifest({ steps }: { steps: readonly Step[] }): JSX.Element {
  const palette = usePalette();

  return (
    <View className="gap-2.5 rounded-2xl border border-border bg-surface p-3.5">
      {steps.map((item) => (
        <View key={item.key} className="flex-row items-center gap-2.5">
          <Ionicons
            name={
              item.state === "done"
                ? "checkmark-circle"
                : item.state === "now"
                  ? "arrow-down-circle"
                  : "time-outline"
            }
            size={16}
            color={
              item.state === "done"
                ? palette.onDevice
                : item.state === "now"
                  ? palette.accent
                  : palette.mutedSoft
            }
          />
          <Typography.Paragraph
            className={`flex-1 font-ui-medium text-[13.5px] ${
              item.state === "later" ? "text-muted" : ""
            }`}
          >
            {item.name}
          </Typography.Paragraph>
          <Typography.Paragraph className="font-ui text-muted text-[12px]">
            {item.state === "done"
              ? "on this phone"
              : item.state === "later"
                ? `${item.size} later`
                : item.progress > 0
                  ? `${Math.round(item.progress * 100)}% of ${item.size}`
                  : item.size}
          </Typography.Paragraph>
        </View>
      ))}
    </View>
  );
}

/**
 * Renders `children` as soon as storage is open, without waiting for the model.
 *
 * The budget screens read and write SQLite and never ask the model anything, so
 * holding them behind a language model — which on a fresh install means a 400 MB
 * download, complete with a Cancel button — is a wait for something they do not
 * use. Once boot has run, `db` exists whatever the model is doing.
 */
export function DataGate({ children }: { children: ReactNode }): JSX.Element {
  const { db } = useAI();
  if (db) return <>{children}</>;
  // Storage is not up yet, so fall through to the full gate, which already
  // knows how to show the boot stages and any error they produced.
  return <ModelGate>{children}</ModelGate>;
}

/**
 * Renders `children` only once the models are loaded. Every screen needs this,
 * so it lives next to the provider rather than being repeated four times.
 */
export function ModelGate({ children }: { children: ReactNode }): JSX.Element {
  const { status, retry, cancelDownload } = useAI();

  if (status.kind === "ready") return <>{children}</>;

  return (
    <View className="flex-1 bg-background justify-center px-7">
      {status.kind === "loading" ? (
        status.fetching ? (
          <View className="gap-5">
            <MascotAtWork />
            <View className="flex-row items-end justify-between">
              <Typography.Heading type="h2" className="font-ui-bold text-[26px] tracking-tight">
                {status.stage}
              </Typography.Heading>
              {status.progress > 0 ? (
                <Typography.Paragraph className="font-ui-bold text-accent text-[26px]">
                  {Math.round(status.progress * 100)}%
                </Typography.Paragraph>
              ) : (
                <Spinner size="sm" />
              )}
            </View>

            <View className="h-[3px] w-full overflow-hidden rounded-full bg-surface-tertiary">
              <View
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.max(status.progress, 0.01) * 100}%` }}
              />
            </View>

            <Manifest steps={status.steps} />

            <Typography.Paragraph className="font-read text-muted text-[15px] leading-6">
              This is the only time the app needs a network. Keep it open until the bar fills, then
              it runs with the radio off.
            </Typography.Paragraph>

            <Button variant="tertiary" onPress={cancelDownload}>
              Cancel download
            </Button>
          </View>
        ) : (
          // Nothing to download and nothing to cancel: the files are here, this
          // is the phone reading them in. No bar either — there is no progress
          // to report, and a bar that crawls to 1% and stops reads as a hang.
          <Warming stage={status.stage} />
        )
      ) : (
        <View className="gap-4">
          <Typography.Heading type="h2" className="font-ui-bold text-[26px] tracking-tight">
            The model didn&apos;t finish downloading
          </Typography.Heading>
          <View className="rounded-xl border border-border bg-surface px-4 py-3">
            <Typography.Paragraph className="font-ui text-[13px] leading-5">
              {status.message}
            </Typography.Paragraph>
          </View>
          <Typography.Paragraph className="font-read text-muted text-[15px] leading-6">
            Transfers can&apos;t resume, so a dropped connection starts that file over. Anything
            already on disk is kept.
          </Typography.Paragraph>
          <Button onPress={retry}>Try again</Button>
        </View>
      )}
    </View>
  );
}

/* -------------------------------------------------------------------------
   Notes
   The `notes` table is what the person wrote; `vectors` is a search index
   derived from it. Editing writes the text immediately and re-embeds later,
   because embedding every keystroke would pin the CPU for nothing.
   ------------------------------------------------------------------------- */

export async function listNotes(db: DB): Promise<Note[]> {
  const result = await db.execute("SELECT * FROM notes ORDER BY updatedAt DESC");
  return result.rows as unknown as Note[];
}

export async function getNote(db: DB, id: string): Promise<Note | null> {
  const result = await db.execute("SELECT * FROM notes WHERE id = ?", [id]);
  return (result.rows[0] as unknown as Note) ?? null;
}

export function newNoteId(): string {
  return uuidv4();
}

/** Cheap: text only, safe to call on a debounce while typing. */
export async function saveNoteText(
  db: DB,
  note: { id: string; title: string; body: string }
): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO notes (id, title, body, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title,
                                   body = excluded.body,
                                   updatedAt = excluded.updatedAt`,
    [note.id, note.title, note.body, now, now]
  );
}

/**
 * Expensive: re-chunks and re-embeds the note so search and Ask see the edit.
 * Call it when the person leaves the note, not while they are typing.
 */
export async function reindexNote(rag: RAG, db: DB, id: string): Promise<void> {
  const note = await getNote(db, id);
  if (!note) return;

  await db.execute("DELETE FROM vectors WHERE json_extract(metadata, '$.sourceId') = ?", [id]);
  if (!note.body.trim()) return;

  await rag.splitAddDocument({
    document: note.body,
    metadataGenerator: (chunks) =>
      chunks.map((_, chunk) => ({
        sourceId: id,
        kind: "note" as const,
        title: note.title,
        createdAt: note.createdAt,
        chunk,
      })),
  });
}

export async function deleteNote(db: DB, id: string): Promise<void> {
  await db.execute("DELETE FROM vectors WHERE json_extract(metadata, '$.sourceId') = ?", [id]);
  await db.execute("DELETE FROM notes WHERE id = ?", [id]);
}

/* -------------------------------------------------------------------------
   Packs
   ------------------------------------------------------------------------- */

/**
 * Chunks `text`, embeds it, and stores it. One pack becomes many `vectors`
 * rows sharing a `sourceId`.
 */
export async function addSource(
  rag: RAG,
  params: { title: string; text: string; kind: SourceKind; id?: string }
): Promise<string> {
  const sourceId = params.id ?? uuidv4();
  const createdAt = new Date().toISOString();

  await rag.splitAddDocument({
    document: params.text,
    metadataGenerator: (chunks) =>
      chunks.map((_, chunk) => ({
        sourceId,
        kind: params.kind,
        title: params.title,
        createdAt,
        chunk,
      })),
  });

  return sourceId;
}

export async function listSources(db: DB, kind: SourceKind): Promise<Source[]> {
  const result = await db.execute(
    `SELECT json_extract(metadata, '$.sourceId')  AS id,
            json_extract(metadata, '$.title')     AS title,
            json_extract(metadata, '$.createdAt') AS createdAt,
            COUNT(*)                              AS chunks
     FROM vectors
     WHERE json_extract(metadata, '$.kind') = ?
     -- Group by the expression, not the "id" alias: vectors has a real column
     -- named id (the per-chunk uuid), and SQLite resolves a bare GROUP BY name
     -- to the column before the alias -- which yields one row per chunk
     -- instead of one per note.
     GROUP BY json_extract(metadata, '$.sourceId')
     ORDER BY createdAt DESC`,
    [kind]
  );
  return result.rows as unknown as Source[];
}

/** Reassembles a source's chunks, removing the overlap the splitter added. */
export async function readSource(db: DB, sourceId: string): Promise<string> {
  const result = await db.execute(
    `SELECT document FROM vectors
     WHERE json_extract(metadata, '$.sourceId') = ?
     ORDER BY json_extract(metadata, '$.chunk')`,
    [sourceId]
  );
  return joinChunks(result.rows.map((row: any) => row.document as string));
}

export async function deleteSource(db: DB, sourceId: string): Promise<void> {
  // ponytail: one DELETE instead of VectorStore.delete(), which pulls every row
  // and its embedding into JS just to run a predicate.
  await db.execute("DELETE FROM vectors WHERE json_extract(metadata, '$.sourceId') = ?", [
    sourceId,
  ]);
}

/* -------------------------------------------------------------------------
   Chats and quiz results
   Both exist so the dashboard can show true numbers. A conversation is stored
   as one JSON blob rather than a messages table: it is only ever read and
   written whole, so a second table would buy a join and nothing else.
   ------------------------------------------------------------------------- */

export type ChatSummary = { id: string; title: string; turns: number; updatedAt: string };
export type QuizResult = {
  id: string;
  noteId: string;
  title: string;
  score: number;
  total: number;
  takenAt: string;
};

export function newChatId(): string {
  return uuidv4();
}

/** Upsert. Called once per completed answer, so the row is never half a turn. */
export async function saveChat(
  db: DB,
  chat: { id: string; title: string; body: unknown[] }
): Promise<void> {
  await db.execute(
    `INSERT INTO chats (id, title, body, turns, updatedAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title,
                                   body = excluded.body,
                                   turns = excluded.turns,
                                   updatedAt = excluded.updatedAt`,
    [chat.id, chat.title, JSON.stringify(chat.body), chat.body.length, new Date().toISOString()]
  );
}

export async function listChats(db: DB, limit = 20): Promise<ChatSummary[]> {
  const result = await db.execute(
    "SELECT id, title, turns, updatedAt FROM chats ORDER BY updatedAt DESC LIMIT ?",
    [limit]
  );
  return result.rows as unknown as ChatSummary[];
}

/** The stored turns, or null if the row is gone or the blob is unreadable. */
export async function getChat(db: DB, id: string): Promise<unknown[] | null> {
  const result = await db.execute("SELECT body FROM chats WHERE id = ?", [id]);
  const body = (result.rows[0] as { body?: string } | undefined)?.body;
  if (typeof body !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // A corrupt blob is not worth failing the screen over.
    return null;
  }
}

export async function deleteChat(db: DB, id: string): Promise<void> {
  await db.execute("DELETE FROM chats WHERE id = ?", [id]);
}

/** Titles are generated from the first question, which is often not what it was about. */
export async function renameChat(db: DB, id: string, title: string): Promise<void> {
  await db.execute("UPDATE chats SET title = ? WHERE id = ?", [title, id]);
}

export async function deleteQuizResult(db: DB, id: string): Promise<void> {
  await db.execute("DELETE FROM quiz_results WHERE id = ?", [id]);
}

/**
 * Everything the user put in, gone in one step.
 *
 * Deliberately not the models or the settings: the claim this app makes is that
 * your material never leaves the phone, so what has to be provable is that the
 * material can leave the phone's storage. Re-downloading a gigabyte to prove it
 * is not part of that, and neither is losing your theme.
 */
export async function eraseContent(db: DB): Promise<void> {
  for (const table of ["vectors", "notes", "chats", "quiz_results"]) {
    await db.execute(`DELETE FROM ${table}`);
  }
}

export async function saveQuizResult(
  db: DB,
  result: { noteId: string; title: string; score: number; total: number }
): Promise<void> {
  await db.execute(
    "INSERT INTO quiz_results (id, noteId, title, score, total, takenAt) VALUES (?, ?, ?, ?, ?, ?)",
    [uuidv4(), result.noteId, result.title, result.score, result.total, new Date().toISOString()]
  );
}

export async function listQuizResults(db: DB, limit = 20): Promise<QuizResult[]> {
  const result = await db.execute("SELECT * FROM quiz_results ORDER BY takenAt DESC LIMIT ?", [
    limit,
  ]);
  return result.rows as unknown as QuizResult[];
}

/**
 * Notes whose most recent quiz went badly, worst first.
 *
 * SQLite lets a bare column ride along with MAX() and picks the row the max
 * came from, so this is the latest attempt per note rather than a blend of
 * attempts — which is the number worth acting on.
 */
export async function weakTopics(db: DB, limit = 3): Promise<QuizResult[]> {
  const result = await db.execute(
    `SELECT id, noteId, title, score, total, MAX(takenAt) AS takenAt
       FROM quiz_results
      GROUP BY noteId
     HAVING total > 0 AND (score * 1.0 / total) < 0.6
      ORDER BY (score * 1.0 / total) ASC
      LIMIT ?`,
    [limit]
  );
  return result.rows as unknown as QuizResult[];
}
