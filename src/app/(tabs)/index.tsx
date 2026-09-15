import { Ionicons } from "@expo/vector-icons";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import type { Message } from "react-native-rag";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ModelGate, useAI } from "../../lib/ai";
import { usePalette } from "../../lib/theme";

const SUGGESTIONS = [
  "Summarise everything I saved this week",
  "Quiz me on my notes",
  "What did I write about deadlines?",
];

/**
 * The rule down the left of an answer. It carries the amber only while tokens
 * are arriving, which is the one job the accent colour has in this app — so
 * "the model is working" is legible from across the room, with no spinner.
 */
function AnswerRule({ live }: { live: boolean }): JSX.Element {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = live
      ? withRepeat(withTiming(0.25, { duration: 620 }), -1, true)
      : withTiming(1, { duration: 200 });
  }, [live, pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={style}
      className={`w-[3px] rounded-full ${live ? "bg-accent" : "bg-separator"}`}
    />
  );
}

function Turn({ message, live }: { message: Message; live: boolean }): JSX.Element {
  // A person's words and a machine's words are set differently on purpose: the
  // question stays a compact grotesk bubble, the answer is serif prose laid
  // flat on the page like something you would read rather than skim.
  if (message.role === "user") {
    return (
      <View className="my-2 max-w-[82%] self-end rounded-2xl rounded-br-md bg-surface-tertiary px-4 py-2.5">
        <Typography.Paragraph className="font-ui text-[15px] leading-[21px]">
          {message.content}
        </Typography.Paragraph>
      </View>
    );
  }

  return (
    <View className="my-2.5 flex-row gap-3 pr-2">
      <AnswerRule live={live} />
      <Typography.Paragraph className="flex-1 font-read text-[17px] leading-[26px]">
        {message.content}
        {live && message.content === "" ? "Thinking…" : ""}
      </Typography.Paragraph>
    </View>
  );
}

function Chat(): JSX.Element {
  const { rag } = useAI();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [useNotes, setUseNotes] = useState(true);
  const listRef = useRef<FlatList<Message>>(null);

  const busy = streaming !== null;

  const send = useCallback(async () => {
    const input = draft.trim();
    if (!rag || !input || busy) return;

    const history: Message[] = [...messages, { role: "user", content: input }];
    setMessages(history);
    setDraft("");
    setStreaming("");

    let answer = "";
    try {
      await rag.generate({
        input: history,
        augmentedGeneration: useNotes,
        callback: (token) => {
          answer += token;
          setStreaming(answer);
        },
      });
      setMessages([...history, { role: "assistant", content: answer }]);
    } catch (error) {
      setMessages([
        ...history,
        {
          role: "assistant",
          content: `Couldn't answer that: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    } finally {
      setStreaming(null);
    }
  }, [rag, draft, busy, messages, useNotes]);

  const shown: Message[] =
    streaming === null ? messages : [...messages, { role: "assistant", content: streaming }];

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.bottom + 56}
    >
      <View className="flex-row items-center justify-between px-4 pb-2 pt-2">
        <Typography.Heading type="h1" className="font-ui-bold text-[30px] tracking-tight">
          Ask
        </Typography.Heading>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start a new chat"
          disabled={busy || messages.length === 0}
          onPress={() => setMessages([])}
          className="h-10 w-10 items-center justify-center rounded-full border border-border active:bg-surface-tertiary"
          style={{ opacity: busy || messages.length === 0 ? 0.35 : 1 }}
        >
          <Ionicons name="create-outline" size={19} color={palette.foreground} />
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        className="flex-1 px-4"
        data={shown}
        keyExtractor={(_, index) => String(index)}
        renderItem={({ item, index }) => (
          <Turn message={item} live={busy && index === shown.length - 1} />
        )}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View className="gap-6 pt-8">
            <Typography.Paragraph className="font-read text-[19px] leading-[28px] text-muted">
              Everything here runs on the phone. Your questions, your notes and the model never
              leave it.
            </Typography.Paragraph>

            <View className="overflow-hidden rounded-2xl border border-border bg-surface">
              {SUGGESTIONS.map((text, index) => (
                <Pressable
                  key={text}
                  accessibilityRole="button"
                  onPress={() => setDraft(text)}
                  className={`flex-row items-center gap-3 px-4 py-3.5 active:bg-surface-tertiary ${
                    index > 0 ? "border-t border-border" : ""
                  }`}
                >
                  <Typography.Paragraph className="flex-1 font-ui text-[15px]">
                    {text}
                  </Typography.Paragraph>
                  <Ionicons name="arrow-forward" size={15} color={palette.muted} />
                </Pressable>
              ))}
            </View>
          </View>
        }
      />

      <View className="gap-2.5 border-t border-border bg-surface px-4 pb-3 pt-3">
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: useNotes }}
          onPress={() => setUseNotes((on) => !on)}
          className={`flex-row items-center gap-1.5 self-start rounded-full border px-3 py-1.5 ${
            useNotes ? "border-accent" : "border-border"
          }`}
        >
          <Ionicons
            name={useNotes ? "layers" : "layers-outline"}
            size={13}
            color={useNotes ? palette.accent : palette.muted}
          />
          <Typography.Paragraph
            className={`font-ui-medium text-[12px] ${useNotes ? "text-accent" : "text-muted"}`}
          >
            {useNotes ? "Reading your notes" : "Notes off"}
          </Typography.Paragraph>
        </Pressable>

        <View className="flex-row items-end gap-2">
          <TextInput
            className="max-h-32 flex-1 rounded-2xl border border-border bg-background px-4 py-2.5 font-ui text-[16px] text-foreground"
            placeholder="Ask anything"
            placeholderTextColor={palette.placeholder}
            value={draft}
            onChangeText={setDraft}
            multiline
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={busy ? "Stop generating" : "Send"}
            onPress={() => (busy ? void rag?.interrupt() : void send())}
            disabled={!busy && !draft.trim()}
            className={`h-11 w-11 items-center justify-center rounded-full ${
              busy ? "bg-surface-tertiary" : "bg-accent"
            }`}
            style={{ opacity: !busy && !draft.trim() ? 0.35 : 1 }}
          >
            <Ionicons
              name={busy ? "stop" : "arrow-up"}
              size={19}
              color={busy ? palette.foreground : palette.accentForeground}
            />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

export default function AskTab(): JSX.Element {
  return (
    <ModelGate>
      <Chat />
    </ModelGate>
  );
}
