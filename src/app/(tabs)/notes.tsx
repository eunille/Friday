import { Ionicons } from "@expo/vector-icons";
import { Button, Spinner, Typography } from "heroui-native";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { AudioManager, AudioRecorder } from "react-native-audio-api";
import { models, useSpeechToText } from "react-native-executorch";

import { ScreenHeader } from "../../components/screen";
import {
  ModelGate,
  addSource,
  deleteSource,
  listSources,
  readSource,
  useAI,
  type Source,
} from "../../lib/ai";
import { clampForPrompt, concatFloat32, parseFlashcards } from "../../lib/formats";
import { usePalette } from "../../lib/theme";

/**
 * Whisper is trained on 16 kHz mono audio. The recorder treats this as a
 * preference, not a guarantee — if a device insists on another rate the
 * transcript degrades, so this is the first knob to check when accuracy is poor
 * on specific hardware.
 */
const WHISPER_SAMPLE_RATE = 16_000;

const PROMPTS = {
  summary: (text: string) =>
    `Summarise the note below in at most five short bullet points. Use only what the note says.\n\nNOTE:\n${text}`,
  flashcards: (text: string) =>
    `Write five question-and-answer flashcards from the note below. Format each as "Q: ..." on one line and "A: ..." on the next. Use only what the note says.\n\nNOTE:\n${text}`,
} as const;

type DerivedKind = keyof typeof PROMPTS;
type Derived = { sourceId: string; kind: DerivedKind; text: string };

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** One card, answer hidden until tapped. There is nothing to learn from an answer you can already see. */
function Flashcard({
  card,
  index,
}: {
  card: { question: string; answer: string };
  index: number;
}): JSX.Element {
  const [shown, setShown] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={shown ? "Hide answer" : "Reveal answer"}
      onPress={() => setShown((s) => !s)}
      className="gap-3 rounded-2xl border border-border bg-background px-4 py-4 active:opacity-70"
    >
      <View className="flex-row items-start gap-3">
        <Typography.Paragraph className="font-ui-medium text-muted text-[13px] pt-1">
          {index + 1}
        </Typography.Paragraph>
        <Typography.Paragraph className="flex-1 font-read text-[17px] leading-[25px]">
          {card.question}
        </Typography.Paragraph>
      </View>

      <View className="border-t border-border pt-3">
        {shown ? (
          <Typography.Paragraph className="font-read text-[16px] leading-[24px] text-muted">
            {card.answer}
          </Typography.Paragraph>
        ) : (
          <Typography.Paragraph className="font-ui-medium text-accent text-[13px]">
            Tap to answer
          </Typography.Paragraph>
        )}
      </View>
    </Pressable>
  );
}

function DerivedPanel({ derived }: { derived: Derived }): JSX.Element {
  const cards = useMemo(
    () => (derived.kind === "flashcards" ? parseFlashcards(derived.text) : []),
    [derived.kind, derived.text]
  );

  if (derived.text === "") {
    return (
      <View className="flex-row items-center gap-2.5 py-2">
        <Spinner size="sm" />
        <Typography.Paragraph className="font-ui text-muted text-[13px]">
          {derived.kind === "summary" ? "Reading the note" : "Writing questions"}
        </Typography.Paragraph>
      </View>
    );
  }

  // Cards only appear once a full Q/A pair has streamed in, so the raw text
  // stays visible underneath until the first one lands — otherwise the panel
  // looks frozen for the first few seconds.
  if (derived.kind === "flashcards" && cards.length > 0) {
    return (
      <View className="gap-2.5">
        {cards.map((card, index) => (
          <Flashcard key={`${index}-${card.question}`} card={card} index={index} />
        ))}
      </View>
    );
  }

  return (
    <View className="flex-row gap-3">
      <View className="w-[3px] rounded-full bg-separator" />
      <Typography.Paragraph className="flex-1 font-read text-[16px] leading-[25px]">
        {derived.text}
      </Typography.Paragraph>
    </View>
  );
}

function Notes(): JSX.Element {
  const { rag, db, revision, invalidate } = useAI();
  const palette = usePalette();

  const [notes, setNotes] = useState<Source[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [derived, setDerived] = useState<Derived | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [voiceOn, setVoiceOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);

  const stt = useSpeechToText({
    model: models.speech_to_text.whisper_tiny_en(),
    preventLoad: !voiceOn,
  });

  useEffect(() => {
    if (db) void listSources(db, "note").then(setNotes);
  }, [db, revision]);

  // Stop the mic if the screen goes away mid-recording.
  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (!recorder) return;
      void recorder.stop();
      recorder.clearOnAudioReady();
    },
    []
  );

  const startRecording = useCallback(async () => {
    setNotice(null);
    if ((await AudioManager.requestRecordingPermissions()) !== "Granted") {
      setNotice("Microphone access is off. Turn it on in Settings to dictate notes.");
      return;
    }

    const recorder = new AudioRecorder();
    chunksRef.current = [];
    recorder.onAudioReady(
      { sampleRate: WHISPER_SAMPLE_RATE, bufferLength: 4096, channelCount: 1 },
      (event) => {
        chunksRef.current.push(Float32Array.from(event.buffer.getChannelData(0)));
      }
    );

    const started = await recorder.start();
    if (started.status === "error") {
      setNotice(started.message);
      return;
    }
    recorderRef.current = recorder;
    setRecording(true);
  }, []);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;

    await recorder.stop();
    recorder.clearOnAudioReady();
    recorderRef.current = null;
    setRecording(false);

    const waveform = concatFloat32(chunksRef.current);
    chunksRef.current = [];
    if (waveform.length === 0) return;

    try {
      const { text } = await stt.transcribe(waveform);
      setBody((prev) => (prev ? `${prev}\n${text}` : text));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [stt]);

  const save = useCallback(async () => {
    if (!rag || !body.trim()) return;
    setSaving(true);
    try {
      await addSource(rag, {
        title: title.trim() || body.trim().slice(0, 40),
        text: body.trim(),
        kind: "note",
      });
      setTitle("");
      setBody("");
      invalidate();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [rag, title, body, invalidate]);

  const derive = useCallback(
    async (note: Source, kind: DerivedKind) => {
      if (!rag || !db || busyId) return;
      setBusyId(note.id);
      setDerived({ sourceId: note.id, kind, text: "" });
      try {
        const source = clampForPrompt(await readSource(db, note.id));
        let out = "";
        await rag.generate({
          input: PROMPTS[kind](source),
          augmentedGeneration: false, // the note is already in the prompt
          callback: (token) => {
            out += token;
            setDerived({ sourceId: note.id, kind, text: out });
          },
        });
      } catch (error) {
        setDerived({
          sourceId: note.id,
          kind,
          text: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusyId(null);
      }
    },
    [rag, db, busyId]
  );

  const remove = useCallback(
    async (note: Source) => {
      if (!db) return;
      await deleteSource(db, note.id);
      setDerived((current) => (current?.sourceId === note.id ? null : current));
      setOpenId((current) => (current === note.id ? null : current));
      invalidate();
    },
    [db, invalidate]
  );

  const micBusy = voiceOn && (!stt.isReady || stt.isGenerating);
  const micLabel = !voiceOn
    ? "Dictate"
    : !stt.isReady
      ? stt.downloadProgress > 0 && stt.downloadProgress < 1
        ? `${Math.round(stt.downloadProgress * 100)}%`
        : "Loading"
      : stt.isGenerating
        ? "Transcribing"
        : recording
          ? "Stop"
          : "Dictate";

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 pt-3 pb-8 gap-5"
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeader title="Notes">
        Anything saved here is chunked, embedded and searchable on the phone. Nothing is uploaded.
      </ScreenHeader>

      {/* Composer. The body is set in the reading serif because it is writing,
          not chrome — it should feel like a page, not a form field. */}
      <View className="overflow-hidden rounded-2xl border border-border bg-surface">
        <TextInput
          className="px-4 pb-2 pt-3.5 font-ui-bold text-[17px] text-foreground"
          placeholder="Title"
          placeholderTextColor={palette.placeholder}
          value={title}
          onChangeText={setTitle}
        />
        <TextInput
          className="min-h-24 px-4 pb-3 font-read text-[17px] leading-[25px] text-foreground"
          placeholder={recording ? "Listening…" : "Write, or hold a thought and dictate it."}
          placeholderTextColor={palette.placeholder}
          value={body}
          onChangeText={setBody}
          multiline
          textAlignVertical="top"
        />

        <View className="flex-row items-center justify-between gap-3 border-t border-border px-3 py-2.5">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? "Stop dictating" : "Dictate a note"}
            disabled={micBusy}
            onPress={() => {
              if (!voiceOn) {
                setVoiceOn(true);
                return;
              }
              void (recording ? stopRecording() : startRecording());
            }}
            className={`flex-row items-center gap-2 rounded-full border px-3 py-2 ${
              recording ? "border-danger bg-danger" : "border-border"
            }`}
            style={{ opacity: micBusy ? 0.5 : 1 }}
          >
            <Ionicons
              name={recording ? "stop" : "mic-outline"}
              size={15}
              color={recording ? palette.surface : palette.foreground}
            />
            <Typography.Paragraph
              className={`font-ui-medium text-[13px] ${recording ? "text-danger-foreground" : ""}`}
            >
              {micLabel}
            </Typography.Paragraph>
          </Pressable>

          <Button size="sm" isDisabled={!body.trim() || saving} onPress={() => void save()}>
            {saving ? "Saving" : "Save note"}
          </Button>
        </View>
      </View>

      {!voiceOn && (
        <Typography.Paragraph className="-mt-3 font-ui text-muted text-[12px]">
          Dictation downloads an 80 MB speech model the first time you use it.
        </Typography.Paragraph>
      )}

      {stt.error && (
        <Typography.Paragraph className="font-ui text-danger text-[13px]">
          {stt.error.message}
        </Typography.Paragraph>
      )}
      {notice && (
        <Typography.Paragraph className="font-ui text-danger text-[13px]">
          {notice}
        </Typography.Paragraph>
      )}

      {notes.length === 0 ? (
        <View className="items-center gap-2 py-10">
          <Ionicons name="document-text-outline" size={26} color={palette.muted} />
          <Typography.Paragraph className="text-center font-read text-[16px] leading-6 text-muted">
            Save your first note, then ask a question about it in the Ask tab.
          </Typography.Paragraph>
        </View>
      ) : (
        /* A list, not a grid of cards. Titles are what you scan; everything
           else waits behind a tap. */
        <View className="overflow-hidden rounded-2xl border border-border bg-surface">
          {notes.map((note, index) => {
            const open = openId === note.id;
            return (
              <View key={note.id} className={index > 0 ? "border-t border-border" : ""}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  onPress={() => setOpenId(open ? null : note.id)}
                  className="flex-row items-center gap-3 px-4 py-3.5 active:bg-surface-tertiary"
                >
                  <View className="flex-1 gap-0.5">
                    <Typography.Paragraph className="font-ui-medium text-[16px]" numberOfLines={1}>
                      {note.title}
                    </Typography.Paragraph>
                    <Typography.Paragraph className="font-ui text-muted text-[12px]">
                      {relativeDate(note.createdAt)}
                    </Typography.Paragraph>
                  </View>
                  <Ionicons
                    name={open ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={palette.muted}
                  />
                </Pressable>

                {open && (
                  <View className="gap-3 px-4 pb-4">
                    <View className="flex-row gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="flex-1"
                        isDisabled={busyId !== null}
                        onPress={() => void derive(note, "summary")}
                      >
                        Summarise
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="flex-1"
                        isDisabled={busyId !== null}
                        onPress={() => void derive(note, "flashcards")}
                      >
                        Quiz me
                      </Button>
                      <Button
                        size="sm"
                        variant="danger-soft"
                        isDisabled={busyId !== null}
                        onPress={() => void remove(note)}
                      >
                        Delete
                      </Button>
                    </View>

                    {derived?.sourceId === note.id && <DerivedPanel derived={derived} />}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

export default function NotesTab(): JSX.Element {
  return (
    <ModelGate>
      <Notes />
    </ModelGate>
  );
}
