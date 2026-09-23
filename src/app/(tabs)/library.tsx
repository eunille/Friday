import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Spinner, Typography } from "heroui-native";
import { useCallback, useEffect, useState, type JSX, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { useConfirm } from "../../components/dialog";
import {
  ChoiceRow,
  Group,
  IconButton,
  Screen,
  ScreenHeader,
  SectionTitle,
} from "../../components/screen";
import {
  LENGTHS,
  EXTRAS,
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
import { STARTERS } from "../../lib/packs";
import { usePalette } from "../../lib/theme";

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <View className="gap-2.5">
      <SectionTitle>{title}</SectionTitle>
      {children}
    </View>
  );
}

function Library(): JSX.Element {
  const { rag, db, tier, setTier, crashed, settings, revision, invalidate } = useAI();
  const router = useRouter();
  const confirm = useConfirm();
  const palette = usePalette();

  const [packs, setPacks] = useState<Source[]>([]);
  const [url, setUrl] = useState("");
  const [linking, setLinking] = useState(false);
  // Which row is working: a starter id, "link", or nothing.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (db) void listSources(db, "pack").then(setPacks);
  }, [db, revision]);

  // One path for both ways in, because the only difference between a pack from
  // the catalogue and a pack from a link is where the JSON came from.
  const install = useCallback(
    async (raw: unknown, id: string) => {
      if (!rag || !db) return;
      setBusy(id);
      setError(null);
      try {
        const pack = parsePack(raw);

        // Re-importing replaces rather than duplicates.
        await deleteSource(db, pack.id);

        // ponytail: packs ship plain text and are embedded here. Precomputing
        // embeddings would shave the import wait but pins every pack to one
        // embedding model - do it only once packs get big enough to hurt.
        await addSource(rag, {
          id: pack.id,
          title: pack.title,
          kind: "pack",
          text: pack.entries
            .map((entry) => `## ${entry.title}\n${entry.text}`)
            .join("\n\n"),
        });
        invalidate();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [rag, db, invalidate]
  );

  const importPack = useCallback(async () => {
    const target = url.trim();
    if (!target || busy) return;
    setBusy("link");
    setError(null);
    try {
      const response = await fetch(target);
      if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
      const body: unknown = await response.json();
      setUrl("");
      await install(body, "link");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }, [url, busy, install]);

  const removePack = useCallback(
    (pack: Source) => {
      confirm.ask({
        title: "Remove this pack?",
        // A starter can be added straight back; one from a link needs the
        // link again, and nothing here knows which this was.
        message: `“${pack.title}” stops being searchable. Adding it again puts it back.`,
        action: "Remove",
        destructive: true,
        onConfirm: () => {
          if (!db) return;
          void deleteSource(db, pack.id).then(invalidate);
        },
      });
    },
    [db, confirm, invalidate]
  );

  return (
    <Screen>
      <ScreenHeader title="Library">
        What the phone is carrying: the model that answers, and the material it answers from.
      </ScreenHeader>

      {/* Its own section, and its own stack of screens behind this one row.
          Budget shares the offline model with the rest of the app and nothing
          else — no notes, no retrieval, no OCR — so it earns a door here rather
          than one of the five slots in the dock. */}
      <Section title="Money">
        <Group>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open money tracking"
            onPress={() => router.push("/budget")}
            className="min-h-[56px] flex-row items-center gap-3 px-4 py-3.5 active:bg-surface-tertiary"
          >
            <Ionicons name="wallet-outline" size={19} color={palette.muted} />
            <View className="flex-1 gap-0.5">
              <Typography.Paragraph className="font-ui-medium text-[15px]">
                Money
              </Typography.Paragraph>
              <Typography.Paragraph className="font-ui text-muted text-[12px]">
                Wallets, what came in and what went out.
              </Typography.Paragraph>
            </View>
            <Ionicons name="chevron-forward" size={16} color={palette.muted} />
          </Pressable>
        </Group>
      </Section>

      <Section title="How the AI answers">
        <Group>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open AI behaviour settings"
            onPress={() => router.push("/settings")}
            className="min-h-[56px] flex-row items-center gap-3 px-4 py-3.5 active:bg-surface-tertiary"
          >
            <Ionicons name="options-outline" size={19} color={palette.muted} />
            <View className="flex-1 gap-0.5">
              <Typography.Paragraph className="font-ui-medium text-[15px]">
                AI behaviour
              </Typography.Paragraph>
              <Typography.Paragraph className="font-ui text-muted text-[12px]">
                Length, tone and your own instructions.
              </Typography.Paragraph>
            </View>
            <Typography.Paragraph className="font-ui-medium text-muted text-[12px]">
              {LENGTHS[settings.length].label}
            </Typography.Paragraph>
            <Ionicons name="chevron-forward" size={16} color={palette.muted} />
          </Pressable>
        </Group>
      </Section>

      <Section title="Language model">
        <Group>
          {(Object.keys(TIERS) as Tier[]).map((key, index) => (
            <ChoiceRow
              key={key}
              first={index === 0}
              label={TIERS[key].name}
              // Said on the row itself, because this is where someone goes to
              // find out why the app quietly switched back to Tiny.
              note={
                crashed === key
                  ? `The app closed while loading this — the phone may not have the memory.${
                      key === "tiny" ? "" : " Switched back to Tiny."
                    }`
                  : TIERS[key].note
              }
              trailing={TIERS[key].size}
              selected={tier === key}
              onPress={() => setTier(key)}
            />
          ))}
        </Group>
        <Typography.Paragraph className="font-ui text-muted text-[12px]">
          Switching downloads the new model, and you can cancel part-way without losing the one you
          already have. Do it on Wi-Fi; after that it never reaches for the network again.
        </Typography.Paragraph>
      </Section>

      {/* Not choices — they arrive when the feature that needs them is first
          used. Listed because someone on mobile data should know what a tap on
          the mic is about to cost them. */}
      <Section title="Also downloaded">
        <Group>
          {EXTRAS.map((extra, index) => (
            <View
              key={extra.key}
              className={`min-h-[60px] flex-row items-center gap-3 px-4 py-3 ${
                index === 0 ? "" : "border-t border-border"
              }`}
            >
              <Ionicons
                name={
                  extra.key === "speech"
                    ? "mic-outline"
                    : extra.key === "reader"
                      ? "volume-high-outline"
                      : extra.key === "ocr"
                      ? "scan-outline"
                      : "search-outline"
                }
                size={19}
                color={palette.muted}
              />
              <View className="flex-1 gap-0.5">
                <Typography.Paragraph className="font-ui-medium text-[15px]">
                  {extra.name}
                </Typography.Paragraph>
                <Typography.Paragraph className="font-ui text-muted text-[12px]">
                  {extra.note}
                </Typography.Paragraph>
                <Typography.Paragraph className="font-ui text-muted-soft text-[11.5px]">
                  {extra.when}
                </Typography.Paragraph>
              </View>
              <Typography.Paragraph className="font-ui-medium text-muted text-[12px]">
                {extra.size}
              </Typography.Paragraph>
            </View>
          ))}
        </Group>
      </Section>

      <Section title="Knowledge packs">
        {/* What a pack is, before anything asks to be tapped. This used to open
            with "paste a link to a pack file", which is an instruction you can
            only follow if you already know what one is and have one. */}
        <Typography.Paragraph className="font-read text-[15px] leading-[23px] text-muted">
          Reference material the chat can read, stored beside your notes. Add one and it works
          offline like everything else.
        </Typography.Paragraph>
        {/* Worth saying plainly: a pack is not loaded into the model, and it
            is not consulted unless retrieval is switched on for the question.
            Someone who adds one and sees no difference is owed the reason. */}
        <Typography.Paragraph className="font-ui text-muted-soft text-[12.5px] leading-[19px]">
          Packs sit alongside your notes, not inside the model. Turn on{" "}
          <Typography.Paragraph className="font-ui-medium text-[12.5px] text-muted">
            Reading notes
          </Typography.Paragraph>{" "}
          in the chat and answers are drawn from them.
        </Typography.Paragraph>

        <Group>
          {STARTERS.map((starter, index) => {
            const installed = packs.some((pack) => pack.id === starter.id);
            const working = busy === starter.id;
            return (
              <Pressable
                key={starter.id}
                accessibilityRole="button"
                accessibilityState={{ disabled: installed || busy !== null, busy: working }}
                accessibilityLabel={
                  installed ? `${starter.title}, already added` : `Add ${starter.title}`
                }
                disabled={installed || busy !== null}
                onPress={() => void install(starter.load(), starter.id)}
                className={`min-h-[64px] flex-row items-center gap-3 px-4 py-3 active:bg-surface-tertiary ${
                  index > 0 ? "border-t border-border" : ""
                }`}
                style={{ opacity: busy !== null && !working ? 0.5 : 1 }}
              >
                <Ionicons
                  name={starter.icon as never}
                  size={19}
                  color={installed ? palette.onDevice : palette.muted}
                />
                <View className="flex-1 gap-0.5">
                  <Typography.Paragraph className="font-ui-medium text-[15px]">
                    {starter.title}
                  </Typography.Paragraph>
                  <Typography.Paragraph className="font-ui text-muted text-[12px] leading-[17px]">
                    {starter.blurb}
                  </Typography.Paragraph>
                </View>
                {/* Three states, one slot: working, already here, or a thing to
                    press. Nothing downloads, so "Add" is the honest verb. */}
                {working ? (
                  <Spinner size="sm" />
                ) : installed ? (
                  <Ionicons name="checkmark-circle" size={20} color={palette.onDevice} />
                ) : (
                  <View className="rounded-full border border-border px-3 py-1.5">
                    <Text
                      style={{
                        fontFamily: "Archivo_600SemiBold",
                        fontSize: 12.5,
                        color: palette.foreground,
                      }}
                    >
                      Add
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </Group>

        {/* Behind a disclosure, because it is the path for someone who already
            has a pack file, and that is nobody on their first run. */}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: linking }}
          onPress={() => setLinking((open) => !open)}
          className="min-h-[40px] flex-row items-center gap-1.5 active:opacity-70"
        >
          <Ionicons name={linking ? "chevron-down" : "chevron-forward"} size={14} color={palette.muted} />
          <Typography.Paragraph className="font-ui-medium text-[13px] text-muted">
            Add one from a link
          </Typography.Paragraph>
        </Pressable>

        {linking && (
          <View className="gap-2.5 rounded-2xl border border-border bg-surface p-3.5">
            <Typography.Paragraph className="font-ui text-muted-soft text-[12.5px] leading-[19px]">
              Any static host works. The file is fetched once and read from the phone after that.
            </Typography.Paragraph>
            <TextInput
              className="min-h-[44px] rounded-xl border border-border bg-background px-3.5 py-2.5 font-ui text-[15px] text-foreground"
              placeholder="https://example.com/packs/first-aid.json"
              placeholderTextColor={palette.placeholder}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !url.trim() || busy !== null }}
              disabled={!url.trim() || busy !== null}
              onPress={() => void importPack()}
              className="min-h-[46px] items-center justify-center rounded-full active:opacity-80"
              style={{
                backgroundColor: palette.accent,
                opacity: !url.trim() || busy !== null ? 0.4 : 1,
              }}
            >
              {busy === "link" ? (
                <Spinner size="sm" />
              ) : (
                <Text
                  style={{
                    fontFamily: "Archivo_600SemiBold",
                    fontSize: 14,
                    color: palette.accentForeground,
                  }}
                >
                  Add pack
                </Text>
              )}
            </Pressable>
          </View>
        )}

        {error !== null && (
          <Typography.Paragraph className="font-ui text-danger text-[13px]">
            {error}
          </Typography.Paragraph>
        )}

        {/* Wrapped rather than left as a sibling of the form. React
            Compiler turns a conditional sitting in a children list into a
            runtime array, which React then checks for keys and warns
            about — one child sidesteps the whole question. */}
        <View className="gap-2.5">
          {packs.length === 0 ? (
            <Typography.Paragraph className="py-2 font-ui text-muted text-[13px]">
              No packs installed yet.
            </Typography.Paragraph>
          ) : (
            <Group>
              {packs.map((pack, index) => (
                <View
                  key={pack.id}
                  className={`min-h-[60px] flex-row items-center gap-3 px-4 py-2.5 ${
                    index > 0 ? "border-t border-border" : ""
                  }`}
                >
                  <View className="flex-1 gap-0.5">
                    <Typography.Paragraph className="font-ui-medium text-[15px]" numberOfLines={1}>
                      {pack.title}
                    </Typography.Paragraph>
                    <Typography.Paragraph className="font-ui text-muted text-[12px]">
                      {`${pack.chunks} passage${pack.chunks === 1 ? "" : "s"}`}
                    </Typography.Paragraph>
                  </View>
                  <IconButton
                    name="trash-outline"
                    label={`Remove ${pack.title}`}
                    tone="muted"
                    onPress={() => void removePack(pack)}
                  />
                </View>
              ))}
            </Group>
          )}
        </View>
      </Section>
      {confirm.dialog}
    </Screen>
  );
}

export default function LibraryTab(): JSX.Element {
  return (
    <ModelGate>
      <Library />
    </ModelGate>
  );
}
