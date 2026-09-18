import { useEffect, useState, type JSX } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

/**
 * Matches `imageWidth` in the expo-splash-screen plugin config. The sprites are
 * 420x312, so this is exactly 1:1 on a 3x screen — pixel art goes to mush the
 * moment it is resampled by a fraction.
 */
const MARK = { width: 140, height: 104 };

/** Matches the splash `backgroundColor`, so the handoff has no seam. */
const GROUND = "#16181D";

const BODY = require("../../assets/images/mascot-body.png");
const SPARKS = require("../../assets/images/mascot-sparks.png");

/**
 * The opening.
 *
 * Android's splash is a static image that vanishes the instant the first frame
 * is ready, which lands as a jump cut. This draws the same mascot, at the same
 * size, on the same ground, in the same pose — so when the native splash goes
 * away nothing appears to change. Then he hops, the sparks fly off the pan, and
 * the whole thing dissolves into the app.
 *
 * ponytail: two sprites, not a frame-by-frame sheet. Body and sparks are cut
 * from the one drawing onto a shared canvas, so stacking them reproduces the
 * splash exactly at rest, and animating them apart costs two transforms.
 *
 * Nothing scales or rotates — only translation and opacity. A pixel mascot
 * scaled by 1.08 arrives blurred, which is the one way this illusion visibly
 * fails.
 */
export function Boot({ onDone }: { onDone: () => void }): JSX.Element | null {
  const [gone, setGone] = useState(false);
  const hop = useSharedValue(0);
  const spark = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    // The beat before the hop is the seam: it holds the splash pose long enough
    // that the handoff reads as one continuous image rather than a cut.
    hop.value = withDelay(
      100,
      withSequence(
        withTiming(-14, { duration: 250, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 240, easing: Easing.bounce })
      )
    );
    spark.value = withDelay(100, withTiming(1, { duration: 560, easing: Easing.out(Easing.quad) }));

    fade.value = withDelay(
      700,
      withTiming(0, { duration: 280, easing: Easing.out(Easing.quad) }, (finished) => {
        if (finished) runOnJS(setGone)(true);
      })
    );
  }, [hop, spark, fade]);

  // Told once the curtain is actually down, so nothing depends on a timer
  // agreeing with the animation.
  useEffect(() => {
    if (gone) onDone();
  }, [gone, onDone]);

  const curtain = useAnimatedStyle(() => ({ opacity: fade.value }));
  const bodyStyle = useAnimatedStyle(() => ({ transform: [{ translateY: hop.value }] }));
  const sparkStyle = useAnimatedStyle(() => ({
    opacity: 1 - spark.value,
    transform: [{ translateY: -22 * spark.value }],
  }));

  if (gone) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        curtain,
        {
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          zIndex: 100,
          backgroundColor: GROUND,
          alignItems: "center",
          justifyContent: "center",
        },
      ]}
    >
      <View style={MARK}>
        <Animated.Image source={BODY} style={[MARK, { position: "absolute" }, bodyStyle]} />
        <Animated.Image source={SPARKS} style={[MARK, { position: "absolute" }, sparkStyle]} />
      </View>
    </Animated.View>
  );
}
