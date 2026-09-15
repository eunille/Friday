import { Ionicons } from "@expo/vector-icons";
import { Spinner, Typography } from "heroui-native";
import { useCallback, useState, type JSX } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import type { QueryResult } from "react-native-rag";

import { ScreenHeader } from "../../components/screen";
import { ModelGate, useAI } from "../../lib/ai";
import { usePalette } from "../../lib/theme";

const RESULT_COUNT = 8;

/**
 * How close the passage was. This is the retrieval model doing work, so it is
 * one of the few places allowed to spend the accent colour — and a bar reads
 * at a glance in a way a bare percentage never does.
 */
function Similarity({ value }: { value: number }): JSX.Element {
  return (
    <View className="w-16 gap-1">
      <Typography.Paragraph className="text-right font-ui-medium text-muted text-[11px]">
        {Math.round(value * 100)}%
      </Typography.Paragraph>
      <View className="h-[3px] overflow-hidden rounded-full bg-surface-tertiary">
        <View
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      </View>
    </View>
  );
}

function Search(): JSX.Element {
  const { store } = useAI();
  const palette = usePalette();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QueryResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    const text = query.trim();
    if (!store || !text || searching) return;

    setSearching(true);
    setError(null);
    try {
      // Retrieval only — no LLM. This is why search stays fast on a phone.
      setResults(await store.query({ queryText: text, nResults: RESULT_COUNT }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }, [store, query, searching]);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 pt-3 pb-8 gap-5"
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeader title="Search">
        Matches on meaning rather than words, so &ldquo;how do I stop a burn hurting&rdquo; finds a
        note that only says &ldquo;cool under running water&rdquo;.
      </ScreenHeader>

      <View className="flex-row items-center gap-2.5 rounded-full border border-border bg-surface px-4">
        <Ionicons name="search" size={17} color={palette.muted} />
        <TextInput
          className="flex-1 py-3 font-ui text-[16px] text-foreground"
          placeholder="Search notes and packs"
          placeholderTextColor={palette.placeholder}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onSubmitEditing={() => void run()}
          autoCapitalize="none"
        />
        {searching ? (
          <Spinner size="sm" />
        ) : query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => {
              setQuery("");
              setResults(null);
            }}
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={18} color={palette.muted} />
          </Pressable>
        ) : null}
      </View>

      {error && (
        <Typography.Paragraph className="font-ui text-danger text-[13px]">
          {error}
        </Typography.Paragraph>
      )}

      {results?.length === 0 && (
        <View className="items-center gap-2 py-10">
          <Ionicons name="search-outline" size={26} color={palette.muted} />
          <Typography.Paragraph className="text-center font-read text-[16px] leading-6 text-muted">
            Nothing matched. Save a note or install a pack, then try again.
          </Typography.Paragraph>
        </View>
      )}

      {results && results.length > 0 && (
        <View className="overflow-hidden rounded-2xl border border-border bg-surface">
          {results.map((result, index) => (
            <View
              key={result.id}
              className={`gap-2 px-4 py-3.5 ${index > 0 ? "border-t border-border" : ""}`}
            >
              <View className="flex-row items-start justify-between gap-3">
                <Typography.Paragraph
                  className="flex-1 font-ui-medium text-[15px]"
                  numberOfLines={1}
                >
                  {typeof result.metadata?.title === "string" ? result.metadata.title : "Untitled"}
                </Typography.Paragraph>
                <Similarity value={result.similarity} />
              </View>
              <Typography.Paragraph className="font-read text-[16px] leading-[24px] text-muted">
                {result.document}
              </Typography.Paragraph>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

export default function SearchTab(): JSX.Element {
  return (
    <ModelGate>
      <Search />
    </ModelGate>
  );
}
