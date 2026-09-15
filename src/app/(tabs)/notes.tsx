import { Button, Card, Chip, Input, Spinner, Typography } from "heroui-native";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { ScrollView, View } from "react-native";
import { AudioManager, AudioRecorder } from "react-native-audio-api";
import { models, useSpeechToText } from "react-native-executorch";

import {
  ModelGate,
  addSource,
  deleteSource,
  listSources,
  readSource,
  useAI,
  type Source,
} from "../../lib/ai";
import { clampForPrompt, concatFloat32 } from "../../lib/formats";

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

type Derived = { sourceId: string; kind: keyof typeof PROMPTS; text: string };

function Notes(): JSX.Element {
  const { rag, db, revision, invalidate } = useAI();

  const [notes, setNotes] = useState<Source[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
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
      setNotice("Microphone permission is required for voice notes.");
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
    async (note: Source, kind: keyof typeof PROMPTS) => {
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
      invalidate();
    },
    [db, invalidate]
  );

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 py-4 gap-4">
      <Typography.Heading type="h2">Notes</Typography.Heading>

      <Card className="gap-3">
        <Input placeholder="Title (optional)" value={title} onChangeText={setTitle} />
        <Input
          placeholder="Write or dictate a note…"
          value={body}
          onChangeText={setBody}
          multiline
          className="min-h-28"
          textAlignVertical="top"
        />

        <View className="flex-row gap-2">
          {!voiceOn ? (
            <Button variant="outline" className="flex-1" onPress={() => setVoiceOn(true)}>
              Enable voice (~80 MB)
            </Button>
          ) : !stt.isReady ? (
            <Button variant="outline" className="flex-1" isDisabled>
              {stt.downloadProgress > 0 && stt.downloadProgress < 1
                ? `Downloading ${Math.round(stt.downloadProgress * 100)}%`
                : "Loading speech model"}
            </Button>
          ) : (
            <Button
              variant={recording ? "danger" : "outline"}
              className="flex-1"
              isDisabled={stt.isGenerating}
              onPress={() => void (recording ? stopRecording() : startRecording())}
            >
              {stt.isGenerating ? "Transcribing…" : recording ? "Stop" : "Record"}
            </Button>
          )}

          <Button
            className="flex-1"
            isDisabled={!body.trim() || saving}
            onPress={() => void save()}
          >
            {saving ? "Saving…" : "Save note"}
          </Button>
        </View>

        {stt.error && (
          <Typography.Paragraph className="text-danger text-xs">
            {stt.error.message}
          </Typography.Paragraph>
        )}
        {notice && (
          <Typography.Paragraph className="text-danger text-xs">{notice}</Typography.Paragraph>
        )}
      </Card>

      {notes.length === 0 && (
        <Typography.Paragraph className="text-muted-foreground text-center py-8">
          No notes yet. Anything you save here becomes searchable and answerable, offline.
        </Typography.Paragraph>
      )}

      {notes.map((note) => (
        <Card key={note.id} className="gap-3">
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1">
              <Card.Title>{note.title}</Card.Title>
              <Card.Description>
                {new Date(note.createdAt).toLocaleDateString()} · {note.chunks} chunk
                {note.chunks === 1 ? "" : "s"}
              </Card.Description>
            </View>
            <Chip size="sm">note</Chip>
          </View>

          <View className="flex-row gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              isDisabled={busyId !== null}
              onPress={() => void derive(note, "summary")}
            >
              Summarise
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              isDisabled={busyId !== null}
              onPress={() => void derive(note, "flashcards")}
            >
              Flashcards
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

          {derived?.sourceId === note.id && (
            <View className="gap-2 border-t border-border pt-3">
              <Typography.Paragraph className="text-muted-foreground text-xs uppercase">
                {derived.kind}
              </Typography.Paragraph>
              {derived.text === "" ? (
                <Spinner size="sm" />
              ) : (
                <Typography.Paragraph>{derived.text}</Typography.Paragraph>
              )}
            </View>
          )}
        </Card>
      ))}
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
