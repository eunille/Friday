import { Ionicons } from "@expo/vector-icons";
import { Typography } from "heroui-native";
import { useState, type ComponentProps, type JSX, type ReactNode } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TIERS, useAI } from "../lib/ai";
import { useKeyboardHeight, usePalette, useScheme } from "../lib/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

/**
 * Every tap target in the app goes through here at 44pt, the smallest square a
 * finger hits reliably. The icon inside stays small; it is the pressable that
 * grows.
 */
export function IconButton({
  name,
  label,
  onPress,
  disabled = false,
  tone = "default",
  bordered = false,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "default" | "muted" | "accent" | "danger";
  bordered?: boolean;
}): JSX.Element {
  const palette = usePalette();
  const colors = {
    default: palette.foreground,
    muted: palette.muted,
    accent: palette.accent,
    danger: palette.danger,
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`h-11 w-11 items-center justify-center rounded-full active:bg-surface-tertiary ${
        bordered ? "border border-border" : ""
      }`}
      style={{ opacity: disabled ? 0.35 : 1 }}
    >
      <Ionicons name={name} size={20} color={colors[tone]} />
    </Pressable>
  );
}

/**
 * Scrolling container for a tab.
 *
 * Carries the status-bar inset (the title used to sit under the clock) and the
 * keyboard's height as bottom padding, so the field you are typing into can
 * always be scrolled into view.
 */
export function Screen({ children }: { children: ReactNode }): JSX.Element {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 gap-5"
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingBottom: 32 + keyboard,
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {children}
    </ScrollView>
  );
}

/**
 * Scrolling body for a pushed page — one without a tab bar beneath it.
 *
 * The tab bar normally holds content clear of Android's back/home/recents
 * strip. A pushed page has no tab bar, so it has to carry that inset itself or
 * its last button ends up underneath the system buttons and cannot be tapped.
 */
export function PageScroll({ children }: { children: ReactNode }): JSX.Element {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="px-4 pt-4 gap-5"
      contentContainerStyle={{ paddingBottom: 32 + insets.bottom + keyboard }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {children}
    </ScrollView>
  );
}

/**
 * Title block for a tab. The chip names the model that is actually loaded — the
 * only claim in the app worth making persistently.
 */
export function ScreenHeader({
  title,
  children,
  action,
  pose,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Draws the mascot beside the title, doing whatever this screen is for. */
  pose?: Pose;
}): JSX.Element {
  const { tier } = useAI();

  return (
    <View className="gap-2 pb-1">
      <View className="flex-row items-center justify-between gap-2">
        {pose && <Mascot pose={pose} size={48} />}
        <Typography.Heading type="h1" className="flex-1 font-ui-bold text-[30px] tracking-tight">
          {title}
        </Typography.Heading>
        {action ??
          (tier && (
            <View className="rounded-full border border-border px-2.5 py-1">
              <Typography.Paragraph className="font-ui text-muted text-[11px]">
                {TIERS[tier].name}
              </Typography.Paragraph>
            </View>
          ))}
      </View>
      {children && (
        <Typography.Paragraph className="font-read text-muted text-[15px] leading-6">
          {children}
        </Typography.Paragraph>
      )}
    </View>
  );
}

/** Top bar for a pushed page: back, title, and whatever the page needs on the right. */
export function PageHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
}): JSX.Element {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row items-center gap-1 border-b border-border bg-surface px-2 pb-2"
      style={{ paddingTop: insets.top + 6 }}
    >
      <IconButton name="chevron-back" label="Go back" onPress={onBack} />
      <Typography.Paragraph className="flex-1 font-ui-bold text-[17px]" numberOfLines={1}>
        {title}
      </Typography.Paragraph>
      {right}
    </View>
  );
}

/** One selectable option in a settings-style list. */
export function ChoiceRow({
  label,
  note,
  trailing,
  selected,
  first = false,
  onPress,
}: {
  label: string;
  note?: string;
  trailing?: string;
  selected: boolean;
  first?: boolean;
  onPress: () => void;
}): JSX.Element {
  const palette = usePalette();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-[52px] flex-row items-center gap-3 px-4 py-3 active:bg-surface-tertiary ${
        first ? "" : "border-t border-border"
      }`}
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={19}
        color={selected ? palette.accent : palette.muted}
      />
      <View className="flex-1 gap-0.5">
        <Typography.Paragraph className="font-ui-medium text-[15px]">{label}</Typography.Paragraph>
        {note && (
          <Typography.Paragraph className="font-ui text-muted text-[12px]">
            {note}
          </Typography.Paragraph>
        )}
      </View>
      {trailing && (
        <Typography.Paragraph className="font-ui-medium text-muted text-[12px]">
          {trailing}
        </Typography.Paragraph>
      )}
    </Pressable>
  );
}

/** Rounded container that groups rows with hairline separators. */
export function Group({ children }: { children: ReactNode }): JSX.Element {
  return (
    <View className="overflow-hidden rounded-2xl border border-border bg-surface">{children}</View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Typography.Heading type="h3" className="font-ui-bold text-[17px]">
      {children}
    </Typography.Heading>
  );
}

/**
 * A card that visibly takes a press: it sits on a hard 3pt lip of its own
 * colour and drops onto it when touched.
 *
 * ponytail: a backing view, not a CSS boxShadow string. RN accepts the string
 * but Android's rendering of a zero-blur shadow is inconsistent, and this is
 * the redesign's signature affordance — worth the one extra view to have it
 * render the same everywhere. Total height does not change on press, so
 * nothing below it moves.
 */
export function PressCard({
  children,
  onPress,
  className = "p-3.5",
}: {
  children: ReactNode;
  onPress?: () => void;
  className?: string;
}): JSX.Element {
  const scheme = useScheme();
  const [down, setDown] = useState(false);

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      onPressIn={() => setDown(true)}
      onPressOut={() => setDown(false)}
      className={`rounded-[20px] border border-border bg-surface ${className}`}
      style={
        // A card is lifted by light, and settles when pressed. On a near-black
        // scheme a shadow is invisible, so there the border carries the edge on
        // its own and only the scale reads.
        scheme === "light"
          ? {
              shadowColor: "#0e0f12",
              shadowOpacity: down ? 0.04 : 0.1,
              shadowRadius: down ? 4 : 14,
              shadowOffset: { width: 0, height: down ? 1 : 6 },
              elevation: down ? 1 : 3,
              transform: [{ scale: down ? 0.985 : 1 }],
            }
          : { transform: [{ scale: down ? 0.985 : 1 }] }
      }
    >
      {children}
    </Pressable>
  );
}

/**
 * The app's one persistent claim: this ran here, nothing left the phone.
 * Teal carries it everywhere — see the colour note in global.css.
 */
export function OnDeviceChip({ label }: { label: string }): JSX.Element {
  const palette = usePalette();

  return (
    <View className="flex-row items-center gap-1.5 self-start rounded-full bg-on-device-soft px-2.5 py-1">
      <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: palette.onDevice }} />
      <Typography.Paragraph className="font-ui-medium text-[10.5px] text-on-device">
        {label}
      </Typography.Paragraph>
    </View>
  );
}

/** The poses on `faces-sheet.png`, in the order they sit on the strip. */
const POSES = [
  "hero",
  "stretch",
  "reading",
  "glasses",
  "earn",
  "savings",
  "rich",
  "happy",
] as const;
export type Pose = (typeof POSES)[number];

const FACES = require("../../assets/images/sprites/faces-sheet.png");

/**
 * The mascot, as he appears beside anything he said.
 *
 * One pose per screen, so the badge says what the screen is for before you
 * read the heading: reading on Notes, glasses on Scan, a coin on Money. Whole
 * sprites rather than the head crop the old chef needed — cropping to the face
 * would make every pose the same owl, which defeats having poses at all.
 *
 * One sheet behind a window, like the loaders, so five poses cost one decode.
 * Nothing centres the window: the strip is five cells wide and is placed by the
 * transform, which `justifyContent` would fight.
 *
 * He sits on the page with no disc behind him. That does cost contrast in the
 * light theme, where a near-white owl meets a near-white surface — the tan
 * outline and the orange tufts are what carry him there.
 *
 * No particle on the corner. The atlas's sparkles are almost entirely
 * antialiased edge, so lifting them off the painted checkerboard leaves a pale
 * halo that shows as a white box at any size worth drawing them.
 */
export function Mascot({ pose = "hero", size = 58 }: { pose?: Pose; size?: number }): JSX.Element {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, overflow: "hidden" }}
    >
      <Image
        source={FACES}
        style={{
          width: size * POSES.length,
          height: size,
          transform: [{ translateX: -POSES.indexOf(pose) * size }],
        }}
      />
    </View>
  );
}
