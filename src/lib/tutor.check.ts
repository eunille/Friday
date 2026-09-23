/**
 * node --experimental-strip-types src/lib/tutor.check.ts
 *
 * The matcher decides the tutor's mode, so the ways it can be wrong are the
 * ways the whole feature is wrong: hijacking an ordinary question, missing a
 * plain request, or mangling the topic it hands on.
 */
import assert from "node:assert";

import { parseQuiz } from "./formats.ts";
import {
  detectMode,
  detectNotes,
  detectQuiz,
  pickNotes,
  scoreLine,
  testPrompt,
  verdict,
} from "./tutor.ts";

const is = (text: string, mode: string, topic = "") =>
  assert.deepEqual(detectMode(text), { mode, topic }, text);

// Test, however it is phrased.
is("Test me on TCP", "test", "TCP");
is("test me about the OSI model", "test", "the OSI model");
is("Can you quiz me on subnetting?", "test", "subnetting");
is("Let's do a test on networking", "test", "networking");
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

// Standalone quizzes: asking to be *given* one, as opposed to being tested now.
const quiz = (text: string, topic: string, count: number) =>
  assert.deepEqual(detectQuiz(text), { topic, count }, text);
quiz("Make me a quiz about TCP", "TCP", 5);
quiz("Create a 10 question quiz on subnetting", "subnetting", 10);
quiz("create a 10-question quiz about the OSI model", "the OSI model", 10);
quiz("Can you give me a quiz about networking?", "networking", 5);
quiz("generate a practice exam on World War II", "World War II", 5);
quiz("make a quiz", "", 5);
quiz("Make me a quiz on my notes", "", 5);
// Lengths the page cannot write round to the nearest one it can.
quiz("create a 20 question quiz on TCP", "TCP", 10);
quiz("make a 3 question quiz about DNS", "DNS", 5);
quiz("make an 8-question quiz on DNS", "DNS", 10);

// The two never claim the same sentence.
assert.equal(detectQuiz("Test me on TCP"), null, "being tested now is not a standalone quiz");
assert.equal(detectQuiz("Quiz me on TCP"), null);
assert.equal(detectMode("Give me a quiz about photosynthesis"), null, "being given one is not Test mode");
for (const plain of ["What is a quiz?", "I made a quiz yesterday", "quiz night ideas", ""]) {
  assert.equal(detectQuiz(plain), null, `should be a plain message: "${plain}"`);
}

// Reading and summarising your own notes.
const notes = (text: string, action: string, about = "", since: string | null = null) =>
  assert.deepEqual(detectNotes(text), { action, about, since }, text);
notes("Read my networking notes", "read", "networking");
notes("read my notes", "read");
notes("Can you read me my notes on TCP aloud?", "read", "TCP");
notes("Summarize my notes", "summarise");
notes("Summarise what I studied today", "summarise", "", "today");
notes("summarise everything I saved this week", "summarise", "", "week");
notes("Give me a summary of my OSI notes", "summarise", "OSI");
for (const plain of ["Summarise the French Revolution", "read this article", "What is a note?", ""]) {
  assert.equal(detectNotes(plain), null, `should be a plain message: "${plain}"`);
}
// Nothing else claims them.
assert.equal(detectMode("Read my networking notes"), null);
assert.equal(detectQuiz("Summarise my notes"), null);

const now = new Date("2026-09-24T15:00:00");
const shelf = [
  { id: "a", title: "Subnetting", subject: "Networking", updatedAt: "2026-09-24T09:00:00" },
  { id: "b", title: "TCP handshake", subject: "Networking", updatedAt: "2026-09-20T09:00:00" },
  { id: "c", title: "Networking jobs", subject: null, updatedAt: "2026-09-01T09:00:00" },
  { id: "d", title: "Cells", subject: "Biology", updatedAt: "2026-09-24T08:00:00" },
];
const ids = (ask: string, chosen: string[] | null = null) =>
  pickNotes(shelf, detectNotes(ask)!, chosen, now).map((note) => note.id);
// The subject wins over a title that merely mentions it.
assert.deepEqual(ids("read my networking notes"), ["a", "b"]);
assert.deepEqual(ids("read my TCP notes"), ["b"]);
assert.deepEqual(ids("summarise what I studied today"), ["a", "d"]);
assert.deepEqual(ids("summarise everything I saved this week"), ["a", "b", "d"]);
assert.deepEqual(ids("summarise my notes", ["d"]), ["d"]);
assert.deepEqual(ids("summarise my notes"), ["a", "b", "c", "d"]);
assert.deepEqual(ids("read my chemistry notes"), []);

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
