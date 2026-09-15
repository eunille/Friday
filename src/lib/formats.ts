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
