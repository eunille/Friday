/**
 * Self-check for the pure helpers. Run: `npm run check`
 *
 * ponytail: no test framework. These are the two pieces of logic that can
 * silently corrupt data — a bad waveform join produces garbled transcripts, a
 * loose pack parser writes junk into the vector store.
 */
import assert from "node:assert/strict";

import {
  clampForPrompt,
  concatFloat32,
  forSpeech,
  joinChunks,
  parseFlashcards,
  parsePack,
  parseQuiz,
  preview,
  readingOrder,
  relativeDate,
  trimToSentence,
} from "./formats.ts";

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

// joinChunks — the overlap the splitter added must not survive into the editor
assert.equal(joinChunks([]), "");
assert.equal(joinChunks(["only one"]), "only one");
assert.equal(
  joinChunks(["Cool the burn under running", " under running water for 20 minutes."]),
  "Cool the burn under running water for 20 minutes."
);
// No shared text: the separator the splitter ate is restored as a newline.
assert.equal(joinChunks(["First para.", "Second para."]), "First para.\nSecond para.");
// A whole chunk contained in the previous one must not duplicate.
assert.equal(joinChunks(["abcdef", "def"]), "abcdef");

// parseQuiz — multiple choice
const mcq = parseQuiz(
  [
    "1. Q: Which layer does RAID 5 add?",
    "A) Mirroring",
    "B) Distributed parity",
    "C) Nothing",
    "D) Compression",
    "Correct: B",
  ].join("\n")
);
assert.equal(mcq.length, 1);
assert.equal(mcq[0].options.length, 4);
assert.equal(mcq[0].correctIndex, 1);
assert.equal(mcq[0].question, "Which layer does RAID 5 add?");

// parseQuiz — true/false supplies its own options, and accepts the word as the answer
const tf = parseQuiz("Q: RAID 5 survives two disk failures.\nAnswer: False", true);
assert.equal(tf.length, 1);
assert.deepEqual(tf[0].options, ["True", "False"]);
assert.equal(tf[0].correctIndex, 1);

// parseQuiz — an answer given as the option's own text still resolves
assert.equal(
  parseQuiz("Q: Capital of France?\nA) Lyon\nB) Paris\nCorrect answer: Paris")[0].correctIndex,
  1
);

// parseQuiz — unanswerable questions are dropped rather than shown
assert.deepEqual(parseQuiz("Q: No options and no answer here"), []);
assert.deepEqual(parseQuiz("Q: Pick one\nA) Yes\nB) No\nCorrect: Z"), []);
assert.deepEqual(parseQuiz(""), []);

// relativeDate — the four branches, off synthetic offsets from now
const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();
assert.equal(relativeDate(daysAgo(0)), "Today");
assert.equal(relativeDate(daysAgo(1)), "Yesterday");
assert.equal(relativeDate(daysAgo(3)), "3 days ago");
// A future timestamp (clock skew, or a note saved a moment ago) must not read
// as "-1 days ago".
assert.equal(relativeDate(new Date(Date.now() + 60_000).toISOString()), "Today");
// Past a week it gives up on prose and shows the date.
assert.notEqual(relativeDate(daysAgo(40)).includes("days ago"), true);

// preview — first line that has something on it, never a blank
assert.equal(preview("\n\n  Osmosis notes\nsecond line"), "Osmosis notes");
assert.equal(preview("   \n\t\n"), "Empty note");
assert.equal(preview(""), "Empty note");

// readingOrder — boxes come back shuffled; position decides the sequence
const box = (text: string, x1: number, y1: number) => ({
  text,
  bbox: { x1, y1, x2: x1 + 40, y2: y1 + 10 },
});
// Same line, supplied right-to-left, must read left-to-right.
assert.equal(readingOrder([box("1,480mg", 120, 50), box("Sodium", 10, 51)]), "Sodium 1,480mg");
// Different lines stay different lines, in top-to-bottom order.
assert.equal(readingOrder([box("Protein", 10, 90), box("Sodium", 10, 50)]), "Sodium\nProtein");
// Blank detections are dropped rather than becoming stray spaces.
assert.equal(readingOrder([box("  ", 10, 50), box("Sugar", 60, 50)]), "Sugar");
assert.equal(readingOrder([]), "");
// A slight tilt down the row must not split one line in two.
assert.equal(
  readingOrder([box("Total", 10, 50), box("Fat", 70, 53), box("9g", 130, 56)]),
  "Total Fat 9g"
);

// The scrambling case. A nutrient name set larger than its value shares the
// line but not the centre: grouping on centre distance tore these apart.
const sized = (text: string, x1: number, y1: number, height: number) => ({
  text,
  bbox: { x1, y1, x2: x1 + 40, y2: y1 + height },
});
assert.equal(
  readingOrder([sized("Sodium", 10, 50, 20), sized("1,480 mg", 120, 56, 9)]),
  "Sodium 1,480 mg"
);
// …but a genuinely lower row still starts a new line, even under a tall heading.
assert.equal(
  readingOrder([sized("NUTRITION", 10, 20, 26), sized("Sodium", 10, 60, 10)]),
  "NUTRITION\nSodium"
);

// Confident nonsense from smudges and artwork is dropped, not woven in.
const scored = (text: string, x1: number, y1: number, score: number) => ({
  text,
  bbox: { x1, y1, x2: x1 + 40, y2: y1 + 10 },
  score,
});
assert.equal(readingOrder([scored("Sodium", 10, 50, 0.95), scored("s~m", 60, 50, 0.05)]), "Sodium");
// A box with no score at all is trusted, so fixtures and older callers work.
assert.equal(readingOrder([box("Sodium", 10, 50)]), "Sodium");

/* ---------------------------------------------------- cutting an answer --- */

// Stopping a model mid-word reads as a bug rather than a limit, so the tail
// goes back to the last finished sentence.
assert.equal(trimToSentence("One thing. Then another. And a th"), "One thing. Then another.");
assert.equal(trimToSentence("Done already."), "Done already.");
assert.equal(trimToSentence("A question? Yes"), "A question?");
assert.equal(trimToSentence("Stop! More wo"), "Stop!");

// A decimal point is not the end of a sentence — cutting there would turn
// 2,300 into "2,3" and invent a number.
assert.equal(trimToSentence("Sodium is 2.3 grams per d"), "Sodium is 2.3 grams per d");
assert.equal(trimToSentence("It is 2.3. Next sen"), "It is 2.3.");

// A newline ends a line of a list, which is a fine place to stop.
assert.equal(trimToSentence("- one\n- two\n- thr"), "- one\n- two");

// Nothing to fall back to: half an answer beats none, and a list or a code
// block may legitimately hold no full stop at all.
assert.equal(trimToSentence("no punctuation here"), "no punctuation here");
assert.equal(trimToSentence(""), "");
assert.equal(trimToSentence("   "), "");

/* ------------------------------------------------------------ forSpeech --- */

// Marks go, words stay.
assert.equal(forSpeech("This is **really** important."), "This is really important.");
assert.equal(forSpeech("Use `ping` to test."), "Use ping to test.");
assert.equal(forSpeech("See [the RFC](https://example.com/rfc1918)."), "See the RFC.");
// Headings and bullets become sentences, with one pause per line — not a
// "hash" and not a run of stops.
assert.equal(
  forSpeech("## Steps\n- Open the app\n- Tap Scan"),
  "Steps. Open the app. Tap Scan"
);
assert.equal(forSpeech("First line.\n\n\nSecond line."), "First line. Second line.");
assert.equal(forSpeech("Here is why:\nit is faster."), "Here is why: it is faster.");
// A code block keeps its contents; only the fences are dropped.
assert.equal(forSpeech("```js\nconst x = 1\n```"), "const x = 1");
// Numbers and ordinary punctuation are left alone.
assert.equal(forSpeech("It costs ₱2,300.50 — about 3.5%."), "It costs ₱2,300.50 — about 3.5%.");
assert.equal(forSpeech("   "), "");

console.log("formats: all checks passed");
