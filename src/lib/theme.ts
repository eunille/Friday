import { useCallback, useEffect, useState } from "react";
import { Keyboard, type LayoutChangeEvent } from "react-native";
import {
  KeyboardState,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedReaction,
} from "react-native-reanimated";
import { useUniwind } from "uniwind";

/**
 * The handful of palette values React Navigation needs as raw JS.
 *
 * ponytail: yes, this duplicates part of global.css. Navigation chrome (tab
 * bar, status bar) and a few RN props (shadowColor, placeholderTextColor) are
 * styled through props, not className, so they cannot read the compiled CSS
 * variables. Mirroring the values is cheaper than a native module to read them
 * back. If they drift, the chrome is the only thing that looks wrong — change
 * both or neither.
 */
export const NAV_THEME = {
  light: {
    background: "#f4f5f7",
    surface: "#ffffff",
    border: "#e6e8ec",
    accent: "#23262e",
    accentForeground: "#ffffff",
    accentSoft: "#eceef1",
    accentDeep: "#000000",
    onDevice: "#0f8f6a",
    onDeviceSoft: "#e4f4ee",
    ink: "#16181d",
    inkForeground: "#ffffff",
    foreground: "#171a20",
    placeholder: "#9ca3af",
    muted: "#6b7280",
    mutedSoft: "#9ca3af",
    success: "#0f8f6a",
    warning: "#a9761b",
    warningSoft: "#fbf4e6",
    danger: "#c4372b",
    pressOffset: "#e4e7ec",
    // One hue per destination inside Money — see the colour note in global.css.
    money: "#2f6bf6",
    moneyForeground: "#ffffff",
    wallets: "#6d4df6",
    ask: "#dd5f34",
    plan: "#0d8fa6",
  },
  dark: {
    background: "#0b0c0e",
    surface: "#16181d",
    border: "#262a31",
    accent: "#f2f3f5",
    accentForeground: "#0b0c0e",
    accentSoft: "#21242a",
    accentDeep: "#ffffff",
    onDevice: "#3ddc97",
    onDeviceSoft: "#10302a",
    ink: "#000000",
    inkForeground: "#ffffff",
    foreground: "#f2f3f5",
    placeholder: "#6b7280",
    muted: "#9ca3af",
    mutedSoft: "#6b7280",
    success: "#3ddc97",
    warning: "#e8b339",
    warningSoft: "#2a2412",
    danger: "#ff6b5e",
    pressOffset: "#262a31",
    money: "#3d6fe8",
    moneyForeground: "#ffffff",
    wallets: "#9b85ff",
    ask: "#ff8f66",
    plan: "#3fc9de",
  },
} as const;

/**
 * Drawn *on* the ink dock and status card, which are near-black in both
 * schemes. --accent inverts between schemes and would disappear against it, so
 * anything sitting on ink takes a fixed value from here instead.
 */
export const ON_INK = {
  bright: "#ffffff",
  dim: "rgba(255,255,255,0.52)",
  faint: "rgba(255,255,255,0.10)",
  ready: "#3ddc97",
  working: "#e8b339",
  error: "#ff6b5e",
} as const;

/** Widened off the literals so light and dark are the same type. */
export type NavTheme = Record<keyof (typeof NAV_THEME)["light"], string>;

/**
 * For the few props that take a colour value instead of a className.
 *
 * Reads uniwind's active theme rather than the system one, so the in-app
 * appearance choice moves the compiled CSS and these raw values together. Two
 * sources here would mean a light screen with a dark tab bar.
 */
export function usePalette(): NavTheme {
  return NAV_THEME[useScheme()];
}

/** Which of the two schemes is actually showing, after the in-app choice. */
export function useScheme(): "light" | "dark" {
  const { theme } = useUniwind();
  return theme === "dark" ? "dark" : "light";
}

/**
 * Height of the on-screen keyboard, or 0 when it is closed.
 *
 * Asks twice, because neither source is reliable on its own.
 *
 * React Native's own `Keyboard` events are the obvious answer and work fine on
 * iOS, but under Expo's edge-to-edge Android mode they can stay silent: the
 * system delivers the keyboard as a window inset rather than through the
 * legacy path those events listen to. When that happens every consumer here
 * reads zero — the composer never lifts and the dock never gets out of the
 * way, which is exactly the bug this kept producing.
 *
 * Reanimated reads that inset natively, so it fills the gap. Taking the larger
 * of the two means whichever one the platform actually feeds is the one that
 * decides, and there is no per-version guesswork to get wrong.
 *
 * ponytail: `useAnimatedKeyboard` is deprecated in favour of
 * react-native-keyboard-controller, which is a native module and therefore a
 * rebuild. Swap to it if this ever stops working; the signature here does not
 * change.
 */
export function useKeyboardHeight(): number {
  const [fromEvents, setFromEvents] = useState(0);
  const [fromInsets, setFromInsets] = useState(0);

  useEffect(() => {
    // `keyboardWillShow` is iOS-only; `keyboardDidShow` fires on both.
    const shown = Keyboard.addListener("keyboardDidShow", (event) =>
      setFromEvents(event.endCoordinates.height)
    );
    const hidden = Keyboard.addListener("keyboardDidHide", () => setFromEvents(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const keyboard = useAnimatedKeyboard();
  useAnimatedReaction(
    () => ({ height: keyboard.height.value, state: keyboard.state.value }),
    (current, previous) => {
      // Only at rest: reacting to every frame would cross to the JS thread
      // sixty times a second to move the composer somewhere it is about to
      // leave anyway.
      if (previous !== null && current.state === previous.state) return;
      if (current.state === KeyboardState.OPEN) runOnJS(setFromInsets)(current.height);
      if (current.state === KeyboardState.CLOSED) runOnJS(setFromInsets)(0);
    }
  );

  return Math.max(fromEvents, fromInsets);
}

/**
 * How much of the keyboard actually covers the screen, after whatever the
 * system already did about it.
 *
 * Android is asked to resize the window for the keyboard, but under edge to
 * edge it only sometimes obliges, and which way it goes varies by version. Add
 * the keyboard height when the window did resize and the composer flies up by
 * twice what it should; omit it when the window did not and the keyboard sits
 * over the field you are typing into. Guessing wrong is how this bug keeps
 * coming back.
 *
 * So it is measured instead. Remember the tallest this view has ever been with
 * the keyboard down; whatever it has given up since is the part the system
 * handled, and only the remainder needs compensating. Correct under either
 * behaviour, and self-correcting after a rotation.
 *
 * Attach `onLayout` to the screen's root view and apply `overlap` as the
 * bottom margin of whatever must stay above the keyboard.
 */
export function useKeyboardOverlap(): {
  overlap: number;
  onLayout: (event: LayoutChangeEvent) => void;
} {
  const keyboard = useKeyboardHeight();
  // Both measurements in one piece of state, updated from the layout event
  // itself. Nothing here belongs in an effect: this is React reacting to a
  // platform event, not synchronising with an external system.
  const [box, setBox] = useState({ width: 0, height: 0, tallest: 0 });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBox((previous) =>
      // A rotation changes the width and invalidates the old baseline; short of
      // that, the tallest the view has ever been is the keyboard-down height.
      // Only ever growing it avoids a race: the window can resize before
      // keyboardDidShow reports, and a guard on the keyboard height would then
      // record the shrunken view as the baseline.
      previous.width === width
        ? { width, height, tallest: Math.max(previous.tallest, height) }
        : { width, height, tallest: height }
    );
  }, []);

  const reclaimed = box.tallest > 0 ? Math.max(0, box.tallest - box.height) : 0;
  return { overlap: Math.max(0, keyboard - reclaimed), onLayout };
}
