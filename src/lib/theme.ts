import { useEffect, useState } from "react";
import { Keyboard, useColorScheme } from "react-native";

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
