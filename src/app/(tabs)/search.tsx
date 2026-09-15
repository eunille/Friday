import { Button, Card, Chip, Input, Spinner, Typography } from "heroui-native";
import { useCallback, useState, type JSX } from "react";
import { ScrollView, View } from "react-native";
import type { QueryResult } from "react-native-rag";

import { ModelGate, useAI } from "../../lib/ai";

const RESULT_COUNT = 8;

function Search(): JSX.Element {
  const { store } = useAI();
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
      contentContainerClassName="px-4 py-4 gap-4"
      keyboardShouldPersistTaps="handled"
    >
      <Typography.Heading type="h2">Search</Typography.Heading>
      <Typography.Paragraph className="text-muted-foreground">
        Finds passages by meaning, not keywords. No answer is generated.
      </Typography.Paragraph>

      <View className="flex-row gap-2">
        <Input
          className="flex-1"
          placeholder="Search your notes and packs…"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onSubmitEditing={() => void run()}
        />
        <Button isDisabled={!query.trim() || searching} onPress={() => void run()}>
          {searching ? <Spinner size="sm" /> : "Search"}
        </Button>
      </View>

      {error && <Typography.Paragraph className="text-danger">{error}</Typography.Paragraph>}

      {results?.length === 0 && (
        <Typography.Paragraph className="text-muted-foreground text-center py-8">
          Nothing matched. Add notes or a knowledge pack first.
        </Typography.Paragraph>
      )}

      {results?.map((result) => (
        <Card key={result.id} className="gap-2">
          <View className="flex-row items-center justify-between gap-2">
            <Card.Title className="flex-1">{result.metadata?.title ?? "Untitled"}</Card.Title>
            <Chip size="sm">{Math.round(result.similarity * 100)}%</Chip>
          </View>
          <Typography.Paragraph>{result.document}</Typography.Paragraph>
        </Card>
      ))}
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
