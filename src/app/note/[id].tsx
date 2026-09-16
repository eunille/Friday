import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconButton, PageHeader } from "../../components/screen";
import { ModelGate, deleteNote, getNote, reindexNote, saveNoteText, useAI } from "../../lib/ai";
import { useDictation } from "../../lib/dictation";
import { useKeyboardOverlap, usePalette } from "../../lib/theme";

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
        // Explicit offsets: the inset utilities compile to nothing, and an
        // absolute box with none of them collapses into the top-left corner.
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 10 }}
      />
      <View
        className="min-w-[184px] overflow-hidden rounded-2xl border border-border bg-surface"
        style={{ position: "absolute", right: 12, top: 8, zIndex: 20 }}
      >
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
  const { overlap, onLayout } = useKeyboardOverlap();
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Shared with the chat composer — see src/lib/dictation.ts.
  const dictation = useDictation(
    useCallback((heard: string) => {
      setBody((prev) => (prev ? `${prev}\n${heard}` : heard));
      setDirty(true);
      setSaved(false);
    }, [])
  );

  // Read by the unmount handler, which must see the final text rather than
  // whatever was current when the effect was created.
  const latest = useRef({ title: "", body: "", dirty: false });

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
  const downloading = dictation.downloadProgress > 0 && dictation.downloadProgress < 1;
  const micLabel = dictation.working
    ? "Transcribing"
    : downloading
      ? `${Math.round(dictation.downloadProgress * 100)}%`
      : dictation.recording
        ? "Stop"
        : "Dictate";

  return (
    <View className="flex-1 bg-background" onLayout={onLayout}>
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
          placeholder={dictation.recording ? "Listening…" : "Start writing."}
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

        {dictation.notice && (
          <Typography.Paragraph className="px-5 font-ui text-danger text-[13px]">
            {dictation.notice}
          </Typography.Paragraph>
        )}
      </ScrollView>

      {/* Sits on top of the keyboard when it is open, and clear of Android's
          own buttons when it is not. The margin is only the part of the
          keyboard the system did not already handle — see useKeyboardOverlap. */}
      <View
        className="flex-row items-center gap-3 border-t border-border bg-surface px-4 pt-2.5"
        style={{ marginBottom: overlap, paddingBottom: 10 + (overlap > 0 ? 0 : insets.bottom) }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dictation.recording ? "Stop dictating" : "Dictate"}
          disabled={dictation.working}
          onPress={dictation.toggle}
          className={`min-h-[44px] flex-row items-center gap-2 rounded-full border px-4 ${
            dictation.recording ? "border-warning bg-warning-soft" : "border-border"
          }`}
          style={{ opacity: dictation.working ? 0.5 : 1 }}
        >
          <Ionicons
            name={dictation.recording ? "stop" : "mic-outline"}
            size={17}
            color={
              dictation.recording || dictation.working ? palette.warning : palette.foreground
            }
          />
          <Typography.Paragraph className="font-ui-medium text-[14px]">
            {micLabel}
          </Typography.Paragraph>
        </Pressable>

        <Typography.Paragraph className="flex-1 font-ui text-muted text-[12px]">
          {dictation.working
            ? "Writing down what you said."
            : downloading
              ? "Getting the voice model, once only."
              : dictation.recording
                ? "Listening."
                : "Speech is transcribed on this phone."}
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
