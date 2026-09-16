/**
 * Reading a nutrition panel and scoring it.
 *
 * Pure, with no React Native imports, so `nutrition.check.ts` can run it under
 * plain node. That split matters more here than anywhere else in the app: the
 * language model extracts the numbers, but *nothing below asks it to judge
 * them*. Scoring is arithmetic against a published reference, so the same
 * label always produces the same score and the result can be asserted on.
 */

/* -------------------------------------------------------------------------
   The reference

   WHO population guidance, scaled per age band by energy requirement:
   sodium under 2,000 mg a day; free sugars and saturated fat each under 10%
   of energy; fibre around 25 g; protein around 50 g.

   ponytail: one object and one label. To move to the FNRI PDRI tables, replace
   REFERENCE_LABEL and the body of dailyLimits — nothing else in this file, and
   nothing in the UI, needs to change.
   ------------------------------------------------------------------------- */

export const REFERENCE_LABEL = "WHO general reference";

export const AGES = {
  child: { label: "Child", note: "4–6 years", kcal: 1350 },
  teen: { label: "Teen", note: "13–18 years", kcal: 2200 },
  adult: { label: "Adult", note: "19–59 years", kcal: 2000 },
  elderly: { label: "Older adult", note: "60 and over", kcal: 1800 },
} as const;

export type Age = keyof typeof AGES;

export type Limits = {
  energyKcal: number;
  sodiumMg: number;
  addedSugarG: number;
  satFatG: number;
  fibreG: number;
  proteinG: number;
};

/** What a whole day looks like for this age band. */
export function dailyLimits(age: Age): Limits {
  const kcal = AGES[age].kcal;
  const scale = kcal / AGES.adult.kcal;
  return {
    energyKcal: kcal,
    sodiumMg: Math.round(2000 * scale),
    // 10% of energy, at 4 kcal per gram of sugar and 9 per gram of fat.
    addedSugarG: Math.round((kcal * 0.1) / 4),
    satFatG: Math.round((kcal * 0.1) / 9),
    fibreG: Math.round(25 * scale),
    proteinG: Math.round(50 * scale),
  };
}

/* ------------------------------------------------------------------ panel */

export type Panel = {
  name?: string;
  serving?: string;
  energyKcal?: number;
  sodiumMg?: number;
  addedSugarG?: number;
  satFatG?: number;
  proteinG?: number;
  fibreG?: number;
};

type NutrientKey = keyof Limits;

const NUTRIENTS: readonly {
  key: NutrientKey;
  label: string;
  unit: string;
  /** "limit" is something to keep down; "get" is something to reach. */
  goal: "limit" | "get";
}[] = [
  { key: "sodiumMg", label: "Sodium", unit: "mg", goal: "limit" },
  { key: "addedSugarG", label: "Added sugar", unit: "g", goal: "limit" },
  { key: "satFatG", label: "Saturated fat", unit: "g", goal: "limit" },
  { key: "energyKcal", label: "Energy", unit: "kcal", goal: "limit" },
  { key: "proteinG", label: "Protein", unit: "g", goal: "get" },
  { key: "fibreG", label: "Fibre", unit: "g", goal: "get" },
];

/** What the model is asked for. Keys match `Panel` exactly. */
export const EXTRACTION_PROMPT = [
  "Read the nutrition panel below and reply with JSON only, no explanation.",
  'Use exactly these keys: {"name","serving","energyKcal","sodiumMg","addedSugarG","satFatG","proteinG","fibreG"}.',
  "Use the per-serving column, not per 100 g, when the label gives both.",
  "Numbers must be plain numbers with no units. Omit any key the label does not state.",
  "Never estimate a value that is not printed on the label.",
].join(" ");

/** "1,480 mg" and "1480" both become 1480; anything unreadable becomes undefined. */
function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const digits = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!digits) return undefined;
  const parsed = Number(digits[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Pulls the panel out of whatever the model wrapped its JSON in — a fenced
 * block, a sentence of preamble, a trailing apology. Returns an empty panel
 * rather than throwing, because a screen with nothing on it is easier to
 * recover from than a crash.
 */
export function parsePanel(text: string): Panel {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return {};

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null) return {};

  const source = raw as Record<string, unknown>;
  const panel: Panel = {
    name: toText(source.name),
    serving: toText(source.serving),
  };
  for (const { key } of NUTRIENTS) {
    const value = toNumber(source[key]);
    if (value !== undefined && value >= 0) panel[key] = value;
  }
  return panel;
}

/* ------------------------------------------------------- reading it here

   A nutrition panel is one of the most regular pieces of text in the world:
   a name, a number, a unit, repeated. That is a parser's job, not a language
   model's — a 1.5B model spends half a minute retyping numbers that are
   already in the OCR output, and can get one wrong on the way. This runs in
   under a millisecond, needs no model loaded at all, and is asserted on.

   `parsePanel` above stays as the escape hatch for a label this cannot read.
   ---------------------------------------------------------------------- */

type Rule = {
  key: NutrientKey;
  unit: "mg" | "g" | "kcal";
  /** Tried in order, so the specific wording ("added sugars") is preferred
      over the loose one ("sugars"). */
  patterns: readonly RegExp[];
};

const RULES: readonly Rule[] = [
  { key: "energyKcal", unit: "kcal", patterns: [/energy/i, /calories/i, /\bkcal\b/i] },
  // No "Na" abbreviation. On a Filipino label "na" is an ordinary particle
  // ("walang asukal na idinagdag"), so it would match a line of ingredients
  // and take whatever number came next. Sodium and salt cover real panels.
  { key: "sodiumMg", unit: "mg", patterns: [/sodium/i] },
  {
    key: "addedSugarG",
    unit: "g",
    patterns: [/added\s*sugar/i, /total\s*sugar/i, /\bsugars?\b/i],
  },
  { key: "satFatG", unit: "g", patterns: [/saturated/i, /\bsat\.?\s*fat/i] },
  { key: "proteinG", unit: "g", patterns: [/protein/i] },
  { key: "fibreG", unit: "g", patterns: [/dietary\s*fib(?:re|er)/i, /\bfib(?:re|er)\b/i] },
];

/** The first number after `from`, with whatever unit sits against it. */
function valueAfter(line: string, from: number): { amount: number; unit: string } | null {
  const rest = line.slice(from);
  const found = /(\d[\d,]*(?:[.]\d+)?)\s*(mg|g|kcal|kj)?/i.exec(rest);
  if (!found) return null;
  const amount = Number(found[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  return { amount, unit: (found[2] ?? "").toLowerCase() };
}

function convert(amount: number, found: string, want: Rule["unit"]): number {
  if (want === "mg" && found === "g") return amount * 1000;
  if (want === "g" && found === "mg") return amount / 1000;
  // Labels outside the US often print kilojoules; 1 kcal is 4.184 kJ.
  if (want === "kcal" && found === "kj") return amount / 4.184;
  return amount;
}

/**
 * Reads a panel straight out of recognised text. No model involved.
 *
 * ponytail: line-by-line keyword match, no table or column detection. A label
 * printing per-100g and per-serving side by side takes whichever number comes
 * first on the line. The text is editable on screen, which is a faster
 * correction loop than anything cleverer would buy.
 */
export function readPanel(text: string): Panel {
  const lines = text.split("\n");
  const panel: Panel = {};

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      let matched = false;
      for (const line of lines) {
        const hit = pattern.exec(line);
        if (!hit) continue;
        const value = valueAfter(line, hit.index + hit[0].length);
        if (!value) continue;
        const amount = convert(value.amount, value.unit, rule.unit);
        if (amount > 0) {
          panel[rule.key] = Math.round(amount * 10) / 10;
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
  }

  // Salt is sometimes printed instead of sodium. 1 g of salt is about 400 mg.
  if (panel.sodiumMg === undefined) {
    for (const line of lines) {
      const hit = /\bsalt\b/i.exec(line);
      if (!hit) continue;
      const value = valueAfter(line, hit.index + hit[0].length);
      if (value && value.amount > 0) {
        panel.sodiumMg = Math.round(convert(value.amount, value.unit || "g", "g") * 400);
        break;
      }
    }
  }

  const serving = lines.find((line) => /serving\s*size|per\s*serving/i.test(line));
  if (serving) panel.serving = serving.trim();

  // The product name, if the first line looks like one rather than a figure or
  // the panel's own heading.
  const first = lines.find((line) => line.trim() !== "");
  if (
    first &&
    !/\d/.test(first) &&
    first.trim().length > 2 &&
    !/nutrition|facts|information|panel|label/i.test(first)
  ) {
    panel.name = first.trim();
  }

  return panel;
}

/* ------------------------------------------------------------------ score */

export type Band = "low" | "moderate" | "high" | "good";

export type Row = {
  key: NutrientKey;
  label: string;
  /** Formatted for display, e.g. "1,480 mg". */
  amount: string;
  /** Fraction of the day's reference this serving uses. */
  share: number;
  band: Band;
  /** The judgement in a word, so colour is never the only signal. */
  word: string;
  /**
   * Whether this is good news. Lives here rather than in the UI because it is
   * not derivable from the band alone: low sodium is good, low fibre is not.
   */
  tone: "good" | "watch" | "bad";
};

export type Assessment = {
  score: number;
  verdict: string;
  rows: Row[];
};

/** Penalties and bonuses, tuned so a single bad nutrient cannot zero a score. */
const PENALTY: Record<Band, number> = { high: 25, moderate: 10, low: 0, good: 0 };
const BONUS: Record<Band, number> = { good: 8, moderate: 4, low: 0, high: 0 };

function bandFor(goal: "limit" | "get", share: number): Band {
  if (goal === "limit") return share > 0.3 ? "high" : share >= 0.15 ? "moderate" : "low";
  return share >= 0.2 ? "good" : share >= 0.1 ? "moderate" : "low";
}

const WORD: Record<"limit" | "get", Record<Band, string>> = {
  limit: { high: "High", moderate: "Moderate", low: "Low", good: "Low" },
  get: { good: "Good", moderate: "Some", low: "Low", high: "Good" },
};

const TONE: Record<"limit" | "get", Record<Band, Row["tone"]>> = {
  limit: { high: "bad", moderate: "watch", low: "good", good: "good" },
  get: { good: "good", moderate: "watch", low: "watch", high: "good" },
};

function format(value: number, unit: string): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("en-US")} ${unit}`;
}

/**
 * Scores one serving against one age band.
 *
 * Only nutrients the label actually stated are scored — a missing value is
 * left out rather than treated as zero, which would flatter a label that
 * simply declined to print its sodium.
 */
export function scorePanel(panel: Panel, age: Age): Assessment {
  const limits = dailyLimits(age);
  const rows: Row[] = [];
  let penalties = 0;
  let bonuses = 0;

  for (const nutrient of NUTRIENTS) {
    const amount = panel[nutrient.key];
    if (amount === undefined) continue;

    const share = limits[nutrient.key] > 0 ? amount / limits[nutrient.key] : 0;
    const band = bandFor(nutrient.goal, share);
    if (nutrient.goal === "limit") penalties += PENALTY[band];
    else bonuses += BONUS[band];

    rows.push({
      key: nutrient.key,
      label: nutrient.label,
      amount: format(amount, nutrient.unit),
      share,
      band,
      word: WORD[nutrient.goal][band],
      tone: TONE[nutrient.goal][band],
    });
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - penalties + bonuses)));

  return {
    score,
    verdict:
      score >= 80
        ? "A good everyday choice"
        : score >= 60
          ? "Okay now and then"
          : score >= 40
            ? "Needs moderation"
            : "Best kept occasional",
    rows,
  };
}

/** True when the label gave us nothing to score. */
export function isEmpty(panel: Panel): boolean {
  return NUTRIENTS.every((nutrient) => panel[nutrient.key] === undefined);
}
