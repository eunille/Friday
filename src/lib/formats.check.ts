/**
 * Self-check for the pure helpers. Run: `npm run check`
 *
 * ponytail: no test framework. These are the two pieces of logic that can
 * silently corrupt data — a bad waveform join produces garbled transcripts, a
 * loose pack parser writes junk into the vector store.
 */
import assert from "node:assert/strict";

import { clampForPrompt, concatFloat32, parsePack } from "./formats.ts";

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

console.log("formats: all checks passed");
