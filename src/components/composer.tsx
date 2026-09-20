import { Ionicons } from "@expo/vector-icons";
import { Typography } from "heroui-native";
import { useCallback, type JSX, type ReactNode } from "react";
import { Pressable, TextInput, View } from "react-native";

import { useDictation } from "../lib/dictation";
import { usePalette } from "../lib/theme";

/**
 * The thing you type into, wherever the app lets you type at it.
 *
 * One implementation, because the parts that are easy to get wrong are exactly
 * the parts that must not differ between screens: how far the field lifts for
 * the keyboard, what the mic does while it is listening, and whether the send
 * button is a send or a stop. Those were solved once on the main chat, and the
 * budget chat carried a plainer copy that had already drifted — no dictation,
 * a shorter field, different corner radii and type size.
 *
 * Whatever genuinely differs per screen goes in through `controls` and
 * `footnote`.
 *
 * `overlap` comes from the screen rather than from here: useKeyboardOverlap
 * needs its onLayout on the screen's root view to measure what the system
 * already did about the keyboard, and a child cannot reach up and attach that.
 */
export function Composer({
  value,
  onChange,
  onSend,
  placeholder,
  editable = true,
  busy = false,
  onStop,
  overlap,
  bottomInset = 0,
  controls,
  footnote,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  placeholder: string;
  editable?: boolean;
  /** While something is generating, the send button becomes a stop. */
  busy?: boolean;
  onStop?: () => void;
  /** How much of the keyboard the system did not already account for. */
  overlap: number;
  /** Home-indicator inset. Zero on a tab, which sits above the dock already. */
  bottomInset?: number;
  /** Screen-specific chips, drawn above the field. */
  controls?: ReactNode;
  /** A line under the field. */
  footnote?: ReactNode;
}): JSX.Element {
  const palette = usePalette();

  // Dictated words join the draft rather than sending straight away, so a
  // misheard word can be fixed before anything acts on it.
  const dictation = useDictation(
    useCallback(
      (heard: string) => onChange(value.trim() ? `${value.trim()} ${heard}` : heard),
      [onChange, value]
    )
  );

  const ready = editable && value.trim() !== "";

  return (
    // Lifted by however much of the keyboard the system did not already account
    // for — see useKeyboardOverlap. Assuming either behaviour is what kept
    // putting this field back underneath the keys.
    <View
      className="gap-2.5 border-t border-border bg-surface px-4 pt-3"
      style={{ marginBottom: overlap, paddingBottom: Math.max(bottomInset, 12) }}
    >
      {(dictation.recording || dictation.working || dictation.notice) && (
        <Pressable
          accessibilityRole={dictation.notice ? "button" : undefined}
          onPress={dictation.notice ? dictation.dismiss : undefined}
          className="flex-row items-center gap-2 rounded-xl bg-warning-soft px-3 py-2"
        >
          <Ionicons
            name={dictation.notice ? "alert-circle-outline" : "mic"}
            size={14}
            color={palette.warning}
          />
          <Typography.Paragraph className="flex-1 font-ui-medium text-[11px] text-muted-strong">
            {dictation.notice
              ? dictation.notice
              : dictation.working
                ? "Writing down what you said…"
                : dictation.downloadProgress > 0 && dictation.downloadProgress < 1
                  ? `Getting the voice model, once only · ${Math.round(dictation.downloadProgress * 100)}%`
                  : "Listening — tap the square to stop"}
          </Typography.Paragraph>
        </Pressable>
      )}

      {controls}

      <View className="flex-row items-end gap-2">
        <TextInput
          className="max-h-32 min-h-[46px] flex-1 rounded-[20px] border border-border bg-background px-4 py-2.5 font-ui text-[15px] text-foreground"
          placeholder={placeholder}
          placeholderTextColor={palette.placeholder}
          value={value}
          onChangeText={onChange}
          editable={editable}
          multiline
        />
        {/* Dictation. Amber while it is listening or transcribing, because that
            is the app's "working" signal everywhere else. */}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: dictation.recording || dictation.working }}
          accessibilityLabel={dictation.recording ? "Stop dictating" : "Dictate instead of typing"}
          disabled={dictation.working || !editable}
          onPress={dictation.toggle}
          className={`h-[46px] w-[46px] items-center justify-center rounded-full border ${
            dictation.recording ? "border-warning bg-warning-soft" : "border-border bg-surface"
          }`}
          style={{ opacity: dictation.working || !editable ? 0.55 : 1 }}
        >
          <Ionicons
            name={dictation.recording ? "stop" : "mic-outline"}
            size={20}
            color={dictation.recording || dictation.working ? palette.warning : palette.muted}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={busy ? "Stop generating" : "Send"}
          onPress={busy ? onStop : onSend}
          disabled={!busy && !ready}
          className={`h-[46px] w-[46px] items-center justify-center rounded-full ${
            busy ? "bg-surface-tertiary" : "bg-accent"
          }`}
          style={{ opacity: !busy && !ready ? 0.35 : 1 }}
        >
          <Ionicons
            name={busy ? "stop" : "arrow-up"}
            size={20}
            color={busy ? palette.foreground : palette.accentForeground}
          />
        </Pressable>
      </View>

      {footnote}
    </View>
  );
}
