import { Tabs } from "expo-router";
import type { JSX } from "react";

import { Dock } from "../../components/dock";

/**
 * Five slots, drawn by `Dock`. The order and the labels live there; this file
 * only says which routes exist and which of them the bar may show.
 */
export default function TabsLayout(): JSX.Element {
  return (
    // The navigator's own transition, not a hand-rolled one. Switching tabs
    // used to re-deal every card on the page from opacity 0, which fought
    // whatever the navigator was doing and read as a flicker; "shift" slides
    // the scene a little in the direction you moved, on the UI thread, and
    // cannot fall out of step with itself.
    <Tabs
      screenOptions={{ headerShown: false, animation: "shift" }}
      tabBar={(props) => <Dock {...props} />}
    >
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
