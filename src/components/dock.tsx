import { Ionicons } from "@expo/vector-icons";
// expo-router 57 vendors React Navigation instead of depending on it, so this
// type has no top-level package to come from. The path is stable enough: the
// same module `expo-router/build/layouts/Tabs` re-exports wholesale.
import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs";
import type { ComponentProps, JSX } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useKeyboardHeight, usePalette } from "../lib/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

/**
 * Declared here rather than read off the navigator, so the bar's order is a
 * property of the design and not of how the files happen to sort. A route not
 * named here simply never appears in the dock — which is how Search stays
 * reachable by URL without taking one of the five slots.
 */
const SLOTS: readonly {
  name: string;
  label: string;
  icon: IconName;
  raised?: true;
}[] = [
  { name: "home", label: "Home", icon: "home" },
  { name: "index", label: "Chat", icon: "chatbubble" },
  { name: "scan", label: "Scan", icon: "scan", raised: true },
  { name: "notes", label: "Notes", icon: "document-text" },
  { name: "library", label: "Tools", icon: "grid" },
];

/** How far the scan key stands above the dock. */
const RAISE = 26;
const KEY = 48;

/**
 * The dark dock, with the camera raised out of it.
 *
 * Two layers rather than one: the dark bar is an absolutely positioned sibling
 * *behind* a transparent row, so the scan key can stand above the bar without
 * relying on overflow, which Android clips inconsistently on a view that has a
 * background and a radius.
 */
export function Dock({ state, navigation }: BottomTabBarProps): JSX.Element | null {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();

  // A custom bar does not get `tabBarHideOnKeyboard`, so it hides itself, or it
  // sits between the keyboard and the field being typed into.
  if (keyboard > 0) return null;

  const barHeight = 58 + insets.bottom;

  return (
    <View style={{ height: RAISE + barHeight }}>
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: RAISE,
          bottom: 0,
          backgroundColor: palette.ink,
        }}
      />
      <View
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "space-around",
          paddingBottom: insets.bottom + 10,
          paddingHorizontal: 6,
        }}
      >
        {SLOTS.map((slot) => {
          const index = state.routes.findIndex((route) => route.name === slot.name);
          if (index === -1) return null;
          const focused = state.index === index;
          const tint = focused ? palette.warning : "rgba(255,255,255,0.55)";

          const go = (): void => {
            const route = state.routes[index];
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };

          return (
            <Pressable
              key={slot.name}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={slot.label}
              onPress={go}
              style={{ width: 62, alignItems: "center", gap: slot.raised ? 7 : 3 }}
            >
              {slot.raised ? (
                <View
                  style={{
                    width: KEY,
                    height: KEY,
                    borderRadius: 18,
                    marginTop: -RAISE,
                    backgroundColor: palette.accent,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name={slot.icon} size={24} color={palette.accentForeground} />
                </View>
              ) : (
                <Ionicons
                  name={focused ? slot.icon : (`${slot.icon}-outline` as IconName)}
                  size={22}
                  color={tint}
                />
              )}
              <Text
                style={{
                  fontFamily: focused ? "Archivo_600SemiBold" : "Archivo_500Medium",
                  fontSize: 9.5,
                  color: slot.raised ? "rgba(255,255,255,0.55)" : tint,
                }}
              >
                {slot.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
