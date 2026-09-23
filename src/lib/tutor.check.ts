/**
 * node --experimental-strip-types src/lib/tutor.check.ts
 *
 * The matcher decides the tutor's mode, so the ways it can be wrong are the
 * ways the whole feature is wrong: hijacking an ordinary question, missing a
 * plain request, or mangling the topic it hands on.
 */
import assert from "node:assert";

import { parseQuiz } from "./formats.ts";
import { detectMode, scoreLine, testPrompt, verdict } from "./tutor.ts";

const is = (text: string, mode: string, topic = "") =>
  assert.deepEqual(detectMode(text), { mode, topic }, text);

// Test, however it is phrased.
is("Test me on TCP", "test", "TCP");
is("test me about the OSI model", "test", "the OSI model");
is("Can you quiz me on subnetting?", "test", "subnetting");
is("Let's do a test on networking", "test", "networking");
is("give me a quiz about photosynthesis", "test", "photosynthesis");
is("Ask me questions about World War II", "test", "World War II");
is("test me", "test");

// "My notes" is not a topic — it means whatever the picker has chosen.
is("Quiz me on my notes", "test");
is("test me on everything", "test");
is("test me on this", "test");

// Teach.
is("Teach me subnetting", "teach", "subnetting");
is("please teach me about compound interest", "teach", "compound interest");
is("Help me understand recursion", "teach", "recursion");
is("Let's study the water cycle", "teach", "the water cycle");
is("walk me through binary search", "teach", "binary search");

// Back to Ask, and "stop testing" must not read as a test.
is("stop the test", "ask");
is("Stop testing me", "ask");
is("end the lesson please", "ask");
is("normal mode", "ask");

// Case is kept for the topic, since it goes into a prompt and onto the screen.
assert.equal(detectMode("TEST ME ON TCP/IP")?.topic, "TCP/IP");

// Ordinary questions must pass through untouched — the matcher only acts on a
// request that leads with the verb.
for (const plain of [
  "What is TCP?",
  "What does 'test me' mean?",
  "How do I study for an exam?",
  "I have a test tomorrow on TCP",
  "Explain the OSI model",
  "Summarise everything I saved this week",
  "teacher salaries in the Philippines",
  "",
]) {
  assert.equal(detectMode(plain), null, `should be a plain message: "${plain}"`);
}

// The prompt asks for the exact format parseQuiz reads, so a model that
// follows it produces answerable questions. Checked with a reply in that shape.
assert.ok(testPrompt("TCP").includes("about TCP"));
assert.ok(testPrompt("").includes("about the context"));
const reply = [
  "Q: What does TCP guarantee?",
  "A) Ordered, reliable delivery",
  "B) Encryption",
  "C) Compression",
  "D) Name lookup",
  "Correct: A",
  "",
  "Q: How many steps are in the TCP handshake?",
  "A) Two",
  "B) Three",
  "C) Four",
  "D) Five",
  "Correct: B",
].join("\n");
const parsed = parseQuiz(reply);
assert.equal(parsed.length, 2);
assert.equal(parsed[1]?.correctIndex, 1);

// Feedback is computed, and names the right option by letter and text.
const options = ["Two", "Three", "Four", "Five"];
assert.equal(verdict(options, 1, 1), "Correct!");
assert.equal(verdict(options, 1, 3), "Not quite — it's B) Three.");

assert.ok(scoreLine(5, 5).startsWith("Perfect — 5 of 5"));
assert.ok(scoreLine(3, 5).startsWith("Nice work — 3 of 5"));
assert.ok(scoreLine(1, 5).startsWith("Worth another pass — 1 of 5"));

console.log("tutor: all checks passed");
