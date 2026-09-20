/**
 * The packs that ship with the app.
 *
 * "Paste a link to a pack file" is a correct instruction and a useless one:
 * nobody has a pack file, and there was nowhere to get one. A catalogue only
 * helps if the things in it exist, so these five are bundled rather than
 * hosted — they install with the radio off, which is the promise the rest of
 * the app makes anyway.
 *
 * They are small. All five together are about 17 KB of text, against the
 * 400 MB the model already costs, so shipping them all beats making anyone
 * choose which to download.
 *
 * `load` is a function so Metro keeps the JSON off the boot path and only
 * parses a pack when someone installs it. The literal path is what makes it
 * bundle at all, so it has to stay inline.
 */
export type Starter = {
  id: string;
  title: string;
  /** One line, in the reader's terms rather than the file's. */
  blurb: string;
  /** Ionicons name. */
  icon: string;
  load: () => unknown;
};

export const STARTERS: readonly Starter[] = [
  {
    id: "money-basics",
    title: "Money basics",
    blurb: "Budgets, emergency funds, and what compound interest does in both directions.",
    icon: "wallet-outline",
    load: () => require("../../assets/packs/money-basics.json"),
  },
  {
    id: "study-skills",
    title: "How to study",
    blurb: "Active recall, spaced repetition, and why highlighting does not work.",
    icon: "school-outline",
    load: () => require("../../assets/packs/study-skills.json"),
  },
  {
    id: "science-basics",
    title: "Science basics",
    blurb: "Cells, atoms, forces and the water cycle, a paragraph each.",
    icon: "flask-outline",
    load: () => require("../../assets/packs/science-basics.json"),
  },
  {
    id: "world-history",
    title: "World history",
    blurb: "Farming to the Cold War, including where the Philippines sits in it.",
    icon: "hourglass-outline",
    load: () => require("../../assets/packs/world-history.json"),
  },
  {
    id: "emergency-prep",
    title: "Emergency prep",
    blurb: "Typhoons, quakes, floods and safe water — what to do before and during.",
    icon: "warning-outline",
    load: () => require("../../assets/packs/emergency-prep.json"),
  },
];
