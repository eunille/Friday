import { useCallback, useEffect, useState } from "react";
import { Keyboard, useColorScheme, type LayoutChangeEvent } from "react-native";
import {
  KeyboardState,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedReaction,
} from "react-native-reanimated";

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
    background: "#fff6ef",
    surface: "#ffffff",
    border: "#f0e2d7",
    accent: "#f2621b",
    accentForeground: "#ffffff",
    accentSoft: "#ffede1",
    accentDeep: "#c7440a",
    onDevice: "#0b7f6c",
    onDeviceSoft: "#ddf5f0",
    ink: "#241812",
    inkForeground: "#ffffff",
    foreground: "#241812",
    placeholder: "#b39f91",
    muted: "#8a7466",
    mutedSoft: "#b39f91",
    success: "#0e8c63",
    warning: "#b47100",
    warningSoft: "#fff3dc",
    danger: "#c13a1e",
    pressOffset: "#efdfd2",
  },
  dark: {
    background: "#1a100b",
    surface: "#241812",
    border: "#3a2920",
    accent: "#ff7a3d",
    accentForeground: "#1a100b",
    accentSoft: "#3a2018",
    accentDeep: "#ff9c6b",
    onDevice: "#3ed6b5",
    onDeviceSoft: "#12352e",
    ink: "#0f0906",
    inkForeground: "#ffffff",
    foreground: "#f7ede5",
    placeholder: "#8a7466",
    muted: "#b39f91",
    mutedSoft: "#8a7466",
    success: "#3ed6b5",
    warning: "#ffb020",
    warningSoft: "#3a2a10",
    danger: "#ff6b57",
    pressOffset: "#0f0906",
  },
} as const;

/** Widened off the literals so light and dark are the same type. */
export type NavTheme = Record<keyof (typeof NAV_THEME)["light"], string>;

/** For the few props that take a colour value instead of a className. */
export function usePalette(): NavTheme {
  return NAV_THEME[useColorScheme() === "dark" ? "dark" : "light"];
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
