/**
 * The tutor's modes, and how a sentence picks one.
 *
 * Deliberately not the model's job. Asking a 0.5B model to classify intent and
 * emit a tool call gets malformed JSON and the wrong intent often enough to
 * feel broken, and a handful of intents is a few regexes. So a matcher
 * decides, the model only writes prose, and the mode chip in the composer
 * always shows what was decided — a phrasing the matcher misses costs one tap,
 * not a mystery.
 */

export type Mode = "ask" | "teach" | "test";

export const MODES: Record<Mode, { label: string; icon: string; note: string; hello: string }> = {
  ask: {
    label: "Ask",
    icon: "chatbubble-outline",
    note: "Answers straight away.",
    hello: "Ask me anything — about your notes or anything else.",
  },
  teach: {
    label: "Teach me",
    icon: "school-outline",
    note: "Explains a little, then asks you a question.",
    hello: "Tell me a topic and I'll teach it a step at a time, checking as we go.",
  },
  test: {
    label: "Test me",
    icon: "checkbox-outline",
    note: "One question at a time, with the answer after each.",
    hello: "Tell me a topic and I'll test you on it, one question at a time.",
  },
};

/** How many questions one test asks. */
export const TEST_LENGTH = 5;

/**
 * Leading filler that carries no intent: "can you", "please", "let's". Stripped
 * before matching so the rules below only have to describe the verb.
 */
const LEAD =
  /^(?:(?:hey|hi|ok(?:ay)?|so)[,!]?\s+)?(?:(?:can|could|would|will) you\s+|please\s+|pls\s+|let'?s\s+|i want (?:you )?to\s+|i'?d like (?:you )?to\s+)*/i;

const RULES: readonly { mode: Mode; pattern: RegExp }[] = [
  // Back to plain answers. First, so "stop testing me" is not read as a test.
  {
    mode: "ask",
    pattern: /^(?:stop|end|quit|exit|cancel)\b.*\b(?:test\w*|quiz\w*|lesson|teach\w*|questions?)\b/i,
  },
  { mode: "ask", pattern: /^(?:normal|ask|chat) mode\b/i },

  { mode: "test", pattern: /^(?:test|quiz|drill) me\b(?:\s+(?:on|about|in|over))?/i },
  // "give me a quiz" is not here: asking to be *given* one is asking for the
  // standalone quiz (see detectQuiz), while "do a test" is doing it now.
  {
    mode: "test",
    pattern: /^(?:do|start|take|have) (?:a |another )?(?:test|quiz)\b(?:\s+(?:on|about|in))?/i,
  },
  { mode: "test", pattern: /^ask me (?:some |a few )?questions\b(?:\s+(?:on|about|in))?/i },

  { mode: "teach", pattern: /^teach me\b(?:\s+(?:about|on))?/i },
  { mode: "teach", pattern: /^help me (?:learn|understand|study)\b(?:\s+(?:about|on))?/i },
  { mode: "teach", pattern: /^(?:study|learn)\b(?:\s+(?:about|on))?/i },
  { mode: "teach", pattern: /^(?:walk|take) me through\b/i },
];

/**
 * A "topic" that names whatever is selected rather than a subject. "Quiz me on
 * my notes" has no topic — it means use the notes chosen in the picker.
 */
const NO_TOPIC =
  /^(?:(?:my|the|these|this|those|all|all my|everything in my)\s+)?(?:notes?|materials?|stuff|it|that|this|them|everything)?$/i;

/**
 * The mode a message asks for, and what it is about — or null when it is just
 * a message.
 *
 * Only a request that leads with the verb counts. "What does 'test me' mean
 * in psychology?" is a question, not a command, and matching anywhere in the
 * sentence would hijack it.
 */
export function detectMode(text: string): { mode: Mode; topic: string } | null {
  const said = text.trim().replace(/[.!?]+$/, "").replace(LEAD, "");

  for (const rule of RULES) {
    const match = rule.pattern.exec(said);
    if (!match) continue;
    const topic = said.slice(match[0].length).trim();
    return { mode: rule.mode, topic: rule.mode === "ask" || NO_TOPIC.test(topic) ? "" : topic };
  }
  return null;
}

/** The lengths the Quiz page offers. A request for any other is rounded to one. */
export const QUIZ_COUNTS = [5, 10] as const;

const QUIZ =
  /^(?:make|create|generate|build|write|prepare|give|set)(?: me| us)? (?:a |an |another )?(?:(\d+)[- ]?(?:question|item|q)s?[- ]?)?(?:practice |short |quick |full |proper )?(?:quiz|exam|test)\b(?:\s+(?:about|on|for|covering|over|in))?/i;

/**
 * A request for a standalone quiz — the kind with a score at the end, taken on
 * the Quiz page — or null.
 *
 * Checked before detectMode. "Test me on TCP" is a conversation: questions
 * one at a time in the chat. "Make me a 10-question quiz on TCP" asks for a
 * thing, so it gets a card that opens one.
 */
export function detectQuiz(text: string): { topic: string; count: number } | null {
  const said = text.trim().replace(/[.!?]+$/, "").replace(LEAD, "");
  const match = QUIZ.exec(said);
  if (!match) return null;

  const asked = Number(match[1] ?? 0);
  // Nearest offered length. Twenty rounds down to ten rather than being
  // refused: the page cannot write twenty, and ten is the closest it can.
  const count = asked >= (QUIZ_COUNTS[0] + QUIZ_COUNTS[1]) / 2 ? QUIZ_COUNTS[1] : QUIZ_COUNTS[0];
  const topic = said.slice(match[0].length).trim();
  return { topic: NO_TOPIC.test(topic) ? "" : topic, count };
}

/** "Read my networking notes", "Summarise what I studied today". */
export type NotesAsk = {
  action: "read" | "summarise";
  /** A subject or title word, or "" for whatever is chosen. */
  about: string;
  since: "today" | "week" | null;
};

const NOTES_VERB =
  /^(?:(read)(?: me)?(?: out| aloud| back)?|summari[sz]e|sum up|recap|give me (?:a )?(?:summary|recap) of)\s+/i;
/** Only about the student's own notes — "summarise the French Revolution" is a question for the model. */
const OWN_NOTES = /\bnotes?\b|\b(?:studied|saved|wrote|written|learned|learnt|added)\b/i;
const NOTES_FILLER =
  /\b(?:what|everything|all|that|i've|ive|i|have|studied|saved|wrote|written|learned|learnt|added|my|the|notes?|on|about|out loud|aloud|to me|for me|please)\b/gi;

/**
 * A request to read out or summarise the student's own notes, or null.
 * Checked before detectMode, after detectQuiz.
 */
export function detectNotes(text: string): NotesAsk | null {
  const said = text.trim().replace(/[.!?]+$/, "").replace(LEAD, "");
  const match = NOTES_VERB.exec(said);
  if (!match) return null;
  let rest = said.slice(match[0].length);
  if (!OWN_NOTES.test(rest)) return null;

  const since = /\btoday\b/i.test(rest)
    ? "today"
    : /\b(?:this|past|last) week\b/i.test(rest)
      ? "week"
      : null;
  rest = rest.replace(/\btoday\b|\b(?:this|past|last) week\b/gi, "");
  const about = rest.replace(NOTES_FILLER, "").replace(/\s+/g, " ").trim();
  return { action: match[1] ? "read" : "summarise", about, since };
}

/**
 * Which notes a NotesAsk means. A named subject wins over a title match, so
 * "networking" finds the Networking subject before a stray title. `chosen` is
 * the picker's notes, or null when it is on Everything or Nothing.
 */
export function pickNotes<
  T extends { id: string; title: string; updatedAt: string; subject?: string | null },
>(notes: readonly T[], ask: NotesAsk, chosen: readonly string[] | null, now = new Date()): T[] {
  let pool = notes;
  if (ask.since) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (ask.since === "week") start.setDate(start.getDate() - 6);
    pool = pool.filter((note) => new Date(note.updatedAt) >= start);
  }
  if (ask.about) {
    const key = ask.about.toLowerCase();
    const filed = pool.filter((note) => note.subject?.toLowerCase() === key);
    if (filed.length > 0) return filed;
    return pool.filter(
      (note) =>
        note.title.toLowerCase().includes(key) || note.subject?.toLowerCase().includes(key)
    );
  }
  return pool.filter((note) => !chosen || chosen.includes(note.id));
}

/**
 * Added to the system prompt in Teach mode.
 *
 * The shape is the whole instruction: a small model told to "use the Socratic
 * method" writes an essay about Socrates. Told exactly what one turn contains,
 * it mostly does it.
 */
export const TEACH_PROMPT = [
  "You are a patient tutor. Teach one small step per reply:",
  "1. Explain one idea in two or three plain sentences, with a concrete example.",
  "2. End with exactly one short question that checks the student understood.",
  "When the student answers, first say whether they are right and fix any mistake in one sentence, then teach the next step the same way.",
  "Never write more than one step at a time.",
].join("\n");

/**
 * The instruction for writing a test. The format is the one the quiz screen
 * already parses (`parseQuiz`), so both read questions the same way.
 */
export function testPrompt(topic: string, count = TEST_LENGTH): string {
  return [
    `Write exactly ${count} multiple-choice questions${topic ? ` about ${topic}` : " about the context"}.`,
    "Format each question exactly as:\nQ: <question>\nA) <option>\nB) <option>\nC) <option>\nD) <option>\nCorrect: <letter>",
    "Each question has exactly one correct option. Use the context if there is one. Do not add any other text.",
  ].join("\n");
}

/** The line after each answer. Written here, not by the model, so it is always right. */
export function verdict(options: readonly string[], correct: number, chosen: number): string {
  if (chosen === correct) return "Correct!";
  return `Not quite — it's ${String.fromCharCode(65 + correct)}) ${options[correct]}.`;
}

/** The closing line, scaled to the score so a perfect run and a bad one do not read the same. */
export function scoreLine(right: number, total: number): string {
  const lead =
    right === total ? "Perfect" : right / total >= 0.6 ? "Nice work" : "Worth another pass";
  return `${lead} — ${right} of ${total}. Send another topic to go again, or switch back to Ask.`;
}
