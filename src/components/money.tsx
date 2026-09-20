import { Ionicons } from "@expo/vector-icons";
import { Typography } from "heroui-native";
import { useId, useState, type ComponentProps, type JSX, type ReactNode } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

import {
  ACCOUNT_TYPES,
  INCOME_SOURCES,
  balanceOf,
  categoriesInUse,
  categoryOf,
  openingFor,
  parseAmount,
  peso,
  type Account,
  type AccountType,
  type Category,
  type IncomeSource,
  type Txn,
  type TxnKind,
} from "../lib/budget";
import { relativeDate } from "../lib/formats";
import { usePalette } from "../lib/theme";
import { IconButton } from "./screen";

/**
 * The parts of Money that more than one screen draws.
 *
 * They live here rather than in the dashboard because the wallet page shows the
 * same cards, the same ledger rows and the same editors. Two copies of a money
 * row would be two places for a sign to go the wrong way.
 */

const WALLET_TYPES = Object.keys(ACCOUNT_TYPES) as AccountType[];
/** Derived, so adding a bank to ACCOUNT_TYPES cannot leave its group unlisted. */
const TYPE_GROUPS = [...new Set(WALLET_TYPES.map((type) => ACCOUNT_TYPES[type].group))];

/**
 * The brand marks there are actually files for.
 *
 * Drawn on a white chip rather than straight onto the card. These are
 * full-colour logos and the card behind them is the same brand colour — a mint
 * wordmark on a green card is invisible. A white tile is also how the banks'
 * own apps show each other's marks, so it reads as a logo rather than a sticker.
 *
 * A type missing from here falls back to its initial in the brand colour, so
 * adding a logo later is one line and nothing breaks without one.
 */
const BRAND_LOGOS: Partial<Record<AccountType, number>> = {
  maribank: require("../../assets/images/brands/maribank.png"),
  maya: require("../../assets/images/brands/maya.png"),
  // ponytail: the only card mark supplied was Visa, so every credit account
  // wears it. Swap to per-card brands when someone actually holds two.
  credit: require("../../assets/images/brands/visa.png"),
};

/** Mix a #rrggbb toward white (ratio > 0) or black (ratio < 0). */
function shift(hex: string, ratio: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const target = ratio > 0 ? 255 : 0;
  const k = Math.abs(ratio);
  const channel = (c: number): string =>
    Math.round(c + (target - c) * k)
      .toString(16)
      .padStart(2, "0");
  return `#${channel((n >> 16) & 255)}${channel((n >> 8) & 255)}${channel(n & 255)}`;
}

/**
 * The face of a coloured card: a diagonal wash, two soft blobs, a hairline ring
 * and one specular sweep.
 *
 * Flat fills are what made these look stale. A real card catches light, so the
 * colour runs lighter at the top-left and deeper at the bottom-right, with
 * highlights pooling where the light would land. Everything is drawn with
 * react-native-svg, already here for the charts, so this costs no dependency
 * and no rebuild.
 *
 * All of it is white at low opacity rather than a second hue, which is what
 * keeps nine of these on one screen from turning into a paint chart.
 *
 * The gradient ids carry a per-instance suffix. SVG ids are document-global, so
 * five cards all defining "face" would every one of them paint with whichever
 * mounted first — every wallet the same colour.
 */
export function BrandSurface({ colour, radius }: { colour: string; radius: number }): JSX.Element {
  // useId returns colons, which are legal in an id but awkward in a url(#…).
  const uid = useId().replace(/:/g, "");
  const face = `face${uid}`;
  const gloss = `gloss${uid}`;
  const blob = `blob${uid}`;

  return (
    // The plain View is what makes the wash reach the edges. Yoga resolves an
    // absolute child's *insets* against the parent's border box but a
    // percentage *width* against its content box, so an <Svg width="100%">
    // pinned with absoluteFill started at the card's left edge and stopped a
    // whole padding short of the right one — a hard seam down a p-4 card,
    // which is what made the hero read as half-transparent. Insets alone have
    // no such disagreement, so the wrapper fills the card and the Svg fills a
    // parent with no padding to argue about.
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={face} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={shift(colour, 0.32)} />
            <Stop offset="0.5" stopColor={colour} />
            <Stop offset="1" stopColor={shift(colour, -0.34)} />
          </LinearGradient>
          <LinearGradient id={gloss} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0.30" />
            <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </LinearGradient>
          {/* A blob with a hard edge reads as a sticker. Fading it to nothing
              at its own rim is what makes it look like light on a surface. */}
          <RadialGradient id={blob} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0.20" />
            <Stop offset="0.6" stopColor="#ffffff" stopOpacity="0.10" />
            <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <Rect x="0" y="0" width="100%" height="100%" rx={radius} fill={`url(#${face})`} />

        {/* Everything below bleeds off an edge on purpose. A circle that fits
            inside the card reads as a dot someone put there; one running off
            the side reads as the card being a window onto something larger.
            The parent View clips them — see the overflow-hidden on the card. */}
        <Circle cx="84%" cy="116%" r="58%" fill={`url(#${blob})`} />
        <Circle cx="112%" cy="70%" r="38%" fill={`url(#${blob})`} />
        {/* One crisp line against all that softness, so the card has an edge to
            catch the eye rather than only washes. */}
        <Circle
          cx="14%"
          cy="-18%"
          r="34%"
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.22}
          strokeWidth={1}
        />
        <Ellipse cx="82%" cy="-6%" rx="78%" ry="52%" fill={`url(#${gloss})`} />
      </Svg>
    </View>
  );
}

/** The logo if there is one, otherwise the initial in the brand colour. */
export function BrandMark({ type, size }: { type: AccountType; size: number }): JSX.Element {
  const logo = BRAND_LOGOS[type];
  const brand = ACCOUNT_TYPES[type];

  return (
    <View
      className="items-center justify-center bg-white"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        // The tile is white so full-colour logos read on a brand-coloured card.
        // On the picker's white surface that would leave it invisible, so it
        // keeps a hairline: definition where it is needed, unnoticeable on
        // saturated ground.
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(0,0,0,0.12)",
      }}
    >
      {logo === undefined ? (
        <Text
          style={{
            color: brand.colour,
            fontFamily: "Archivo_600SemiBold",
            fontSize: size * 0.5,
          }}
        >
          {brand.label.slice(0, 1)}
        </Text>
      ) : (
        <Image
          source={logo}
          resizeMode="contain"
          style={{ width: size * 0.74, height: size * 0.74 }}
        />
      )}
    </View>
  );
}

const SOURCE_KEYS = Object.keys(INCOME_SOURCES) as IncomeSource[];

const KINDS: { kind: TxnKind; label: string }[] = [
  { kind: "expense", label: "Expense" },
  { kind: "income", label: "Income" },
  { kind: "transfer", label: "Transfer" },
];

/* ----------------------------------------------------------------- chrome --- */

/**
 * A bottom sheet: backdrop behind, card slid up from the bottom edge.
 *
 * The backdrop is a sibling of the card rather than its parent. Wrapping the
 * card in the dismiss-Pressable is the obvious way to write this, and it costs
 * you scrolling inside the sheet on Android — the outer press responder claims
 * the gesture before the ScrollView sees it.
 */
export function Drawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.55)",
          }}
        />
        {/* A Modal draws edge to edge, so the sheet's own bottom padding was
            the only thing holding its last row clear of Android's back/home
            strip — and 32 is less than a navigation bar. Carrying the inset is
            what stops the final action being sliced in half. */}
        <View
          className="max-h-[90%] rounded-t-[26px] border border-border bg-surface"
          style={{ paddingBottom: insets.bottom + 24 }}
        >
          {/* The grab bar does nothing — the sheet is not draggable — but it is
              what says at a glance that this is a sheet you can get out of
              rather than a screen you have arrived at. */}
          <View className="items-center pt-2.5 pb-1">
            <View className="h-1 w-9 rounded-full bg-border" />
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** Title and a close button, shared by every sheet here. */
export function SheetHead({ title, onClose }: { title: string; onClose: () => void }): JSX.Element {
  return (
    <View className="flex-row items-center justify-between px-5 pt-1">
      <Typography.Heading type="h2" className="font-ui-bold text-[19px]">
        {title}
      </Typography.Heading>
      <IconButton name="close" label="Close" tone="muted" onPress={onClose} />
    </View>
  );
}

/** A labelled field. The label sits above, so it survives a filled input. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <View className="gap-1.5">
      <Typography.Paragraph className="font-ui-medium text-muted text-[12px]">
        {label}
      </Typography.Paragraph>
      {children}
      {hint !== undefined && (
        <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
          {hint}
        </Typography.Paragraph>
      )}
    </View>
  );
}

export function Chip({
  label,
  on,
  tint,
  onPress,
}: {
  label: string;
  on: boolean;
  tint?: string;
  onPress: () => void;
}): JSX.Element {
  const palette = usePalette();
  const colour = tint ?? palette.accent;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      className="min-h-[36px] justify-center rounded-full border px-3.5"
      style={{
        backgroundColor: on ? colour : "transparent",
        borderColor: on ? colour : palette.border,
      }}
    >
      <Text
        style={{
          fontFamily: "Archivo_600SemiBold",
          fontSize: 12.5,
          color: on ? (tint ? "#fff" : palette.accentForeground) : palette.muted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ---------------------------------------------------------------- wallets --- */

/**
 * One wallet, as a card you can swipe past.
 *
 * Brand colour, white type: you find GCash by its blue rather than by reading
 * five labels. These are the only saturated things on the screen apart from the
 * balance above them.
 */
export function WalletCard({
  account,
  balance,
  onPress,
  grow = false,
}: {
  account: Account;
  balance: number;
  onPress: () => void;
  /** Share the row instead of taking a fixed width, for the two-column grid. */
  grow?: boolean;
}): JSX.Element {
  const brand = ACCOUNT_TYPES[account.type];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${account.name}, ${brand.label}, ${peso(balance)}`}
      onPress={onPress}
      className={`h-[104px] justify-between overflow-hidden rounded-[20px] p-3 active:opacity-90 ${
        grow ? "flex-1" : "w-[158px]"
      }`}
      style={{
        // Under the gradient, not instead of it: if the SVG ever fails to draw
        // there is still a brand-coloured card rather than a transparent hole.
        backgroundColor: brand.colour,
        // A shadow in the card's own colour is what reads as "lit" rather than
        // "dropped on grey paper".
        shadowColor: brand.colour,
        shadowOpacity: 0.45,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6,
      }}
    >
      <BrandSurface colour={brand.colour} radius={20} />
      <View className="flex-row items-center gap-1.5">
        <BrandMark type={account.type} size={22} />
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            color: "#fff",
            opacity: 0.9,
            fontFamily: "Archivo_500Medium",
            fontSize: 11.5,
          }}
        >
          {brand.label}
        </Text>
      </View>
      <View>
        {/* The purpose leads, the balance sits under it. You scan these to find
            "the one I pay bills from", not to read nine brand names. */}
        <Text
          numberOfLines={1}
          style={{ color: "#fff", fontFamily: "Archivo_500Medium", fontSize: 11.5, opacity: 0.82 }}
        >
          {account.name}
        </Text>
        <Text style={{ color: "#fff", fontFamily: "Archivo_600SemiBold", fontSize: 17 }}>
          {peso(balance)}
        </Text>
      </View>
    </Pressable>
  );
}

/** One kind in the picker: brand dot, name, tick when it is the chosen one. */
function TypeRow({
  type,
  on,
  onPress,
}: {
  type: AccountType;
  on: boolean;
  onPress: () => void;
}): JSX.Element {
  const palette = usePalette();
  const brand = ACCOUNT_TYPES[type];

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      className="min-h-[50px] flex-row items-center gap-3 rounded-xl px-3 active:bg-surface-tertiary"
    >
      <BrandMark type={type} size={28} />
      <Typography.Paragraph className="flex-1 font-ui-medium text-[14.5px]">
        {brand.label}
      </Typography.Paragraph>
      {on && <Ionicons name="checkmark" size={18} color={palette.accent} />}
    </Pressable>
  );
}

/**
 * Add or correct one wallet.
 *
 * The kind comes first and opens a list rather than a row of chips. Nine brands
 * in a horizontal scroller means the ones past the edge get found by accident;
 * a list grouped into e-wallets, banks, cash and credit is one tap to a name
 * you were already looking for.
 *
 * That list replaces the form inside the same sheet instead of opening a second
 * Modal over it — two stacked modals on Android leave the backdrop behind when
 * the inner one closes.
 */
export function WalletEditor({
  draft,
  txns,
  isNew,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Account;
  txns: readonly Txn[];
  isNew: boolean;
  onChange: (next: Account) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}): JSX.Element {
  const palette = usePalette();
  const [picking, setPicking] = useState(false);

  // Seeded from the balance that is true right now, not from the opening
  // balance — that is the number you can check against the bank's own app.
  // Seeded once and never synced back: the caller remounts this per wallet, so
  // an effect mirroring `draft` would re-run on every keystroke and rewrite
  // what is being typed, turning "250." into "250" under the cursor.
  const [amount, setAmount] = useState(() => {
    const current = balanceOf(draft, txns);
    return current === 0 ? "" : String(current / 100);
  });

  const named = draft.name.trim() !== "";
  const brand = ACCOUNT_TYPES[draft.type];

  if (picking) {
    return (
      <Drawer onClose={() => setPicking(false)}>
        <View className="flex-row items-center gap-1 px-2 pt-1">
          <IconButton name="chevron-back" label="Back" onPress={() => setPicking(false)} />
          <Typography.Heading type="h2" className="flex-1 font-ui-bold text-[19px]">
            Choose a kind
          </Typography.Heading>
        </View>
        <ScrollView contentContainerClassName="px-3 pt-2 pb-2 gap-3">
          {TYPE_GROUPS.map((group) => (
            <View key={group} className="gap-0.5">
              <Typography.Paragraph className="px-3 font-ui-medium text-muted text-[11.5px]">
                {group}
              </Typography.Paragraph>
              {WALLET_TYPES.filter((type) => ACCOUNT_TYPES[type].group === group).map((type) => (
                <TypeRow
                  key={type}
                  type={type}
                  on={draft.type === type}
                  onPress={() => {
                    // The name is deliberately not prefilled from the kind any
                    // more. It is the wallet's purpose now, and seeding it with
                    // "GCash" would teach exactly the naming this moved away
                    // from — the brand is already on the card.
                    onChange({ ...draft, type });
                    setPicking(false);
                  }}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      </Drawer>
    );
  }

  return (
    <Drawer onClose={onClose}>
      <SheetHead title={isNew ? "New wallet" : "Edit wallet"} onClose={onClose} />
      <ScrollView
        contentContainerClassName="px-5 pt-4 pb-2 gap-4"
        keyboardShouldPersistTaps="handled"
      >
        <Field label="Kind">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Kind: ${brand.label}. Change it.`}
            onPress={() => setPicking(true)}
            className="min-h-[50px] flex-row items-center gap-2.5 rounded-xl border border-border bg-background px-3 active:bg-surface-tertiary"
          >
            <BrandMark type={draft.type} size={28} />
            <Typography.Paragraph className="flex-1 font-ui-medium text-[15px]">
              {brand.label}
            </Typography.Paragraph>
            <Ionicons name="chevron-down" size={16} color={palette.muted} />
          </Pressable>
        </Field>

        <Field
          label="What is it for"
          hint={`Ask matches this or the kind, so "food 250 from ${
            draft.name.trim() === "" ? "expenses" : draft.name.trim().toLowerCase()
          }" and "food 250 ${brand.label.toLowerCase()}" both land here.`}
        >
          <TextInput
            value={draft.name}
            onChangeText={(name) => onChange({ ...draft, name })}
            placeholder="Expenses, savings, bills…"
            placeholderTextColor={palette.muted}
            className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui text-[15px] text-foreground"
          />
        </Field>

        <Field
          label={isNew ? "Starting balance" : "Balance right now"}
          hint={
            isNew
              ? "What is in it today. Everything you log from here moves it."
              : "What this wallet should say. Correcting it adjusts the starting balance, so nothing you already logged is lost."
          }
        >
          <TextInput
            value={amount}
            onChangeText={(text) => {
              setAmount(text);
              // The field holds the real balance, so the opening balance is
              // worked back from it. Writing this straight into openingBalance
              // would re-add every transaction since the wallet was opened.
              onChange({
                ...draft,
                openingBalance: openingFor(draft.id, txns, parseAmount(text) ?? 0),
              });
            }}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={palette.muted}
            className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui-bold text-[20px] text-foreground"
          />
        </Field>

        <View className="flex-row gap-2 pt-1">
          {/* Only for a wallet that exists. Offering Delete on something never
              saved is offering to undo nothing. */}
          {!isNew && (
            <Pressable
              accessibilityRole="button"
              onPress={onDelete}
              className="min-h-[48px] justify-center rounded-full border border-border px-4 active:opacity-70"
            >
              <Text
                style={{ fontFamily: "Archivo_600SemiBold", fontSize: 14, color: palette.danger }}
              >
                Delete
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={!named}
            onPress={onSave}
            className="min-h-[48px] flex-1 items-center justify-center rounded-full active:opacity-80"
            style={{ backgroundColor: palette.accent, opacity: named ? 1 : 0.4 }}
          >
            <Text
              style={{
                fontFamily: "Archivo_600SemiBold",
                fontSize: 14,
                color: palette.accentForeground,
              }}
            >
              {isNew ? "Add wallet" : "Save"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Drawer>
  );
}

/* ----------------------------------------------------------------- ledger --- */

/** One line in the ledger. */
export function TxnRow({
  txn,
  accounts,
  onPress,
  first,
}: {
  txn: Txn;
  accounts: readonly Account[];
  onPress: () => void;
  first: boolean;
}): JSX.Element {
  const palette = usePalette();
  const from = accounts.find((account) => account.id === txn.accountId);
  const to = accounts.find((account) => account.id === txn.toAccountId);

  const title =
    txn.kind === "transfer"
      ? `${from?.name ?? "?"} → ${to?.name ?? "?"}`
      : txn.kind === "income"
        ? INCOME_SOURCES[txn.source ?? "other"].label
        : categoryOf(txn.category).label;

  const icon =
    txn.kind === "transfer"
      ? "swap-horizontal"
      : txn.kind === "income"
        ? "arrow-down"
        : categoryOf(txn.category).icon;

  const tint =
    txn.kind === "transfer"
      ? palette.muted
      : txn.kind === "income"
        ? palette.onDevice
        : palette.foreground;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${peso(txn.amount)}`}
      onPress={onPress}
      className={`min-h-[58px] flex-row items-center gap-3 px-3.5 py-2.5 active:bg-surface-tertiary ${
        first ? "" : "border-t border-border"
      }`}
    >
      <View
        className="h-9 w-9 items-center justify-center rounded-xl"
        style={{ backgroundColor: from ? `${ACCOUNT_TYPES[from.type].colour}1A` : palette.border }}
      >
        <Ionicons
          name={icon as never}
          size={16}
          color={from ? ACCOUNT_TYPES[from.type].colour : palette.muted}
        />
      </View>
      <View className="flex-1">
        <Typography.Paragraph className="font-ui-medium text-[14px]" numberOfLines={1}>
          {txn.note?.trim() || title}
        </Typography.Paragraph>
        <Typography.Paragraph className="font-ui text-muted text-[11.5px]" numberOfLines={1}>
          {/* A transfer already says both ends on the line above, so repeating
              the route here would print it twice. */}
          {relativeDate(txn.at)}
          {txn.kind === "transfer" ? "" : ` · ${from?.name ?? "Unknown"}`}
        </Typography.Paragraph>
      </View>
      {/* A transfer carries no sign: nothing was gained or lost, so either one
          would be a lie about the total. */}
      <Text style={{ fontFamily: "Archivo_600SemiBold", fontSize: 14.5, color: tint }}>
        {txn.kind === "transfer"
          ? peso(txn.amount)
          : peso(txn.kind === "income" ? txn.amount : -txn.amount, { sign: true })}
      </Text>
    </Pressable>
  );
}

/**
 * Correct one transaction that already exists.
 *
 * There is no longer a way to write one by hand — Ask does that from a sentence
 * — but a wrong amount or the wrong wallet still has to be fixable, and no chat
 * can edit a row that is already filed.
 *
 * Transfer swaps the category row for a second account picker, because a
 * transfer has no category: it is not spending, and offering one would invite
 * filing money you still have under Food.
 */
export function TxnEditor({
  draft,
  accounts,
  used,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Txn;
  accounts: readonly Account[];
  /** Everything already filed, so an invented category can be picked again. */
  used: readonly { category?: Category }[];
  onChange: (next: Txn) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}): JSX.Element {
  const palette = usePalette();
  const [picking, setPicking] = useState(false);

  // Seeded once, never synced back — see the note in WalletEditor.
  const [amount, setAmount] = useState(() =>
    draft.amount === 0 ? "" : String(draft.amount / 100)
  );

  const parsed = parseAmount(amount);
  const valid =
    parsed !== null &&
    parsed > 0 &&
    (draft.kind !== "transfer" || (!!draft.toAccountId && draft.toAccountId !== draft.accountId));

  if (picking) {
    return (
      <CategoryPicker
        value={draft.category}
        used={used}
        onPick={(category) => {
          onChange({ ...draft, category });
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    );
  }

  return (
    <Drawer onClose={onClose}>
      <SheetHead title="Edit transaction" onClose={onClose} />
      <ScrollView
        contentContainerClassName="px-5 pt-4 pb-2 gap-4"
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row gap-2">
          {KINDS.map(({ kind, label }) => (
            <Chip
              key={kind}
              label={label}
              on={draft.kind === kind}
              onPress={() =>
                onChange({
                  ...draft,
                  kind,
                  // Each kind carries a different third field, so the other two
                  // are cleared rather than left to be written to the row.
                  category: kind === "expense" ? (draft.category ?? "food") : undefined,
                  source: kind === "income" ? (draft.source ?? "salary") : undefined,
                  toAccountId: kind === "transfer" ? draft.toAccountId : undefined,
                })
              }
            />
          ))}
        </View>

        <TextInput
          value={amount}
          onChangeText={(text) => {
            setAmount(text);
            onChange({ ...draft, amount: parseAmount(text) ?? 0 });
          }}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={palette.muted}
          className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui-bold text-[26px] text-foreground"
        />

        <Field label={draft.kind === "transfer" ? "From" : "Account"}>
          <View className="flex-row flex-wrap gap-2">
            {accounts.map((account) => (
              <Chip
                key={account.id}
                label={account.name}
                tint={ACCOUNT_TYPES[account.type].colour}
                on={draft.accountId === account.id}
                onPress={() => onChange({ ...draft, accountId: account.id })}
              />
            ))}
          </View>
        </Field>

        {draft.kind === "transfer" ? (
          <Field label="To">
            <View className="flex-row flex-wrap gap-2">
              {accounts
                .filter((account) => account.id !== draft.accountId)
                .map((account) => (
                  <Chip
                    key={account.id}
                    label={account.name}
                    tint={ACCOUNT_TYPES[account.type].colour}
                    on={draft.toAccountId === account.id}
                    onPress={() => onChange({ ...draft, toAccountId: account.id })}
                  />
                ))}
            </View>
          </Field>
        ) : draft.kind === "income" ? (
          <Field label="Source">
            <View className="flex-row flex-wrap gap-2">
              {SOURCE_KEYS.map((source) => (
                <Chip
                  key={source}
                  label={INCOME_SOURCES[source].label}
                  on={draft.source === source}
                  onPress={() => onChange({ ...draft, source })}
                />
              ))}
            </View>
          </Field>
        ) : (
          <Field label="Category">
            <PickerField
              icon={categoryOf(draft.category).icon}
              label={categoryOf(draft.category).label}
              onPress={() => setPicking(true)}
            />
          </Field>
        )}

        <Field label="Note (optional)">
          <TextInput
            value={draft.note ?? ""}
            onChangeText={(note) => onChange({ ...draft, note })}
            placeholder="Starbucks"
            placeholderTextColor={palette.muted}
            className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui text-[15px] text-foreground"
          />
        </Field>

        <View className="flex-row gap-2 pt-1">
          <Pressable
            accessibilityRole="button"
            onPress={onDelete}
            className="min-h-[48px] justify-center rounded-full border border-border px-4 active:opacity-70"
          >
            <Text
              style={{ fontFamily: "Archivo_600SemiBold", fontSize: 14, color: palette.danger }}
            >
              Delete
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!valid}
            onPress={onSave}
            className="min-h-[48px] flex-1 items-center justify-center rounded-full active:opacity-80"
            style={{ backgroundColor: palette.accent, opacity: valid ? 1 : 0.4 }}
          >
            <Text
              style={{
                fontFamily: "Archivo_600SemiBold",
                fontSize: 14,
                color: palette.accentForeground,
              }}
            >
              Save
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Drawer>
  );
}

/* ---------------------------------------------------------------- actions --- */

export type Action = {
  key: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  hint: string;
  tint: string;
  onPress: () => void;
};

/**
 * What the + can do, as a sheet rather than four more things on the screen.
 *
 * The tiles on the dashboard are doors — they say where you would end up. This
 * says what you can *do*, which is a different question and deserves its own
 * affordance rather than a fifth tile nobody reads.
 */
export function ActionSheet({
  actions,
  onClose,
}: {
  actions: readonly Action[];
  onClose: () => void;
}): JSX.Element {
  const palette = usePalette();

  return (
    <Drawer onClose={onClose}>
      <SheetHead title="Add" onClose={onClose} />
      <View className="gap-0.5 px-3 pt-2">
        {actions.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => {
              onClose();
              action.onPress();
            }}
            className="min-h-[62px] flex-row items-center gap-3 rounded-2xl px-3 active:bg-surface-tertiary"
          >
            <View
              className="h-10 w-10 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${action.tint}22` }}
            >
              <Ionicons name={action.icon} size={18} color={action.tint} />
            </View>
            <View className="flex-1">
              <Typography.Paragraph className="font-ui-medium text-[14.5px]">
                {action.label}
              </Typography.Paragraph>
              <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
                {action.hint}
              </Typography.Paragraph>
            </View>
            <Ionicons name="chevron-forward" size={15} color={palette.muted} />
          </Pressable>
        ))}
      </View>
    </Drawer>
  );
}

/* -------------------------------------------------------------- pickers --- */

/**
 * A field that opens a list, drawn to match the wallet kind picker.
 *
 * The chip rows these replace worked for three options and stopped working at
 * eleven: past the fourth chip the rest live off the edge of a horizontal
 * scroller and get found by accident. A field that says what is chosen, and a
 * list when you want to change it, costs one tap and no hunting.
 */
export function PickerField({
  icon,
  tint,
  label,
  onPress,
}: {
  icon?: string;
  tint?: string;
  label: string;
  onPress: () => void;
}): JSX.Element {
  const palette = usePalette();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Change it.`}
      onPress={onPress}
      className="min-h-[50px] flex-row items-center gap-2.5 rounded-xl border border-border bg-background px-3 active:bg-surface-tertiary"
    >
      {icon !== undefined && (
        <View
          className="h-7 w-7 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${tint ?? palette.accent}1F` }}
        >
          <Ionicons name={icon as never} size={15} color={tint ?? palette.accent} />
        </View>
      )}
      <Typography.Paragraph className="flex-1 font-ui-medium text-[15px]">
        {label}
      </Typography.Paragraph>
      <Ionicons name="chevron-down" size={16} color={palette.muted} />
    </Pressable>
  );
}

/** One row in a picker list. */
function PickRow({
  icon,
  label,
  on,
  onPress,
}: {
  icon: string;
  label: string;
  on: boolean;
  onPress: () => void;
}): JSX.Element {
  const palette = usePalette();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      className="min-h-[48px] flex-row items-center gap-3 rounded-xl px-3 active:bg-surface-tertiary"
    >
      <View
        className="h-7 w-7 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${palette.accent}1F` }}
      >
        <Ionicons name={icon as never} size={15} color={palette.accent} />
      </View>
      <Typography.Paragraph className="flex-1 font-ui-medium text-[14.5px]">
        {label}
      </Typography.Paragraph>
      {on && <Ionicons name="checkmark" size={18} color={palette.accent} />}
    </Pressable>
  );
}

/**
 * Pick a category, or write one.
 *
 * The eleven shipped categories cover most spending, and nobody's spending is
 * most spending — so anything typed here becomes a category too, and is
 * offered back afterwards alongside the built-in ones. See `categoryOf`, which
 * is what lets an invented key still draw a label and an icon.
 */
export function CategoryPicker({
  value,
  used,
  onPick,
  onClose,
}: {
  value?: Category;
  /** Anything already filed, so a category invented once can be reused. */
  used: readonly { category?: Category }[];
  onPick: (category: Category) => void;
  onClose: () => void;
}): JSX.Element {
  const palette = usePalette();
  const [own, setOwn] = useState("");
  const { known, own: mine } = categoriesInUse(used);
  const typed = own.trim();

  return (
    <Drawer onClose={onClose}>
      <SheetHead title="What for" onClose={onClose} />
      <ScrollView contentContainerClassName="px-3 pt-2 pb-2 gap-2" keyboardShouldPersistTaps="handled">
        <View className="flex-row items-center gap-2 px-1">
          <TextInput
            value={own}
            onChangeText={setOwn}
            placeholder="Or write your own…"
            placeholderTextColor={palette.muted}
            className="min-h-[46px] flex-1 rounded-xl border border-border bg-background px-3.5 font-ui text-[15px] text-foreground"
            onSubmitEditing={() => typed !== "" && onPick(typed.toLowerCase())}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use this category"
            disabled={typed === ""}
            onPress={() => onPick(typed.toLowerCase())}
            className="h-[46px] w-[46px] items-center justify-center rounded-full"
            style={{ backgroundColor: palette.accent, opacity: typed === "" ? 0.35 : 1 }}
          >
            <Ionicons name="arrow-forward" size={18} color={palette.accentForeground} />
          </Pressable>
        </View>

        {mine.length > 0 && (
          <View className="gap-0.5">
            <Typography.Paragraph className="px-3 font-ui-medium text-muted text-[11.5px]">
              Yours
            </Typography.Paragraph>
            {mine.map((category) => (
              <PickRow
                key={category}
                icon={categoryOf(category).icon}
                label={categoryOf(category).label}
                on={value === category}
                onPress={() => onPick(category)}
              />
            ))}
          </View>
        )}

        <View className="gap-0.5">
          <Typography.Paragraph className="px-3 font-ui-medium text-muted text-[11.5px]">
            Built in
          </Typography.Paragraph>
          {known.map((category) => (
            <PickRow
              key={category}
              icon={categoryOf(category).icon}
              label={categoryOf(category).label}
              on={value === category}
              onPress={() => onPick(category)}
            />
          ))}
        </View>
      </ScrollView>
    </Drawer>
  );
}
