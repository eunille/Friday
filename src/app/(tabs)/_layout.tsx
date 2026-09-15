import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { JSX } from "react";
import { useColorScheme } from "react-native";

import { NAV_THEME } from "../../lib/theme";

/**
 * Each tab names one glyph and takes the filled form when selected. Swapping
 * the weight reads faster than a colour change alone, which is how both
 * platforms' own tab bars behave.
 */
const TABS = [
  { name: "index", title: "Ask", icon: "chatbubble" },
  { name: "notes", title: "Notes", icon: "document-text" },
  { name: "search", title: "Search", icon: "search" },
  { name: "library", title: "Library", icon: "albums" },
] as const;

export default function TabsLayout(): JSX.Element {
  const palette = NAV_THEME[useColorScheme() === "dark" ? "dark" : "light"];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.muted,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          borderTopWidth: 1,
          // Default RN elevation paints a grey smear over the hairline; the
          // border alone is the separation.
          elevation: 0,
          height: 62,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontFamily: "Archivo_500Medium",
          fontSize: 11,
          letterSpacing: 0.2,
          marginTop: 2,
        },
      }}
    >
      {TABS.map(({ name, title, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? icon : `${icon}-outline`} size={23} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
