import assert from "node:assert/strict";

import {
  addDays,
  celebrate,
  checkKey,
  dayScore,
  iconFor,
  isDue,
  perfectStreaks,
  rateBetween,
  streak,
  weekStart,
  type Habit,
} from "./habits.ts";

// Calendar days, not milliseconds: month and year edges roll over.
assert.equal(addDays("2026-10-31", 1), "2026-11-01");
assert.equal(addDays("2026-01-01", -1), "2025-12-31");
// 2026-10-12 is a Monday; the week starts there whichever day you ask from.
assert.equal(weekStart("2026-10-12"), "2026-10-12");
assert.equal(weekStart("2026-10-18"), "2026-10-12");

const daily: Habit = {
  id: "d",
  name: "Read",
  icon: "book",
  days: [0, 1, 2, 3, 4, 5, 6],
  start: "2026-10-12",
};
const mwf: Habit = { id: "m", name: "Gym", icon: "barbell", days: [1, 3, 5], start: "2026-10-12" };
const once: Habit = {
  id: "o",
  name: "Dentist",
  icon: "happy",
  days: [],
  once: "2026-10-14",
  start: "2026-10-12",
};

assert.ok(isDue(mwf, "2026-10-14")); // Wednesday
assert.ok(!isDue(mwf, "2026-10-13")); // Tuesday
assert.ok(!isDue(daily, "2026-10-11")); // before it existed
assert.ok(isDue(once, "2026-10-14") && !isDue(once, "2026-10-15"));

const checks = new Set([
  checkKey("2026-10-12", "d"),
  checkKey("2026-10-12", "m"),
  checkKey("2026-10-13", "d"),
  checkKey("2026-10-14", "d"),
]);
assert.deepEqual(dayScore([daily, mwf, once], checks, "2026-10-14"), { due: 3, done: 1 });
assert.equal(rateBetween([mwf], checks, "2026-10-12", "2026-10-14"), 0.5);
// Nothing planned is not 0%.
assert.equal(rateBetween([mwf], checks, "2026-10-13", "2026-10-13"), null);

// Today undone does not break a streak; a missed planned day does; a day it
// was never planned for is stepped over.
assert.equal(streak(daily, checks, "2026-10-15"), 3);
assert.equal(streak(daily, checks, "2026-10-16"), 0);
assert.equal(streak(mwf, checks, "2026-10-13"), 1);
assert.equal(streak(mwf, checks, "2026-10-15"), 0);

// Mon and Tue perfect, Wed missed the gym — the run is over by Thursday.
assert.deepEqual(perfectStreaks([daily, mwf], checks, 2026, "2026-10-14"), {
  current: 2,
  best: 2,
  perfect: 2,
});
assert.deepEqual(perfectStreaks([daily, mwf], checks, 2026, "2026-10-15"), {
  current: 0,
  best: 2,
  perfect: 2,
});
assert.deepEqual(perfectStreaks([], checks, 2026, "2026-10-15"), {
  current: 0,
  best: 0,
  perfect: 0,
});

// New year, new count: a run across Dec 31 starts again from zero on Jan 1,
// while last year's report still has it.
const nyRun = new Set(["2026-12-30", "2026-12-31", "2027-01-01"].map((day) => checkKey(day, "d")));
const longDaily = { ...daily, start: "2026-12-30" };
assert.equal(streak(longDaily, nyRun, "2027-01-01"), 1);
assert.equal(streak(longDaily, nyRun, "2026-12-31"), 2);
assert.deepEqual(perfectStreaks([longDaily], nyRun, 2027, "2027-01-01"), {
  current: 1,
  best: 1,
  perfect: 1,
});
assert.deepEqual(perfectStreaks([longDaily], nyRun, 2026, "2027-01-01"), {
  current: 2,
  best: 2,
  perfect: 2,
});

// The day is done, the week is not: Wed and Fri gym still to come.
assert.equal(celebrate([daily, mwf], checks, "2026-10-12"), "day");
assert.equal(celebrate([daily, mwf], checks, "2026-10-14"), null);

// A habit planned for one day a week, done on it, finishes the week.
const sundays: Habit = { id: "s", name: "Call mom", icon: "call", days: [0], start: "2026-10-12" };
assert.equal(celebrate([sundays], new Set([checkKey("2026-10-18", "s")]), "2026-10-18"), "week");
// Every Sunday left in October done finishes the month.
const october = new Set(["2026-10-18", "2026-10-25"].map((day) => checkKey(day, "s")));
assert.equal(celebrate([sundays], october, "2026-10-25"), "month");
// A one-off on New Year's Eve is the whole year for it.
const nye: Habit = {
  id: "n",
  name: "Plan",
  icon: "x",
  days: [],
  once: "2026-12-31",
  start: "2026-12-01",
};
assert.equal(celebrate([nye], new Set([checkKey("2026-12-31", "n")]), "2026-12-31"), "year");

assert.equal(iconFor("Morning run"), "walk");
assert.equal(iconFor("Water the plants"), "flower");
assert.equal(iconFor("Drink 8 glasses of water"), "water");
assert.equal(iconFor("Bake bread"), "checkmark-done");
assert.equal(iconFor("Read 10 pages"), "book");

console.log("habits: all checks passed");
