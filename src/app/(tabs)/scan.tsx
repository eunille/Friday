import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Typography } from "heroui-native";
import { OCR_ENGLISH, useOCR } from "react-native-executorch";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Image, Pressable, TextInput, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { Mascot, OnDeviceChip, PressCard, Screen } from "../../components/screen";
import { newNoteId, reindexNote, saveNoteText, useAI } from "../../lib/ai";
import { clampForPrompt, readingOrder } from "../../lib/formats";
import {
  AGES,
  EXTRACTION_PROMPT,
  REFERENCE_LABEL,
  isEmpty,
  parsePanel,
  readPanel,
  scorePanel,
  type Age,
  type Panel,
} from "../../lib/nutrition";
import { usePalette } from "../../lib/theme";

/**
 * How a label becomes a score. Written out because the interesting claim here
 * is not that it works, but that every step of it happens on the phone.
 */
const STEPS = [
  {
    icon: "crop-outline",
    title: "Photograph, then crop to the panel",
    note: "Crop tight. It is the one thing that most improves the reading.",
  },
  {
    icon: "text-outline",
    title: "Read the values",
    note: "A text recogniser pulls the numbers off the panel.",
  },
  {
    icon: "podium-outline",
    title: "Score them",
    note: "Against a published reference, for the age you pick.",
  },
] as const;

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; image: string }
  | { kind: "read"; image: string; words: number }
  | { kind: "scoring"; image: string }
  | { kind: "scored"; image: string; panel: Panel }
  | { kind: "unreadable"; image: string }
  | { kind: "failed"; message: string };

/** The score as a ring. Nothing in RN draws a conic gradient, but SVG has had
    a dashed arc since forever, and it animates for free if we ever want it. */
function ScoreRing({ score, colour, track }: { score: number; colour: string; track: string }): JSX.Element {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;

  return (
    <View className="h-24 w-24 items-center justify-center">
      <Svg width={96} height={96} style={{ position: "absolute" }}>
        <Circle cx={48} cy={48} r={radius} stroke={track} strokeWidth={9} fill="none" />
        <Circle
          cx={48}
          cy={48}
          r={radius}
          stroke={colour}
          strokeWidth={9}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.max(0, Math.min(100, score)) / 100)}
          transform="rotate(-90 48 48)"
        />
      </Svg>
      <Typography.Paragraph className="font-ui-bold text-[26px]">{score}</Typography.Paragraph>
      <Typography.Paragraph className="font-ui-medium text-[9.5px] text-muted">
        / 100
      </Typography.Paragraph>
    </View>
  );
}

export default function Scan(): JSX.Element {
  const { db, rag, invalidate } = useAI();
  const palette = usePalette();

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [text, setText] = useState("");
  const [age, setAge] = useState<Age>("adult");
  const [words, setWords] = useState("");
  const [saved, setSaved] = useState(false);

  // The detector and recogniser are ~35 MB together. Nobody should pay for
  // that by opening a tab, so loading waits until a photo actually exists.
  const [armed, setArmed] = useState(false);
  const ocr = useOCR({ model: OCR_ENGLISH, preventLoad: !armed });

  // Guards the effect below: forward() throws if called while already busy.
  const running = useRef(false);

  const pick = useCallback(async (from: "camera" | "library") => {
    const permission =
      from === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setPhase({
        kind: "failed",
        message:
          from === "camera"
            ? "Camera access is off. Turn it on for Offline AI in Android settings, then try again."
            : "Photo access is off. Turn it on for Offline AI in Android settings, then try again.",
      });
      return;
    }

    // Cropping is the single biggest thing that helps accuracy here. The
    // detector runs at a fixed input size, so a photo of a whole packet spends
    // most of that budget on packaging; cropped to the panel, it all goes on
    // the text. allowsEditing puts the system's crop tool in the way of every
    // scan deliberately.
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 1,
    };
    const result =
      from === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled || !result.assets[0]) return;
    setText("");
    setWords("");
    setSaved(false);
    setArmed(true);
    setPhase({ kind: "reading", image: result.assets[0].uri });
  }, []);

  // Recognition can only start once the models are in memory, which may be a
  // download away — so it is an effect keyed on readiness, not a call inside
  // the button handler.
  useEffect(() => {
    if (phase.kind !== "reading" || !ocr.isReady || running.current) return;
    running.current = true;
    const image = phase.image;

    void ocr
      .forward(image)
      .then((detections) => {
        const read = readingOrder(detections);
        setText(read);
        setPhase(
          read.trim() === ""
            ? {
                kind: "failed",
                message:
                  "Nothing readable in that photo. Crop tight to the nutrition panel, hold the phone square to the label rather than at an angle, and keep glare off it.",
              }
            : { kind: "read", image, words: detections.length }
        );
      })
      .catch((error: unknown) => {
        setPhase({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        running.current = false;
      });
  }, [phase, ocr]);

  /**
   * A nutrition panel is one of the most regular pieces of text there is, so a
   * parser reads it in under a millisecond with no model loaded at all. This
   * used to ask the language model for JSON and cost half a minute of staring
   * at a spinner to retype numbers that were already on screen.
   */
  const score = useCallback(
    (image: string) => {
      const panel = readPanel(text);
      setWords("");
      setPhase(isEmpty(panel) ? { kind: "unreadable", image } : { kind: "scored", image, panel });
    },
    [text]
  );

  /**
   * The escape hatch, for a panel worded in a way the parser does not know.
   * Slow, and opt-in for that reason. Even here the model only transcribes —
   * it is never asked whether the food is healthy, because that is arithmetic.
   */
  const scoreWithModel = useCallback(
    async (image: string) => {
      if (!rag) return;
      setPhase({ kind: "scoring", image });
      setWords("");

      let out = "";
      try {
        await rag.generate({
          input: [
            { role: "system", content: EXTRACTION_PROMPT },
            { role: "user", content: clampForPrompt(text) },
          ],
          augmentedGeneration: false,
          callback: (token) => {
            out += token;
          },
        });
      } catch (error) {
        setPhase({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
        return;
      }

      const panel = parsePanel(out);
      if (isEmpty(panel)) {
        setPhase({
          kind: "failed",
          message:
            "No nutrition values could be found in that text. Check the reading above — a missing serving column is the usual cause.",
        });
        return;
      }
      setPhase({ kind: "scored", image, panel });
    },
    [rag, text]
  );

  const assessment = useMemo(
    () => (phase.kind === "scored" ? scorePanel(phase.panel, age) : null),
    [phase, age]
  );

  /** A short plain-language reading. Separate call, so the score never waits on prose. */
  const explain = useCallback(async () => {
    if (!rag || !assessment || phase.kind !== "scored") return;
    setWords("");
    let out = "";
    const summary = assessment.rows
      .map((row) => `${row.label} ${row.amount} (${row.word})`)
      .join(", ");

    try {
      await rag.generate({
        input: [
          {
            role: "system",
            content:
              "You explain a food label in two or three short sentences of plain English, then suggest one practical thing a person could do. " +
              "Describe only the figures you are given. Do not diagnose, do not give medical advice, and do not invent numbers.",
          },
          {
            role: "user",
            content: `For a ${AGES[age].label.toLowerCase()} (${AGES[age].note}), one serving contains: ${summary}.`,
          },
        ],
        augmentedGeneration: false,
        callback: (token) => {
          out += token;
          setWords(out);
        },
      });
    } catch {
      // The score is the useful part and it is already on screen; a failed
      // paragraph should not take it away.
      setWords("");
    }
  }, [rag, assessment, age, phase]);

  const save = useCallback(async () => {
    if (!db || !rag || !text.trim()) return;
    const body =
      assessment && phase.kind === "scored"
        ? [
            `Score ${assessment.score}/100 — ${assessment.verdict}`,
            `Read for: ${AGES[age].label} (${AGES[age].note}) · ${REFERENCE_LABEL}`,
            "",
            ...assessment.rows.map((row) => `${row.label}: ${row.amount} — ${row.word}`),
            "",
            text,
          ].join("\n")
        : text;

    const id = newNoteId();
    await saveNoteText(db, {
      id,
      title: (phase.kind === "scored" && phase.panel.name) || "Scanned label",
      body,
    });
    await reindexNote(rag, db, id);
    setSaved(true);
    invalidate();
  }, [db, rag, text, assessment, phase, age, invalidate]);

  const toneColour = (tone: "good" | "watch" | "bad"): string =>
    tone === "bad" ? palette.danger : tone === "watch" ? palette.warning : palette.success;

  const scoreColour = (value: number): string =>
    value >= 70 ? palette.success : value >= 45 ? palette.warning : palette.danger;

  return (
    <View className="flex-1 bg-background">
      <Screen>
        <View className="gap-2 pb-1">
          <Typography.Heading type="h1" className="font-ui-bold text-[30px] tracking-tight">
            Scan a label
          </Typography.Heading>
          <Typography.Paragraph className="font-read text-[15px] leading-6 text-muted">
            Point the camera at a nutrition panel and get the numbers read back in plain words.
          </Typography.Paragraph>
          <OnDeviceChip label="Reads the photo on this phone" />
        </View>

        {phase.kind === "idle" && (
          <View className="gap-2.5">
            {STEPS.map((step, index) => (
              <PressCard key={step.title}>
                <View className="flex-row items-center gap-3">
                  <View className="h-9 w-9 items-center justify-center rounded-xl bg-warning-soft">
                    <Ionicons name={step.icon} size={19} color={palette.warning} />
                  </View>
                  <View className="flex-1">
                    <Typography.Paragraph className="font-ui-bold text-[13.5px]">
                      {index + 1}. {step.title}
                    </Typography.Paragraph>
                    <Typography.Paragraph className="mt-0.5 font-ui text-[11.5px] text-muted">
                      {step.note}
                    </Typography.Paragraph>
                  </View>
                </View>
              </PressCard>
            ))}
          </View>
        )}

        {(phase.kind === "reading" || phase.kind === "scoring") && (
          <View className="items-center gap-3 rounded-[20px] border border-border bg-surface p-5">
            <Image
              source={{ uri: phase.image }}
              className="h-32 w-32 rounded-2xl"
              resizeMode="cover"
              accessibilityLabel="The label you photographed"
            />
            <Typography.Paragraph className="font-ui-bold text-[13.5px]">
              {phase.kind === "scoring"
                ? "Pulling out the numbers"
                : ocr.isReady
                  ? "Reading the label"
                  : "Setting up the reader"}
            </Typography.Paragraph>
            <Typography.Paragraph className="text-center font-read text-[13px] leading-5 text-muted">
              {phase.kind === "scoring"
                ? "Finding the per-serving values in what was read."
                : ocr.isReady
                  ? "Finding the text and working out its order."
                  : `Downloading the recogniser, once only · ${Math.round(ocr.downloadProgress * 100)}%`}
            </Typography.Paragraph>
            {phase.kind === "reading" && !ocr.isReady && (
              <View className="h-1.5 w-full overflow-hidden rounded-full bg-surface-tertiary">
                <View
                  className="h-1.5 rounded-full bg-warning"
                  style={{ width: `${Math.round(ocr.downloadProgress * 100)}%` }}
                />
              </View>
            )}
          </View>
        )}

        {phase.kind === "read" && (
          <View className="gap-3">
            <View className="flex-row items-center gap-3">
              <Image
                source={{ uri: phase.image }}
                className="h-20 w-20 rounded-2xl"
                resizeMode="cover"
                accessibilityLabel="The label you photographed"
              />
              <View className="flex-1 gap-1.5">
                <Typography.Paragraph className="font-ui-bold text-[15px]">
                  What I read
                </Typography.Paragraph>
                <Typography.Paragraph className="font-ui text-[11.5px] text-muted">
                  {phase.words} pieces of text found
                </Typography.Paragraph>
                <OnDeviceChip label="Read on device" />
              </View>
            </View>

            {/* Editable on purpose. A recogniser on a crinkled sachet will get
                something wrong, and a wrong number is worse than a slow one. */}
            <TextInput
              className="min-h-40 rounded-2xl border border-border bg-surface px-4 py-3 font-read text-[15px] leading-[23px] text-foreground"
              value={text}
              onChangeText={setText}
              multiline
              textAlignVertical="top"
              accessibilityLabel="Text read from the label. Correct anything it got wrong."
            />
            <Typography.Paragraph className="font-read text-[12.5px] leading-[19px] text-muted">
              Correct anything it misread before scoring — glare and creases trip it up.
            </Typography.Paragraph>

            <View className="flex-row gap-2.5">
              <Pressable
                accessibilityRole="button"
                onPress={() => setPhase({ kind: "idle" })}
                className="min-h-[48px] flex-1 flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-surface active:opacity-70"
              >
                <Ionicons name="scan-outline" size={17} color={palette.foreground} />
                <Typography.Paragraph className="font-ui-bold text-[13px]">
                  Scan again
                </Typography.Paragraph>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => score(phase.image)}
                className="min-h-[48px] flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-accent active:opacity-80"
              >
                <Ionicons name="podium-outline" size={17} color={palette.accentForeground} />
                <Typography.Paragraph
                  className="font-ui-bold text-[13px]"
                  style={{ color: palette.accentForeground }}
                >
                  Score it
                </Typography.Paragraph>
              </Pressable>
            </View>
          </View>
        )}

        {phase.kind === "scored" && assessment && (
          <View className="gap-3.5">
            <View className="flex-row items-center gap-3">
              <Image
                source={{ uri: phase.image }}
                className="h-[72px] w-[72px] rounded-2xl"
                resizeMode="cover"
                accessibilityLabel="The label you photographed"
              />
              <View className="flex-1 gap-1.5">
                <Typography.Paragraph className="font-ui-bold text-[16px]" numberOfLines={2}>
                  {phase.panel.name || "This label"}
                </Typography.Paragraph>
                {phase.panel.serving && (
                  <Typography.Paragraph className="font-ui text-[11.5px] text-muted">
                    Per serving · {phase.panel.serving}
                  </Typography.Paragraph>
                )}
                <OnDeviceChip label="Read on device" />
              </View>
            </View>

            {/* Score first, reasons second, prose third — and the reference
                named twice, so this never reads as a diagnosis. */}
            <View className="flex-row items-center gap-4 rounded-[20px] border border-border bg-surface p-4">
              <ScoreRing
                score={assessment.score}
                colour={scoreColour(assessment.score)}
                track={palette.border}
              />
              <View className="flex-1 gap-1.5">
                <Typography.Paragraph className="font-ui-medium text-[10px] uppercase tracking-wider text-muted">
                  Assessment
                </Typography.Paragraph>
                <Typography.Paragraph
                  className="font-ui-bold text-[17px] leading-[22px]"
                  style={{ color: scoreColour(assessment.score) }}
                >
                  {assessment.verdict}
                </Typography.Paragraph>
                <Typography.Paragraph className="font-read text-[11.5px] leading-[17px] text-muted-strong">
                  Scored against the {REFERENCE_LABEL} — not a medical opinion.
                </Typography.Paragraph>
              </View>
            </View>

            <View className="overflow-hidden rounded-[20px] border border-border bg-surface">
              <View className="border-b border-separator px-4 py-3">
                <Typography.Paragraph className="font-ui-bold text-[13px]">
                  Why this score
                </Typography.Paragraph>
              </View>
              {assessment.rows.map((row, index) => (
                <View
                  key={row.key}
                  className={`flex-row items-center gap-3 px-4 py-3 ${
                    index > 0 ? "border-t border-separator" : ""
                  }`}
                >
                  <View
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: toneColour(row.tone) }}
                  />
                  <Typography.Paragraph className="flex-1 font-ui-medium text-[13px]">
                    {row.label}
                  </Typography.Paragraph>
                  <Typography.Paragraph className="font-ui text-[11.5px] text-muted">
                    {row.amount}
                  </Typography.Paragraph>
                  {/* The word carries the judgement too — colour is never the
                      only signal. */}
                  <Typography.Paragraph
                    className="w-[62px] text-right font-ui-bold text-[11.5px]"
                    style={{ color: toneColour(row.tone) }}
                  >
                    {row.word}
                  </Typography.Paragraph>
                </View>
              ))}
            </View>

            <View className="gap-2">
              <Typography.Paragraph className="font-ui-medium text-[10px] uppercase tracking-wider text-muted">
                Reading it for
              </Typography.Paragraph>
              <View className="flex-row flex-wrap gap-2">
                {(Object.keys(AGES) as Age[]).map((key) => (
                  <Pressable
                    key={key}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: age === key }}
                    accessibilityLabel={`${AGES[key].label}, ${AGES[key].note}`}
                    onPress={() => {
                      setAge(key);
                      // The previous paragraph described a different age.
                      setWords("");
                    }}
                    className={`min-h-[40px] justify-center rounded-full px-3.5 ${
                      age === key ? "" : "border border-border bg-surface"
                    }`}
                    style={age === key ? { backgroundColor: palette.accent } : undefined}
                  >
                    <Typography.Paragraph
                      className="font-ui-medium text-[12px]"
                      style={age === key ? { color: palette.accentForeground } : undefined}
                    >
                      {AGES[key].label}
                    </Typography.Paragraph>
                  </Pressable>
                ))}
              </View>
            </View>

            <View className="gap-2.5 rounded-[20px] border border-border bg-surface p-4">
              <View className="flex-row items-center gap-2">
                <Mascot size={26} />
                <Typography.Paragraph className="flex-1 font-ui-bold text-[12.5px]">
                  In plain words
                </Typography.Paragraph>
              </View>
              {words ? (
                <Typography.Paragraph className="font-read text-[14px] leading-[23px]">
                  {words}
                </Typography.Paragraph>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void explain()}
                  className="min-h-[44px] flex-row items-center justify-center gap-2 rounded-2xl bg-surface-tertiary active:opacity-70"
                >
                  <Ionicons name="sparkles-outline" size={16} color={palette.foreground} />
                  <Typography.Paragraph className="font-ui-bold text-[12.5px]">
                    Explain this for a {AGES[age].label.toLowerCase()}
                  </Typography.Paragraph>
                </Pressable>
              )}
            </View>

            <Typography.Paragraph className="font-read text-[11px] leading-[17px] text-muted">
              Values read from the label by the recogniser and scored against the {REFERENCE_LABEL}.
              Needs differ with age, weight, activity and health conditions — this is general
              information, not advice.
            </Typography.Paragraph>

            <View className="flex-row gap-2.5">
              <Pressable
                accessibilityRole="button"
                onPress={() => void save()}
                disabled={saved}
                className="min-h-[48px] flex-1 flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-surface active:opacity-70"
                style={{ opacity: saved ? 0.55 : 1 }}
              >
                <Ionicons
                  name={saved ? "checkmark" : "bookmark-outline"}
                  size={17}
                  color={palette.foreground}
                />
                <Typography.Paragraph className="font-ui-bold text-[13px]">
                  {saved ? "Saved" : "Save to notes"}
                </Typography.Paragraph>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPhase({ kind: "idle" })}
                className="min-h-[48px] flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-accent active:opacity-80"
              >
                <Ionicons name="scan-outline" size={17} color={palette.accentForeground} />
                <Typography.Paragraph
                  className="font-ui-bold text-[13px]"
                  style={{ color: palette.accentForeground }}
                >
                  Scan another
                </Typography.Paragraph>
              </Pressable>
            </View>
          </View>
        )}

        {phase.kind === "unreadable" && (
          <View className="gap-3 rounded-2xl border border-warning-border bg-warning-soft p-3.5">
            <View className="flex-row items-start gap-2.5">
              <Ionicons name="help-circle-outline" size={18} color={palette.warning} />
              <Typography.Paragraph className="flex-1 font-read text-[13px] leading-5 text-muted-strong">
                No nutrition values found in that reading. Usually the panel was cut off, or the
                figures landed on a different line from their names — the text above is editable,
                so fixing it and scoring again is the quickest route.
              </Typography.Paragraph>
            </View>
            <View className="flex-row gap-2.5">
              <Pressable
                accessibilityRole="button"
                onPress={() => setPhase({ kind: "read", image: phase.image, words: 0 })}
                className="min-h-[44px] flex-1 items-center justify-center rounded-2xl border border-warning-border bg-surface active:opacity-70"
              >
                <Typography.Paragraph className="font-ui-bold text-[12.5px]">
                  Edit the text
                </Typography.Paragraph>
              </Pressable>
              {/* Opt-in, because it is slow: the model reads the whole panel
                  token by token where the parser did it instantly. */}
              <Pressable
                accessibilityRole="button"
                onPress={() => void scoreWithModel(phase.image)}
                className="min-h-[44px] flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl border border-warning-border bg-surface active:opacity-70"
              >
                <Ionicons name="sparkles-outline" size={15} color={palette.warning} />
                <Typography.Paragraph className="font-ui-bold text-[12.5px]">
                  Let the AI try
                </Typography.Paragraph>
              </Pressable>
            </View>
          </View>
        )}

        {phase.kind === "failed" && (
          <View className="flex-row items-start gap-2.5 rounded-2xl border border-danger bg-danger-soft p-3.5">
            <Ionicons name="alert-circle-outline" size={18} color={palette.danger} />
            <View className="flex-1 gap-2">
              <Typography.Paragraph className="font-read text-[13px] leading-5 text-muted-strong">
                {phase.message}
              </Typography.Paragraph>
              <Pressable accessibilityRole="button" onPress={() => setPhase({ kind: "idle" })}>
                <Typography.Paragraph className="font-ui-bold text-[12.5px] text-link">
                  Start over
                </Typography.Paragraph>
              </Pressable>
            </View>
          </View>
        )}

        {ocr.error && phase.kind !== "failed" && (
          <Typography.Paragraph className="font-read text-[13px] leading-5 text-danger">
            The reader could not start: {ocr.error.message}
          </Typography.Paragraph>
        )}

        {(phase.kind === "idle" || phase.kind === "failed") && (
          <View className="flex-row gap-2.5">
            <Pressable
              accessibilityRole="button"
              onPress={() => void pick("camera")}
              className="min-h-[52px] flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-accent active:opacity-80"
            >
              <Ionicons name="camera-outline" size={19} color={palette.accentForeground} />
              <Typography.Paragraph
                className="font-ui-bold text-[13.5px]"
                style={{ color: palette.accentForeground }}
              >
                Take a photo
              </Typography.Paragraph>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void pick("library")}
              className="min-h-[52px] flex-1 flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-surface active:opacity-70"
            >
              <Ionicons name="images-outline" size={19} color={palette.foreground} />
              <Typography.Paragraph className="font-ui-bold text-[13.5px]">
                Choose an image
              </Typography.Paragraph>
            </Pressable>
          </View>
        )}

        {phase.kind === "idle" && (
          <Typography.Paragraph className="text-center font-read text-[12.5px] leading-5 text-muted">
            A scan is saved as an ordinary note, so you can search it and ask about it later.
          </Typography.Paragraph>
        )}
      </Screen>
    </View>
  );
}
