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
