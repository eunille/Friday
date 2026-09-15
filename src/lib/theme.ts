import { useEffect, useState } from "react";
import { Keyboard, useColorScheme } from "react-native";

/**
 * The handful of palette values React Navigation needs as raw JS.
 *
 * ponytail: yes, this duplicates six lines of global.css. Navigation chrome
 * (tab bar, status bar) is styled through props, not className, so it cannot
 * read the compiled CSS variables. Six values is cheaper than a native module
 * to read them back. If they drift, the tab bar is the only thing that looks
 * wrong — change both or neither.
 */
export const NAV_THEME = {
  light: {
    background: "#edf0f3",
    surface: "#ffffff",
    border: "#d5dce3",
    accent: "#8a5a00",
    accentForeground: "#ffffff",
    foreground: "#15202b",
    placeholder: "#7d8b99",
    muted: "#5d6e7e",
    success: "#1f7a5c",
    danger: "#b0261d",
  },
  dark: {
    background: "#0e1620",
    surface: "#16202c",
    border: "#243040",
    accent: "#ffc24d",
    accentForeground: "#101923",
    foreground: "#e7edf3",
    placeholder: "#75879a",
    muted: "#8b9bab",
    success: "#4ecfa4",
    danger: "#ff6b60",
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
 * Android draws this app edge to edge, and an edge-to-edge window is never
 * resized by the keyboard — which is why KeyboardAvoidingView silently did
 * nothing and the composer sat underneath the keys. Measuring the keyboard
 * ourselves and padding by it is the fix that needs no native change.
 *
 * `keyboardWillShow` is iOS-only; `keyboardDidShow` fires on both, so both
 * platforms take the same path here and there is only one behaviour to test.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", (event) =>
      setHeight(event.endCoordinates.height)
    );
    const hidden = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return height;
}
