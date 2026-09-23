import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { FlatList, Pressable, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import type { Message } from "react-native-rag";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconButton, Mascot, PressCard } from "../../components/screen";
import {
  LENGTHS,
  ModelGate,
  TIERS,
  getChat,
  newChatId,
  newNoteId,
  reindexNote,
  saveChat,
  saveNoteText,
  LENGTH_TOKENS,
  systemPrompt,
  useAI,
} from "../../lib/ai";
import { trimToSentence } from "../../lib/formats";
import { asContext, retrieve } from "../../lib/retrieval";
import { Composer } from "../../components/composer";
import { useKeyboardOverlap, usePalette } from "../../lib/theme";

const SUGGESTIONS = [
  { icon: "sparkles-outline", text: "Summarise everything I saved this week" },
  { icon: "help-circle-outline", text: "Quiz me on my notes" },
  { icon: "search-outline", text: "What did I write about deadlines?" },
] as const;

/** A note or pack the answer was grounded in. */
type Cite = { id: string; title: string };

/**
 * One turn. Richer than react-native-rag's `Message`, which is only role and
 * content — the extras are display-only and are stripped before sending.
 */
type Entry = {
  role: "user" | "assistant";
  content: string;
  cites?: Cite[];
  /** Wall-clock milliseconds and token count, so the speed claim is measured. */
  ms?: number;
  tokens?: number;
};

const asMessages = (entries: Entry[]): Message[] =>
  entries.map(({ role, content }) => ({ role, content }));

function Dot({ delay, color }: { delay: number; color: string }): JSX.Element {
  const value = useSharedValue(0.25);

  useEffect(() => {
    const id = setTimeout(() => {
      value.value = withRepeat(withTiming(1, { duration: 480 }), -1, true);
    }, delay);
    return () => clearTimeout(id);
  }, [delay, value]);

  const style = useAnimatedStyle(() => ({ opacity: value.value }));

  return (
    <Animated.View
      style={[style, { width: 7, height: 7, borderRadius: 7, backgroundColor: color }]}
    />
  );
}

/**
 * Three amber dots while tokens are arriving. Amber is the app's "working"
 * signal — see the colour note in global.css — so this reads the same as the
 * status card and the active tab.
 */
function Thinking(): JSX.Element {
  const palette = usePalette();

  return (
    <View className="flex-row items-center gap-2 rounded-[18px] rounded-bl-md border border-border bg-surface px-4 py-3.5">
      {[0, 1, 2].map((index) => (
        <Dot key={index} delay={index * 160} color={palette.warning} />
      ))}
      <Typography.Paragraph className="ml-1 font-ui-medium text-[11px] text-muted">
        Thinking on device…
      </Typography.Paragraph>
    </View>
  );
}

function Turn({
  entry,
  onSave,
  onRegenerate,
  saved,
}: {
  entry: Entry;
  onSave: () => void;
  onRegenerate: () => void;
  saved: boolean;
}): JSX.Element {
  const palette = usePalette();
  const router = useRouter();

  // A person's words and a machine's words are set differently on purpose: the
  // question is a compact grotesk bubble, the answer is serif prose in a card
  // — something you read rather than skim.
  if (entry.role === "user") {
    return (
      /* A quiet tint, not a filled block. Every question you ask draws one of
         these, so a solid dark bubble stacks into a column of black down the
         right of a long conversation. Alignment and the missing avatar already
         say who is speaking. */
      <View className="my-2 max-w-[82%] self-end rounded-[18px] rounded-br-md bg-surface-tertiary px-3.5 py-2.5">
        <Typography.Paragraph className="font-ui text-[13.5px] leading-[20px]">
          {entry.content}
        </Typography.Paragraph>
      </View>
    );
  }

  return (
    <View className="my-2.5 flex-row gap-2.5">
      <Mascot pose="stretch" size={38} />
      <View className="flex-1 rounded-[18px] rounded-bl-md border border-border bg-surface px-3.5 py-3">
        <Typography.Paragraph className="font-read text-[14.5px] leading-[23px]">
          {entry.content}
        </Typography.Paragraph>

        {entry.cites && entry.cites.length > 0 && (
          <View className="mt-2.5 flex-row flex-wrap gap-1.5">
            {entry.cites.map((cite) => (
              <Pressable
                key={cite.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${cite.title}`}
                onPress={() => router.push({ pathname: "/note/[id]", params: { id: cite.id } })}
                className="flex-row items-center gap-1.5 rounded-full bg-on-device-soft px-2.5 py-1 active:opacity-70"
              >
                <Ionicons name="document-text" size={12} color={palette.onDevice} />
                <Typography.Paragraph
                  className="max-w-[150px] font-ui-medium text-[10.5px] text-on-device"
                  numberOfLines={1}
                >
                  {cite.title}
                </Typography.Paragraph>
              </Pressable>
            ))}
          </View>
        )}

        <View className="mt-2.5 flex-row items-center gap-1 border-t border-separator pt-1.5">
          <IconButton
            name={saved ? "bookmark" : "bookmark-outline"}
            label={saved ? "Saved as a note" : "Save as a note"}
            tone={saved ? "accent" : "muted"}
            disabled={saved}
            onPress={onSave}
          />
          <IconButton
            name="refresh-outline"
            label="Answer again"
            tone="muted"
            onPress={onRegenerate}
          />
          <View className="flex-1" />
          {entry.ms !== undefined && entry.tokens !== undefined && entry.ms > 0 && (
            <Typography.Paragraph className="font-ui text-[10px] text-muted-soft">
              {(entry.ms / 1000).toFixed(1)}s · {Math.round((entry.tokens / entry.ms) * 1000)} tok/s
            </Typography.Paragraph>
          )}
        </View>
      </View>
    </View>
  );
}

function Chat(): JSX.Element {
  const { rag, db, embed, tier, settings, invalidate } = useAI();
  const router = useRouter();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { overlap, onLayout } = useKeyboardOverlap();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  // Off by default. Retrieval makes every answer slower and drags in passages
  // that may have nothing to do with the question; it should be something you
  // reach for when the answer ought to come from your own material.
  const [useNotes, setUseNotes] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const listRef = useRef<FlatList<Entry>>(null);
  // One id per conversation, so every answer upserts the same row instead of
  // leaving a trail of one-turn chats on the dashboard.
  const chatId = useRef(newChatId());

  const busy = streaming !== null;

  // Opened from the dashboard with ?chat=<id>: pick that conversation back up.
  const { chat: resume } = useLocalSearchParams<{ chat?: string }>();
  useEffect(() => {
    if (!db || !resume) return;
    void getChat(db, resume).then((body) => {
      if (!body) return;
      chatId.current = resume;
      setEntries(body as Entry[]);
      setSavedIds(new Set());
    });
  }, [db, resume]);

  const ask = useCallback(
    async (question: string, history: Entry[]) => {
      if (!rag || !question || busy) return;

      const asked: Entry[] = [...history, { role: "user", content: question }];
      setEntries(asked);
      setDraft("");
      setStreaming("");

      let cites: Cite[] = [];
      let answer = "";
      let tokens = 0;
      let cut = false;
      const started = Date.now();

      try {
        // The system message is prepended per call rather than baked into the
        // model, so changing a setting takes effect on the next question
        // instead of forcing a reload.
        const input: Message[] = [
          { role: "system", content: systemPrompt(settings) },
          ...asMessages(asked),
        ];

        // Retrieved here rather than inside generate(). The library's own
        // retrieval reads every embedding in the database into JavaScript on
        // every question and searches by meaning alone; this one stays bounded
        // in SQLite and adds a keyword pass for the exact terms — "RFC 1918",
        // an IP, a formula — that embeddings blur. See lib/retrieval.ts.
        if (useNotes && db && embed) {
          const chunks = await retrieve({ db, embed, query: question });
          cites = [...new Map(chunks.map((c) => [c.sourceId, { id: c.sourceId, title: c.title }])).values()];
          // Same `Message: … Context: …` shape the library appended, so the
          // model sees the format it always has and only the chunks change.
          input.push({ role: "user", content: `Message: ${question}\nContext: ${asContext(chunks)}` });
        }

        await rag.generate({
          input,
          augmentedGeneration: false,
          callback: (token) => {
            answer += token;
            tokens += 1;
            setStreaming(answer);
            // Asking for a length is not enforcing one. A small model ignores
            // "at most three sentences" often enough that the setting looked
            // broken, so past the cap the generation is stopped outright.
            // Guarded so a late token cannot interrupt twice.
            if (tokens > LENGTH_TOKENS[settings.length] && !cut) {
              cut = true;
              void rag.interrupt();
            }
          },
        });
        // Interrupting lands mid-word, which reads as a crash rather than a
        // limit, so the tail goes back to the last finished sentence.
        if (cut) answer = trimToSentence(answer);
        const finished: Entry[] = [
          ...asked,
          { role: "assistant", content: answer, cites, ms: Date.now() - started, tokens },
        ];
        setEntries(finished);
        // Cleared here, batched with setEntries, rather than left to the
        // `finally` below. Awaiting the save first would yield mid-update and
        // React would paint one frame holding both the finished answer and the
        // streaming copy of it — the answer flashing twice.
        setStreaming(null);
        if (db) {
          await saveChat(db, {
            id: chatId.current,
            title: asked.find((entry) => entry.role === "user")?.content.slice(0, 80) ?? "Chat",
            body: finished,
          });
          invalidate();
        }
      } catch (error) {
        setEntries([
          ...asked,
          {
            role: "assistant",
            content: `Couldn't answer that: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ]);
      } finally {
        setStreaming(null);
      }
    },
    [rag, db, embed, busy, useNotes, settings, invalidate]
  );

  /** Drops the last answer and asks the same question again. */
  const regenerate = useCallback(
    (index: number) => {
      const question = entries[index - 1];
      if (!question || question.role !== "user" || busy) return;
      void ask(question.content, entries.slice(0, index - 1));
    },
    [entries, busy, ask]
  );

  const saveAnswer = useCallback(
    async (index: number) => {
      const answer = entries[index];
      const question = entries[index - 1];
      if (!db || !rag || !answer) return;

      const id = newNoteId();
      await saveNoteText(db, {
        id,
        title: question?.content.slice(0, 60) ?? "Saved answer",
        body: answer.content,
      });
      await reindexNote(rag, db, id);
      setSavedIds((previous) => new Set(previous).add(index));
      invalidate();
    },
    [entries, db, rag, invalidate]
  );

  const shown: Entry[] =
    streaming === null ? entries : [...entries, { role: "assistant", content: streaming }];

  return (
    <View className="flex-1 bg-background" onLayout={onLayout}>
      <View
        className="flex-row items-center gap-1 px-3 pb-1"
        style={{ paddingTop: insets.top + 6 }}
      >
        <Typography.Heading
          type="h1"
          className="flex-1 pl-1 font-ui-bold text-[26px] tracking-tight"
        >
          Ask
        </Typography.Heading>
        {tier && (
          <View className="mr-1 flex-row items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1">
            <View
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: palette.onDevice }}
            />
            <Typography.Paragraph className="font-ui-medium text-[10.5px] text-on-device">
              {TIERS[tier].label} · offline
            </Typography.Paragraph>
          </View>
        )}
        <IconButton
          name="time-outline"
          label="Past conversations"
          tone="muted"
          onPress={() => router.push("/chats")}
        />
        <IconButton
          name="create-outline"
          label="Start a new chat"
          disabled={busy || entries.length === 0}
          onPress={() => {
            setEntries([]);
            setSavedIds(new Set());
            chatId.current = newChatId();
          }}
        />
      </View>

      <FlatList
        ref={listRef}
        className="flex-1 px-4"
        data={shown}
        keyExtractor={(_, index) => String(index)}
        renderItem={({ item, index }) =>
          item.role === "assistant" && item.content === "" ? (
            <View className="my-2.5 flex-row gap-2.5">
              <Mascot pose="stretch" size={38} />
              <Thinking />
            </View>
          ) : (
            <Turn
              entry={item}
              saved={savedIds.has(index)}
              onSave={() => void saveAnswer(index)}
              onRegenerate={() => regenerate(index)}
            />
          )
        }
        ListHeaderComponent={
          entries.length > 0 && useNotes ? (
            <View className="my-2 self-center rounded-full bg-surface-tertiary px-3 py-1.5">
              <Typography.Paragraph className="font-ui-medium text-[10px] text-muted">
                Reading your notes · answers stay on this phone
              </Typography.Paragraph>
            </View>
          ) : null
        }
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <View className="gap-4 pt-4">
            <View className="items-center justify-center py-6">
              <Mascot pose="stretch" size={150} />
            </View>

            <View className="gap-2">
              <Typography.Heading type="h2" className="font-ui-bold text-[22px] tracking-tight">
                What would you like to learn today?
              </Typography.Heading>
              <Typography.Paragraph className="font-read text-[14px] leading-[22px] text-muted-strong">
                Answers come from the notes on this phone. No account, no network — try it in
                airplane mode.
              </Typography.Paragraph>
            </View>

            <View className="gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <PressCard
                  key={suggestion.text}
                  className="px-3.5 py-3"
                  onPress={() => setDraft(suggestion.text)}
                >
                  <View className="flex-row items-center gap-2.5">
                    <Ionicons name={suggestion.icon} size={18} color={palette.accent} />
                    <Typography.Paragraph className="flex-1 font-ui-medium text-[13px] leading-[18px]">
                      {suggestion.text}
                    </Typography.Paragraph>
                    <Ionicons name="arrow-forward" size={15} color={palette.mutedSoft} />
                  </View>
                </PressCard>
              ))}
            </View>

            <View className="flex-row items-center gap-2.5 rounded-2xl border border-warning-border bg-warning-soft p-3">
              <Ionicons name="bulb-outline" size={17} color={palette.warning} />
              <Typography.Paragraph className="flex-1 font-read text-[12px] leading-[19px] text-muted-strong">
                Answers get sharper the more notes you keep. One note is enough to start.
              </Typography.Paragraph>
            </View>
          </View>
        }
      />

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => void ask(draft.trim(), entries)}
        placeholder="Ask anything…"
        busy={busy}
        onStop={() => void rag?.interrupt()}
        overlap={overlap}
        controls={
          <View className="flex-row items-center gap-2">
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: useNotes }}
              onPress={() => setUseNotes((on) => !on)}
              className={`min-h-[34px] flex-row items-center gap-1.5 rounded-full border px-2.5 ${
                useNotes ? "border-accent bg-accent-soft" : "border-border"
              }`}
            >
              <Ionicons
                name={useNotes ? "layers" : "layers-outline"}
                size={14}
                color={useNotes ? palette.accent : palette.muted}
              />
              <Typography.Paragraph
                className={`font-ui-medium text-[11px] ${useNotes ? "text-accent" : "text-muted"}`}
              >
                {useNotes ? "Reading notes" : "Notes off"}
              </Typography.Paragraph>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change answer length and tone"
              onPress={() => router.push("/settings")}
              className="min-h-[34px] flex-row items-center gap-1.5 rounded-full border border-border px-2.5"
            >
              <Ionicons name="options-outline" size={14} color={palette.muted} />
              <Typography.Paragraph className="font-ui-medium text-[11px] text-muted">
                {LENGTHS[settings.length].label}
              </Typography.Paragraph>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

export default function AskTab(): JSX.Element {
  return (
    <ModelGate>
      <Chat />
    </ModelGate>
  );
}
