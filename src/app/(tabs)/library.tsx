import { Ionicons } from "@expo/vector-icons";
import { Button, Spinner, Typography } from "heroui-native";
import { useCallback, useEffect, useState, type JSX, type ReactNode } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";

import { ScreenHeader } from "../../components/screen";
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
import { usePalette } from "../../lib/theme";

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <View className="gap-2.5">
      <Typography.Heading type="h3" className="font-ui-bold text-[17px]">
        {title}
      </Typography.Heading>
      {children}
    </View>
  );
}

function Library(): JSX.Element {
  const { rag, db, tier, setTier, revision, invalidate } = useAI();
  const palette = usePalette();

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
      contentContainerClassName="px-4 pt-3 pb-8 gap-6"
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeader title="Library">
        What the phone is carrying: the model that answers, and the material it answers from.
      </ScreenHeader>

      <Section title="Language model">
        {/* Radio rows, not a stack of buttons — this is one choice out of
            three, and picking one should look like picking, not submitting. */}
        <View className="overflow-hidden rounded-2xl border border-border bg-surface">
          {(Object.keys(TIERS) as Tier[]).map((key, index) => {
            const active = tier === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => setTier(key)}
                className={`flex-row items-center gap-3 px-4 py-3.5 active:bg-surface-tertiary ${
                  index > 0 ? "border-t border-border" : ""
                }`}
              >
                <Ionicons
                  name={active ? "radio-button-on" : "radio-button-off"}
                  size={19}
                  color={active ? palette.accent : palette.muted}
                />
                <View className="flex-1 gap-0.5">
                  <Typography.Paragraph className="font-ui-medium text-[15px]">
                    {TIERS[key].name}
                  </Typography.Paragraph>
                  <Typography.Paragraph className="font-ui text-muted text-[12px]">
                    {TIERS[key].note}
                  </Typography.Paragraph>
                </View>
                <Typography.Paragraph className="font-ui-medium text-muted text-[12px]">
                  {TIERS[key].size}
                </Typography.Paragraph>
              </Pressable>
            );
          })}
        </View>
        <Typography.Paragraph className="font-ui text-muted text-[12px]">
          Switching downloads the new model. Do it on Wi-Fi; after that it never reaches for the
          network again.
        </Typography.Paragraph>
      </Section>

      <Section title="Knowledge packs">
        <View className="gap-2.5 rounded-2xl border border-border bg-surface p-3.5">
          <Typography.Paragraph className="font-read text-[15px] leading-[23px] text-muted">
            Paste a link to a pack file. Any static host works — it is fetched once and read from
            the phone after that.
          </Typography.Paragraph>
          <TextInput
            className="rounded-xl border border-border bg-background px-3.5 py-2.5 font-ui text-[15px] text-foreground"
            placeholder="https://example.com/packs/first-aid.json"
            placeholderTextColor={palette.placeholder}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Button isDisabled={!url.trim() || importing} onPress={() => void importPack()}>
            {importing ? <Spinner size="sm" /> : "Add pack"}
          </Button>
          {error && (
            <Typography.Paragraph className="font-ui text-danger text-[13px]">
              {error}
            </Typography.Paragraph>
          )}
        </View>

        {packs.length === 0 ? (
          <Typography.Paragraph className="py-2 font-ui text-muted text-[13px]">
            No packs installed yet.
          </Typography.Paragraph>
        ) : (
          <View className="overflow-hidden rounded-2xl border border-border bg-surface">
            {packs.map((pack, index) => (
              <View
                key={pack.id}
                className={`flex-row items-center gap-3 px-4 py-3.5 ${
                  index > 0 ? "border-t border-border" : ""
                }`}
              >
                <View className="flex-1 gap-0.5">
                  <Typography.Paragraph className="font-ui-medium text-[15px]" numberOfLines={1}>
                    {pack.title}
                  </Typography.Paragraph>
                  <Typography.Paragraph className="font-ui text-muted text-[12px]">
                    {pack.chunks} passage{pack.chunks === 1 ? "" : "s"}
                  </Typography.Paragraph>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${pack.title}`}
                  onPress={() => void removePack(pack)}
                  hitSlop={8}
                  className="h-9 w-9 items-center justify-center rounded-full active:bg-surface-tertiary"
                >
                  <Ionicons name="trash-outline" size={17} color={palette.muted} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </Section>
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
