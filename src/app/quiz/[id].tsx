import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spinner, Typography } from "heroui-native";
import { useCallback, useEffect, useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ChoiceRow, Group, PageHeader, SectionTitle } from "../../components/screen";
import { ModelGate, getNote, useAI } from "../../lib/ai";
import { clampForPrompt, parseFlashcards, parseQuiz } from "../../lib/formats";
import { usePalette } from "../../lib/theme";

const MODES = {
  multiple: {
    label: "Multiple choice",
    note: "Four options, one right.",
    format:
      "Format each question exactly as:\nQ: <question>\nA) <option>\nB) <option>\nC) <option>\nD) <option>\nCorrect: <letter>",
  },
  boolean: {
    label: "True or false",
    note: "Quick statements to judge.",
    format:
      "Write statements that are either true or false, and make roughly half of them false. Format each exactly as:\nQ: <statement>\nAnswer: True",
  },
  recall: {
    label: "Recall",
    note: "Answer in your head, then check.",
    format: "Format each exactly as:\nQ: <question>\nA: <answer>",
  },
} as const;

const DIFFICULTIES = {
  easy: {
    label: "Easy",
    note: "Straight from the text.",
    rule: "Keep the questions straightforward.",
  },
  normal: { label: "Normal", note: "A fair test.", rule: "" },
  hard: {
    label: "Hard",
    note: "Tests understanding, not recall.",
    rule: "Make the questions demanding: test understanding rather than recognition.",
  },
} as const;

const COUNTS = [5, 10] as const;

type Mode = keyof typeof MODES;
type Difficulty = keyof typeof DIFFICULTIES;

/** One answerable item. `reveal` carries the model's own answer for recall mode. */
type Item = { question: string; options: string[]; correctIndex: number; reveal?: string };

type Phase =
  | { kind: "setup" }
  | { kind: "writing"; ready: number }
  | { kind: "taking"; items: Item[]; index: number; answers: number[] }
  | { kind: "done"; items: Item[]; answers: number[] }
  | { kind: "failed"; message: string };

function toItems(text: string, mode: Mode): Item[] {
  if (mode === "recall") {
    // Self-graded, so "correct" is whatever you claim — the value is in the
    // reveal, not the score.
    return parseFlashcards(text).map((card) => ({
      question: card.question,
      options: ["I knew it", "I missed it"],
      correctIndex: 0,
      reveal: card.answer,
    }));
  }
  return parseQuiz(text, mode === "boolean");
}

function buildPrompt(mode: Mode, difficulty: Difficulty, count: number): string {
  return [
    `Write exactly ${count} questions about the note below.`,
    MODES[mode].format,
    DIFFICULTIES[difficulty].rule,
    "Use only what the note says. Do not add any other text.",
  ]
    .filter(Boolean)
    .join("\n");
}

function Option({
  text,
  state,
  onPress,
}: {
  text: string;
  state: "idle" | "chosen-right" | "chosen-wrong" | "correct";
  onPress: () => void;
}): JSX.Element {
  const palette = usePalette();

  const skin = {
    idle: "border-border bg-surface",
    "chosen-right": "border-success bg-surface",
    "chosen-wrong": "border-danger bg-surface",
    correct: "border-success bg-surface",
  }[state];

  const icon =
    state === "chosen-right" || state === "correct"
      ? ("checkmark-circle" as const)
      : state === "chosen-wrong"
        ? ("close-circle" as const)
        : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      disabled={state !== "idle"}
      onPress={onPress}
      className={`min-h-[56px] flex-row items-center gap-3 rounded-2xl border px-4 py-3.5 active:opacity-80 ${skin}`}
    >
      <Typography.Paragraph className="flex-1 font-read text-[16px] leading-[23px]">
        {text}
      </Typography.Paragraph>
      {icon && (
        <Ionicons
          name={icon}
          size={20}
          color={state === "chosen-wrong" ? palette.danger : palette.success}
        />
      )}
    </Pressable>
  );
}

function Quiz({ id }: { id: string }): JSX.Element {
  const { rag, db } = useAI();
  const router = useRouter();
  const palette = usePalette();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<Mode>("multiple");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [count, setCount] = useState<number>(5);
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    if (!db) return;
    void getNote(db, id).then((note) => {
      if (!note) return;
      setTitle(note.title);
      setBody(note.body);
    });
  }, [db, id]);

  const start = useCallback(async () => {
    if (!rag || !body.trim()) return;
    setPhase({ kind: "writing", ready: 0 });
    setPicked(null);

    let out = "";
    try {
      await rag.generate({
        input: [
          { role: "system", content: buildPrompt(mode, difficulty, count) },
          { role: "user", content: clampForPrompt(body) },
        ],
        augmentedGeneration: false,
        callback: (token) => {
          out += token;
          // Parsing as it streams costs little and turns a long blank wait into
          // a counter that visibly moves.
          setPhase({ kind: "writing", ready: toItems(out, mode).length });
        },
      });

      const items = toItems(out, mode).slice(0, count);
      setPhase(
        items.length > 0
          ? { kind: "taking", items, index: 0, answers: [] }
          : {
              kind: "failed",
              message:
                "The model didn't produce anything answerable. A shorter note, or a larger model in Library, usually fixes it.",
            }
      );
    } catch (error) {
      setPhase({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }, [rag, body, mode, difficulty, count]);

  const next = useCallback(() => {
    if (phase.kind !== "taking" || picked === null) return;
    const answers = [...phase.answers, picked];
    setPicked(null);
    setPhase(
      phase.index + 1 < phase.items.length
        ? { ...phase, index: phase.index + 1, answers }
        : { kind: "done", items: phase.items, answers }
    );
  }, [phase, picked]);

  /* ---------------------------------------------------------------- setup */
  if (phase.kind === "setup" || phase.kind === "failed") {
    return (
      <View className="flex-1 bg-background">
        <PageHeader title={title || "Quiz"} onBack={() => router.back()} />
        <ScrollView className="flex-1" contentContainerClassName="px-4 pt-4 pb-10 gap-5">
          {phase.kind === "failed" && (
            <View className="rounded-2xl border border-danger bg-surface px-4 py-3">
              <Typography.Paragraph className="font-ui text-[13px] leading-5">
                {phase.message}
              </Typography.Paragraph>
            </View>
          )}

          <SectionTitle>Question type</SectionTitle>
          <Group>
            {(Object.keys(MODES) as Mode[]).map((key, index) => (
              <ChoiceRow
                key={key}
                first={index === 0}
                label={MODES[key].label}
                note={MODES[key].note}
                selected={mode === key}
                onPress={() => setMode(key)}
              />
            ))}
          </Group>

          <SectionTitle>Difficulty</SectionTitle>
          <Group>
            {(Object.keys(DIFFICULTIES) as Difficulty[]).map((key, index) => (
              <ChoiceRow
                key={key}
                first={index === 0}
                label={DIFFICULTIES[key].label}
                note={DIFFICULTIES[key].note}
                selected={difficulty === key}
                onPress={() => setDifficulty(key)}
              />
            ))}
          </Group>

          <SectionTitle>How many</SectionTitle>
          <Group>
            {COUNTS.map((value, index) => (
              <ChoiceRow
                key={value}
                first={index === 0}
                label={`${value} questions`}
                note={value === 5 ? "About a minute to write." : "Slower, but a fuller test."}
                selected={count === value}
                onPress={() => setCount(value)}
              />
            ))}
          </Group>

          <Button isDisabled={!body.trim()} onPress={() => void start()}>
            Start quiz
          </Button>

          {!body.trim() && (
            <Typography.Paragraph className="font-read text-muted text-[15px] leading-6">
              This note is empty. Write something first and there will be something to ask about.
            </Typography.Paragraph>
          )}
        </ScrollView>
      </View>
    );
  }

  /* -------------------------------------------------------------- writing */
  if (phase.kind === "writing") {
    return (
      <View className="flex-1 bg-background">
        <PageHeader title={title || "Quiz"} onBack={() => router.back()} />
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <Spinner size="lg" />
          <Typography.Paragraph className="text-center font-ui-medium text-[16px]">
            {phase.ready > 0 ? `${phase.ready} of ${count} written` : "Reading your note"}
          </Typography.Paragraph>
          <Typography.Paragraph className="text-center font-read text-muted text-[15px] leading-6">
            The whole quiz is being written on this phone, so give it a moment.
          </Typography.Paragraph>
        </View>
      </View>
    );
  }

  /* --------------------------------------------------------------- taking */
  if (phase.kind === "taking") {
    const item = phase.items[phase.index];
    const answered = picked !== null;

    return (
      <View className="flex-1 bg-background">
        <PageHeader
          title={`Question ${phase.index + 1} of ${phase.items.length}`}
          onBack={() => router.back()}
        />

        <View className="h-[3px] w-full bg-surface-tertiary">
          <View
            className="h-full bg-accent"
            style={{ width: `${((phase.index + (answered ? 1 : 0)) / phase.items.length) * 100}%` }}
          />
        </View>

        <ScrollView className="flex-1" contentContainerClassName="px-4 pt-5 pb-8 gap-5">
          <Typography.Paragraph className="font-read text-[21px] leading-[31px]">
            {item.question}
          </Typography.Paragraph>

          <View className="gap-2.5">
            {item.options.map((option, index) => (
              <Option
                key={option}
                text={option}
                state={
                  !answered
                    ? "idle"
                    : index === picked
                      ? index === item.correctIndex
                        ? "chosen-right"
                        : "chosen-wrong"
                      : index === item.correctIndex
                        ? "correct"
                        : "idle"
                }
                onPress={() => setPicked(index)}
              />
            ))}
          </View>

          {answered && item.reveal && (
            <View className="flex-row gap-3 rounded-2xl border border-border bg-surface p-4">
              <View className="w-[3px] rounded-full bg-accent" />
              <Typography.Paragraph className="flex-1 font-read text-[16px] leading-[24px]">
                {item.reveal}
              </Typography.Paragraph>
            </View>
          )}

          {answered && (
            <Button onPress={next}>
              {phase.index + 1 < phase.items.length ? "Next question" : "See score"}
            </Button>
          )}
        </ScrollView>
      </View>
    );
  }

  /* ----------------------------------------------------------------- done */
  const score = phase.answers.filter((a, i) => a === phase.items[i].correctIndex).length;

  return (
    <View className="flex-1 bg-background">
      <PageHeader title="Score" onBack={() => router.back()} />
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-6 pb-10 gap-5">
        <View className="items-center gap-1">
          <Typography.Heading type="h1" className="font-ui-bold text-accent text-[54px]">
            {score}/{phase.items.length}
          </Typography.Heading>
          <Typography.Paragraph className="font-read text-muted text-[16px]">
            {score === phase.items.length
              ? "Every one right."
              : score === 0
                ? "Worth another read of the note."
                : "Review the misses below."}
          </Typography.Paragraph>
        </View>

        <Group>
          {phase.items.map((item, index) => {
            const right = phase.answers[index] === item.correctIndex;
            return (
              <View
                key={`${index}-${item.question}`}
                className={`gap-2 px-4 py-3.5 ${index > 0 ? "border-t border-border" : ""}`}
              >
                <View className="flex-row items-start gap-2.5">
                  <Ionicons
                    name={right ? "checkmark-circle" : "close-circle"}
                    size={18}
                    color={right ? palette.success : palette.danger}
                  />
                  <Typography.Paragraph className="flex-1 font-read text-[16px] leading-[23px]">
                    {item.question}
                  </Typography.Paragraph>
                </View>
                {!right && (
                  <Typography.Paragraph className="pl-7 font-ui text-muted text-[13px]">
                    Answer: {item.reveal ?? item.options[item.correctIndex]}
                  </Typography.Paragraph>
                )}
              </View>
            );
          })}
        </Group>

        <Button onPress={() => setPhase({ kind: "setup" })}>Quiz me again</Button>
      </ScrollView>
    </View>
  );
}

export default function QuizScreen(): JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ModelGate>
      <Quiz id={id} />
    </ModelGate>
  );
}
