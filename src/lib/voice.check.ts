/**
 * node --experimental-strip-types src/lib/voice.check.ts
 *
 * A dictated or typed answer to a test question is matched, not guessed:
 * marked wrong for a mishearing is worse than being asked again.
 */
import assert from "node:assert";

import { spokenChoice, spokenQuestion } from "./voice.ts";

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
