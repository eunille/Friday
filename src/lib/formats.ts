/**
 * Pure helpers with no React Native imports, so `formats.check.ts` can run them
 * under plain node.
 */

/** Joins the PCM buffers an AudioRecorder hands back into one waveform. */
export function concatFloat32(chunks: readonly Float32Array[]): Float32Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;

  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export type PackEntry = { title: string; text: string };
export type Pack = { id: string; title: string; entries: PackEntry[] };

/**
 * Validates a knowledge pack downloaded from a static host. Packs come off the
 * network, so nothing here trusts the shape — a malformed pack must fail loudly
 * rather than write half of itself into the vector store.
 */
export function parsePack(value: unknown): Pack {
  if (typeof value !== "object" || value === null) {
    throw new Error("Pack is not a JSON object");
  }

  const { id, title, entries } = value as Record<string, unknown>;

  if (typeof id !== "string" || id.trim() === "") throw new Error("Pack is missing an id");
  if (typeof title !== "string" || title.trim() === "") throw new Error("Pack is missing a title");
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("Pack has no entries");

  const parsed = entries.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`Entry ${index} is not an object`);
    }
    const { title: entryTitle, text } = entry as Record<string, unknown>;
    if (typeof entryTitle !== "string" || entryTitle.trim() === "") {
      throw new Error(`Entry ${index} is missing a title`);
    }
    if (typeof text !== "string" || text.trim() === "") {
      throw new Error(`Entry ${index} is missing text`);
    }
    return { title: entryTitle, text };
  });

  return { id, title, entries: parsed };
}

/**
 * ponytail: hard character cap instead of counting tokens. Qwen2.5's window is
 * far larger, but generation slows to a crawl on a phone long before the window
 * fills — this keeps summarise/flashcards responsive. Raise it once you have
 * real timings from Phase 6 devices.
 */
export const PROMPT_CHAR_BUDGET = 6000;

export function clampForPrompt(text: string, budget = PROMPT_CHAR_BUDGET): string {
  return text.length <= budget ? text : `${text.slice(0, budget)}\n…(truncated)`;
}

/**
 * Puts a document back together from the overlapping chunks it was split into.
 *
 * RecursiveCharacterTextSplitter overlaps neighbours by up to 100 characters so
 * retrieval never cuts a sentence in half. Joining the chunks naively repeats
 * that overlap, which is fine for a prompt but not for text a person is about
 * to edit — so each chunk is welded onto the longest suffix of what is already
 * written. Where no overlap is found the chunks were split on a separator the
 * splitter consumed, and a newline is the closest thing to it.
 */
export function joinChunks(chunks: readonly string[], maxOverlap = 100): string {
  let out = "";

  for (const chunk of chunks) {
    if (out === "") {
      out = chunk;
      continue;
    }

    let overlap = 0;
    for (let size = Math.min(maxOverlap, out.length, chunk.length); size > 0; size--) {
      if (out.endsWith(chunk.slice(0, size))) {
        overlap = size;
        break;
      }
    }

    out += overlap > 0 ? chunk.slice(overlap) : `\n${chunk}`;
  }

  return out;
}

export type Flashcard = { question: string; answer: string };

/** "Q:" / "A:" at the head of a line, after any "1." / "-" / "*" bullet. */
const CARD_LINE = /^\s*(?:[-*•]\s*)?(?:\d+[.)]\s*)?(?:\*\*)?([QA])\s*[:.)-]\s*/i;

/**
 * Pulls Q/A pairs out of a model's answer.
 *
 * A 0.5B model asked for "Q: ... / A: ..." mostly complies, but sometimes
 * numbers, bullets or bolds the markers, or wraps an answer onto a second
 * line. Rather than tighten the prompt and hope, this tolerates all of that
 * and drops anything still incomplete — a half-parsed card is worse than no
 * card, because you cannot tell which half is missing while studying.
 */
export type QuizQuestion = { question: string; options: string[]; correctIndex: number };

const QUIZ_BULLET = /^\s*(?:[-*•]\s*)?(?:(\d+)[.)]\s*)?/;
const QUIZ_MARKER = /^(?:\*\*)?Q(?:uestion)?\s*\d*\s*[:.)-]\s*/i;
const QUIZ_OPTION = /^\s*(?:\*\*)?([A-D])\s*(?:\*\*)?\s*[).:-]\s+/i;
const QUIZ_ANSWER = /^\s*(?:\*\*)?(?:Correct(?:\s*Answer)?|Answer|Ans)\s*(?:\*\*)?\s*[:.)-]\s*/i;

const clean = (value: string): string => value.replace(/\*\*/g, "").trim();

/**
 * The question text if this line starts one, else null.
 *
 * Bullets and numbering are stripped first so "1. Q: …" does not leave the
 * "Q:" stranded in the question. A bare "1. …" counts too, because a model
 * told to number its questions often drops the Q marker once it has.
 */
function questionBody(line: string): string | null {
  const bullet = QUIZ_BULLET.exec(line);
  const rest = line.slice(bullet?.[0].length ?? 0);

  const marker = QUIZ_MARKER.exec(rest);
  if (marker) return rest.slice(marker[0].length);

  return bullet?.[1] !== undefined && rest.trim() ? rest : null;
}

/** Which option the model named: a letter, the word true/false, or the option's own text. */
function resolveAnswer(answer: string, options: string[]): number {
  const said = clean(answer).replace(/[.]$/, "");

  const letter = /^([A-D])\b/i.exec(said);
  if (letter) {
    const index = letter[1].toUpperCase().charCodeAt(0) - 65;
    if (index < options.length) return index;
  }

  const exact = options.findIndex((option) => option.toLowerCase() === said.toLowerCase());
  if (exact >= 0) return exact;

  return options.findIndex((option) => option.toLowerCase().startsWith(said.toLowerCase()));
}

/**
 * Reads a generated quiz into answerable questions.
 *
 * `trueFalse` supplies the two options itself, because a model asked for a
 * true/false question usually writes the statement and the verdict but not the
 * choices. Anything whose correct answer cannot be resolved to one of the
 * options is dropped: an unanswerable question is worse than a shorter quiz,
 * since it marks you wrong whatever you tap.
 */
export function parseQuiz(text: string, trueFalse = false): QuizQuestion[] {
  const questions: QuizQuestion[] = [];
  let current: { question: string[]; options: string[]; answer: string } | null = null;

  const flush = (): void => {
    if (!current) return;
    const question = clean(current.question.join(" "));
    const options = current.options.length >= 2 ? current.options : trueFalse ? ["True", "False"] : [];
    const correctIndex = question && options.length >= 2 ? resolveAnswer(current.answer, options) : -1;
    if (correctIndex >= 0) questions.push({ question, options, correctIndex });
    current = null;
  };

  for (const line of text.split("\n")) {
    const answer = QUIZ_ANSWER.exec(line);
    if (answer && current) {
      current.answer = line.slice(answer[0].length);
      continue;
    }

    const option = QUIZ_OPTION.exec(line);
    if (option && current) {
      current.options.push(clean(line.slice(option[0].length)));
      continue;
    }

    const question = questionBody(line);
    if (question !== null) {
      flush();
      current = { question: [question], options: [], answer: "" };
      continue;
    }

    // A wrapped question line, but only before the options start.
    if (current && current.options.length === 0 && line.trim()) current.question.push(line);
  }
  flush();

  return questions;
}

export function parseFlashcards(text: string): Flashcard[] {
  const cards: Flashcard[] = [];
  let current: { question: string[]; answer: string[] } | null = null;
  let field: "question" | "answer" = "question";

  const flush = (): void => {
    if (!current) return;
    const question = current.question.join(" ").trim();
    const answer = current.answer.join(" ").trim();
    if (question && answer) cards.push({ question, answer });
    current = null;
  };

  for (const line of text.split("\n")) {
    const marker = CARD_LINE.exec(line);
    const rest = marker ? line.slice(marker[0].length).replace(/\*\*/g, "").trim() : line.trim();
    const kind = marker?.[1].toUpperCase();

    if (kind === "Q") {
      flush();
      current = { question: rest ? [rest] : [], answer: [] };
      field = "question";
    } else if (kind === "A") {
      if (!current) current = { question: [], answer: [] };
      field = "answer";
      if (rest) current.answer.push(rest);
    } else if (current && rest) {
      // Continuation of whichever field is currently open.
      current[field].push(rest);
    }
  }
  flush();

  return cards;
}

/**
 * How long ago, in the words a person would use. Falls back to a plain date
 * once "N days ago" stops being easier to read than the date itself.
 */
export function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** First non-empty line of a note body, for a list preview. */
export function preview(body: string): string {
  const line = body.split("\n").find((candidate) => candidate.trim() !== "");
  return line?.trim() ?? "Empty note";
}

/** The shape `useOCR` hands back, narrowed to what reading order needs. */
export type OcrBox = {
  bbox: { x1: number; y1: number; x2: number; y2: number };
  text: string;
  /** Recogniser confidence, 0 to 1. Absent in hand-written test fixtures. */
  score?: number;
};

/**
 * Turns unordered OCR boxes into the text a person would read.
 *
 * The recogniser returns each detected word with a box and no sense of
 * sequence, so a panel comes back shuffled. Boxes are grouped into lines, then
 * each line is sorted left to right.
 *
 * Lines are decided by how much two boxes *overlap* vertically, not by how far
 * apart their centres are. On a nutrition panel "Sodium" is often set larger
 * than the "1,480 mg" beside it: same line, different centres, different
 * heights. Centre distance splits that pair onto separate lines and the label
 * comes out scrambled; overlap keeps them together. Measuring the shared band
 * against the shorter box also stops a tall heading swallowing the row beneath
 * it.
 *
 * Detections below `minScore` are dropped. The recogniser emits confident
 * nonsense for smudges and package artwork, and one invented word in the
 * middle of a line is worse than a gap.
 *
 * ponytail: greedy single pass, no column detection. A panel printing per-100g
 * and per-serving side by side reads across rather than down. The text is
 * editable on screen, which is a faster fix than anything cleverer.
 */
export function readingOrder(boxes: readonly OcrBox[], minScore = 0.3): string {
  const rows = boxes
    .filter((box) => box.text.trim() !== "" && (box.score ?? 1) >= minScore)
    .map((box) => ({
      text: box.text.trim(),
      top: Math.min(box.bbox.y1, box.bbox.y2),
      bottom: Math.max(box.bbox.y1, box.bbox.y2),
      left: Math.min(box.bbox.x1, box.bbox.x2),
    }))
    .sort((a, b) => a.top - b.top || a.left - b.left);

  if (rows.length === 0) return "";

  type Line = { top: number; bottom: number; items: typeof rows };
  const lines: Line[] = [];

  for (const row of rows) {
    const line = lines[lines.length - 1];
    const height = row.bottom - row.top;
    const shared = line ? Math.min(line.bottom, row.bottom) - Math.max(line.top, row.top) : 0;

    // Half of this box has to sit inside the line's band to join it.
    if (line && height > 0 && shared / height >= 0.5) {
      line.items.push(row);
      line.top = Math.min(line.top, row.top);
      line.bottom = Math.max(line.bottom, row.bottom);
    } else {
      lines.push({ top: row.top, bottom: row.bottom, items: [row] });
    }
  }

  return lines
    .map((line) =>
      line.items
        .sort((a, b) => a.left - b.left)
        .map((row) => row.text)
        .join(" ")
    )
    .join("\n");
}

/**
 * Cuts an answer back to its last finished sentence.
 *
 * Used when generation is stopped for running long. A hard stop lands
 * mid-word, and "the recommended intake is about 2,3" reads as a bug rather
 * than a limit — so the tail is dropped back to the last full stop.
 *
 * Returns the text untouched when there is no sentence end to fall back to:
 * half an answer is worth more than none, and a list or a code block may
 * legitimately contain no full stop at all.
 */
export function trimToSentence(text: string): string {
  const trimmed = text.trimEnd();
  // Search from the end for terminal punctuation that is not a decimal point.
  for (let at = trimmed.length - 1; at >= 0; at -= 1) {
    const char = trimmed[at];
    if (char !== "." && char !== "!" && char !== "?" && char !== "\n") continue;
    // "2,300." ends a sentence; "2.3" does not.
    if (char === "." && /\d/.test(trimmed[at + 1] ?? "")) continue;
    const kept = trimmed.slice(0, at + 1).trimEnd();
    if (kept.length > 0) return kept;
  }
  return trimmed;
}

/**
 * An answer, as it should be said rather than seen.
 *
 * A reading voice pronounces what it is given, so markdown the screen hides —
 * "asterisk asterisk important", "hash hash Step two" — comes out as noise.
 * Only the marks are removed, never the words: a bullet becomes the start of a
 * sentence, a link keeps its label, and a code span keeps its contents.
 */
export function forSpeech(text: string): string {
  return (
    text
      // Fenced code: the fences go, the contents are still worth hearing.
      .replace(/```[a-z]*\n?/gi, "")
      // [label](url) — the label is what a person would read out.
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // Headings, quotes and bullets at the start of a line.
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*•+]\s+)/gm, "")
      // Emphasis and inline code marks, anywhere.
      .replace(/[*_`~]+/g, "")
      // Trimmed first, so a newline at either end is not read as a pause.
      .trim()
      // A line break is a pause, not a word — and one pause, not ten.
      .replace(/\s*\n+\s*/g, ". ")
      // …except after a line that already ended its own sentence.
      .replace(/([.!?:])\s*\.\s/g, "$1 ")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}
