import { Tabs } from "expo-router";
import type { JSX } from "react";

import { Dock } from "../../components/dock";

/**
 * Five slots, drawn by `Dock`. The order and the labels live there; this file
 * only says which routes exist and which of them the bar may show.
 */
export default function TabsLayout(): JSX.Element {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <Dock {...props} />}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="index" />
      <Tabs.Screen name="scan" />
      <Tabs.Screen name="notes" />
      <Tabs.Screen name="library" />
      {/* Semantic search is the app's best trick but it is a destination, not a
          place you live, and there are only five slots. It keeps its route and
          is reached from Home. */}
      <Tabs.Screen name="search" options={{ href: null }} />
    </Tabs>
  );
}
