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

// ExecuTorch 0.9+ ships no downloader of its own — an adapter must be
// registered before anything tries to load a model. Module scope, so this runs
// on import, well before the provider's effects fire.
initExecutorch({ resourceFetcher: ExpoResourceFetcher });

const DB_NAME = "offline-ai";

export const TIERS = {
  tiny: {
    label: "Tiny — Qwen2.5 0.5B",
    hint: "~0.4 GB download · fastest to get running",
    model: models.llm.qwen2_5_0_5b,
  },
  lite: {
    label: "Lite — Qwen2.5 1.5B",
    hint: "~1.1 GB download · better answers",
    model: models.llm.qwen2_5_1_5b,
  },
  standard: {
    label: "Standard — Qwen2.5 3B",
    hint: "~1.9 GB download · wants ~3 GB free RAM",
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

/** A note or knowledge pack, reconstructed from the chunks it produced. */
export type Source = {
  id: string;
  title: string;
  createdAt: string;
  chunks: number;
};

export type AIStatus =
  | { kind: "loading"; stage: string; progress: number }
  | { kind: "ready" }
  | { kind: "error"; message: string };

type AIContextValue = {
  rag: RAG | null;
  store: OPSQLiteVectorStore | null;
  db: DB | null;
  status: AIStatus;
  tier: Tier | null;
  setTier: (tier: Tier) => void;
  /** Bumped after every write so list screens know to re-query. */
  revision: number;
  invalidate: () => void;
  /** Re-attempt a failed model load. Downloads already on disk are reused. */
  retry: () => void;
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
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Tagged with what it belongs to, so a stale percentage never leaks into the
  // next phase's label.
  const [download, setDownload] = useState<{ of: Tier | "embeddings"; progress: number } | null>(
    null
  );
  // Tagged with the tier it was built for: on a tier switch the old instance is
  // ignored immediately rather than being handed out until the new one loads.
  const [loaded, setLoaded] = useState<{ tier: Tier; rag: RAG } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const rag = loaded && loaded.tier === tier ? loaded.rag : null;

  // Boot: embedding model + vector store + persisted tier. Runs once.
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

        await vectorStore.db.execute(
          "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        );
        const saved = (
          await vectorStore.db.execute("SELECT value FROM settings WHERE key = 'tier'")
        ).rows[0]?.value;
        if (cancelled) return;

        setStore(vectorStore);
        setTierState(typeof saved === "string" && saved in TIERS ? (saved as Tier) : DEFAULT_TIER);
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

  const invalidate = useCallback(() => setRevision((r) => r + 1), []);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((a) => a + 1);
  }, []);

  const value = useMemo<AIContextValue>(() => {
    // Derived, not stored: React owns the truth, so there is nothing to keep in
    // sync and no setState in an effect body.
    const status: AIStatus = error
      ? { kind: "error", message: error }
      : rag
        ? { kind: "ready" }
        : !store
          ? {
              kind: "loading",
              stage: "Downloading embedding model",
              progress: download?.of === "embeddings" ? download.progress : 0,
            }
          : {
              kind: "loading",
              stage: tier ? `Preparing ${TIERS[tier].label}` : "Starting up",
              progress: download?.of === tier ? download.progress : 0,
            };

    return {
      rag,
      store,
      db: store?.db ?? null,
      status,
      tier,
      setTier,
      revision,
      invalidate,
      retry,
    };
  }, [rag, store, tier, error, download, setTier, revision, invalidate, retry]);

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}

/**
 * Renders `children` only once the models are loaded. Every screen needs this,
 * so it lives next to the provider rather than being repeated four times.
 */
export function ModelGate({ children }: { children: ReactNode }): JSX.Element {
  const { status, retry } = useAI();

  if (status.kind === "ready") return <>{children}</>;

  return (
    <View className="flex-1 bg-background items-center justify-center gap-3 px-8">
      {status.kind === "loading" ? (
        <>
          <Spinner size="lg" />
          <Typography.Paragraph className="text-center">{status.stage}</Typography.Paragraph>
          {status.progress > 0 && (
            <Typography.Paragraph className="text-center text-muted-foreground">
              {Math.round(status.progress * 100)}%
            </Typography.Paragraph>
          )}
          <Typography.Paragraph className="text-center text-muted-foreground text-xs">
            First run downloads the models. Keep the app open — after this it works offline.
          </Typography.Paragraph>
        </>
      ) : (
        <>
          <Typography.Heading type="h3" className="text-center">
            Couldn&apos;t load the models
          </Typography.Heading>
          <Typography.Paragraph className="text-center text-muted-foreground">
            {status.message}
          </Typography.Paragraph>
          <Typography.Paragraph className="text-center text-muted-foreground text-xs">
            Downloads have no resume, so a dropped connection restarts the transfer. Retrying keeps
            any model already on disk.
          </Typography.Paragraph>
          <Button onPress={retry}>Retry</Button>
        </>
      )}
    </View>
  );
}

/**
 * Chunks `text`, embeds it, and stores it. One document (note or pack entry)
 * becomes many `vectors` rows sharing a `sourceId`.
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

/** Reassembles a source's chunks back into their original order. */
export async function readSource(db: DB, sourceId: string): Promise<string> {
  const result = await db.execute(
    `SELECT document FROM vectors
     WHERE json_extract(metadata, '$.sourceId') = ?
     ORDER BY json_extract(metadata, '$.chunk')`,
    [sourceId]
  );
  // Chunks overlap by 100 chars, so this repeats a little text. Harmless as
  // prompt input; don't use it to re-export the original document.
  return result.rows.map((row: any) => row.document as string).join("\n");
}

export async function deleteSource(db: DB, sourceId: string): Promise<void> {
  // ponytail: one DELETE instead of VectorStore.delete(), which pulls every row
  // and its embedding into JS just to run a predicate.
  await db.execute("DELETE FROM vectors WHERE json_extract(metadata, '$.sourceId') = ?", [
    sourceId,
  ]);
}
