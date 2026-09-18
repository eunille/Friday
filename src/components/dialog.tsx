import { useCallback, useState, type JSX, type ReactNode } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";

import { usePalette } from "../lib/theme";

/**
 * The shared chrome: a dimmed backdrop and one card.
 *
 * ponytail: React Native's own Modal, not a library. It already does the hard
 * parts — the Android back button, focus, and drawing above everything without
 * a portal — and a confirm box needs nothing a bottom sheet would add.
 */
function Sheet({
  open,
  onDismiss,
  children,
}: {
  open: boolean;
  onDismiss: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onDismiss}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.55)",
          alignItems: "center",
          justifyContent: "center",
          padding: 28,
        }}
      >
        {/* Swallows the press so a tap inside the card does not dismiss it. */}
        <Pressable onPress={() => {}} style={{ width: "100%", maxWidth: 380 }}>
          <View className="gap-3 rounded-[22px] border border-border bg-surface p-5">{children}</View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Actions({
  action,
  destructive,
  disabled,
  onCancel,
  onAction,
}: {
  action: string;
  destructive?: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onAction: () => void;
}): JSX.Element {
  const palette = usePalette();

  return (
    <View className="mt-1 flex-row justify-end gap-2">
      <Pressable
        accessibilityRole="button"
        onPress={onCancel}
        className="min-h-[44px] justify-center rounded-full px-4 active:bg-surface-tertiary"
      >
        <Text style={{ fontFamily: "Archivo_600SemiBold", fontSize: 14, color: palette.muted }}>
          Cancel
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={onAction}
        className="min-h-[44px] justify-center rounded-full px-4 active:opacity-80"
        style={{
          backgroundColor: destructive ? palette.danger : palette.accent,
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <Text
          style={{
            fontFamily: "Archivo_600SemiBold",
            fontSize: 14,
            color: destructive ? "#ffffff" : palette.accentForeground,
          }}
        >
          {action}
        </Text>
      </Pressable>
    </View>
  );
}

type Ask = {
  title: string;
  message?: string;
  /** Label on the confirming button. Name the verb, never "OK". */
  action?: string;
  destructive?: boolean;
  onConfirm: () => void;
};

/**
 * Ask before doing something that cannot be undone.
 *
 * A hook rather than a component per call site, so asking costs one line and no
 * caller has to keep `visible` state of its own. Render `dialog` anywhere in the
 * screen; it draws in a Modal, so where does not matter.
 */
export function useConfirm(): { ask: (ask: Ask) => void; dialog: JSX.Element } {
  const [pending, setPending] = useState<Ask | null>(null);
  const close = useCallback(() => setPending(null), []);

  const dialog = (
    <Sheet open={pending !== null} onDismiss={close}>
      <Text className="font-ui-bold text-[17px] text-foreground">{pending?.title}</Text>
      {pending?.message ? (
        <Text className="font-read text-[14.5px] text-muted leading-[22px]">{pending.message}</Text>
      ) : null}
      <Actions
        action={pending?.action ?? "Confirm"}
        destructive={pending?.destructive}
        onCancel={close}
        onAction={() => {
          // Closed first: the callback may navigate, and a Modal still mounted
          // over a screen that has gone away strands the backdrop on Android.
          const run = pending?.onConfirm;
          close();
          run?.();
        }}
      />
    </Sheet>
  );

  return { ask: setPending, dialog };
}

type AskText = {
  title: string;
  label?: string;
  initial?: string;
  action?: string;
  onSubmit: (value: string) => void;
};

/** The same idea, for an action that needs a word back rather than a yes. */
export function usePrompt(): { ask: (ask: AskText) => void; dialog: JSX.Element } {
  const [pending, setPending] = useState<AskText | null>(null);
  const [value, setValue] = useState("");
  const palette = usePalette();
  const close = useCallback(() => setPending(null), []);

  const open = useCallback((next: AskText) => {
    setValue(next.initial ?? "");
    setPending(next);
  }, []);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    const run = pending?.onSubmit;
    close();
    // Guarded rather than disabled-only: the keyboard's own return key can fire
    // this too, and an empty rename would blank the title it was editing.
    if (trimmed) run?.(trimmed);
  }, [value, pending, close]);

  const dialog = (
    <Sheet open={pending !== null} onDismiss={close}>
      <Text className="font-ui-bold text-[17px] text-foreground">{pending?.title}</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
        onSubmitEditing={submit}
        placeholder={pending?.label}
        placeholderTextColor={palette.muted}
        className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui text-[15px] text-foreground"
      />
      <Actions
        action={pending?.action ?? "Save"}
        disabled={value.trim() === ""}
        onCancel={close}
        onAction={submit}
      />
    </Sheet>
  );

  return { ask: open, dialog };
}
