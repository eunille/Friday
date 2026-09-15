import { useColorScheme } from "react-native";

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
  },
} as const;

/** Widened off the literals so light and dark are the same type. */
export type NavTheme = Record<keyof (typeof NAV_THEME)["light"], string>;

/** For the few props that take a colour value instead of a className. */
export function usePalette(): NavTheme {
  return NAV_THEME[useColorScheme() === "dark" ? "dark" : "light"];
}
