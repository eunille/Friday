/**
 * node --experimental-strip-types src/lib/recovery.check.ts
 *
 * The crash-loop guard runs only after the app has been killed, so these are
 * the only times it runs before a real phone needs it.
 */
import assert from "node:assert";

import { recover } from "./recovery.ts";

const known = ["tiny", "lite", "gemma"] as const;
const run = (saved: unknown, interrupted: unknown, lastCrash: unknown = undefined) =>
  recover({ known, fallback: "tiny", saved, interrupted, lastCrash });

// A normal start: whatever was chosen, no warning.
assert.deepEqual(run("gemma", undefined), { start: "gemma", crashed: null, fellBack: false });

// The whole point: killed while loading Gemma, so start on Tiny and say why.
assert.deepEqual(run("gemma", "gemma"), { start: "tiny", crashed: "gemma", fellBack: true });

// Tiny itself was killed. There is nothing smaller, so try it again rather
// than start with no model — but still warn.
assert.deepEqual(run("tiny", "tiny"), { start: "tiny", crashed: "tiny", fellBack: false });

// A stale mark for a model no longer chosen warns, but does not override the
// choice — falling back from Lite because Gemma once failed would be wrong.
assert.deepEqual(run("lite", "gemma"), { start: "lite", crashed: "gemma", fellBack: false });

// The warning from an earlier crash survives a normal start until the model
// is shown to load.
assert.deepEqual(run("tiny", undefined, "gemma"), {
  start: "tiny",
  crashed: "gemma",
  fellBack: false,
});

// Unknown values — a model removed in an update, a corrupt row — are ignored,
// never trusted into a load.
assert.deepEqual(run("qwen9_huge", undefined), { start: "tiny", crashed: null, fellBack: false });
assert.deepEqual(run("gemma", "qwen9_huge", "also_gone"), {
  start: "gemma",
  crashed: null,
  fellBack: false,
});
assert.deepEqual(run(undefined, 42), { start: "tiny", crashed: null, fellBack: false });

console.log("recovery: all checks passed");
