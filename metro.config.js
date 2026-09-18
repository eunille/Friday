const path = require("node:path");

const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const config = getDefaultConfig(__dirname);

/**
 * Packages with no web build, swapped for one stub so the browser preview can
 * boot. Everything above this line — screens, components, styles, layout — is
 * the same source the phone runs, which is the entire point: a preview that
 * cannot drift, rather than a mock that starts accurate and rots.
 */
const NATIVE_ONLY = new Set([
  "@op-engineering/op-sqlite",
  "react-native-executorch",
  "react-native-executorch-expo-resource-fetcher",
  "react-native-rag",
  "@react-native-rag/executorch",
  "@react-native-rag/op-sqlite",
  "react-native-audio-api",
  "expo-notifications",
]);

const STUB = path.resolve(__dirname, "src/web/native-stubs.ts");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Guarded on platform, not on the name alone. Without that check the phone
  // would get the stub too, and the app would ship with no model and no
  // database while still looking like it worked.
  if (platform === "web" && NATIVE_ONLY.has(moduleName)) {
    return { type: "sourceFile", filePath: STUB };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./src/global.css",
});
