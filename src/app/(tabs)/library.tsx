import { Button, Card, Chip, Input, Spinner, Typography } from "heroui-native";
import { useCallback, useEffect, useState, type JSX } from "react";
import { ScrollView, View } from "react-native";

import {
  ModelGate,
  TIERS,
  addSource,
  deleteSource,
  listSources,
  useAI,
  type Source,
  type Tier,
} from "../../lib/ai";
import { parsePack } from "../../lib/formats";

function Library(): JSX.Element {
  const { rag, db, tier, setTier, revision, invalidate } = useAI();

  const [packs, setPacks] = useState<Source[]>([]);
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (db) void listSources(db, "pack").then(setPacks);
  }, [db, revision]);

  const importPack = useCallback(async () => {
    const target = url.trim();
    if (!rag || !db || !target || importing) return;

    setImporting(true);
    setError(null);
    try {
      const response = await fetch(target);
      if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
      const pack = parsePack(await response.json());

      // Re-importing replaces rather than duplicates.
      await deleteSource(db, pack.id);

      // ponytail: packs ship plain text and are embedded here. Precomputing
      // embeddings would shave the import wait but pins every pack to one
      // embedding model — do it only once packs get big enough to hurt.
      await addSource(rag, {
        id: pack.id,
        title: pack.title,
        kind: "pack",
        text: pack.entries.map((entry) => `## ${entry.title}\n${entry.text}`).join("\n\n"),
      });

      setUrl("");
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }, [rag, db, url, importing, invalidate]);

  const removePack = useCallback(
    async (pack: Source) => {
      if (!db) return;
      await deleteSource(db, pack.id);
      invalidate();
    },
    [db, invalidate]
  );

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-4 gap-4"
      keyboardShouldPersistTaps="handled"
    >
      <Typography.Heading type="h2">Library</Typography.Heading>

      <Card className="gap-3">
        <Card.Title>Language model</Card.Title>
        <Card.Description>
          Switching re-downloads the model. Do it on Wi-Fi — after that it runs offline.
        </Card.Description>
        {(Object.keys(TIERS) as Tier[]).map((key) => (
          <Button
            key={key}
            variant={tier === key ? "primary" : "outline"}
            onPress={() => setTier(key)}
          >
            {`${TIERS[key].label} · ${TIERS[key].hint}`}
          </Button>
        ))}
      </Card>

      <Card className="gap-3">
        <Card.Title>Knowledge packs</Card.Title>
        <Card.Description>
          Paste the URL of a pack JSON file. Any static host works — it is fetched once, then
          available offline.
        </Card.Description>
        <Input
          placeholder="https://example.com/packs/first-aid.json"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Button isDisabled={!url.trim() || importing} onPress={() => void importPack()}>
          {importing ? <Spinner size="sm" /> : "Download pack"}
        </Button>
        {error && (
          <Typography.Paragraph className="text-danger text-xs">{error}</Typography.Paragraph>
        )}
      </Card>

      {packs.length === 0 ? (
        <Typography.Paragraph className="text-muted-foreground text-center py-8">
          No packs installed.
        </Typography.Paragraph>
      ) : (
        packs.map((pack) => (
          <Card key={pack.id} className="gap-3">
            <View className="flex-row items-start justify-between gap-2">
              <View className="flex-1">
                <Card.Title>{pack.title}</Card.Title>
                <Card.Description>
                  {new Date(pack.createdAt).toLocaleDateString()} · {pack.chunks} chunk
                  {pack.chunks === 1 ? "" : "s"}
                </Card.Description>
              </View>
              <Chip size="sm">pack</Chip>
            </View>
            <Button size="sm" variant="danger-soft" onPress={() => void removePack(pack)}>
              Remove
            </Button>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

export default function LibraryTab(): JSX.Element {
  return (
    <ModelGate>
      <Library />
    </ModelGate>
  );
}
