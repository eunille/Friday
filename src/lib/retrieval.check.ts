/**
 * node --experimental-strip-types src/lib/retrieval.check.ts
 *
 * The parts of retrieval that can be wrong silently: a scope filter that
 * quietly means "everything", a fusion that ignores one of the two searches,
 * an FTS query that throws on punctuation, and a context block that lets one
 * note impersonate three.
 */
import assert from "node:assert";

import {
  asContext,
  ftsQuery,
  fuse,
  resetSearchIndex,
  retrieve,
  scopeSql,
  type Chunk,
} from "./retrieval.ts";

/* ----------------------------------------------------------------- scope --- */

assert.deepEqual(scopeSql({ kind: "all" }), { where: "1", params: [] });

// The one that matters: "no study materials" must match nothing, not everything.
assert.deepEqual(scopeSql({ kind: "none" }), { where: "0", params: [] });

// An empty selection is "none", not "all". Picking zero notes and getting the
// whole library back is the failure that looks like it worked.
assert.deepEqual(scopeSql({ kind: "sources", ids: [] }), { where: "0", params: [] });

const two = scopeSql({ kind: "sources", ids: ["a", "b"] });
assert.equal(two.where, "json_extract(metadata, '$.sourceId') IN (?, ?)");
assert.deepEqual(two.params, ["a", "b"]);
// One placeholder per id, so ids are never concatenated into the SQL.
assert.equal(two.where.split("?").length - 1, two.params.length);

const subject = scopeSql({ kind: "subject", id: "networking" }, "v.metadata");
assert.equal(subject.where, "json_extract(v.metadata, '$.subjectId') = ?");
assert.deepEqual(subject.params, ["networking"]);

/* ------------------------------------------------------------------- fts --- */

assert.equal(ftsQuery("What is TCP?"), '"What" OR "is" OR "TCP"');
// Identifiers survive intact — they are the reason the keyword half exists.
assert.equal(ftsQuery("RFC 1918 and 192.168.1.1"), '"RFC" OR "1918" OR "and" OR "192.168.1.1"');
// Single characters rank nothing and match most of the corpus.
assert.equal(ftsQuery("a TCP"), '"TCP"');
// FTS5 operators and punctuation must come back as ordinary quoted terms, not
// as syntax — an unquoted NEAR or a stray parenthesis is a query that throws.
assert.equal(ftsQuery("NEAR(tcp handshake)"), '"NEAR" OR "tcp" OR "handshake"');
assert.equal(ftsQuery('say "hello" -now'), '"say" OR "hello" OR "now"');
// A quote is not a word character, so it ends a term rather than escaping into
// one. Whatever comes out, every term must be balanced-quoted and the operators
// between them must only ever be OR — that is the property MATCH depends on.
for (const nasty of ['the"quote', "NEAR(a b)", "a AND b", "x*", "col:val", "'", '"', "((("]) {
  const built = ftsQuery(nasty);
  if (built === "") continue;
  assert.equal((built.match(/"/g) ?? []).length % 2, 0, `unbalanced quotes from ${nasty}`);
  assert.match(built, /^"[^"]*"( OR "[^"]*")*$/, `not a safe MATCH expression: ${nasty}`);
}
assert.equal(ftsQuery("   "), "");
assert.equal(ftsQuery("one two three", 2), '"one" OR "two"');

/* ------------------------------------------------------------------ fuse --- */

const hit = (id: string, sourceId = "n1", chunk = 0) => ({
  id,
  text: `text ${id}`,
  sourceId,
  title: "Note",
  chunk,
});

// Agreed-on beats first-in-one-list: "b" is 2nd and 1st, "a" is 1st and absent.
const agreed = fuse([[hit("a"), hit("b")], [hit("b"), hit("c")]], 3);
assert.equal(agreed[0]?.id, "b", "a chunk both searches rank should win");
assert.equal(agreed.length, 3);

// Each list still contributes when the other finds nothing.
assert.deepEqual(
  fuse([[hit("a")], []], 5).map((c) => c.id),
  ["a"]
);
assert.deepEqual(fuse([[], []], 5), []);

// Scores strictly descend, and a doubly-ranked chunk scores above a single one.
const ordered = fuse([[hit("a"), hit("b"), hit("c")], [hit("c")]], 3);
for (let i = 1; i < ordered.length; i += 1) {
  assert.ok(ordered[i - 1]!.score >= ordered[i]!.score, "fused scores must descend");
}
assert.equal(ordered[0]?.id, "c");

// Limit is a limit, and no chunk is returned twice.
assert.equal(fuse([[hit("a"), hit("b"), hit("c"), hit("d")]], 2).length, 2);
assert.equal(new Set(fuse([[hit("a")], [hit("a")]], 5).map((c) => c.id)).size, 1);

/* --------------------------------------------------------------- context --- */

const chunk = (id: string, sourceId: string, title: string, index: number, text: string): Chunk => ({
  id,
  text,
  sourceId,
  title,
  chunk: index,
  score: 1,
});

// Chunks from one note group under one heading, in reading order — not three
// headings that read as three sources agreeing.
const grouped = asContext([
  chunk("2", "n1", "TCP", 1, "second"),
  chunk("1", "n1", "TCP", 0, "first"),
]);
assert.equal(grouped, "[TCP]\nfirst\nsecond");
assert.equal(grouped.match(/\[TCP\]/g)?.length, 1, "one heading per note");

// Two notes keep two headings.
const both = asContext([chunk("1", "n1", "TCP", 0, "a"), chunk("2", "n2", "OSI", 0, "b")]);
assert.equal(both, "[TCP]\na\n\n[OSI]\nb");

// The budget is respected rather than advisory.
assert.equal(asContext([chunk("1", "n1", "TCP", 0, "x".repeat(500))], 100), "");
assert.equal(asContext([], 100), "");

/* -------------------------------------------------------------- retrieve --- */

type Call = { sql: string; params: unknown[] };

function fakeDb(rows: Record<string, unknown[]>, failFts = false) {
  const calls: Call[] = [];
  return {
    calls,
    execute: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (failFts && /fts5|chunk_fts/i.test(sql)) throw new Error("no fts5 in this build");
      const key = Object.keys(rows).find((name) => sql.includes(name));
      return { rows: key ? rows[key]! : [] };
    },
  };
}

const row = (id: string, sourceId = "n1") => ({
  id,
  document: `body ${id}`,
  metadata: JSON.stringify({ sourceId, title: "Note", chunk: 0 }),
});

// A "none" scope must not reach SQL or the embedder at all.
resetSearchIndex();
const silent = fakeDb({});
let embedded = 0;
assert.deepEqual(
  await retrieve({
    db: silent,
    embed: async () => {
      embedded += 1;
      return [0];
    },
    query: "anything",
    scope: { kind: "none" },
  }),
  []
);
assert.equal(silent.calls.length, 0, "scope none must not query");
assert.equal(embedded, 0, "scope none must not embed");

// An empty query short-circuits too — embedding whitespace is wasted work.
assert.deepEqual(await retrieve({ db: silent, embed: async () => [0], query: "   " }), []);
assert.equal(silent.calls.length, 0);

// The happy path: both halves run, and the embedding never comes back out.
resetSearchIndex();
const db = fakeDb({ "FROM vectors": [row("a"), row("b")], chunk_fts: [row("b")] });
const found = await retrieve({ db, embed: async () => [0.1, 0.2], query: "what is TCP", limit: 2 });
assert.equal(found[0]?.id, "b", "the chunk both halves found should lead");
assert.ok(found.every((item) => !("embedding" in item)));
assert.equal(found[0]?.sourceId, "n1");
assert.equal(found[0]?.title, "Note");

const vectorCall = db.calls.find((call) => call.sql.includes("vector_distance_cos"));
assert.ok(vectorCall, "a vector search should have run");
// The whole point: bounded rows, and the blob stays in SQLite.
assert.ok(/LIMIT \?/.test(vectorCall!.sql), "vector search must be bounded by LIMIT");
// `embedding` may appear only as an argument to the distance function, never
// as a selected column. Blank out the distance call and nothing should be left:
// that mention is the computation, any other is 1.5 KB a row crossing the
// bridge for nothing, which is the whole reason this module exists.
assert.ok(
  !/\bembedding\b/.test(vectorCall!.sql.replace(/vector_distance_cos\([^)]*\)/g, "")),
  "the embedding column must never be selected back into JS"
);
assert.equal(vectorCall!.params.at(-1), 10, "over-fetch for fusion, not just `limit`");

// Falling back when the SQLite build has no FTS5: still answers, vector only.
resetSearchIndex();
const noFts = fakeDb({ "FROM vectors": [row("a")] }, true);
const degraded = await retrieve({ db: noFts, embed: async () => [0.1], query: "TCP", limit: 3 });
assert.equal(degraded.length, 1, "a missing full-text index must not fail the search");
assert.ok(noFts.calls.some((call) => call.sql.includes("LIKE")), "should fall back to LIKE");

// The scope reaches both halves, not just the vector one.
resetSearchIndex();
const scoped = fakeDb({ "FROM vectors": [row("a")], chunk_fts: [row("a")] });
await retrieve({
  db: scoped,
  embed: async () => [0.1],
  query: "TCP",
  scope: { kind: "sources", ids: ["n1"] },
});
const searches = scoped.calls.filter((call) =>
  /vector_distance_cos|chunk_fts MATCH/.test(call.sql)
);
assert.equal(searches.length, 2);
for (const call of searches) {
  assert.ok(call.sql.includes("$.sourceId"), "both halves must filter by scope");
  assert.ok(call.params.includes("n1"));
}

// Index setup is attempted once, not per query.
resetSearchIndex();
const once = fakeDb({ "FROM vectors": [], chunk_fts: [] });
await retrieve({ db: once, embed: async () => [0], query: "a b" });
await retrieve({ db: once, embed: async () => [0], query: "c d" });
assert.equal(
  once.calls.filter((call) => call.sql.includes("CREATE VIRTUAL TABLE")).length,
  1,
  "the FTS index should be built once per process, not per search"
);

console.log("retrieval: all checks passed");
