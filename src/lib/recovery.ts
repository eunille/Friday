/**
 * Which model to start with, given what the last run left behind.
 *
 * Kept apart from ai.tsx, which imports the native model runtime and so cannot
 * run under Node, because this only ever executes after the app was killed —
 * the one path nobody exercises by hand, so it needs a check that does.
 *
 * `interrupted` is the model whose load into memory never finished. Nothing
 * but the system ends a process mid-load, so it is treated as too big for the
 * phone: start smaller, and remember why.
 */
export function recover<T extends string>(p: {
  known: readonly T[];
  fallback: T;
  saved: unknown;
  interrupted: unknown;
  lastCrash: unknown;
}): { start: T; crashed: T | null; fellBack: boolean } {
  const isKnown = (value: unknown): value is T =>
    typeof value === "string" && (p.known as readonly string[]).includes(value);

  const chosen = isKnown(p.saved) ? p.saved : p.fallback;

  if (isKnown(p.interrupted)) {
    // Only when the killed model is the one we would start with. A leftover
    // mark for some other model (switched away since) is still worth the
    // warning, but is no reason to override what was chosen.
    const fellBack = chosen === p.interrupted && p.interrupted !== p.fallback;
    return { start: fellBack ? p.fallback : chosen, crashed: p.interrupted, fellBack };
  }

  return { start: chosen, crashed: isKnown(p.lastCrash) ? p.lastCrash : null, fellBack: false };
}
