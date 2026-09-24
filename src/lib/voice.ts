/**
 * Spoken test answers and questions, kept free of audio and React so they can
 * be checked: which option an answer like "the second one" meant, and how a
 * test question sounds read aloud.
 */

/** Letters, ordinals and numbers, including Whisper's spellings of a lone letter said aloud. */
const PICKS: Record<string, number> = {
  a: 0,
  ay: 0,
  eh: 0,
  one: 0,
  first: 0,
  b: 1,
  bee: 1,
  be: 1,
  two: 1,
  second: 1,
  c: 2,
  see: 2,
  sea: 2,
  three: 2,
  third: 2,
  d: 3,
  dee: 3,
  four: 3,
  fourth: 3,
};

/** Words around an answer that are not the answer. */
const FILLER = new Set(
  "i id im ill think guess maybe um uh erm it its is option answer letter the number my choice go with say pick".split(
    " "
  )
);

/**
 * Which option a spoken answer picks, or -1.
 *
 * People answer a read-aloud question the way they would a person — "B", "the
 * second one", "I think it's the three-way handshake" — so this accepts a
 * letter, an ordinal, or enough of the option's own words. A guess it cannot
 * back is -1, and the caller asks again rather than marking someone wrong for
 * a mishearing.
 */
export function spokenChoice(heard: string, options: readonly string[]): number {
  const words = heard
    .toLowerCase()
    // Contractions joined, not split: "it's" is one word, not "it" and "s".
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return -1;

  // A lone pick, once the filler is gone: "b", "second", "the second one".
  const content = words.filter((word) => !FILLER.has(word));
  const [first, second] = content;
  const lone =
    content.length === 1 || (content.length === 2 && second === "one") ? first : undefined;
  if (lone !== undefined && lone in PICKS) {
    const index = PICKS[lone]!;
    if (index < options.length) return index;
  }

  // Otherwise the option whose words were said: the best match, and at least
  // half of that option's meaningful words, so "TCP" alone cannot pick a long
  // option that merely mentions TCP. A tie is not a pick — two options both
  // fully said is someone thinking aloud, and guessing between them would mark
  // them on a coin toss.
  const said = ` ${words.join(" ")} `;
  let best = -1;
  let bestShare = 0;
  let tied = false;
  options.forEach((option, index) => {
    const parts = option
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((part) => part.length > 2);
    if (parts.length === 0) return;
    const share = parts.filter((part) => said.includes(` ${part}`)).length / parts.length;
    if (share > bestShare) {
      bestShare = share;
      best = index;
      tied = false;
    } else if (share === bestShare && share > 0) {
      tied = true;
    }
  });
  return bestShare >= 0.5 && !tied ? best : -1;
}

/* --------------------------------------------------------- reading aloud --- */

/**
 * Knobs for read-aloud, the first place to look when it sounds wrong on a
 * phone. Pausing mid-reply: raise LEAD_S. Too slow to start: lower it, or
 * raise SPEED.
 */
export const READ = {
  /** Kokoro's speed multiplier. A touch brisker than 1 reads as confident, not rushed. */
  SPEED: 1.1,
  /** Roughly how many characters of English Kokoro says per second at speed 1. */
  CHARS_PER_S: 14,
  /** Extra buffered audio before starting, to absorb a slow sentence. */
  LEAD_S: 0.6,
  /** A group this long is worth one call on its own; shorter sentences are joined. */
  MIN_GROUP: 80,
  /** Kokoro takes 128 phoneme tokens a call; a group is not grown past this. */
  MAX_GROUP: 220,
} as const;

/**
 * The reply cut into groups of whole sentences, as spans of the original text.
 *
 * Spans rather than strings so the screen can show exactly the text being
 * spoken — a group's end is how far the reply has been read. Short sentences
 * are joined because every call to the voice has a fixed cost, and "Yes."
 * synthesised alone pays it for half a second of audio.
 */
export function speechGroups(
  text: string,
  knobs: typeof READ = READ
): { start: number; end: number }[] {
  // A sentence ends at . ! ? … (plus any closing quote or bracket) or a line break.
  const ends: number[] = [];
  const pattern = /[.!?…]+["')\]]*(?=\s|$)|\n+/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    ends.push(match.index + match[0].length);
  }
  if (ends[ends.length - 1] !== text.length) ends.push(text.length);

  // A sentence too long for one group — a note with no full stops — is broken
  // at a space, or it starts late and, past 2048 characters, Kokoro refuses it.
  for (let i = 0, from = 0; i < ends.length; from = ends[i]!, i += 1) {
    if (ends[i]! - from <= knobs.MAX_GROUP) continue;
    const space = text.lastIndexOf(" ", from + knobs.MAX_GROUP);
    ends.splice(i, 0, space > from ? space + 1 : from + knobs.MAX_GROUP);
  }

  const groups: { start: number; end: number }[] = [];
  let start = 0;
  let end = 0;
  for (const next of ends) {
    // Adding this sentence would overfill a group that already has one: close it.
    if (end > start && next - start > knobs.MAX_GROUP) {
      groups.push({ start, end });
      start = end;
    }
    end = next;
    if (end - start >= knobs.MIN_GROUP) {
      groups.push({ start, end });
      start = end;
    }
  }
  if (end > start) groups.push({ start, end });
  // Only text worth saying: whitespace and punctuation alone is nothing.
  return groups.filter((group) => /[\p{L}\p{N}]/u.test(text.slice(group.start, group.end)));
}

/**
 * Whether enough audio is buffered to start playing and not stop again.
 *
 * The voice is slower than real time on a mid-range phone, so starting at the
 * first sentence plays it and then waits while the next is made — the pauses
 * people hear. At a measured rate r (seconds of audio made per second), the
 * rest takes remaining/r to make and plays in buffered + remaining, so the
 * reading never runs dry once buffered >= remaining × (1/r − 1).
 */
export function readyToPlay(
  state: {
    bufferedS: number;
    producedS: number;
    elapsedS: number;
    remainingChars: number;
    done: boolean;
  },
  knobs: typeof READ = READ
): boolean {
  if (state.done) return true;
  if (state.producedS <= 0 || state.elapsedS <= 0) return false;
  const rate = state.producedS / state.elapsedS;
  if (rate >= 1) return true;
  const remainingS = state.remainingChars / (knobs.CHARS_PER_S * knobs.SPEED);
  return state.bufferedS >= remainingS * (1 / rate - 1) + knobs.LEAD_S;
}

/** A test question as it should be read aloud: the question, then each option by letter. */
export function spokenQuestion(
  number: number,
  total: number,
  question: string,
  options: readonly string[]
): string {
  const choices = options
    .map((option, index) => `${String.fromCharCode(65 + index)}: ${option}.`)
    .join(" ");
  return `Question ${number} of ${total}. ${question} ${choices}`;
}
