import { useEffect, useState, type JSX } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

/** Columns of `intro-sheet.png`; the other twelve-frame axis is two rows. */
const COLS = 6;
/** On screen. A 256x290 source cell, kept in proportion. */
const FRAME = { width: 168, height: 190 };

/** Matches the splash `backgroundColor`, and the sheet's own flattened field. */
const GROUND = "#16181D";
const INK = "#F2F3F5";

const SHEET = require("../../assets/images/sprites/intro-sheet.png");

const NAME = "Offline AI";

/**
 * The shot list: `[until ms, frame]`, read top to bottom, first match wins.
 *
 * 0-4 are the wingbeat, played twice; 5 is the hover with the thrusters lit;
 * 6 is the landing squash; 7 the shake; 8 standing; 9 the wink; 10 opens the
 * eyes; 11 is the sparkle burst, which is where it stays.
 */
const SHOTS: readonly (readonly [number, number])[] = [
  [70, 0],
  [140, 1],
  [210, 2],
  [280, 3],
  [350, 4],
  [420, 1],
  [490, 2],
  [560, 3],
  [630, 4],
  [790, 5],
  [870, 6],
  [940, 7],
  [1080, 8],
  [1220, 9],
  [1320, 10],
];
const BURST = 11;

/** Beats, in ms from mount, so the sequence can be read in one place. */
const RUN = 1500; // the clock the sprite and the flight path both read
const WORD = 980; // first letter, once he is on his feet
const STAGGER = 32; // between letters
const LEAVE = 1700;

/**
 * One letter of the wordmark.
 *
 * A component rather than a loop over shared values, because each letter needs
 * its own animation and hooks cannot be called in a loop.
 */
function Letter({ char, delay }: { char: string; delay: number }): JSX.Element {
  const show = useSharedValue(0);

  useEffect(() => {
    show.value = withDelay(
      delay,
      withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) })
    );
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
 * He flies in from the lower left, climbing and closing on the camera, holds a
 * beat on the thrusters, drops onto his feet, shakes it off, winks, and the
 * name resolves underneath while the sparks go up.
 *
 * ponytail: one sheet and one clock. Every frame lives in `intro-sheet.png`, so
 * there is a single decode and no first-run stutter, and the flight path reads
 * the same linear clock the frames do — the pose and the position cannot drift
 * apart, because there is nothing for them to drift against.
 *
 * The sheet's own dark field was flattened onto GROUND when it was cut, so the
 * frame rectangle has no edge against this screen and nothing needs keying.
 *
 * Scaling does soften pixel art, which is why the old opening refused to do it.
 * The zoom is asked for here and carries the approach, so it wins; the sprite
 * rests at scale 1 where it matters, and 1 is a clean 168dp against a 256px
 * cell.
 *
 * The native splash is still the old mark, so the handoff is a cut rather than
 * the seam this screen used to hold. Swapping `splash-icon.png` for the landed
 * pose closes it, and needs a native rebuild.
 */
export function Boot({ onDone }: { onDone: () => void }): JSX.Element | null {
  const [gone, setGone] = useState(false);
  const clock = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    // Linear, because the shot list is written in milliseconds: easing the
    // clock would silently restagger every frame.
    clock.value = withTiming(RUN, { duration: RUN, easing: Easing.linear });

    fade.value = withDelay(
      LEAVE,
      withTiming(0, { duration: 280, easing: Easing.out(Easing.quad) }, (finished) => {
        if (finished) runOnJS(setGone)(true);
      })
    );
  }, [clock, fade]);

  // Told once the curtain is actually down, so nothing depends on a timer
  // agreeing with the animation.
  useEffect(() => {
    if (gone) onDone();
  }, [gone, onDone]);

  const curtain = useAnimatedStyle(() => ({ opacity: fade.value }));

  const flight = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(clock.value, [0, 630], [-140, 0], Extrapolation.CLAMP),
      },
      {
        // Up first, forward across the climb, then down onto the spot.
        translateY: interpolate(
          clock.value,
          [0, 350, 630, 700, 790],
          [150, -20, -40, -30, 0],
          Extrapolation.CLAMP
        ),
      },
      {
        // Far, then close, settling at 1 — and a pop when the sparks go.
        scale: interpolate(
          clock.value,
          [0, 350, 630, 790, 1320, 1400, 1500],
          [0.5, 0.92, 1.07, 1, 1, 1.12, 1],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  const sheet = useAnimatedStyle(() => {
    let index = BURST;
    for (let i = 0; i < SHOTS.length; i += 1) {
      if (clock.value < SHOTS[i][0]) {
        index = SHOTS[i][1];
        break;
      }
    }
    return {
      transform: [
        { translateX: -(index % COLS) * FRAME.width },
        { translateY: -Math.floor(index / COLS) * FRAME.height },
      ],
    };
  });

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
      <Animated.View style={[FRAME, flight]}>
        {/* The window. The sheet is six frames wide and slides behind it. */}
        <View style={[FRAME, { overflow: "hidden" }]}>
          <Animated.Image
            source={SHEET}
            style={[{ width: FRAME.width * COLS, height: FRAME.height * 2 }, sheet]}
          />
        </View>
      </Animated.View>

      {/* Absolutely positioned rather than stacked in the column: in a centred
          column its height would push the sprite off the middle of the screen,
          and the flight path is aimed at the middle. */}
      <View
        style={{
          position: "absolute",
          top: "50%",
          marginTop: FRAME.height / 2 + 10,
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
  );
}
