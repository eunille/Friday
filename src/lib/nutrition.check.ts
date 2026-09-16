/**
 * Self-check for nutrition scoring. Run: `npm run check`
 *
 * This is the one place in the app where a wrong number could matter to
 * somebody, so the arithmetic is asserted rather than trusted. The model's job
 * is extraction only; every judgement below is deterministic.
 */
import assert from "node:assert/strict";

import { dailyLimits, isEmpty, parsePanel, readPanel, scorePanel } from "./nutrition.ts";

/* ------------------------------------------------------------- reference */

const adult = dailyLimits("adult");
assert.equal(adult.sodiumMg, 2000);
assert.equal(adult.addedSugarG, 50); // 10% of 2000 kcal at 4 kcal/g
assert.equal(adult.satFatG, 22); // 10% of 2000 kcal at 9 kcal/g
assert.equal(adult.fibreG, 25);

// A child's day is smaller across the board, never larger.
const child = dailyLimits("child");
for (const key of Object.keys(adult) as (keyof typeof adult)[]) {
  assert.ok(child[key] < adult[key], `child ${key} must be below adult`);
}

/* ---------------------------------------------------------------- parsing */

// The clean case.
assert.deepEqual(parsePanel('{"name":"Instant noodles","sodiumMg":1480,"proteinG":9}'), {
  name: "Instant noodles",
  serving: undefined,
  sodiumMg: 1480,
  proteinG: 9,
});

// What a small model actually emits: a fence, preamble, and units left in.
const messy = parsePanel(
  [
    "Here is the panel:",
    "```json",
    '{"name":"Chocolate drink","serving":"30 g","sodiumMg":"95 mg","addedSugarG":"18g","energyKcal":"140"}',
    "```",
    "Let me know if you need anything else!",
  ].join("\n")
);
assert.equal(messy.name, "Chocolate drink");
assert.equal(messy.sodiumMg, 95, "units must be stripped");
assert.equal(messy.addedSugarG, 18);
assert.equal(messy.energyKcal, 140);

// A comma thousands separator must not truncate the value.
assert.equal(parsePanel('{"sodiumMg":"1,480 mg"}').sodiumMg, 1480);

// Nothing parseable must not invent a panel.
assert.ok(isEmpty(parsePanel("")));
assert.ok(isEmpty(parsePanel("I could not read the label.")));
assert.ok(isEmpty(parsePanel("{ not json at all }")));
// Nonsense values are dropped rather than scored.
assert.ok(isEmpty(parsePanel('{"sodiumMg":"none","proteinG":-5}')));

/* ---------------------------------------------------------------- scoring */

// A serving carrying most of a day's sodium must read High and cost the score.
const noodles = scorePanel({ sodiumMg: 1480, addedSugarG: 6, proteinG: 9, fibreG: 1 }, "adult");
const sodium = noodles.rows.find((row) => row.key === "sodiumMg");
assert.equal(sodium?.word, "High");
assert.equal(sodium?.amount, "1,480 mg");
assert.ok(sodium !== undefined && sodium.share > 0.7);
assert.ok(noodles.score < 80, "a high-sodium serving cannot score as an everyday choice");

// The same label judged for a child must never score better than for an adult.
const forChild = scorePanel({ sodiumMg: 1480, addedSugarG: 6, proteinG: 9, fibreG: 1 }, "child");
assert.ok(forChild.score <= noodles.score, "a smaller day cannot make a serving healthier");

// A genuinely good label lands in the top band.
const oats = scorePanel(
  { sodiumMg: 5, addedSugarG: 1, satFatG: 1, proteinG: 13, fibreG: 10 },
  "adult"
);
assert.ok(oats.score >= 80, `expected a good score, got ${oats.score}`);
assert.equal(oats.verdict, "A good everyday choice");

// Missing values are skipped, not counted as zero — a label that declines to
// print its sodium must not be flattered into a perfect score.
const silent = scorePanel({ addedSugarG: 30 }, "adult");
assert.equal(silent.rows.length, 1, "only stated nutrients produce rows");
assert.ok(silent.score < 100);

// Score stays inside its bounds however bad the label is.
const awful = scorePanel(
  { sodiumMg: 9000, addedSugarG: 200, satFatG: 90, energyKcal: 1500 },
  "child"
);
assert.ok(awful.score >= 0 && awful.score <= 100);
assert.equal(awful.verdict, "Best kept occasional");

// Colour is never the only signal: every row carries a word.
for (const row of [...noodles.rows, ...oats.rows, ...awful.rows]) {
  assert.ok(row.word.length > 0, `${row.key} must state its judgement in words`);
}

// "Low" means opposite things depending on the nutrient, so tone is not
// derivable from the word — low sodium is good news, low fibre is not.
const tones = scorePanel({ sodiumMg: 5, fibreG: 1 }, "adult");
assert.equal(tones.rows.find((row) => row.key === "sodiumMg")?.tone, "good");
assert.equal(tones.rows.find((row) => row.key === "fibreG")?.tone, "watch");
assert.equal(tones.rows.find((row) => row.key === "sodiumMg")?.word, "Low");
assert.equal(tones.rows.find((row) => row.key === "fibreG")?.word, "Low");

// An empty panel scores nothing rather than a suspicious 100.
assert.equal(scorePanel({}, "adult").rows.length, 0);

/* ------------------------------------------------- reading without a model */

// A whole panel, as OCR would hand it over after readingOrder().
const read = readPanel(
  [
    "Nutrition Facts",
    "Serving Size 1 pack (55 g)",
    "Energy 380 kcal",
    "Total Fat 14 g",
    "Saturated Fat 7 g",
    "Sodium 1,480 mg 62%",
    "Total Carbohydrate 52 g",
    "Dietary Fiber 2 g",
    "Total Sugars 6 g",
    "Protein 9 g",
  ].join("\n")
);
assert.equal(read.sodiumMg, 1480, "a comma and a trailing % must not confuse it");
assert.equal(read.satFatG, 7, "Saturated Fat, not Total Fat");
assert.equal(read.fibreG, 2);
assert.equal(read.addedSugarG, 6);
assert.equal(read.proteinG, 9);
assert.equal(read.energyKcal, 380);
assert.ok(read.serving?.includes("55 g"));
// The panel's own heading is not the product's name.
assert.equal(read.name, undefined);

// "Added sugars" is the honest figure and must win over "total sugars".
assert.equal(readPanel("Total Sugars 20 g\nAdded Sugars 3 g").addedSugarG, 3);

// Units that are not what we score in.
assert.equal(readPanel("Sodium 1.5 g").sodiumMg, 1500);
assert.equal(Math.round(readPanel("Energy 1590 kJ").energyKcal ?? 0), 380);
// Salt instead of sodium: 1 g of salt is about 400 mg of sodium.
assert.equal(readPanel("Salt 1.2 g").sodiumMg, 480);

// On a Filipino label "na" is an ordinary particle. It must never be read as
// the sodium abbreviation, or an ingredients line would set the figure.
assert.equal(readPanel("Walang asukal na idinagdag 0 g").sodiumMg, undefined);
// Nor should a fruit.
assert.equal(readPanel("Banana puree 25 g").sodiumMg, undefined);

// Nothing readable yields nothing, rather than a zero that would score well.
assert.ok(isEmpty(readPanel("")));
assert.ok(isEmpty(readPanel("blurry photo of a shelf")));
// A label naming a nutrient without a figure must not invent one.
assert.ok(isEmpty(readPanel("Sodium\nProtein")));

// The product name, when the first line really is one.
assert.equal(readPanel("Choco Malt Drink\nSodium 95 mg").name, "Choco Malt Drink");

console.log("nutrition: all checks passed");
