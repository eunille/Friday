import { Ionicons } from "@expo/vector-icons";
import { Typography } from "heroui-native";
import { useEffect, useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { listNotes, listSources, useAI } from "../lib/ai";
import type { Scope } from "../lib/retrieval";
import { MODES, verdict, type Mode } from "../lib/tutor";
import { usePalette } from "../lib/theme";
import { Drawer, SheetHead } from "./money";
import { ChoiceRow, Group, Mascot } from "./screen";

/** A test question as it sits in the conversation. */
export type Question = {
  options: string[];
  correctIndex: number;
  /** Absent until answered. */
  chosen?: number;
  number: number;
  total: number;
};

/** The chip's words for a scope. Short, because it shares a row with two others. */
export function scopeLabel(scope: Scope): string {
  if (scope.kind === "all") return "All notes";
  if (scope.kind === "sources") {
    return scope.ids.length === 1 ? "1 selected" : `${scope.ids.length} selected`;
  }
  if (scope.kind === "subject") return "Subject";
  return "Notes off";
}

/** How it answers: plain, step by step, or by testing. */
export function ModeSheet({
  mode,
  onPick,
  onClose,
}: {
  mode: Mode;
  onPick: (mode: Mode) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Drawer onClose={onClose}>
      <SheetHead title="How should I help?" onClose={onClose} />
      <View className="px-4 pt-2">
        <Group>
          {(Object.keys(MODES) as Mode[]).map((key, index) => (
            <ChoiceRow
              key={key}
              first={index === 0}
              label={MODES[key].label}
              note={MODES[key].note}
              selected={mode === key}
              onPress={() => {
                onPick(key);
                onClose();
              }}
            />
          ))}
        </Group>
        <Typography.Paragraph className="px-1 pt-3 font-ui text-muted text-[11.5px] leading-[17px]">
          You can also just say it — “teach me subnetting”, “test me on TCP”, “stop the test”.
        </Typography.Paragraph>
      </View>
    </Drawer>
  );
}

/** One note or pack in the picker, as a checkbox. */
function Pick({
  title,
  kind,
  on,
  first,
  onPress,
}: {
  title: string;
  kind: "note" | "pack";
  on: boolean;
  first: boolean;
  onPress: () => void;
}): JSX.Element {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={title}
      onPress={onPress}
      className={`min-h-[48px] flex-row items-center gap-3 px-4 py-2.5 active:bg-surface-tertiary ${
        first ? "" : "border-t border-border"
      }`}
    >
      <Ionicons
        name={on ? "checkbox" : "square-outline"}
        size={19}
        color={on ? palette.accent : palette.muted}
      />
      <Typography.Paragraph className="flex-1 font-ui-medium text-[14px]" numberOfLines={1}>
        {title}
      </Typography.Paragraph>
      <Ionicons
        name={kind === "pack" ? "library-outline" : "document-text-outline"}
        size={14}
        color={palette.mutedSoft}
      />
    </Pressable>
  );
}

/**
 * What the tutor knows: nothing, everything, or the notes and packs you tick.
 *
 * Every tap applies at once rather than waiting for a Done button — the chip
 * behind the sheet updates as you go, so there is nothing to forget to confirm.
 * Unticking the last item falls back to "none", never to "all": an empty
 * selection meaning the whole library is the failure that looks like it worked.
 */
export function KnowledgeSheet({
  scope,
  onPick,
  onClose,
}: {
  scope: Scope;
  onPick: (scope: Scope) => void;
  onClose: () => void;
}): JSX.Element {
  const { db } = useAI();
  const [items, setItems] = useState<{ id: string; title: string; kind: "note" | "pack" }[]>([]);

  useEffect(() => {
    if (!db) return;
    void Promise.all([listNotes(db), listSources(db, "pack")]).then(([notes, packs]) =>
      setItems([
        ...notes.map((note) => ({
          id: note.id,
          title: note.title || "Untitled",
          kind: "note" as const,
        })),
        ...packs.map((pack) => ({ id: pack.id, title: pack.title, kind: "pack" as const })),
      ])
    );
  }, [db]);

  const chosen = scope.kind === "sources" ? scope.ids : [];
  const toggle = (id: string): void => {
    const next = chosen.includes(id) ? chosen.filter((item) => item !== id) : [...chosen, id];
    onPick(next.length === 0 ? { kind: "none" } : { kind: "sources", ids: next });
  };

  return (
    <Drawer onClose={onClose}>
      <SheetHead title="What should I use?" onClose={onClose} />
      <ScrollView contentContainerClassName="gap-3 px-4 pt-2 pb-2">
        <Group>
          <ChoiceRow
            first
            label="Nothing"
            note="Answer from what the model knows."
            selected={scope.kind === "none"}
            onPress={() => onPick({ kind: "none" })}
          />
          <ChoiceRow
            label="Everything I've saved"
            note="Search all notes and packs."
            selected={scope.kind === "all"}
            onPress={() => onPick({ kind: "all" })}
          />
        </Group>

        {items.length > 0 && (
          <View className="gap-1.5">
            <Typography.Paragraph className="px-1 font-ui-medium text-muted text-[12px]">
              Or only these
            </Typography.Paragraph>
            <Group>
              {items.map((item, index) => (
                <Pick
                  key={item.id}
                  first={index === 0}
                  title={item.title}
                  kind={item.kind}
                  on={chosen.includes(item.id)}
                  onPress={() => toggle(item.id)}
                />
              ))}
            </Group>
          </View>
        )}
      </ScrollView>
    </Drawer>
  );
}

/**
 * A test question in the conversation: tap an option, see the verdict under
 * it. Only the question being asked right now takes a tap — an old one, or one
 * restored from a saved chat whose test is long over, is a record, not a
 * control.
 */
export function QuestionCard({
  text,
  question,
  active,
  onAnswer,
}: {
  text: string;
  question: Question;
  active: boolean;
  onAnswer: (choice: number) => void;
}): JSX.Element {
  const palette = usePalette();
  const answered = question.chosen !== undefined;

  return (
    <View className="my-2.5 flex-row gap-2.5">
      <Mascot pose="stretch" size={38} />
      <View className="flex-1 gap-2.5 rounded-[18px] rounded-bl-md border border-border bg-surface px-3.5 py-3">
        <Typography.Paragraph className="font-ui-medium text-[10.5px] uppercase tracking-wider text-muted">
          Question {question.number} of {question.total}
        </Typography.Paragraph>
        <Typography.Paragraph className="font-read text-[15px] leading-[23px]">
          {text}
        </Typography.Paragraph>

        <View className="gap-2">
          {question.options.map((option, index) => {
            const isRight = index === question.correctIndex;
            const isChosen = index === question.chosen;
            // Before answering every option looks the same. After, the right
            // one is always marked — a wrong pick with no correction teaches
            // nothing — and the untouched wrong ones fade back.
            const tone = !answered
              ? null
              : isRight
                ? palette.onDevice
                : isChosen
                  ? palette.danger
                  : null;
            return (
              <Pressable
                key={index}
                accessibilityRole="button"
                accessibilityLabel={`${String.fromCharCode(65 + index)}: ${option}`}
                accessibilityState={{ disabled: !active || answered, selected: isChosen }}
                disabled={!active || answered}
                onPress={() => onAnswer(index)}
                className="min-h-[46px] flex-row items-center gap-2.5 rounded-xl border px-3 py-2.5 active:opacity-70"
                style={{
                  borderColor: tone ?? palette.border,
                  opacity: answered && !tone ? 0.55 : 1,
                }}
              >
                <View
                  className="h-6 w-6 items-center justify-center rounded-full"
                  style={{ backgroundColor: tone ? `${tone}22` : palette.accentSoft }}
                >
                  <Typography.Paragraph
                    className="font-ui-bold text-[11px]"
                    style={tone ? { color: tone } : undefined}
                  >
                    {String.fromCharCode(65 + index)}
                  </Typography.Paragraph>
                </View>
                <Typography.Paragraph className="flex-1 font-ui text-[13.5px] leading-[19px]">
                  {option}
                </Typography.Paragraph>
                {answered && tone && (
                  <Ionicons
                    name={isRight ? "checkmark-circle" : "close-circle"}
                    size={18}
                    color={tone}
                  />
                )}
              </Pressable>
            );
          })}
        </View>

        {answered && (
          <Typography.Paragraph
            className="font-ui-medium text-[13px]"
            style={{
              color: question.chosen === question.correctIndex ? palette.onDevice : palette.danger,
            }}
          >
            {verdict(question.options, question.correctIndex, question.chosen ?? -1)}
          </Typography.Paragraph>
        )}
      </View>
    </View>
  );
}
