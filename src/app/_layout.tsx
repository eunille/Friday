import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
} from "@expo-google-fonts/archivo";
import {
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_600SemiBold,
} from "@expo-google-fonts/newsreader";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native";
import { useEffect, useState, type JSX } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useColorScheme } from "react-native";
import { ScopedTheme } from "uniwind";

import { Boot } from "../components/boot";
import { AIProvider, useAI } from "../lib/ai";
import { NAV_THEME } from "../lib/theme";
import "../global.css";

// Holding the splash avoids the layout jump you get when metrics-different
// system faces are swapped for Archivo and Newsreader a frame later.
void SplashScreen.preventAutoHideAsync();

/**
 * Everything below the theme choice.
 *
 * Inside AIProvider because the preference is stored with the rest of the
 * settings. ScopedTheme is what makes the choice real: it overrides the theme
 * uniwind would otherwise take from the system, and `usePalette` reads back
 * from the same place, so compiled CSS and raw colour props never disagree.
 *
 * The scene background is painted here too. Without it the navigator's own
 * white shows through the gap the dock leaves for its raised key.
 */
function Themed(): JSX.Element {
  const { appearance } = useAI();
  const [booted, setBooted] = useState(false);
  const system = useColorScheme();
  const theme = appearance === "system" ? (system === "dark" ? "dark" : "light") : appearance;
  const background = NAV_THEME[theme].background;

  return (
    <ScopedTheme theme={theme}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: background },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="note/[id]" />
        <Stack.Screen name="summary/[id]" />
        <Stack.Screen name="quiz/[id]" />
        <Stack.Screen name="chats" />
        <Stack.Screen name="budget/index" />
        <Stack.Screen name="budget/plan" />
        <Stack.Screen name="budget/ask" />
        <Stack.Screen name="budget/charts" />
        <Stack.Screen name="budget/bills" />
        <Stack.Screen name="settings" />
      </Stack>
      <StatusBar style={booted && theme !== "dark" ? "dark" : "light"} />
      {!booted && <Boot onDone={() => setBooted(true)} />}
    </ScopedTheme>
  );
}

export default function RootLayout(): JSX.Element | null {
  const [fontsLoaded, fontError] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Newsreader_400Regular,
    Newsreader_600SemiBold,
    Newsreader_400Regular_Italic,
  });

  // Missing fonts degrade to the system face; that is worth shipping, a blank
  // screen is not — so a font error unblocks rather than holds.
  const ready = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <AIProvider>
          <Themed />
        </AIProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
