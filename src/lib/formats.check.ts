/**
 * Self-check for the pure helpers. Run: `npm run check`
 *
 * ponytail: no test framework. These are the two pieces of logic that can
 * silently corrupt data — a bad waveform join produces garbled transcripts, a
 * loose pack parser writes junk into the vector store.
 */
import assert from "node:assert/strict";

import { clampForPrompt, concatFloat32, parseFlashcards, parsePack } from "./formats.ts";

// concatFloat32
assert.deepEqual(Array.from(concatFloat32([])), []);
assert.deepEqual(
  Array.from(
    concatFloat32([new Float32Array([1, 2]), new Float32Array([]), new Float32Array([3])])
  ),
  [1, 2, 3]
);
assert.equal(concatFloat32([new Float32Array(1024), new Float32Array(512)]).length, 1536);

// parsePack — happy path
const pack = parsePack({
  id: "first-aid",
  title: "First Aid Basics",
  entries: [{ title: "Burns", text: "Cool under running water." }],
});
assert.equal(pack.id, "first-aid");
assert.equal(pack.entries.length, 1);
assert.equal(pack.entries[0].text, "Cool under running water.");

// parsePack — every rejection path, so a malformed pack never reaches the store
for (const bad of [
  null,
  "not-json",
  { title: "No id", entries: [{ title: "a", text: "b" }] },
  { id: "x", entries: [{ title: "a", text: "b" }] },
  { id: "x", title: "y", entries: [] },
  { id: "x", title: "y", entries: [{ title: "a" }] },
  { id: "x", title: "y", entries: [{ title: "", text: "b" }] },
  { id: " ", title: "y", entries: [{ title: "a", text: "b" }] },
]) {
  assert.throws(() => parsePack(bad), `expected reject: ${JSON.stringify(bad)}`);
}

// clampForPrompt
assert.equal(clampForPrompt("short", 10), "short");
assert.ok(clampForPrompt("x".repeat(20), 10).startsWith("x".repeat(10)));
assert.ok(clampForPrompt("x".repeat(20), 10).includes("truncated"));

// parseFlashcards — the clean case a well-behaved model produces
assert.deepEqual(parseFlashcards("Q: Capital of France?\nA: Paris."), [
  { question: "Capital of France?", answer: "Paris." },
]);

// …and the mess a 0.5B model actually produces: numbering, bullets, bold
// markers, wrapped answers, preamble, and a trailing half-card.
const messy = parseFlashcards(
  [
    "Here are your flashcards:",
    "",
    "1. **Q:** What does RAID 5 do?",
    "   **A:** It stripes data across three or more disks",
    "   with distributed parity.",
    "",
    "- Q. Why is parity useful?",
    "  A) Any single disk can fail without data loss.",
    "",
    "Q: This one was cut off",
  ].join("\n")
);
assert.equal(messy.length, 2, "the truncated trailing card must be dropped");
assert.equal(messy[0].question, "What does RAID 5 do?");
assert.equal(
  messy[0].answer,
  "It stripes data across three or more disks with distributed parity.",
  "a wrapped answer must rejoin onto one line"
);
assert.equal(messy[1].answer, "Any single disk can fail without data loss.");

// Nothing parseable must not invent cards.
assert.deepEqual(parseFlashcards(""), []);
assert.deepEqual(parseFlashcards("The model refused to answer."), []);

console.log("formats: all checks passed");
