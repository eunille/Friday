import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
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

import { useConfirm } from "../../components/dialog";
import { IconButton, Mascot } from "../../components/screen";
import {
  KnowledgeSheet,
  ModeSheet,
  QuestionCard,
  QuizCard,
  scopeLabel,
  type Question,
  type QuizOffer,
} from "../../components/tutor";
import {
  LENGTHS,
  ModelGate,
  TIERS,
  getChat,
  listNotes,
  newChatId,
  newNoteId,
  readSource,
  reindexNote,
  saveChat,
  saveNoteText,
  LENGTH_TOKENS,
  systemPrompt,
  useAI,
} from "../../lib/ai";
import { clampForPrompt, parseQuiz, trimToSentence, type QuizQuestion } from "../../lib/formats";
import { useDictation } from "../../lib/dictation";
import { useReader } from "../../lib/reader";
import { asContext, retrieve, type Chunk, type Scope } from "../../lib/retrieval";
import {
  MODES,
  TEACH_PROMPT,
  TEST_LENGTH,
  detectMode,
  detectQuiz,
  scoreLine,
  testPrompt,
  verdict,
  type Mode,
} from "../../lib/tutor";
import { spokenChoice, spokenQuestion } from "../../lib/voice";
import { Composer } from "../../components/composer";
import { useKeyboardOverlap, usePalette } from "../../lib/theme";

/**
 * Enough for five questions with four options each, and no more. A model that
 * keeps going past the format is only adding text parseQuiz will drop.
 */
const TEST_TOKENS = 700;

const PLACEHOLDERS: Record<Mode, string> = {
  ask: "Ask anything…",
  teach: "What should I teach you?",
  test: "What should I test you on?",
};

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
  /** A mode change, drawn as a divider line and never sent to the model. */
  divider?: true;
  /** A test question, answered in place. */
  question?: Question;
  /** A standalone quiz, as a card that opens the Quiz page. */
  quiz?: QuizOffer;
};

const asMessages = (entries: Entry[]): Message[] =>
  entries.filter((entry) => !entry.divider).map(({ role, content }) => ({ role, content }));

/** One chip per note or pack, however many of its chunks were used. */
const citesOf = (chunks: readonly Chunk[]): Cite[] => [
  ...new Map(chunks.map((chunk) => [chunk.sourceId, { id: chunk.sourceId, title: chunk.title }])).values(),
];

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
function Thinking({ label = "Thinking on device…" }: { label?: string }): JSX.Element {
  const palette = usePalette();

  return (
    <View className="flex-row items-center gap-2 rounded-[18px] rounded-bl-md border border-border bg-surface px-4 py-3.5">
      {[0, 1, 2].map((index) => (
        <Dot key={index} delay={index * 160} color={palette.warning} />
      ))}
      <Typography.Paragraph className="ml-1 font-ui-medium text-[11px] text-muted">
        {label}
      </Typography.Paragraph>
    </View>
  );
}

/** A mode change, as a rule across the conversation — so the history still reads. */
function Divider({ text }: { text: string }): JSX.Element {
  return (
    <View className="my-3 flex-row items-center gap-2.5">
      <View className="h-px flex-1 bg-separator" />
      <Typography.Paragraph className="font-ui-medium text-[10.5px] text-muted">
        Switched to {text}
      </Typography.Paragraph>
      <View className="h-px flex-1 bg-separator" />
    </View>
  );
}

/** A composer chip: an icon, a word, and a tint when it is doing something. */
function Chip({
  icon,
  label,
  on,
  hint,
  onPress,
}: {
  icon: string;
  label: string;
  on: boolean;
  hint: string;
  onPress: () => void;
}): JSX.Element {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${hint}`}
      onPress={onPress}
      className={`min-h-[34px] flex-row items-center gap-1.5 rounded-full border px-2.5 ${
        on ? "border-accent bg-accent-soft" : "border-border"
      }`}
    >
      <Ionicons name={icon as never} size={14} color={on ? palette.accent : palette.muted} />
      <Typography.Paragraph
        className={`font-ui-medium text-[11px] ${on ? "text-accent" : "text-muted"}`}
      >
        {label}
      </Typography.Paragraph>
      <Ionicons name="chevron-down" size={11} color={on ? palette.accent : palette.mutedSoft} />
    </Pressable>
  );
}

function Turn({
  entry,
  onSave,
  onRegenerate,
  saved,
  reading,
  progress,
  onRead,
}: {
  entry: Entry;
  onSave: () => void;
  onRegenerate: () => void;
  saved: boolean;
  /** Whether this reply is being read aloud, or waiting for the voice to load. */
  reading: "idle" | "preparing" | "speaking";
  /** The voice's download, 0 to 1, shown while this reply waits for it. */
  progress: number;
  onRead: () => void;
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
          <IconButton
            name={reading === "idle" ? "volume-high-outline" : "stop-circle-outline"}
            label={
              reading === "speaking"
                ? "Stop reading"
                : reading === "preparing"
                  ? "Cancel reading"
                  : "Read aloud"
            }
            tone={reading === "idle" ? "muted" : "accent"}
            onPress={onRead}
          />
          {reading === "preparing" && (
            <Typography.Paragraph className="font-ui text-[10px] text-muted">
              {progress > 0 && progress < 1
                ? `Voice ${Math.round(progress * 100)}%`
                : "Getting the voice ready…"}
            </Typography.Paragraph>
          )}
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
  const { rag, db, embed, tier, settings, invalidate, voiceReady, readerReady } = useAI();
  const router = useRouter();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { overlap, onLayout } = useKeyboardOverlap();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("ask");
  // None by default. Retrieval makes every answer slower and drags in passages
  // that may have nothing to do with the question; it should be something you
  // reach for when the answer ought to come from your own material.
  const [scope, setScope] = useState<Scope>({ kind: "none" });
  const [sheet, setSheet] = useState<"mode" | "knowledge" | null>(null);
  // The questions still to come in a running test. Entries hold what has been
  // asked; this holds what has not, so answering never needs the model.
  const [test, setTest] = useState<{ items: QuizQuestion[]; index: number; right: number } | null>(
    null
  );
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  // One voice for the whole conversation — see useReader for why not one per
  // reply. Keys carry a conversation number, so starting a new chat cannot
  // hand message 3 of the new one the "speaking" state of message 3 of the old.
  const reader = useReader();
  // The screen's one Whisper, shared with the composer's mic — see Composer.
  const dictation = useDictation(
    useCallback(
      (heard: string) => setDraft((prev) => (prev.trim() ? `${prev.trim()} ${heard}` : heard)),
      []
    )
  );
  const confirm = useConfirm();
  const [conversation, setConversation] = useState(0);
  const readKey = (index: number): string => `${conversation}:${index}`;
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
      setTest(null);
      setConversation((count) => count + 1);
    });
  }, [db, resume]);

  const persist = useCallback(
    async (body: Entry[]) => {
      if (!db) return;
      await saveChat(db, {
        id: chatId.current,
        title: body.find((entry) => entry.role === "user")?.content.slice(0, 80) ?? "Chat",
        body,
      });
      invalidate();
    },
    [db, invalidate]
  );

  // Every path through here returns what it answered, so talk mode can say it
  // aloud — or null when there is nothing worth saying.
  const ask = useCallback(
    async (question: string, history: Entry[], as: Mode): Promise<string | null> => {
      if (!rag || !question || busy) return null;

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
        // model, so changing a setting — or the mode — takes effect on the
        // next question instead of forcing a reload.
        const system =
          as === "teach" ? `${systemPrompt(settings)}\n\n${TEACH_PROMPT}` : systemPrompt(settings);
        const input: Message[] = [{ role: "system", content: system }, ...asMessages(asked)];

        // Retrieved here rather than inside generate(). The library's own
        // retrieval reads every embedding in the database into JavaScript on
        // every question and searches by meaning alone; this one stays bounded
        // in SQLite and adds a keyword pass for the exact terms — "RFC 1918",
        // an IP, a formula — that embeddings blur. See lib/retrieval.ts.
        if (scope.kind !== "none" && db && embed) {
          const chunks = await retrieve({ db, embed, query: question, scope });
          cites = citesOf(chunks);
          // Same `Message: … Context: …` shape the library appended, so the
          // model sees the format it always has and only the chunks change.
          input.push({
            role: "user",
            content: `Message: ${question}\nContext: ${asContext(chunks)}`,
          });
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
        await persist(finished);
        return answer;
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
        return null;
      } finally {
        setStreaming(null);
      }
    },
    [rag, db, embed, busy, scope, settings, persist]
  );

  /**
   * Writes a whole test in one generation, then deals it out a question at a
   * time. One call for five questions is faster than five calls, and the
   * pacing the student sees is the same.
   */
  const startTest = useCallback(
    async (said: string, topic: string, history: Entry[]): Promise<string | null> => {
      if (!rag || busy) return null;

      const asked: Entry[] = [...history, { role: "user", content: said }];
      setEntries(asked);
      setDraft("");
      setTest(null);

      // Nothing to test on: no topic, and no notes or subject chosen to take
      // one from. Asked here, not by the model — it would only invent a topic.
      const named = scope.kind === "sources" || scope.kind === "subject";
      if (!topic && !named) {
        const reply =
          "What should I test you on? Name a topic, or pick some notes with the notes chip below.";
        const next: Entry[] = [...asked, { role: "assistant", content: reply }];
        setEntries(next);
        void persist(next);
        return reply;
      }

      setStreaming("");
      try {
        let context = "";
        let cites: Cite[] = [];
        if (named && !topic && db) {
          // "Test me on my notes": the chosen notes themselves — or every note
          // in the chosen subject — not a search for a topic nobody named.
          const ids =
            scope.kind === "sources"
              ? scope.ids
              : (await listNotes(db))
                  .filter((note) => scope.kind === "subject" && note.subject === scope.id)
                  .map((note) => note.id);
          const bodies = await Promise.all(ids.map((id) => readSource(db, id)));
          context = clampForPrompt(bodies.join("\n\n"));
        } else if (scope.kind !== "none" && db && embed) {
          const chunks = await retrieve({ db, embed, query: topic, scope, limit: 6 });
          context = asContext(chunks, 3000);
          cites = citesOf(chunks);
        }

        const write = async (): Promise<QuizQuestion[]> => {
          let out = "";
          let tokens = 0;
          let cut = false;
          await rag.generate({
            input: [
              { role: "system", content: testPrompt(topic) },
              { role: "user", content: context ? `Context:\n${context}` : `Topic: ${topic}` },
            ],
            augmentedGeneration: false,
            // Deliberately not streamed to the screen: the raw text has every
            // answer in it.
            callback: (token) => {
              out += token;
              tokens += 1;
              if (tokens > TEST_TOKENS && !cut) {
                cut = true;
                void rag.interrupt();
              }
            },
          });
          return parseQuiz(out).slice(0, TEST_LENGTH);
        };

        // Once more if the first reply had nothing answerable in it. A small
        // model drifts off the format now and then; twice running is a topic
        // it cannot write questions about, and saying so beats a third try.
        let items = await write();
        if (items.length === 0) items = await write();

        const first = items[0];
        const next: Entry[] = first
          ? [
              ...asked,
              {
                role: "assistant",
                content: first.question,
                cites,
                question: {
                  options: first.options,
                  correctIndex: first.correctIndex,
                  number: 1,
                  total: items.length,
                },
              },
            ]
          : [
              ...asked,
              {
                role: "assistant",
                content:
                  "I couldn't write questions on that. Try a narrower topic, or pick the notes to test you from.",
              },
            ];
        if (first) setTest({ items, index: 0, right: 0 });
        setEntries(next);
        setStreaming(null);
        await persist(next);
        return first
          ? spokenQuestion(1, items.length, first.question, first.options)
          : (next[next.length - 1]?.content ?? null);
      } catch (error) {
        setEntries([
          ...asked,
          {
            role: "assistant",
            content: `Couldn't write the test: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ]);
        return null;
      } finally {
        setStreaming(null);
      }
    },
    [rag, db, embed, busy, scope, persist]
  );

  /**
   * Marks the answer, then deals the next question or the score. No model call.
   *
   * `said` is the words behind a typed or spoken answer — "B", "the second
   * one" — kept as a bubble so the history shows what was heard, which is the
   * first thing to check when a spoken answer was marked wrong.
   *
   * Returns what to say next: the verdict, then the next question or the score.
   */
  const answer = useCallback(
    (index: number, choice: number, said?: string): string | null => {
      const entry = entries[index];
      if (!test || !entry?.question || entry.question.chosen !== undefined) return null;

      const { options, correctIndex } = entry.question;
      const right = test.right + (choice === correctIndex ? 1 : 0);
      const answered: Entry[] = entries.map((item, at) =>
        at === index && item.question
          ? { ...item, question: { ...item.question, chosen: choice } }
          : item
      );
      if (said) answered.push({ role: "user", content: said });
      const upcoming = test.items[test.index + 1];

      let next: Entry[];
      let spoken: string;
      if (upcoming) {
        next = [
          ...answered,
          {
            role: "assistant",
            content: upcoming.question,
            question: {
              options: upcoming.options,
              correctIndex: upcoming.correctIndex,
              number: test.index + 2,
              total: test.items.length,
            },
          },
        ];
        spoken = spokenQuestion(
          test.index + 2,
          test.items.length,
          upcoming.question,
          upcoming.options
        );
        setTest({ ...test, index: test.index + 1, right });
      } else {
        spoken = scoreLine(right, test.items.length);
        next = [...answered, { role: "assistant", content: spoken }];
        setTest(null);
      }
      setEntries(next);
      void persist(next);
      return `${verdict(options, correctIndex, choice)} ${spoken}`;
    },
    [entries, test, persist]
  );

  /** A mode picked from the chip: switch, and mark the switch in the history. */
  const pickMode = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      setMode(next);
      setTest(null);
      if (entries.length > 0) {
        setEntries([...entries, { role: "assistant", content: MODES[next].label, divider: true }]);
      }
    },
    [mode, entries]
  );

  /**
   * Everything the composer sends comes through here. The matcher gets first
   * look: "test me on TCP" switches the chip and starts a test, and anything
   * else goes to whichever mode the chip is on.
   */
  const send = useCallback(
    async (raw: string, spoken = false): Promise<string | null> => {
      const text = raw.trim();
      if (!text || busy) return null;

      // A question is waiting: "B", "the second one", "reliable delivery" is
      // an answer to it, typed or said — not a new topic, which is what Test
      // mode would otherwise make of it.
      const waiting = entries[entries.length - 1];
      if (test && waiting?.question && waiting.question.chosen === undefined) {
        const choice = spokenChoice(text, waiting.question.options);
        if (choice >= 0) {
          setDraft("");
          return answer(entries.length - 1, choice, text);
        }
        // Heard but not understood. Asked again rather than guessed, since a
        // mishearing marked wrong is worse than a second ask. Typed, it falls
        // through: a typed sentence during a test may be a new topic.
        if (spoken) {
          return `Sorry, which one? Say ${waiting.question.options
            .map((_, index) => String.fromCharCode(65 + index))
            .join(", ")
            .replace(/, ([^,]*)$/, " or $1")}.`;
        }
      }

      // Asked to be *given* a quiz: a card that opens the Quiz page, in any
      // mode, without leaving it. Nothing to generate here — the page does
      // that — so this answers instantly.
      const wanted = detectQuiz(text);
      if (wanted) {
        setTest(null);
        const ids = scope.kind === "sources" ? scope.ids : [];
        const reply: Entry =
          !wanted.topic && scope.kind !== "sources" && scope.kind !== "subject"
            ? {
                role: "assistant",
                content:
                  "What should the quiz be on? Name a topic, or pick some notes with the notes chip below.",
              }
            : {
                role: "assistant",
                content: `A ${wanted.count}-question quiz${wanted.topic ? ` on ${wanted.topic}` : ""}, ready to open.`,
                quiz: {
                  topic: wanted.topic,
                  count: wanted.count,
                  // "@" marks a subject — see the Quiz page for the encoding.
                  sources:
                    scope.kind === "all"
                      ? "*"
                      : scope.kind === "subject"
                        ? `@${scope.id}`
                        : ids.join(","),
                  basis:
                    scope.kind === "all"
                      ? "all your notes"
                      : scope.kind === "subject"
                        ? scope.id
                        : ids.length > 0
                          ? `${ids.length} selected`
                          : "general knowledge",
                },
              };
        const next: Entry[] = [...entries, { role: "user", content: text }, reply];
        setEntries(next);
        setDraft("");
        void persist(next);
        // A card cannot be read out, so say where to find it.
        return reply.quiz ? `${reply.content} Tap Open quiz when you're ready.` : reply.content;
      }

      const hit = detectMode(text);
      let history = entries;
      let as = mode;
      if (hit && hit.mode !== mode) {
        as = hit.mode;
        setMode(hit.mode);
        history = [
          ...entries,
          {
            role: "assistant",
            content: `${MODES[hit.mode].label}${hit.topic ? ` · ${hit.topic}` : ""}`,
            divider: true,
          },
        ];
      }

      // In Test mode a plain message is the topic — that is what the
      // placeholder asks for.
      if (as === "test") return startTest(text, hit ? hit.topic : text, history);

      setTest(null);

      // A bare switch — "stop the test", "teach me" with nothing to teach —
      // gets a line from here rather than a model call about nothing.
      if (hit && !hit.topic) {
        const reply =
          as === "ask" ? "Okay — back to answering questions." : "Sure. What would you like to learn?";
        const next: Entry[] = [
          ...history,
          { role: "user", content: text },
          { role: "assistant", content: reply },
        ];
        setEntries(next);
        setDraft("");
        void persist(next);
        return reply;
      }

      return ask(text, history, as);
    },
    [busy, entries, test, mode, scope, answer, startTest, ask, persist]
  );

  /* ---------------------------------------------------------- talk mode --- */

  // Hands-free: listen until you stop talking, answer, say the answer, listen
  // again — the same send() as typing, so every mode, the matcher and spoken
  // test answers work by voice with no second code path to drift.
  const [talk, setTalk] = useState<"off" | "warming" | "listening" | "thinking" | "speaking">(
    "off"
  );
  const [talkNotice, setTalkNotice] = useState<string | null>(null);
  const talking = useRef(false);
  // The loop outlives many renders, so it reads the latest of these through
  // refs rather than the ones that existed when it started — above all send,
  // whose idea of the conversation changes after every turn.
  const sendRef = useRef(send);
  const warm = useRef<{ mic: boolean; voice: boolean; failed: string | null }>({
    mic: false,
    voice: false,
    failed: null,
  });
  useEffect(() => {
    sendRef.current = send;
    warm.current = {
      mic: dictation.ready,
      voice: reader.ready,
      failed: dictation.failed ?? reader.failed,
    };
  }, [send, dictation.ready, reader.ready, dictation.failed, reader.failed]);

  const endTalk = useCallback(
    (why?: string) => {
      talking.current = false;
      setTalk("off");
      setTalkNotice(why ?? null);
      dictation.cancelListen();
      reader.stop();
      // Stopped mid-answer: stop writing it too, or it finishes to nobody.
      if (busy) void rag?.interrupt();
    },
    [dictation, reader, busy, rag]
  );
  // endTalk changes identity on every render — dictation and reader are fresh
  // objects each time — so anything long-lived calls it through this. Two
  // places would break without it: useFocusEffect re-runs its cleanup when
  // its callback changes, which ended talk mode on the first re-render after
  // it started; and the loop would call the endTalk from the turn it began,
  // with that turn's out-of-date idea of whether an answer is being written.
  const endTalkRef = useRef(endTalk);
  useEffect(() => {
    endTalkRef.current = endTalk;
  }, [endTalk]);

  const runTalk = useCallback(async () => {
    talking.current = true;
    setTalkNotice(null);
    dictation.prepare();
    reader.prepare();
    setTalk("warming");
    // Both voices loaded before the first turn: listening with no way to
    // answer aloud, or answering with no way to hear the reply, is half a
    // conversation.
    while (talking.current && !(warm.current.mic && warm.current.voice)) {
      // A model that failed to load will never be ready; waiting on it would
      // leave "Getting the voices ready…" up forever.
      if (warm.current.failed) {
        endTalkRef.current(`Talk mode couldn't start: ${warm.current.failed}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    let turn = 0;
    while (talking.current) {
      setTalk("listening");
      const heard = await dictation.listen();
      if (!talking.current) return;
      if (!heard) {
        // Silence twice would be a mic left open in a pocket. Once is enough
        // to stop and say so.
        endTalkRef.current("Talk mode stopped — I didn't hear anything.");
        return;
      }
      setTalk("thinking");
      const reply = await sendRef.current(heard, true);
      if (!talking.current) return;
      if (reply) {
        setTalk("speaking");
        await reader.say(`talk:${turn}`, reply);
        turn += 1;
      }
    }
  }, [dictation, reader]);

  /**
   * Asked once, for both voices together — talk mode needs both, and two
   * download questions in a row for one button is one too many.
   */
  const toggleTalk = useCallback(() => {
    if (talk !== "off") {
      endTalk();
      return;
    }
    const megabytes = (voiceReady ? 0 : 222) + (readerReady ? 0 : 335);
    if (megabytes === 0) {
      void runTalk();
      return;
    }
    confirm.ask({
      title: "Download the voice models?",
      message: `Talk mode listens with Whisper and answers aloud with Kokoro — ${megabytes} MB, downloaded once. After that it works with the radio off.`,
      action: "Download",
      onConfirm: () => void runTalk(),
    });
  }, [talk, endTalk, voiceReady, readerReady, runTalk, confirm]);

  // A tab stays mounted when you leave it, so without this the mic would stay
  // open — or a reply keep reading aloud — behind whatever screen you went to.
  // Through the ref — see endTalkRef. reader.stop is stable.
  const stopReading = reader.stop;
  useFocusEffect(
    useCallback(
      () => () => {
        if (talking.current) endTalkRef.current();
        else stopReading();
      },
      [stopReading]
    )
  );

  /** Drops the last answer and asks the same question again. */
  const regenerate = useCallback(
    (index: number) => {
      const question = entries[index - 1];
      if (!question || question.role !== "user" || busy) return;
      void ask(question.content, entries.slice(0, index - 1), mode === "test" ? "ask" : mode);
    },
    [entries, busy, ask, mode]
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

  // Only the question being asked right now takes a tap.
  const last = entries[entries.length - 1];
  const activeQuestion =
    test && last?.question && last.question.chosen === undefined ? entries.length - 1 : -1;

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
          Tutor
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
            setTest(null);
            setConversation((count) => count + 1);
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
          item.divider ? (
            <Divider text={item.content} />
          ) : item.quiz ? (
            <QuizCard offer={item.quiz} />
          ) : item.question ? (
            <QuestionCard
              text={item.content}
              question={item.question}
              active={index === activeQuestion}
              onAnswer={(choice) => answer(index, choice)}
            />
          ) : item.role === "assistant" && item.content === "" ? (
            <View className="my-2.5 flex-row gap-2.5">
              <Mascot pose="stretch" size={38} />
              <Thinking label={mode === "test" ? "Writing your questions…" : undefined} />
            </View>
          ) : (
            <Turn
              entry={item}
              saved={savedIds.has(index)}
              onSave={() => void saveAnswer(index)}
              onRegenerate={() => regenerate(index)}
              reading={
                reader.speaking === readKey(index)
                  ? "speaking"
                  : reader.preparing === readKey(index)
                    ? "preparing"
                    : "idle"
              }
              progress={reader.downloadProgress}
              onRead={() => reader.toggle(readKey(index), item.content)}
            />
          )
        }
        ListHeaderComponent={
          entries.length > 0 && scope.kind !== "none" ? (
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
          // A hello, not a menu. The chips below already say what it can do,
          // and the greeting follows them — pick Test me and it tells you to
          // name a topic.
          <View className="items-center gap-3 px-4 pt-10">
            <Mascot pose="stretch" size={150} />
            <Typography.Heading
              type="h2"
              className="pt-2 text-center font-ui-bold text-[24px] tracking-tight"
            >
              Hi, I&apos;m Friday.
            </Typography.Heading>
            <Typography.Paragraph className="text-center font-read text-[15px] leading-[23px] text-muted-strong">
              {MODES[mode].hello}
            </Typography.Paragraph>
          </View>
        }
      />

      {/* What talk mode is doing, and the way out. Worded as instructions,
          because the one thing a hands-free screen must never leave unclear
          is whether it is listening. */}
      {talk !== "off" && (
        <View
          accessibilityLiveRegion="polite"
          className="mx-4 mb-2 flex-row items-center gap-2.5 rounded-2xl border px-3.5 py-2.5"
          style={{
            borderColor: talk === "listening" ? palette.warning : palette.border,
            backgroundColor: talk === "listening" ? palette.warningSoft : palette.surface,
          }}
        >
          <Ionicons
            name={
              talk === "listening"
                ? "mic"
                : talk === "speaking"
                  ? "volume-high"
                  : talk === "thinking"
                    ? "ellipsis-horizontal"
                    : "download-outline"
            }
            size={17}
            color={talk === "listening" ? palette.warning : palette.muted}
          />
          <Typography.Paragraph className="flex-1 font-ui-medium text-[12.5px]" numberOfLines={2}>
            {talk === "warming"
              ? dictation.downloadProgress > 0 && dictation.downloadProgress < 1
                ? `Getting the listening model · ${Math.round(dictation.downloadProgress * 100)}%`
                : reader.downloadProgress > 0 && reader.downloadProgress < 1
                  ? `Getting the voice · ${Math.round(reader.downloadProgress * 100)}%`
                  : "Getting the voices ready…"
              : talk === "listening"
                ? "Listening — just talk. It answers when you stop."
                : talk === "thinking"
                  ? "Thinking…"
                  : "Speaking — it will listen again when it's done."}
          </Typography.Paragraph>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop talk mode"
            onPress={() => endTalk()}
            className="min-h-[34px] justify-center rounded-full border border-border bg-background px-3 active:opacity-70"
          >
            <Typography.Paragraph className="font-ui-bold text-[12px]">Stop</Typography.Paragraph>
          </Pressable>
        </View>
      )}

      {talk === "off" && talkNotice && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${talkNotice}. Dismiss.`}
          onPress={() => setTalkNotice(null)}
          className="mx-4 mb-2 flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2"
        >
          <Ionicons name="mic-off-outline" size={15} color={palette.muted} />
          <Typography.Paragraph className="flex-1 font-ui text-[12px] text-muted" numberOfLines={2}>
            {talkNotice}
          </Typography.Paragraph>
          <Ionicons name="close" size={15} color={palette.muted} />
        </Pressable>
      )}

      {reader.notice && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${reader.notice}. Dismiss.`}
          onPress={reader.dismiss}
          className="mx-4 mb-2 flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2"
        >
          <Ionicons name="volume-mute-outline" size={15} color={palette.muted} />
          <Typography.Paragraph className="flex-1 font-ui text-[12px] text-muted" numberOfLines={2}>
            {reader.notice}
          </Typography.Paragraph>
          <Ionicons name="close" size={15} color={palette.muted} />
        </Pressable>
      )}

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => void send(draft)}
        placeholder={PLACEHOLDERS[mode]}
        dictation={dictation}
        // One conversation at a time: typing into a turn talk mode is in the
        // middle of would race it for the same model.
        editable={talk === "off"}
        busy={busy}
        onStop={() => void rag?.interrupt()}
        overlap={overlap}
        controls={
          <View className="flex-row flex-wrap items-center gap-2">
            <Chip
              icon={MODES[mode].icon}
              label={MODES[mode].label}
              on={mode !== "ask"}
              hint="Change how the tutor helps"
              onPress={() => setSheet("mode")}
            />
            <Chip
              icon={scope.kind === "none" ? "layers-outline" : "layers"}
              label={scopeLabel(scope)}
              on={scope.kind !== "none"}
              hint="Choose which notes the tutor uses"
              onPress={() => setSheet("knowledge")}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: talk !== "off" }}
              accessibilityLabel={
                talk === "off" ? "Talk. Speak to the tutor and hear it answer." : "Stop talk mode"
              }
              onPress={toggleTalk}
              className={`min-h-[34px] flex-row items-center gap-1.5 rounded-full border px-2.5 ${
                talk === "off" ? "border-border" : "border-warning bg-warning-soft"
              }`}
            >
              <Ionicons
                name={talk === "off" ? "headset-outline" : "headset"}
                size={14}
                color={talk === "off" ? palette.muted : palette.warning}
              />
              <Typography.Paragraph
                className="font-ui-medium text-[11px]"
                style={{ color: talk === "off" ? palette.muted : palette.warning }}
              >
                Talk
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

      {sheet === "mode" && (
        <ModeSheet mode={mode} onPick={pickMode} onClose={() => setSheet(null)} />
      )}
      {sheet === "knowledge" && (
        <KnowledgeSheet scope={scope} onPick={setScope} onClose={() => setSheet(null)} />
      )}
      {reader.dialog}
      {confirm.dialog}
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
