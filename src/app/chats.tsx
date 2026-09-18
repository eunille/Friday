import { useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useState, type JSX } from "react";
import { Pressable, View } from "react-native";

import { useConfirm, usePrompt } from "../components/dialog";
import { Group, IconButton, PageHeader, PageScroll } from "../components/screen";
import { ModelGate, deleteChat, listChats, renameChat, useAI, type ChatSummary } from "../lib/ai";
import { relativeDate } from "../lib/formats";

/**
 * Every conversation, and the only place they can be thrown away.
 *
 * The dashboard shows five, merged in among notes and quiz attempts and then
 * trimmed to four rows, so anything older than that had no way to be reopened
 * and no way to be deleted. This is the list that owns them.
 */
export default function Chats(): JSX.Element {
  const { db, invalidate } = useAI();
  const router = useRouter();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [chats, setChats] = useState<ChatSummary[] | null>(null);

  const refresh = useCallback(() => {
    // Far past what anyone will scroll, but bounded: an unbounded query would
    // read every stored conversation into memory to draw a screenful.
    if (db) void listChats(db, 200).then(setChats);
  }, [db]);

  useEffect(refresh, [refresh]);

  // The dashboard reads the same table, so it has to be told after either edit.
  const done = useCallback(() => {
    refresh();
    invalidate();
  }, [refresh, invalidate]);

  const remove = useCallback(
    (chat: ChatSummary) => {
      confirm.ask({
        title: "Delete this conversation?",
        message: `“${chat.title}” and its ${chat.turns} messages can't be brought back.`,
        action: "Delete",
        destructive: true,
        onConfirm: () => {
          if (db) void deleteChat(db, chat.id).then(done);
        },
      });
    },
    [db, confirm, done]
  );

  const rename = useCallback(
    (chat: ChatSummary) => {
      prompt.ask({
        title: "Rename conversation",
        label: "Conversation name",
        initial: chat.title,
        onSubmit: (title) => {
          if (db) void renameChat(db, chat.id, title).then(done);
        },
      });
    },
    [db, prompt, done]
  );

  return (
    <View className="flex-1 bg-background">
      <PageHeader title="Conversations" onBack={() => router.back()} />
      <ModelGate>
        <PageScroll>
          {chats !== null && chats.length === 0 ? (
            <Typography.Paragraph className="pt-6 text-center font-read text-muted text-[15px] leading-6">
              Nothing here yet. Conversations you have in Chat show up on this list.
            </Typography.Paragraph>
          ) : (
            <Group>
              {(chats ?? []).map((chat, index) => (
                <View
                  key={chat.id}
                  className={`flex-row items-center gap-2 pr-2 ${
                    index === 0 ? "" : "border-t border-border"
                  }`}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${chat.title}`}
                    onPress={() => router.push({ pathname: "/", params: { chat: chat.id } })}
                    className="min-h-[56px] flex-1 justify-center gap-0.5 py-3 pl-4 active:opacity-70"
                  >
                    <Typography.Paragraph className="font-ui-medium text-[15px]" numberOfLines={1}>
                      {chat.title}
                    </Typography.Paragraph>
                    <Typography.Paragraph className="font-ui text-muted text-[12px]">
                      {relativeDate(chat.updatedAt)} · {chat.turns} messages
                    </Typography.Paragraph>
                  </Pressable>
                  <IconButton
                    name="pencil-outline"
                    label={`Rename ${chat.title}`}
                    tone="muted"
                    onPress={() => rename(chat)}
                  />
                  <IconButton
                    name="trash-outline"
                    label={`Delete ${chat.title}`}
                    tone="danger"
                    onPress={() => remove(chat)}
                  />
                </View>
              ))}
            </Group>
          )}
        </PageScroll>
      </ModelGate>
      {confirm.dialog}
      {prompt.dialog}
    </View>
  );
}
