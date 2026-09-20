import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useMemo, useState, type ComponentProps, type JSX } from "react";
import { Pressable, View } from "react-native";

import { useConfirm } from "../../components/dialog";
import { Group, Mascot, PressCard, Screen } from "../../components/screen";
import {
  TIERS,
  deleteChat,
  deleteNote,
  deleteQuizResult,
  listChats,
  listNotes,
  listQuizResults,
  useAI,
  weakTopics,
  type ChatSummary,
  type Note,
  type QuizResult,
} from "../../lib/ai";
import {
  monthKey,
  netWorth,
  peso,
  totalsFor,
  type Account,
  type Txn,
} from "../../lib/budget";
import { preview, relativeDate } from "../../lib/formats";
import { listAccounts, listTxns } from "../../lib/ledger";
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
  /** What the confirm calls it. Three tables, three words for the same gesture. */
  noun: string;
  remove: () => void;
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
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
  const { db, tier, status, revision, invalidate } = useAI();
  const router = useRouter();
  const confirm = useConfirm();
  const palette = usePalette();
  const [notes, setNotes] = useState<Note[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [quizzes, setQuizzes] = useState<QuizResult[]>([]);
  const [weak, setWeak] = useState<QuizResult[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);

  const wallets = useMemo(() => accounts.filter((account) => !account.archived), [accounts]);
  const balance = useMemo(() => netWorth(wallets, txns), [wallets, txns]);
  const thisMonth = useMemo(
    () => totalsFor(txns, monthKey(new Date().toISOString())),
    [txns]
  );

  // On focus, not just on mount. This tab stays mounted under whatever is
  // pushed over it, so the Money strip kept showing the balance from before
  // you went into Money and logged something.
  const refresh = useCallback(() => {
    if (!db) return;
    void listAccounts(db).then(setAccounts);
    void listTxns(db).then(setTxns);
    void listNotes(db).then(setNotes);
    void listChats(db, 5).then(setChats);
    void listQuizResults(db, 5).then(setQuizzes);
    void weakTopics(db).then(setWeak);
    // `revision` is not read here — it is a cache-buster. Deleting a note from
    // this screen calls invalidate(), and bumping it is what makes the list
    // read again without anyone having to navigate away and back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, revision]);

  useFocusEffect(refresh);

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
      noun: "note",
      remove: () => void (db && deleteNote(db, note.id).then(invalidate)),
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
      noun: "conversation",
      remove: () => void (db && deleteChat(db, chat.id).then(invalidate)),
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
      noun: "result",
      // Deletes the attempt, never the note it was taken from.
      remove: () => void (db && deleteQuizResult(db, quiz.id).then(invalidate)),
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

        {/* A strip rather than a fifth tile in a grid of four. Money is the one
            shortcut with a number worth showing, and a shortcut that answers
            "how much have I got" before you tap it is worth more than one that
            only opens a screen. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={wallets.length === 0 ? "Track your money" : `Money, ${peso(balance)}`}
          onPress={() => router.push("/budget")}
          className="flex-row items-center gap-3 rounded-[20px] p-4 active:opacity-90"
          style={{ backgroundColor: palette.money }}
        >
          <View className="flex-1 gap-0.5">
            <Typography.Paragraph
              className="font-ui-medium text-[11.5px]"
              style={{ color: palette.moneyForeground, opacity: 0.75 }}
            >
              {wallets.length === 0
                ? "Money"
                : `Across ${wallets.length} wallet${wallets.length === 1 ? "" : "s"}`}
            </Typography.Paragraph>
            <Typography.Paragraph
              className="font-ui-bold text-[24px]"
              style={{ color: palette.moneyForeground }}
            >
              {wallets.length === 0 ? "Track your money" : peso(balance)}
            </Typography.Paragraph>
            <Typography.Paragraph
              className="font-ui text-[11.5px]"
              style={{ color: palette.moneyForeground, opacity: 0.75 }}
            >
              {wallets.length === 0
                ? "GCash, banks and cash, all on this phone"
                : `${peso(thisMonth.income)} in · ${peso(thisMonth.expense)} out this month`}
            </Typography.Paragraph>
          </View>
          <Ionicons name="arrow-forward" size={18} color={palette.moneyForeground} />
        </Pressable>

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
                  onLongPress={() =>
                    confirm.ask({
                      title: `Delete this ${item.noun}?`,
                      message: `“${item.title}” can't be brought back.`,
                      action: "Delete",
                      destructive: true,
                      onConfirm: item.remove,
                    })
                  }
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
      {confirm.dialog}
    </View>
  );
}
