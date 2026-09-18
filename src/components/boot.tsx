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
const INK = "#F2F3F5";

const BODY = require("../../assets/images/mascot-body.png");
const SPARKS = require("../../assets/images/mascot-sparks.png");

const NAME = "Offline AI";

/** Beats, in ms from mount, so the sequence can be read in one place. */
const HOLD = 90; // the seam: long enough that the handoff reads as one image
const LIFT = 460; // mascot rises to make room
const WORD = 500; // first letter
const STAGGER = 38; // between letters
const LEAVE = 1150;

/**
 * One letter of the wordmark.
 *
 * A component rather than a loop over shared values, because each letter needs
 * its own animation and hooks cannot be called in a loop.
 */
function Letter({ char, delay }: { char: string; delay: number }): JSX.Element {
  const show = useSharedValue(0);

  useEffect(() => {
    show.value = withDelay(delay, withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) }));
  }, [show, delay]);

  const style = useAnimatedStyle(() => ({
    opacity: show.value,
    transform: [{ translateY: 6 * (1 - show.value) }],
  }));

  // A space has no glyph to fade, so it is a fixed gap instead — animating it
  // would stagger a blank and put a visible hitch in the middle of the word.
  if (char === " ") return <View style={{ width: 7 }} />;

  return (
    <Animated.Text
      style={[
        style,
        { color: INK, fontFamily: "Archivo_600SemiBold", fontSize: 19, letterSpacing: 1.5 },
      ]}
    >
      {char}
    </Animated.Text>
  );
}

/**
 * The opening.
 *
 * Android's splash is a static image that vanishes the instant the first frame
 * is ready, which lands as a jump cut. This draws the same mascot, at the same
 * size, on the same ground, in the same pose — so when the native splash goes
 * away nothing appears to change. Then he hops, the sparks fly off the pan, he
 * lifts, and the name resolves letter by letter underneath.
 *
 * ponytail: two sprites, not a frame-by-frame sheet. Body and sparks are cut
 * from the one drawing onto a shared canvas, so stacking them reproduces the
 * splash exactly at rest, and animating them apart costs two transforms.
 *
 * Nothing scales or rotates — only translation and opacity. A pixel mascot
 * scaled by 1.08 arrives blurred, which is the one way this illusion visibly
 * fails.
 *
 * The wordmark is absolutely positioned rather than stacked in the column. In a
 * centred column its height would push the mascot up at mount, off the spot the
 * native splash left him on, breaking the seam before anything had moved.
 */
export function Boot({ onDone }: { onDone: () => void }): JSX.Element | null {
  const [gone, setGone] = useState(false);
  const hop = useSharedValue(0);
  const spark = useSharedValue(0);
  const lift = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    hop.value = withDelay(
      HOLD,
      withSequence(
        withTiming(-14, { duration: 240, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 210, easing: Easing.bounce })
      )
    );
    spark.value = withDelay(HOLD, withTiming(1, { duration: 550, easing: Easing.out(Easing.quad) }));
    lift.value = withDelay(
      LIFT,
      withTiming(-18, { duration: 280, easing: Easing.out(Easing.cubic) })
    );

    fade.value = withDelay(
      LEAVE,
      withTiming(0, { duration: 280, easing: Easing.out(Easing.quad) }, (finished) => {
        if (finished) runOnJS(setGone)(true);
      })
    );
  }, [hop, spark, lift, fade]);

  // Told once the curtain is actually down, so nothing depends on a timer
  // agreeing with the animation.
  useEffect(() => {
    if (gone) onDone();
  }, [gone, onDone]);

  const curtain = useAnimatedStyle(() => ({ opacity: fade.value }));
  const stage = useAnimatedStyle(() => ({ transform: [{ translateY: lift.value }] }));
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
      <Animated.View style={[MARK, stage]}>
        <Animated.Image source={BODY} style={[MARK, { position: "absolute" }, bodyStyle]} />
        <Animated.Image source={SPARKS} style={[MARK, { position: "absolute" }, sparkStyle]} />

        <View
          style={{
            position: "absolute",
            top: MARK.height + 14,
            left: 0,
            right: 0,
            flexDirection: "row",
            justifyContent: "center",
          }}
        >
          {NAME.split("").map((char, index) => (
            <Letter key={index} char={char} delay={WORD + index * STAGGER} />
          ))}
        </View>
      </Animated.View>
    </Animated.View>
  );
}
