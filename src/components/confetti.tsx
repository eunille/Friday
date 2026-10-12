import { useEffect, useState, type JSX } from "react";
import { AccessibilityInfo, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import type { Scope } from "../lib/habits";
import { ON_INK, usePalette, type NavTheme } from "../lib/theme";
import { Mascot } from "./screen";

/**
 * A celebration that grows with what was finished.
 *
 *   day    a pop      one burst behind the banner, greens only
 *   week   cannons    two streams from the bottom corners
 *   month  rain       a slow fall across the whole screen, every hue
 *   year   fireworks  bursts of stars going off one after another
 *
 * No dependency: each bit is an Animated.View driven by one shared clock, its
 * path worked out on the UI thread with linear air drag — fast off the mark,
 * then floating down, which is what makes paper read as paper. It does not
 * block touches; the screen stays usable underneath.
 */

type Shape = "rect" | "ribbon" | "dot" | "star";

type Bit = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  sway: number;
  phase: number;
  spin: number;
  flip: number;
  size: number;
  color: string;
  shape: Shape;
  /** Seconds after the start before it appears, and how long it lives then. */
  delay: number;
  life: number;
};

const LOOK: Record<Scope, { seconds: number; title: string; note: string }> = {
  day: { seconds: 1.9, title: "Day done!", note: "Everything planned for the day is ticked." },
  week: { seconds: 2.8, title: "Perfect week!", note: "Every planned day this week, done." },
  month: { seconds: 3.8, title: "Month complete!", note: "Not one planned day missed." },
  year: { seconds: 4.4, title: "A perfect year!", note: "Every single one. Remarkable." },
};

const rand = (min: number, max: number): number => min + Math.random() * (max - min);
const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;

function bit(over: Partial<Bit> & Pick<Bit, "x" | "y" | "vx" | "vy" | "color">): Bit {
  return {
    gravity: 700,
    drag: 2,
    sway: 0,
    phase: rand(0, Math.PI * 2),
    spin: rand(-540, 540),
    flip: rand(4, 12),
    size: rand(6, 10),
    shape: "rect",
    delay: 0,
    life: 1.6,
    ...over,
  };
}

/** Every bit for one celebration, placed for this screen size. */
function launch(scope: Scope, w: number, h: number, palette: NavTheme): Bit[] {
  const bits: Bit[] = [];
  const all = [
    palette.onDevice,
    palette.plan,
    palette.wallets,
    palette.money,
    palette.ask,
    palette.warning,
  ];

  if (scope === "day") {
    const greens = [palette.onDevice, palette.success, palette.plan];
    for (let i = 0; i < 44; i += 1) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(280, 720);
      bits.push(
        bit({
          x: w / 2,
          y: h * 0.2 + 40,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 120,
          color: pick(greens),
          shape: pick(["rect", "dot"] as const),
          life: rand(1.2, 1.8),
        })
      );
    }
  }

  if (scope === "week") {
    const hues = [palette.onDevice, palette.plan, palette.wallets, palette.money];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 42; i += 1) {
        // Up and inward: 50–80° off the floor, mirrored for the right corner.
        const angle = (rand(50, 80) * Math.PI) / 180;
        const speed = rand(950, 1550);
        bits.push(
          bit({
            x: side < 0 ? 0 : w,
            y: h * 0.9,
            vx: -side * Math.cos(angle) * speed,
            vy: -Math.sin(angle) * speed,
            gravity: 900,
            drag: 1.7,
            color: pick(hues),
            shape: pick(["ribbon", "rect", "ribbon"] as const),
            delay: rand(0, 0.25),
            life: rand(2.1, 2.5),
          })
        );
      }
    }
  }

  if (scope === "month") {
    for (let i = 0; i < 120; i += 1) {
      const delay = rand(0, 1.8);
      bits.push(
        bit({
          x: rand(0, w),
          y: rand(-60, -10),
          vx: rand(-30, 30),
          vy: rand(80, 180),
          gravity: 140,
          drag: 0.6,
          sway: rand(12, 34),
          color: pick(all),
          shape: pick(["rect", "ribbon", "dot"] as const),
          delay,
          life: LOOK.month.seconds - delay,
        })
      );
    }
  }

  if (scope === "year") {
    for (let burst = 0; burst < 5; burst += 1) {
      const cx = rand(w * 0.2, w * 0.8);
      const cy = rand(h * 0.15, h * 0.5);
      const hue = pick(all);
      const count = 36;
      for (let i = 0; i < count; i += 1) {
        // An even ring, barely jittered, is what makes a burst read as a
        // firework rather than a spill.
        const angle = (i / count) * Math.PI * 2 + rand(-0.05, 0.05);
        const speed = rand(360, 440);
        bits.push(
          bit({
            x: cx,
            y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            gravity: 240,
            drag: 2.4,
            spin: rand(-180, 180),
            flip: 0,
            color: i % 3 === 0 ? palette.warning : hue,
            shape: i % 3 === 0 ? "star" : "dot",
            size: i % 3 === 0 ? 13 : rand(5, 7),
            delay: burst * 0.5,
            life: 1.9,
          })
        );
      }
    }
  }

  return bits;
}

function Piece({ bit: b, clock }: { bit: Bit; clock: SharedValue<number> }): JSX.Element {
  const style = useAnimatedStyle(() => {
    const t = clock.value - b.delay;
    if (t <= 0 || t >= b.life) return { opacity: 0 };
    // Linear drag: v(t) = v0·e^(−kt). The integral of that is the reach below,
    // and gravity's share is what is left of t after the drag has had its say.
    const reach = (1 - Math.exp(-b.drag * t)) / b.drag;
    const x = b.x + b.vx * reach + b.sway * Math.sin(t * 4 + b.phase);
    const y = b.y + b.vy * reach + (b.gravity / b.drag) * (t - reach);
    return {
      opacity: Math.min(1, (b.life - t) / 0.45),
      transform: [
        { translateX: x },
        { translateY: y },
        { rotate: `${b.spin * t}deg` },
        // Tumbling, edge-on and back. Skipped for stars, which spin flat.
        { scaleY: b.flip === 0 ? 1 : Math.cos(b.flip * t + b.phase) },
      ],
    };
  });

  if (b.shape === "star") {
    return (
      <Animated.View style={[styles.bit, style]}>
        <Text style={{ color: b.color, fontSize: b.size, lineHeight: b.size + 2 }}>★</Text>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.bit,
        {
          width: b.shape === "ribbon" ? b.size * 0.45 : b.size,
          height: b.shape === "ribbon" ? b.size * 1.9 : b.shape === "dot" ? b.size : b.size * 0.6,
          borderRadius: b.shape === "dot" ? b.size : 1.5,
          backgroundColor: b.color,
        },
        style,
      ]}
    />
  );
}

export function Confetti({ scope, onDone }: { scope: Scope; onDone: () => void }): JSX.Element {
  const palette = usePalette();
  const { width, height } = useWindowDimensions();
  const look = LOOK[scope];
  // Rolled once. Re-rolling on a re-render would teleport every bit mid-flight.
  const [bits] = useState(() => launch(scope, width, height, palette));
  const clock = useSharedValue(0);
  const shown = useSharedValue(0);

  useEffect(() => {
    clock.value = withTiming(look.seconds, {
      duration: look.seconds * 1000,
      easing: Easing.linear,
    });
    shown.value = withSequence(
      withSpring(1, { damping: 12, stiffness: 180 }),
      withDelay(look.seconds * 1000 - 900, withTiming(0, { duration: 350 }))
    );
    AccessibilityInfo.announceForAccessibility(look.title);
    const timer = setTimeout(onDone, look.seconds * 1000 + 150);
    return () => clearTimeout(timer);
  }, [clock, shown, look, onDone]);

  const banner = useAnimatedStyle(() => ({
    opacity: Math.min(1, shown.value),
    transform: [{ scale: 0.7 + 0.3 * shown.value }],
  }));

  // The banner grows with the occasion too: plain card for a day, the
  // on-device green for a week, the money blue for a month, ink and gold for a
  // year.
  const face = {
    day: { bg: palette.surface, ink: palette.foreground, sub: palette.muted },
    week: { bg: palette.onDevice, ink: "#ffffff", sub: "rgba(255,255,255,0.8)" },
    month: { bg: palette.money, ink: palette.moneyForeground, sub: "rgba(255,255,255,0.8)" },
    year: { bg: palette.ink, ink: palette.warning, sub: ON_INK.dim },
  }[scope];

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          {
            position: "absolute",
            top: height * 0.2 - 30,
            alignSelf: "center",
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingVertical: 12,
            paddingLeft: 10,
            paddingRight: 18,
            borderRadius: 22,
            backgroundColor: face.bg,
            borderWidth: scope === "day" ? 1 : 0,
            borderColor: palette.border,
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 10,
          },
          banner,
        ]}
      >
        <Mascot pose="hero" size={46} />
        <View>
          <Text style={{ color: face.ink, fontFamily: "Archivo_600SemiBold", fontSize: 19 }}>
            {look.title}
          </Text>
          <Text style={{ color: face.sub, fontFamily: "Archivo_400Regular", fontSize: 12 }}>
            {look.note}
          </Text>
        </View>
      </Animated.View>
      {bits.map((item, index) => (
        <Piece key={index} bit={item} clock={clock} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bit: { position: "absolute", left: 0, top: 0 },
});
