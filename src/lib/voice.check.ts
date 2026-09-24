/**
 * node --experimental-strip-types src/lib/voice.check.ts
 *
 * A dictated or typed answer to a test question is matched, not guessed:
 * marked wrong for a mishearing is worse than being asked again.
 */
import assert from "node:assert";

import { READ, readyToPlay, speechGroups, spokenChoice, spokenQuestion } from "./voice.ts";

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

/* --------------------------------------------------------- reading aloud --- */

// Groups are spans of the original text: together they cover every sentence,
// in order, and each ends on a sentence boundary.
const reply =
  "Yes. TCP is reliable. It numbers every byte, so lost data is resent and the receiver can put it back in order.\n\nUDP skips all of that, which is why games use it!";
const groups = speechGroups(reply);
const said = groups.map((group) => reply.slice(group.start, group.end));
assert.ok(said[0]!.startsWith("Yes."), "short sentences are joined, not synthesised alone");
assert.ok(said[0]!.includes("TCP is reliable."));
assert.ok(said.at(-1)!.trim().endsWith("games use it!"));
for (let i = 1; i < groups.length; i += 1) {
  assert.equal(groups[i]!.start, groups[i - 1]!.end, "no text skipped or read twice");
}
// A long run of short sentences is split, never one enormous call.
const long = "One two three four five. ".repeat(20);
assert.ok(speechGroups(long).every((group) => group.end - group.start <= READ.MAX_GROUP));
assert.ok(speechGroups(long).length > 1);
// One enormous sentence is broken at spaces too — Kokoro refuses 2048+ chars.
const runOn = "word ".repeat(1000);
const runOnGroups = speechGroups(runOn);
assert.ok(runOnGroups.every((group) => group.end - group.start <= READ.MAX_GROUP));
assert.equal(runOnGroups.at(-1)!.end, runOn.length);
assert.equal(speechGroups("x".repeat(500)).length, 3, "no space: cut anyway");
assert.deepEqual(speechGroups(""), []);
assert.deepEqual(speechGroups("..."), [], "punctuation alone is nothing to say");
assert.deepEqual(speechGroups("No full stop"), [{ start: 0, end: 12 }]);

// Start only once the buffer covers the rest at the measured rate.
const state = { bufferedS: 3, producedS: 3, elapsedS: 6, remainingChars: 0, done: false };
assert.equal(readyToPlay({ ...state, done: true }), true, "all made: play");
assert.equal(readyToPlay({ ...state, producedS: 0 }), false, "nothing made yet");
assert.equal(readyToPlay({ ...state, elapsedS: 2 }), true, "faster than real time: play now");
// Half real time, ~15 s of reply left: needs ~15 s buffered first.
const slow = { ...state, remainingChars: Math.round(15 * READ.CHARS_PER_S * READ.SPEED) };
assert.equal(readyToPlay(slow), false);
assert.equal(readyToPlay({ ...slow, bufferedS: 16 }), true);

console.log("voice: all checks passed");
