/**
 * Finding the right chunks, before anything is generated from them.
 *
 * `react-native-rag` hides retrieval inside `rag.generate()`, which is fine for
 * "answer this question" and useless for a tutor: you cannot cite what you
 * cannot see, scope a search to one subject, or show which note an answer came
 * from. So retrieval lives here and generation stays where it is.
 *
 * Two reasons this is its own module rather than a patch to the library:
 *
 * 1. `OPSQLiteVectorStore.query()` selects every column of every row —
 *    including the embedding blob — sorts in SQLite, then deserialises all of
 *    it into JavaScript before filtering and slicing. At 384 dimensions that is
 *    ~1.5 KB per chunk crossing the bridge on every question; a few hundred
 *    notes is tens of megabytes per search. Everything below keeps the blob in
 *    SQLite and returns `limit` rows.
 *
 * 2. Embeddings are good at meaning and bad at strings. "RFC 1918" and
 *    "192.168.1.1" are exactly the tokens a student searches for and exactly
 *    the ones cosine similarity smears together, so the keyword half is not a
 *    nicety — it is the half that finds identifiers.
 */

export type Scope =
  /** Everything indexed. */
  | { kind: "all" }
  /** Nothing — the tutor answers from the model alone. */
  | { kind: "none" }
  /** Specific notes or packs, by `sourceId`. */
  | { kind: "sources"; ids: readonly string[] }
  /** Every chunk tagged with a subject. */
  | { kind: "subject"; id: string };

export type Chunk = {
  /** The chunk's own id, which is what a citation points at. */
  id: string;
  text: string;
  /** The note or pack it came from. */
  sourceId: string;
  title: string;
  /** Position within the source, so neighbouring chunks can be re-joined. */
  chunk: number;
  /** Fused rank score. Comparable within one result set, not across two. */
  score: number;
};

/** A row as the two searches return it, before fusing. */
type Hit = Omit<Chunk, "score">;

/* ------------------------------------------------------------------ pure --- */

/**
 * The SQL fragment and parameters that narrow a search to a scope.
 *
 * Returned as a fragment rather than applied by the caller so both the vector
 * and keyword queries filter identically — two hand-written WHERE clauses is
 * how the two halves of a hybrid search quietly start disagreeing.
 *
 * `none` yields `0`, which is a legal predicate that matches nothing. Callers
 * short-circuit before reaching SQL, but a filter that means "nothing" should
 * say so rather than fall through to "everything".
 */
export function scopeSql(
  scope: Scope,
  column = "metadata"
): { where: string; params: string[] } {
  switch (scope.kind) {
    case "all":
      return { where: "1", params: [] };
    case "none":
      return { where: "0", params: [] };
    case "subject":
      return {
        where: `json_extract(${column}, '$.subjectId') = ?`,
        params: [scope.id],
      };
    case "sources": {
      if (scope.ids.length === 0) return { where: "0", params: [] };
      const slots = scope.ids.map(() => "?").join(", ");
      return {
        where: `json_extract(${column}, '$.sourceId') IN (${slots})`,
        params: [...scope.ids],
      };
    }
  }
}

/** Word characters. Everything else FTS5 would read as an operator. */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}._-]*/gu;

/**
 * The searchable words in a question, as an FTS5 query.
 *
 * Quoted individually and OR-ed: a student types a sentence, and requiring
 * every word of "what happens when TCP establishes a connection" to appear
 * matches nothing at all. OR plus BM25 ranking puts the chunk with the most,
 * rarest matches on top, which is the behaviour actually wanted.
 *
 * Single characters are dropped — they match most of the corpus and rank
 * nothing — and the list is capped, because a pasted paragraph would otherwise
 * build a query with hundreds of clauses.
 */
export function ftsQuery(text: string, max = 12): string {
  return (text.match(WORD) ?? [])
    .filter((word) => word.length > 1)
    .slice(0, max)
    // A quote inside a quoted FTS5 term is escaped by doubling it.
    .map((word) => `"${word.replace(/"/g, '""')}"`)
    .join(" OR ");
}

/** Standard RRF constant. Large enough that rank 1 does not dwarf rank 2. */
const K = 60;

/**
 * Reciprocal rank fusion: merge ranked lists by position, not by score.
 *
 * Cosine similarity and BM25 are different units on different scales — one is
 * bounded, the other is not, and neither is calibrated — so adding or
 * normalising them invents a relationship that is not there. Position is the
 * one thing both lists agree on the meaning of, and a chunk both halves rank
 * highly beats one that either ranks first alone, which is the entire point of
 * searching twice.
 */
export function fuse(lists: readonly (readonly Hit[])[], limit: number): Chunk[] {
  const scores = new Map<string, number>();
  const seen = new Map<string, Hit>();

  for (const list of lists) {
    list.forEach((hit, index) => {
      scores.set(hit.id, (scores.get(hit.id) ?? 0) + 1 / (K + index + 1));
      if (!seen.has(hit.id)) seen.set(hit.id, hit);
    });
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({ ...(seen.get(id) as Hit), score }));
}

/**
 * The retrieved chunks as a block of context, grouped by the note they came
 * from.
 *
 * Grouped rather than listed because five chunks from one note, each captioned
 * with that note's title, reads to the model as five separate sources agreeing
 * with each other — which is how one sentence in one note becomes a confident
 * consensus.
 *
 * `budget` is in characters, not tokens. Close enough at roughly four
 * characters per token, and counting tokens on-device costs a model call.
 */
export function asContext(chunks: readonly Chunk[], budget = 2400): string {
  const bySource = new Map<string, { title: string; parts: Chunk[] }>();
  for (const chunk of chunks) {
    const group = bySource.get(chunk.sourceId);
    if (group) group.parts.push(chunk);
    else bySource.set(chunk.sourceId, { title: chunk.title, parts: [chunk] });
  }

  const blocks: string[] = [];
  let used = 0;
  for (const { title, parts } of bySource.values()) {
    // Back into reading order, so a note split mid-sentence reads as prose
    // rather than as shuffled fragments.
    const text = parts
      .slice()
      .sort((a, b) => a.chunk - b.chunk)
      .map((part) => part.text.trim())
      .join("\n");
    const block = `[${title}]\n${text}`;
    if (used + block.length > budget) break;
    blocks.push(block);
    used += block.length;
  }

  return blocks.join("\n\n");
}

/* ------------------------------------------------------------------- sql --- */

/**
 * Minimal shape of the op-sqlite handle, so this module needs no native import
 * and the check script can hand it a fake. Params are the narrowest type
 * actually passed — op-sqlite's `execute` takes its own `Scalar[]`, and a
 * handle is only substitutable here if everything we send is one of those.
 */
type Db = {
  execute: (sql: string, params?: (string | number)[]) => Promise<{ rows: unknown[] }>;
};

type Row = { id: string; document: string; metadata: string | null };

function toHit(row: Row): Hit {
  const meta = (row.metadata ? JSON.parse(row.metadata) : {}) as {
    sourceId?: string;
    title?: string;
    chunk?: number;
  };
  return {
    id: row.id,
    text: row.document,
    sourceId: meta.sourceId ?? "",
    title: meta.title ?? "Untitled",
    chunk: meta.chunk ?? 0,
  };
}

/**
 * Whether this build of SQLite gave us a full-text index.
 *
 * FTS5 is compiled into most SQLite builds and not all of them, and which one
 * op-sqlite ships is not something to discover from a crash in front of a
 * student. Checked once, remembered, and the keyword half degrades to LIKE
 * rather than the search failing.
 */
let fts: boolean | null = null;

const FTS_SETUP = `
  CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts
    USING fts5(document, content='vectors', content_rowid='rowid');

  CREATE TRIGGER IF NOT EXISTS chunk_fts_insert AFTER INSERT ON vectors BEGIN
    INSERT INTO chunk_fts(rowid, document) VALUES (new.rowid, new.document);
  END;

  CREATE TRIGGER IF NOT EXISTS chunk_fts_delete AFTER DELETE ON vectors BEGIN
    INSERT INTO chunk_fts(chunk_fts, rowid, document) VALUES('delete', old.rowid, old.document);
  END;

  CREATE TRIGGER IF NOT EXISTS chunk_fts_update AFTER UPDATE ON vectors BEGIN
    INSERT INTO chunk_fts(chunk_fts, rowid, document) VALUES('delete', old.rowid, old.document);
    INSERT INTO chunk_fts(rowid, document) VALUES (new.rowid, new.document);
  END;
`;

/**
 * Builds the keyword index beside the vectors, once.
 *
 * External-content FTS5: the text is not stored twice, the index points into
 * `vectors`. The triggers keep it current, and the rebuild catches everything
 * indexed before this table existed — which on an upgrade is all of it.
 */
export async function ensureSearchIndex(db: Db): Promise<boolean> {
  if (fts !== null) return fts;
  try {
    await db.execute(FTS_SETUP);
    await db.execute("INSERT INTO chunk_fts(chunk_fts) VALUES('rebuild')");
    fts = true;
  } catch {
    // No FTS5 in this build. Not fatal, and not worth a screen of its own.
    fts = false;
  }
  return fts;
}

/** Only for the check script, which runs this module against a fake db. */
export function resetSearchIndex(): void {
  fts = null;
}

async function vectorSearch(
  db: Db,
  embedding: readonly number[],
  scope: Scope,
  limit: number
): Promise<Hit[]> {
  const { where, params } = scopeSql(scope);
  // The embedding column is deliberately absent from the SELECT list. It is
  // what the distance is computed from, never what the caller wants back, and
  // shipping it is the difference between kilobytes and megabytes per query.
  const result = await db.execute(
    `SELECT id, document, metadata,
            (1.0 - vector_distance_cos(embedding, vector(?))) AS similarity
       FROM vectors
      WHERE ${where}
      ORDER BY similarity DESC
      LIMIT ?`,
    [`[${embedding.join(",")}]`, ...params, limit]
  );
  return (result.rows as Row[]).map(toHit);
}

async function keywordSearch(
  db: Db,
  query: string,
  scope: Scope,
  limit: number
): Promise<Hit[]> {
  const { where, params } = scopeSql(scope, "v.metadata");

  if (await ensureSearchIndex(db)) {
    const match = ftsQuery(query);
    if (!match) return [];
    // bm25 is a cost, so lower is better and this sorts ascending.
    const result = await db.execute(
      `SELECT v.id AS id, v.document AS document, v.metadata AS metadata
         FROM chunk_fts
         JOIN vectors v ON v.rowid = chunk_fts.rowid
        WHERE chunk_fts MATCH ? AND ${where}
        ORDER BY bm25(chunk_fts)
        LIMIT ?`,
      [match, ...params, limit]
    );
    return (result.rows as Row[]).map(toHit);
  }

  // ponytail: LIKE, unranked, first N matches. Only reached when the SQLite
  // build has no FTS5, and the vector half still carries the search.
  const words = (query.match(WORD) ?? []).filter((word) => word.length > 1).slice(0, 4);
  if (words.length === 0) return [];
  const likes = words.map(() => "v.document LIKE ?").join(" OR ");
  const result = await db.execute(
    `SELECT v.id AS id, v.document AS document, v.metadata AS metadata
       FROM vectors v
      WHERE (${likes}) AND ${where}
      LIMIT ?`,
    [...words.map((word) => `%${word}%`), ...params, limit]
  );
  return (result.rows as Row[]).map(toHit);
}

/**
 * The chunks worth putting in front of the model, most relevant first.
 *
 * Both halves are asked for more than `limit` so fusion has something to
 * disagree about — taking 5 from each and fusing to 5 is the vector list with
 * extra steps.
 */
export async function retrieve(params: {
  db: Db;
  embed: (text: string) => Promise<number[]>;
  query: string;
  scope?: Scope;
  limit?: number;
}): Promise<Chunk[]> {
  const { db, embed, query, scope = { kind: "all" }, limit = 5 } = params;

  if (scope.kind === "none" || !query.trim()) return [];
  if (scope.kind === "sources" && scope.ids.length === 0) return [];

  const deep = Math.max(limit * 3, 10);
  const [semantic, keyword] = await Promise.all([
    embed(query).then((embedding) => vectorSearch(db, embedding, scope, deep)),
    keywordSearch(db, query, scope, deep),
  ]);

  return fuse([semantic, keyword], limit);
}
