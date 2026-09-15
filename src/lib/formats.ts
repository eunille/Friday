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
