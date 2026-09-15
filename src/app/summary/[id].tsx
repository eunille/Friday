import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spinner, Typography } from "heroui-native";
import { useCallback, useEffect, useState, type JSX } from "react";
import { View } from "react-native";

import { ChoiceRow, Group, PageHeader, PageScroll, SectionTitle } from "../../components/screen";
import { ModelGate, getNote, useAI } from "../../lib/ai";
import { clampForPrompt } from "../../lib/formats";

const STYLES = {
  bullets: {
    label: "Key points",
    note: "Up to five one-line takeaways.",
    prompt: "Summarise the note below as at most five short bullet points, one line each.",
  },
  paragraph: {
    label: "Short paragraph",
    note: "The gist, in prose.",
    prompt: "Summarise the note below in one short paragraph.",
  },
  outline: {
    label: "Outline",
    note: "Headings with sub-points, for revision.",
    prompt: "Summarise the note below as a short outline: a few headings, each with sub-points.",
  },
} as const;

type Style = keyof typeof STYLES;

/** Strips whatever bullet glyph the model chose, so the list renders as one style. */
function bulletLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
        .replace(/\*\*/g, "")
        .trim()
    )
    .filter((line) => line !== "");
}

function Summary({ id }: { id: string }): JSX.Element {
  const { rag, db } = useAI();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [style, setStyle] = useState<Style>("bullets");
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!db) return;
    void getNote(db, id).then((note) => {
      if (!note) return;
      setTitle(note.title);
      setBody(note.body);
    });
  }, [db, id]);

  const run = useCallback(async () => {
    if (!rag || busy || !body.trim()) return;
    setBusy(true);
    setOutput("");

    let out = "";
    try {
      await rag.generate({
        input: [
          // The note is already in the prompt, and the style chosen here would
          // fight the global length preference, so this page sets its own rules.
          { role: "system", content: `${STYLES[style].prompt} Use only what the note says.` },
          { role: "user", content: clampForPrompt(body) },
        ],
        augmentedGeneration: false,
        callback: (token) => {
          out += token;
          setOutput(out);
        },
      });
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [rag, busy, body, style]);

  return (
    <View className="flex-1 bg-background">
      <PageHeader title={title || "Summary"} onBack={() => router.back()} />

      <PageScroll>
        <SectionTitle>How should it be summarised?</SectionTitle>
        <Group>
          {(Object.keys(STYLES) as Style[]).map((key, index) => (
            <ChoiceRow
              key={key}
              first={index === 0}
              label={STYLES[key].label}
              note={STYLES[key].note}
              selected={style === key}
              onPress={() => setStyle(key)}
            />
          ))}
        </Group>

        <Button isDisabled={busy || !body.trim()} onPress={() => void run()}>
          {busy ? <Spinner size="sm" /> : output === null ? "Summarise" : "Summarise again"}
        </Button>

        {output !== null && (
          <View className="gap-3 rounded-2xl border border-border bg-surface p-4">
            {output === "" ? (
              <View className="flex-row items-center gap-2.5">
                <Spinner size="sm" />
                <Typography.Paragraph className="font-ui text-muted text-[13px]">
                  Reading the note
                </Typography.Paragraph>
              </View>
            ) : style === "bullets" ? (
              bulletLines(output).map((line, index) => (
                <View key={`${index}-${line}`} className="flex-row gap-3">
                  <View className="mt-[9px] h-1.5 w-1.5 rounded-full bg-accent" />
                  <Typography.Paragraph className="flex-1 font-read text-[16px] leading-[25px]">
                    {line}
                  </Typography.Paragraph>
                </View>
              ))
            ) : (
              <Typography.Paragraph className="font-read text-[16px] leading-[25px]">
                {output}
              </Typography.Paragraph>
            )}
          </View>
        )}

        {!body.trim() && (
          <Typography.Paragraph className="font-read text-muted text-[15px] leading-6">
            This note is empty. Write something first and there will be something to summarise.
          </Typography.Paragraph>
        )}
      </PageScroll>
    </View>
  );
}

export default function SummaryScreen(): JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ModelGate>
      <Summary id={id} />
    </ModelGate>
  );
}
