/**
 * node --experimental-strip-types src/lib/voice.check.ts
 *
 * Talk mode is only as good as two guesses: that you have finished speaking,
 * and what you meant by "the second one". Both are wrong in ways that feel
 * rude — cut off mid-thought, marked wrong for a mishearing — so both are
 * pinned down here.
 */
import assert from "node:assert";

import {
  LISTENING,
  VOICE,
  listen,
  rmsOf,
  spokenChoice,
  spokenQuestion,
  type Listening,
} from "./voice.ts";

const LOUD = 0.1;
const QUIET = 0.001;
const BUFFER = 256; // ms: 4096 samples at 16 kHz

/** Feed a run of levels and report where, and why, it stopped. */
function run(levels: number[]): { stop: string | null; atMs: number } {
  let state: Listening = LISTENING;
  for (const [index, level] of levels.entries()) {
    const step = listen(state, level, BUFFER);
    state = step.next;
    if (step.stop) return { stop: step.stop, atMs: (index + 1) * BUFFER };
  }
  return { stop: null, atMs: levels.length * BUFFER };
}
const times = (level: number, ms: number): number[] =>
  Array<number>(Math.ceil(ms / BUFFER)).fill(level);

// The normal turn: speak, then go quiet — it ends after the silence, not before.
const normal = run([...times(LOUD, 2000), ...times(QUIET, 3000)]);
assert.equal(normal.stop, "spoke");
assert.ok(normal.atMs >= 2000 + VOICE.SILENCE_MS, "must not cut off before the silence is long enough");
assert.ok(normal.atMs < 2000 + VOICE.SILENCE_MS + BUFFER * 2, "and should end soon after it is");

// A thinking pause shorter than SILENCE_MS does not end the turn.
const paused = run([
  ...times(LOUD, 1000),
  ...times(QUIET, 700),
  ...times(LOUD, 1000),
  ...times(QUIET, 3000),
]);
assert.equal(paused.stop, "spoke");
assert.ok(paused.atMs > 2700, "a short pause mid-sentence is not the end");

// Quiet before speaking is someone about to speak — it waits, then gives up.
assert.equal(
  run([...times(QUIET, 3000), ...times(LOUD, 1500), ...times(QUIET, 2000)]).stop,
  "spoke",
  "a slow start still counts"
);
const silent = run(times(QUIET, VOICE.NO_SPEECH_MS + 2000));
assert.equal(silent.stop, "nothing");
assert.ok(silent.atMs >= VOICE.NO_SPEECH_MS);

// Something that never stops — a TV — is capped.
assert.equal(run(times(LOUD, VOICE.MAX_MS + 1000)).stop, "too-long");

// Level measurement.
assert.equal(rmsOf(new Float32Array(0)), 0);
assert.equal(rmsOf(new Float32Array(100)), 0);
assert.ok(Math.abs(rmsOf(Float32Array.from([0.5, -0.5, 0.5, -0.5])) - 0.5) < 1e-9);

/* ------------------------------------------------------- spoken answers --- */

const options = ["Two", "Three", "Four", "Five"];
const picks = (said: string, expected: number): void =>
  assert.equal(spokenChoice(said, options), expected, `"${said}"`);

picks("B", 1);
picks("b.", 1);
picks("It's B", 1);
picks("option C", 2);
picks("the second one", 1);
picks("I think it's the third one", 2);
picks("number four", 3);
picks("Bee", 1); // Whisper's spelling of a lone "B"
picks("see", 2);
picks("A", 0);

// By the option's own words.
const tcp = ["Ordered, reliable delivery", "Encryption of every packet", "Faster name lookup", "Compression"];
assert.equal(spokenChoice("reliable delivery", tcp), 0);
assert.equal(spokenChoice("I'd say encryption of every packet", tcp), 1);

// Not enough to go on, or too much: -1, so the caller asks again instead of
// marking someone wrong for a mishearing.
assert.equal(spokenChoice("", options), -1);
assert.equal(spokenChoice("hmm let me think", options), -1);
assert.equal(spokenChoice("packet", tcp), -1, "one word of a long option is not a pick");
assert.equal(spokenChoice("D", ["True", "False"]), -1, "a letter past the end is not a pick");
assert.equal(spokenChoice("two plus three", options), -1, "two options fully said is a tie, not a pick");

assert.equal(
  spokenQuestion(1, 5, "What does TCP guarantee?", ["Delivery", "Speed"]),
  "Question 1 of 5. What does TCP guarantee? A: Delivery. B: Speed."
);

console.log("voice: all checks passed");
