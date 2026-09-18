import { useEffect, useState, type JSX } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

/** Same sprites and size as the opening, so the wait reads as the same app. */
const MARK = { width: 140, height: 104 };
const BODY = require("../../assets/images/mascot-body.png");
const SPARKS = require("../../assets/images/mascot-sparks.png");

/**
 * The mascot, still working.
 *
 * Only translation and opacity, for the same reason as the opening: scaling
 * pixel art by a fraction arrives blurred.
 */
export function MascotAtWork(): JSX.Element {
  const bob = useSharedValue(0);
  const spark = useSharedValue(0);

  useEffect(() => {
    bob.value = withRepeat(
      withTiming(-6, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    // Not reversed: a spark that flew up and then slid back down would read as
    // a yo-yo. Restarting from the pan is what looks like a new one.
    spark.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }),
      -1,
      false
    );
  }, [bob, spark]);

  const bodyStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));
  const sparkStyle = useAnimatedStyle(() => ({
    opacity: 1 - spark.value,
    transform: [{ translateY: -20 * spark.value }],
  }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[MARK, { alignSelf: "center" }]}
    >
      <Animated.Image source={BODY} style={[MARK, { position: "absolute" }, bodyStyle]} />
      <Animated.Image source={SPARKS} style={[MARK, { position: "absolute" }, sparkStyle]} />
    </View>
  );
}

/**
 * Kitchen words, because the alternative is a frozen "Loading" that gives no
 * sign the phone is still working. None of them claim a step is happening —
 * loading a model has no steps to report — they only say it is still going.
 */
const WORDS = [
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

function pick(except?: string): string {
  // Never the same word twice running: a label that "changes" to itself reads
  // as a hung screen, which is the one thing this is here to disprove.
  const others = WORDS.filter((word) => word !== except);
  return others[Math.floor(Math.random() * others.length)];
}

/** The rotating word. Caller styles it; this only owns which word is showing. */
export function useCookingWord(): string {
  const [word, setWord] = useState(() => pick());

  useEffect(() => {
    const id = setInterval(() => setWord((current) => pick(current)), EVERY);
    return () => clearInterval(id);
  }, []);

  return word;
}
