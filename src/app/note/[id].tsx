import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { AudioManager, AudioRecorder } from "react-native-audio-api";
import { models, useSpeechToText } from "react-native-executorch";

import { IconButton, PageHeader } from "../../components/screen";
import { ModelGate, deleteNote, getNote, reindexNote, saveNoteText, useAI } from "../../lib/ai";
import { concatFloat32 } from "../../lib/formats";
import { useKeyboardHeight, usePalette } from "../../lib/theme";

/**
 * Whisper is trained on 16 kHz mono audio. The recorder treats this as a
 * preference, not a guarantee — if a device insists on another rate the
 * transcript degrades, so this is the first knob to check when accuracy is poor
 * on specific hardware.
 */
const WHISPER_SAMPLE_RATE = 16_000;

/** Long enough that a pause between words doesn't write, short enough to never lose work. */
const AUTOSAVE_DELAY = 800;

type MenuItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  danger?: boolean;
  run: () => void;
};

function MoreMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }): JSX.Element {
  const palette = usePalette();

  // ponytail: a backdrop plus an absolutely placed card, rather than wiring the
  // bottom-sheet library for one menu. Swap it in if a second menu ever needs
  // gestures.
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close menu"
        onPress={onClose}
        className="absolute inset-0 z-10"
      />
      <View className="absolute right-3 top-2 z-20 min-w-[184px] overflow-hidden rounded-2xl border border-border bg-surface">
        {items.map((item, index) => (
          <Pressable
            key={item.label}
            accessibilityRole="menuitem"
            onPress={() => {
              onClose();
              item.run();
            }}
            className={`min-h-[48px] flex-row items-center gap-3 px-4 py-3 active:bg-surface-tertiary ${
              index > 0 ? "border-t border-border" : ""
            }`}
          >
            <Ionicons
              name={item.icon}
              size={18}
              color={item.danger ? palette.danger : palette.foreground}
            />
            <Typography.Paragraph
              className={`font-ui-medium text-[15px] ${item.danger ? "text-danger" : ""}`}
            >
              {item.label}
            </Typography.Paragraph>
          </Pressable>
        ))}
      </View>
    </>
  );
}

function Editor({ id }: { id: string }): JSX.Element {
  const { rag, db, invalidate } = useAI();
  const router = useRouter();
  const palette = usePalette();
  const keyboard = useKeyboardHeight();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [voiceOn, setVoiceOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);

  // Read by the unmount handler, which must see the final text rather than
  // whatever was current when the effect was created.
  const latest = useRef({ title: "", body: "", dirty: false });

  const stt = useSpeechToText({
    model: models.speech_to_text.whisper_tiny_en(),
    preventLoad: !voiceOn,
  });

  useEffect(() => {
    if (!db) return;
    void getNote(db, id).then((note) => {
      if (!note) return;
      setTitle(note.title);
      setBody(note.body);
    });
  }, [db, id]);

  useEffect(() => {
    latest.current = { title, body, dirty };
  }, [title, body, dirty]);

  // Cheap text save on a pause in typing, so nothing is lost if the app dies.
  useEffect(() => {
    if (!db || !dirty) return;
    if (!title.trim() && !body.trim()) return;

    const timer = setTimeout(() => {
      void saveNoteText(db, { id, title, body }).then(() => setSaved(true));
    }, AUTOSAVE_DELAY);

    return () => clearTimeout(timer);
  }, [db, dirty, id, title, body]);

  // Re-embedding is the expensive half, so it happens once, on the way out.
  useEffect(
    () => () => {
      const final = latest.current;
      if (!db || !rag || !final.dirty) return;
      if (!final.title.trim() && !final.body.trim()) return;

      void (async () => {
        await saveNoteText(db, { id, title: final.title, body: final.body });
        await reindexNote(rag, db, id);
        invalidate();
      })();
    },
    [db, rag, id, invalidate]
  );

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
      setNotice("Microphone access is off. Turn it on in Settings to dictate.");
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
      setDirty(true);
      setSaved(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [stt]);

  /** Summarise and Quiz read the saved note, so flush before leaving. */
  const goTo = useCallback(
    async (pathname: "/summary/[id]" | "/quiz/[id]") => {
      if (db && (title.trim() || body.trim())) await saveNoteText(db, { id, title, body });
      router.push({ pathname, params: { id } });
    },
    [db, id, title, body, router]
  );

  const remove = useCallback(async () => {
    if (db) await deleteNote(db, id);
    latest.current = { title: "", body: "", dirty: false };
    invalidate();
    router.back();
  }, [db, id, invalidate, router]);

  const empty = !title.trim() && !body.trim();
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
    <View className="flex-1 bg-background">
      <PageHeader
        title={saved ? "Saved" : "Note"}
        onBack={() => router.back()}
        right={
          <IconButton
            name="ellipsis-horizontal"
            label="More options"
            disabled={empty}
            onPress={() => setMenuOpen(true)}
          />
        }
      />

      {menuOpen && (
        <MoreMenu
          onClose={() => setMenuOpen(false)}
          items={[
            {
              icon: "document-text-outline",
              label: "Summarise",
              run: () => void goTo("/summary/[id]"),
            },
            { icon: "school-outline", label: "Quiz me", run: () => void goTo("/quiz/[id]") },
            { icon: "trash-outline", label: "Delete note", danger: true, run: () => void remove() },
          ]}
        />
      )}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          className="px-5 pb-1 pt-5 font-ui-bold text-[26px] leading-[34px] text-foreground"
          placeholder="Untitled"
          placeholderTextColor={palette.placeholder}
          value={title}
          onChangeText={(next) => {
            setTitle(next);
            setDirty(true);
            setSaved(false);
          }}
          multiline
        />
        <TextInput
          className="min-h-[300px] px-5 pb-6 font-read text-[18px] leading-[28px] text-foreground"
          placeholder={recording ? "Listening…" : "Start writing."}
          placeholderTextColor={palette.placeholder}
          value={body}
          onChangeText={(next) => {
            setBody(next);
            setDirty(true);
            setSaved(false);
          }}
          multiline
          textAlignVertical="top"
        />

        {notice && (
          <Typography.Paragraph className="px-5 font-ui text-danger text-[13px]">
            {notice}
          </Typography.Paragraph>
        )}
        {stt.error && (
          <Typography.Paragraph className="px-5 font-ui text-danger text-[13px]">
            {stt.error.message}
          </Typography.Paragraph>
        )}
      </ScrollView>

      {/* Sits directly on top of the keyboard rather than behind it. */}
      <View
        className="flex-row items-center gap-3 border-t border-border bg-surface px-4 py-2.5"
        style={{ marginBottom: keyboard }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={recording ? "Stop dictating" : "Dictate"}
          disabled={micBusy}
          onPress={() => {
            if (!voiceOn) {
              setVoiceOn(true);
              return;
            }
            void (recording ? stopRecording() : startRecording());
          }}
          className={`min-h-[44px] flex-row items-center gap-2 rounded-full border px-4 ${
            recording ? "border-danger bg-danger" : "border-border"
          }`}
          style={{ opacity: micBusy ? 0.5 : 1 }}
        >
          <Ionicons
            name={recording ? "stop" : "mic-outline"}
            size={17}
            color={recording ? palette.surface : palette.foreground}
          />
          <Typography.Paragraph
            className={`font-ui-medium text-[14px] ${recording ? "text-danger-foreground" : ""}`}
          >
            {micLabel}
          </Typography.Paragraph>
        </Pressable>

        <Typography.Paragraph className="flex-1 font-ui text-muted text-[12px]">
          {!voiceOn ? "Speech model downloads once, 80 MB." : recording ? "Recording." : ""}
        </Typography.Paragraph>
      </View>
    </View>
  );
}

export default function NoteScreen(): JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ModelGate>
      <Editor id={id} />
    </ModelGate>
  );
}
