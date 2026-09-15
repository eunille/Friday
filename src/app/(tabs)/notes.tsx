import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect, useState, type JSX } from "react";
import { Pressable, View } from "react-native";

import { Group, Screen, ScreenHeader } from "../../components/screen";
import { ModelGate, listNotes, newNoteId, useAI, type Note } from "../../lib/ai";
import { usePalette } from "../../lib/theme";

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** First non-empty line of the body, for the list preview. */
function preview(body: string): string {
  const line = body.split("\n").find((candidate) => candidate.trim() !== "");
  return line?.trim() ?? "Empty note";
}

function Notes(): JSX.Element {
  const { db, revision } = useAI();
  const router = useRouter();
  const palette = usePalette();
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (db) void listNotes(db).then(setNotes);
  }, [db, revision]);

  const open = (id: string): void => router.push({ pathname: "/note/[id]", params: { id } });

  return (
    <View className="flex-1 bg-background">
      <Screen>
        <ScreenHeader title="Notes">
          Everything you write is searchable and answerable on the phone. Nothing is uploaded.
        </ScreenHeader>

        {notes.length === 0 ? (
          <View className="items-center gap-3 py-16">
            <Ionicons name="create-outline" size={28} color={palette.muted} />
            <Typography.Paragraph className="text-center font-read text-[16px] leading-6 text-muted">
              Write your first note, then ask a question about it in the Ask tab.
            </Typography.Paragraph>
          </View>
        ) : (
          <Group>
            {notes.map((note, index) => (
              <Pressable
                key={note.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${note.title || "untitled note"}`}
                onPress={() => open(note.id)}
                className={`min-h-[64px] flex-row items-center gap-3 px-4 py-3.5 active:bg-surface-tertiary ${
                  index > 0 ? "border-t border-border" : ""
                }`}
              >
                <View className="flex-1 gap-1">
                  <Typography.Paragraph className="font-ui-medium text-[16px]" numberOfLines={1}>
                    {note.title || "Untitled"}
                  </Typography.Paragraph>
                  <View className="flex-row items-center gap-2">
                    <Typography.Paragraph className="font-ui text-muted text-[12px]">
                      {relativeDate(note.updatedAt)}
                    </Typography.Paragraph>
                    <Typography.Paragraph
                      className="flex-1 font-read text-muted text-[13px]"
                      numberOfLines={1}
                    >
                      {preview(note.body)}
                    </Typography.Paragraph>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={palette.muted} />
              </Pressable>
            ))}
          </Group>
        )}
      </Screen>

      {/* Compose floats above the list rather than sitting inside it, so
          starting a note is one tap from anywhere in the scroll. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New note"
        onPress={() => open(newNoteId())}
        className="absolute bottom-5 right-5 h-14 w-14 items-center justify-center rounded-full bg-accent active:opacity-80"
        style={{
          shadowColor: "#15202b",
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        <Ionicons name="add" size={28} color={palette.accentForeground} />
      </Pressable>
    </View>
  );
}

export default function NotesTab(): JSX.Element {
  return (
    <ModelGate>
      <Notes />
    </ModelGate>
  );
}
