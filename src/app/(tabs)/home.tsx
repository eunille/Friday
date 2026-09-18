import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect, useState, type ComponentProps, type JSX } from "react";
import { Pressable, View } from "react-native";

import { Group, Mascot, PressCard, Screen } from "../../components/screen";
import {
  TIERS,
  listChats,
  listNotes,
  listQuizResults,
  useAI,
  weakTopics,
  type ChatSummary,
  type Note,
  type QuizResult,
} from "../../lib/ai";
import { preview, relativeDate } from "../../lib/formats";
import { ON_INK, usePalette } from "../../lib/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** One row of "Pick up where you left off", whichever table it came from. */
type Recent = {
  key: string;
  when: string;
  icon: IconName;
  tint: string;
  wash: string;
  title: string;
  meta: string;
  go: () => void;
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Magandang umaga";
  if (hour < 18) return "Magandang hapon";
  return "Magandang gabi";
}

/** One of the four "Jump in" tiles. */
function Tile({
  icon,
  tint,
  wash,
  title,
  note,
  onPress,
}: {
  icon: IconName;
  tint: string;
  wash: string;
  title: string;
  note: string;
  onPress: () => void;
}): JSX.Element {
  return (
    <View className="flex-1">
      <PressCard onPress={onPress}>
        <View
          className="h-9 w-9 items-center justify-center rounded-xl"
          style={{ backgroundColor: wash }}
        >
          <Ionicons name={icon} size={20} color={tint} />
        </View>
        <Typography.Paragraph className="mt-2.5 font-ui-bold text-[13.5px]">
          {title}
        </Typography.Paragraph>
        <Typography.Paragraph className="mt-1 font-ui text-[11px] text-muted">
          {note}
        </Typography.Paragraph>
      </PressCard>
    </View>
  );
}

export default function Home(): JSX.Element {
  const { db, tier, status, revision } = useAI();
  const router = useRouter();
  const palette = usePalette();
  const [notes, setNotes] = useState<Note[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [quizzes, setQuizzes] = useState<QuizResult[]>([]);
  const [weak, setWeak] = useState<QuizResult[]>([]);

  useEffect(() => {
    if (!db) return;
    void listNotes(db).then(setNotes);
    void listChats(db, 5).then(setChats);
    void listQuizResults(db, 5).then(setQuizzes);
    void weakTopics(db).then(setWeak);
  }, [db, revision]);

  /**
   * Notes, chats and quiz attempts are three different tables but one idea —
   * the last things you touched. Merged and sorted here rather than shown as
   * three separate lists, because that is how a person remembers them.
   */
  const recent: Recent[] = [
    ...notes.map((note) => ({
      key: `note-${note.id}`,
      when: note.updatedAt,
      icon: "document-text" as IconName,
      tint: palette.onDevice,
      wash: palette.onDeviceSoft,
      title: note.title || "Untitled",
      meta: `${relativeDate(note.updatedAt)} · ${preview(note.body)}`,
      go: () => router.push({ pathname: "/note/[id]", params: { id: note.id } }),
    })),
    ...chats.map((chat) => ({
      key: `chat-${chat.id}`,
      when: chat.updatedAt,
      icon: "chatbubble" as IconName,
      tint: palette.accent,
      wash: palette.accentSoft,
      title: chat.title,
      meta: `${relativeDate(chat.updatedAt)} · ${chat.turns} messages`,
      go: () => router.push({ pathname: "/", params: { chat: chat.id } }),
    })),
    ...quizzes.map((quiz) => ({
      key: `quiz-${quiz.id}`,
      when: quiz.takenAt,
      icon: "help-circle" as IconName,
      tint: palette.warning,
      wash: palette.warningSoft,
      title: quiz.title,
      meta: `Scored ${quiz.score}/${quiz.total} · ${relativeDate(quiz.takenAt)}`,
      go: () => router.push({ pathname: "/quiz/[id]", params: { id: quiz.noteId } }),
    })),
  ]
    .sort((a, b) => b.when.localeCompare(a.when))
    .slice(0, 4);

  const dot =
    status.kind === "ready"
      ? ON_INK.ready
      : status.kind === "error"
        ? ON_INK.error
        : ON_INK.working;
  const state =
    status.kind === "ready" ? "Ready" : status.kind === "error" ? "Needs attention" : status.stage;

  return (
    <View className="flex-1 bg-background">
      <Screen>
        <View className="flex-row items-center gap-3">
          <Mascot />
          <View className="flex-1">
            <Typography.Paragraph className="font-ui-medium text-[12px] text-muted">
              {greeting()}
            </Typography.Paragraph>
            <Typography.Heading type="h1" className="font-ui-bold text-[21px] tracking-tight">
              Ready to study?
            </Typography.Heading>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => router.push("/settings")}
            className="h-11 w-11 items-center justify-center rounded-full border border-border bg-surface active:opacity-70"
          >
            <Ionicons name="settings-outline" size={20} color={palette.foreground} />
          </Pressable>
        </View>

        {/* The one dark surface in the app, and the only place that states the
            claim the whole product rests on. */}
        <View className="gap-3 rounded-[22px] p-4" style={{ backgroundColor: palette.ink }}>
          <View className="flex-row items-center gap-2">
            <View style={{ width: 8, height: 8, borderRadius: 8, backgroundColor: dot }} />
            <Typography.Paragraph
              className="flex-1 font-ui-bold text-[12.5px]"
              style={{ color: palette.inkForeground }}
              numberOfLines={1}
            >
              Offline AI · {state}
            </Typography.Paragraph>
            <View
              className="flex-row items-center gap-1 rounded-full px-2.5 py-1"
              style={{ backgroundColor: ON_INK.faint }}
            >
              <Ionicons name="airplane" size={12} color={ON_INK.bright} />
              <Typography.Paragraph
                className="font-ui-medium text-[10.5px]"
                style={{ color: ON_INK.dim }}
              >
                No network used
              </Typography.Paragraph>
            </View>
          </View>

          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Typography.Paragraph className="font-ui text-[10.5px]" style={{ color: ON_INK.dim }}>
                Active model
              </Typography.Paragraph>
              <Typography.Paragraph
                className="font-ui-bold text-[14px]"
                style={{ color: palette.inkForeground }}
                numberOfLines={1}
              >
                {tier ? `${TIERS[tier].name} · ${TIERS[tier].size}` : "None yet"}
              </Typography.Paragraph>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tier ? "Change model" : "Choose a model"}
              onPress={() => router.push("/library")}
              className="rounded-full px-3 py-2 active:opacity-70"
              style={{ borderWidth: 1, borderColor: ON_INK.dim }}
            >
              <Typography.Paragraph
                className="font-ui-medium text-[11px]"
                style={{ color: ON_INK.bright }}
              >
                {tier ? "Switch" : "Choose"}
              </Typography.Paragraph>
            </Pressable>
          </View>
        </View>

        <View className="gap-2.5">
          <View className="flex-row items-baseline justify-between">
            <Typography.Heading type="h3" className="font-ui-bold text-[15px]">
              Jump in
            </Typography.Heading>
            <Pressable accessibilityRole="button" onPress={() => router.push("/library")}>
              <Typography.Paragraph className="font-ui-medium text-[11.5px] text-link">
                All tools
              </Typography.Paragraph>
            </Pressable>
          </View>

          {/* ponytail: two rows of two, not a grid library. */}
          <View className="flex-row gap-2.5">
            <Tile
              icon="chatbubble-outline"
              tint={palette.accent}
              wash={palette.accentSoft}
              title="Chat with AI"
              note="Grounded in your notes"
              onPress={() => router.push("/")}
            />
            <Tile
              icon="document-text-outline"
              tint={palette.onDevice}
              wash={palette.onDeviceSoft}
              title="My notes"
              note={notes.length === 1 ? "1 note" : `${notes.length} notes`}
              onPress={() => router.push("/notes")}
            />
          </View>
          <View className="flex-row gap-2.5">
            <Tile
              icon="search-outline"
              tint={palette.foreground}
              wash={palette.border}
              title="Search by meaning"
              note="No model needed"
              onPress={() => router.push("/search")}
            />
            {/* Amber rather than the mockup's red: scanning is the model
                working, and red is reserved for things going wrong. */}
            <Tile
              icon="scan-outline"
              tint={palette.warning}
              wash={palette.warningSoft}
              title="Scan food"
              note="Read a nutrition label"
              onPress={() => router.push("/scan")}
            />
          </View>
        </View>

        {recent.length > 0 && (
          <View className="gap-2.5">
            <Typography.Heading type="h3" className="font-ui-bold text-[15px]">
              Pick up where you left off
            </Typography.Heading>
            <Group>
              {recent.map((item, index) => (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.title}`}
                  onPress={item.go}
                  className={`min-h-[60px] flex-row items-center gap-3 px-3.5 py-3 active:bg-surface-tertiary ${
                    index > 0 ? "border-t border-border" : ""
                  }`}
                >
                  <View
                    className="h-9 w-9 items-center justify-center rounded-xl"
                    style={{ backgroundColor: item.wash }}
                  >
                    <Ionicons name={item.icon} size={17} color={item.tint} />
                  </View>
                  <View className="flex-1">
                    <Typography.Paragraph className="font-ui-bold text-[13.5px]" numberOfLines={1}>
                      {item.title}
                    </Typography.Paragraph>
                    <Typography.Paragraph
                      className="font-ui text-[11px] text-muted"
                      numberOfLines={1}
                    >
                      {item.meta}
                    </Typography.Paragraph>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={palette.mutedSoft} />
                </Pressable>
              ))}
            </Group>
          </View>
        )}

        {/* Only appears once there is a quiz that actually went badly. No quiz
            history, no card — better absent than filled with a placeholder. */}
        {weak.length > 0 && (
          <View className="rounded-[20px] border border-warning-border bg-warning-soft p-3.5">
            <View className="flex-row items-center gap-2">
              <Ionicons name="locate-outline" size={17} color={palette.warning} />
              <Typography.Paragraph className="flex-1 font-ui-bold text-[13.5px]">
                Worth another look
              </Typography.Paragraph>
              <Typography.Paragraph
                className="font-ui-medium text-[11px]"
                style={{ color: palette.warning }}
              >
                {weak.length === 1 ? "1 topic" : `${weak.length} topics`}
              </Typography.Paragraph>
            </View>
            <View className="mt-2.5 flex-row flex-wrap gap-1.5">
              {weak.map((topic) => (
                <Pressable
                  key={topic.noteId}
                  accessibilityRole="button"
                  accessibilityLabel={`Retry the quiz on ${topic.title}`}
                  onPress={() =>
                    router.push({ pathname: "/quiz/[id]", params: { id: topic.noteId } })
                  }
                  className="rounded-full border border-warning-border bg-surface px-2.5 py-1.5 active:opacity-70"
                >
                  <Typography.Paragraph className="font-ui-medium text-[11.5px]">
                    {topic.title} · {topic.score}/{topic.total}
                  </Typography.Paragraph>
                </Pressable>
              ))}
            </View>
            <Typography.Paragraph className="mt-2.5 font-read text-[11.5px] leading-[17px] text-muted-strong">
              Scored under 60% last time. A short retry takes about two minutes.
            </Typography.Paragraph>
          </View>
        )}
      </Screen>
    </View>
  );
}
