import { Button, Input, Spinner, Switch, Typography } from "heroui-native";
import { useCallback, useRef, useState, type JSX } from "react";
import { FlatList, KeyboardAvoidingView, Platform, View } from "react-native";
import type { Message } from "react-native-rag";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ModelGate, useAI } from "../../lib/ai";

function Bubble({ message }: { message: Message }): JSX.Element {
  const mine = message.role === "user";
  return (
    <View
      className={`max-w-[85%] rounded-2xl px-4 py-3 my-1 ${
        mine ? "self-end bg-accent" : "self-start bg-surface"
      }`}
    >
      <Typography.Paragraph className={mine ? "text-accent-foreground" : ""}>
        {message.content}
      </Typography.Paragraph>
    </View>
  );
}

function Chat(): JSX.Element {
  const { rag } = useAI();
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
      <View className="flex-row items-center justify-between gap-3 px-4 pt-2 pb-1">
        <View className="flex-row items-center gap-2">
          <Typography.Paragraph className="text-muted-foreground text-xs">
            Use my notes
          </Typography.Paragraph>
          <Switch isSelected={useNotes} onSelectedChange={setUseNotes} />
        </View>
        <Button
          size="sm"
          variant="ghost"
          isDisabled={busy || messages.length === 0}
          onPress={() => setMessages([])}
        >
          New chat
        </Button>
      </View>

      <FlatList
        ref={listRef}
        className="flex-1 px-4"
        data={shown}
        keyExtractor={(_, index) => String(index)}
        renderItem={({ item }) => <Bubble message={item} />}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View className="items-center justify-center py-20 gap-2">
            <Typography.Heading type="h3" className="text-center">
              Ask anything
            </Typography.Heading>
            <Typography.Paragraph className="text-center text-muted-foreground">
              Runs entirely on this device. Add notes in the Notes tab and answers will be grounded
              in them.
            </Typography.Paragraph>
          </View>
        }
      />

      <View className="flex-row items-end gap-2 px-4 pb-3 pt-2">
        <Input
          className="flex-1"
          placeholder="Ask a question…"
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        {busy ? (
          <Button variant="secondary" onPress={() => void rag?.interrupt()}>
            <Spinner size="sm" />
          </Button>
        ) : (
          <Button onPress={send} isDisabled={!draft.trim()}>
            Send
          </Button>
        )}
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
