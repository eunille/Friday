import { useEffect, useState, type JSX } from "react";
import { Image, View } from "react-native";

/**
 * One cell of a loop sheet, on screen. The sheets are cut at 240x268 so this is
 * a 1.5x upscale on a 3x phone rather than a 3x one.
 */
const CELL = { width: 120, height: 134 };

const COOK = require("../../assets/images/sprites/cook-sheet.png");
const WORK = require("../../assets/images/sprites/work-sheet.png");

/**
 * A strip of frames, played on a timer.
 *
 * ponytail: JS state and setInterval, not a reanimated worklet. The opening
 * needs the UI thread because JS is busy booting at that moment; this plays
 * while the phone is reading a model off disk or pulling one down, when a
 * timer every few hundred milliseconds costs nothing.
 */
function Loop({ sheet, frames, every }: { sheet: number; frames: number; every: number }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((current) => (current + 1) % frames), every);
    return () => clearInterval(id);
  }, [frames, every]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[CELL, { alignSelf: "center", overflow: "hidden" }]}
    >
      <Image
        source={sheet}
        style={{
          width: CELL.width * frames,
          height: CELL.height,
          transform: [{ translateX: -index * CELL.width }],
        }}
      />
    </View>
  );
}

/**
 * The mascot cooking, for the warm start.
 *
 * Five frames that tell one small story — pan, tilt, egg up, catch, plated —
 * so the screen is visibly doing something even though loading a model off
 * disk reports no progress at all. Slow enough that the egg reads.
 */
export function MascotCooking(): JSX.Element {
  return <Loop sheet={COOK} frames={5} every={380} />;
}

/**
 * The mascot at the laptop, concentrating.
 *
 * Two frames, fast, because typing is the motion. For the waits that report
 * their own progress — a download with a bar, a scan with a picture of the
 * label — so this only has to say the phone is still awake.
 */
export function MascotFocused(): JSX.Element {
  return <Loop sheet={WORK} frames={2} every={260} />;
}

/**
 * Kitchen words, because the alternative is a frozen "Loading" that gives no
 * sign the phone is still working. None of them claim a step is happening —
 * loading a model has no steps to report — they only say it is still going.
 */
const COOKING = [
  "Preheating",
  "Chopping",
  "Simmering",
  "Whisking",
  "Seasoning",
  "Reducing",
  "Folding",
  "Kneading",
  "Tasting",
  "Plating",
] as const;

const EVERY = 1400;

/**
 * Squinting at a label, for the scan. Same trick, different room — a panel
 * being read is not a kitchen, and "Simmering" over a photo of a sachet reads
 * as the wrong screen.
 */
const SCANNING = [
  "Focusing",
  "Squinting",
  "Tracing the letters",
  "Lining up the columns",
  "Checking the units",
  "Reading the small print",
  "Finding the serving",
  "Doing the sums",
] as const;

function pick(words: readonly string[], except?: string): string {
  // Never the same word twice running: a label that "changes" to itself reads
  // as a hung screen, which is the one thing this is here to disprove.
  const others = words.filter((word) => word !== except);
  return others[Math.floor(Math.random() * others.length)];
}

function useRotatingWord(words: readonly string[]): string {
  const [word, setWord] = useState(() => pick(words));

  useEffect(() => {
    const id = setInterval(() => setWord((current) => pick(words, current)), EVERY);
    return () => clearInterval(id);
  }, [words]);

  return word;
}

/** The rotating word. Caller styles it; this only owns which word is showing. */
export function useCookingWord(): string {
  return useRotatingWord(COOKING);
}

/** The same, for a label being read. */
export function useScanningWord(): string {
  return useRotatingWord(SCANNING);
}
