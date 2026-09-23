import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useConfirm } from "../../components/dialog";
import { Drawer, SheetHead } from "../../components/money";
import { ChoiceRow, Group, IconButton, PageHeader } from "../../components/screen";
import {
  ModelGate,
  deleteNote,
  getNote,
  listNotes,
  reindexNote,
  saveNoteText,
  setNoteSubject,
  useAI,
} from "../../lib/ai";
import { useDictation } from "../../lib/dictation";
import { canonicalSubject, subjectsOf } from "../../lib/formats";
import { useKeyboardOverlap, usePalette } from "../../lib/theme";

/**
 * Where a note is filed: an existing subject, none, or a new one typed in.
 *
 * Existing subjects come first and are one tap, because the likeliest subject
 * for a new note is one already in use — and every one picked rather than
 * retyped is one fewer "Networking" / "networking" split.
 */
function SubjectSheet({
  current,
  onPick,
  onClose,
}: {
  current: string | null;
  onPick: (subject: string | null) => void;
  onClose: () => void;
}): JSX.Element {
  const { db } = useAI();
  const palette = usePalette();
  const [subjects, setSubjects] = useState<{ name: string; count: number }[]>([]);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (db) void listNotes(db).then((notes) => setSubjects(subjectsOf(notes)));
  }, [db]);

  const pick = (subject: string | null): void => {
    onPick(subject);
    onClose();
  };
  const fresh = canonicalSubject(
    typed,
    subjects.map((subject) => subject.name)
  );

  return (
    <Drawer onClose={onClose}>
      <SheetHead title="Subject" onClose={onClose} />
      <ScrollView
        contentContainerClassName="gap-3 px-4 pt-2 pb-2"
        keyboardShouldPersistTaps="handled"
      >
        <Group>
          <ChoiceRow
            first
            label="No subject"
            selected={current === null}
            onPress={() => pick(null)}
          />
          {subjects.map((subject) => (
            <ChoiceRow
              key={subject.name}
              label={subject.name}
              trailing={subject.count === 1 ? "1 note" : `${subject.count} notes`}
              selected={current === subject.name}
              onPress={() => pick(subject.name)}
            />
          ))}
        </Group>
        <View className="flex-row items-center gap-2">
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="New subject, e.g. Networking"
            placeholderTextColor={palette.placeholder}
            returnKeyType="done"
            onSubmitEditing={() => fresh && pick(fresh)}
            className="min-h-[46px] flex-1 rounded-xl border border-border bg-background px-3.5 font-ui text-[15px] text-foreground"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use this subject"
            disabled={!fresh}
            onPress={() => fresh && pick(fresh)}
            className="min-h-[46px] items-center justify-center rounded-xl px-4 active:opacity-80"
            style={{ backgroundColor: palette.accent, opacity: fresh ? 1 : 0.4 }}
          >
            <Typography.Paragraph
              className="font-ui-bold text-[14px]"
              style={{ color: palette.accentForeground }}
            >
              Use
            </Typography.Paragraph>
          </Pressable>
        </View>
      </ScrollView>
    </Drawer>
  );
}

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
  const confirm = useConfirm();
  const palette = usePalette();
  const { overlap, onLayout } = useKeyboardOverlap();
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [subject, setSubject] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

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
      setSubject(note.subject ?? null);
    });
  }, [db, id]);

  /** Filed the moment it is picked — it is one field, not an edit to wait on. */
  const fileUnder = useCallback(
    (next: string | null) => {
      setSubject(next);
      if (!db) return;
      void setNoteSubject(db, { id, title, body, subject: next }).then(() => {
        setSaved(true);
        invalidate();
      });
    },
    [db, id, title, body, invalidate]
  );

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

  const remove = useCallback(() => {
    confirm.ask({
      title: "Delete this note?",
      message: title.trim()
        ? `“${title.trim()}” and anything the assistant learnt from it will be gone.`
        : "This note and anything the assistant learnt from it will be gone.",
      action: "Delete",
      destructive: true,
      onConfirm: () => {
        void (async () => {
          if (db) await deleteNote(db, id);
          // Cleared before leaving, or the autosave on unmount writes the note
          // straight back into the table it was just deleted from.
          latest.current = { title: "", body: "", dirty: false };
          invalidate();
          router.back();
        })();
      },
    });
  }, [db, id, title, confirm, invalidate, router]);

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
        {/* Only once there is something to file. An empty note is not kept,
            and filing one would keep it. */}
        {(!empty || subject) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={subject ? `Subject: ${subject}. Change it.` : "Add a subject"}
            onPress={() => setPicking(true)}
            className="mx-5 mb-2 flex-row items-center gap-1.5 self-start rounded-full border border-border px-2.5 py-1 active:opacity-70"
          >
            <Ionicons
              name={subject ? "folder" : "folder-outline"}
              size={13}
              color={subject ? palette.accent : palette.muted}
            />
            <Typography.Paragraph
              className={`font-ui-medium text-[12px] ${subject ? "text-accent" : "text-muted"}`}
              numberOfLines={1}
            >
              {subject ?? "Add a subject"}
            </Typography.Paragraph>
          </Pressable>
        )}
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
      {confirm.dialog}
      {dictation.dialog}
      {picking && (
        <SubjectSheet current={subject} onPick={fileUnder} onClose={() => setPicking(false)} />
      )}
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
