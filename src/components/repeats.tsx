import { Ionicons } from "@expo/vector-icons";
import { Typography } from "heroui-native";
import { useState, type JSX } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import {
  ACCOUNT_TYPES,
  categoryOf,
  parseAmount,
  peso,
  type Account,
  type Category,
  type Every,
  type Recurring,
} from "../lib/budget";
import { usePalette } from "../lib/theme";
import { CategoryPicker, Chip, Drawer, Field, PickerField, SheetHead } from "./money";

const EVERY: { key: Every; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
];

/**
 * Add or correct one repeating bill.
 *
 * Built on the same Drawer and Field as the wallet editor, and its category is
 * the same dropdown — eleven categories as a row of chips meant the ones past
 * the fourth lived off the edge of a scroller and got found by accident.
 */
export function RepeatEditor({
  draft,
  accounts,
  used,
  isNew,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Recurring;
  accounts: readonly Account[];
  /** Everything already filed, so an invented category can be picked again. */
  used: readonly { category?: Category }[];
  isNew: boolean;
  onChange: (next: Recurring) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}): JSX.Element {
  const palette = usePalette();
  const [picking, setPicking] = useState(false);
  // Seeded once, never synced back: an effect mirroring `draft` would re-run on
  // every keystroke and rewrite what is being typed.
  const [amount, setAmount] = useState(() =>
    draft.amount === 0 ? "" : String(draft.amount / 100)
  );

  const valid = draft.label.trim() !== "" && (parseAmount(amount) ?? 0) > 0;

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
      <SheetHead title={isNew ? "New repeat" : "Edit repeat"} onClose={onClose} />
      <ScrollView
        contentContainerClassName="px-5 pt-4 pb-2 gap-4"
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row gap-2">
          {(["expense", "income"] as const).map((kind) => (
            <Chip
              key={kind}
              label={kind === "expense" ? "Goes out" : "Comes in"}
              on={draft.kind === kind}
              onPress={() =>
                onChange({
                  ...draft,
                  kind,
                  // Income carries no category, and leaving one behind would
                  // file a salary under Subscriptions.
                  category: kind === "expense" ? (draft.category ?? "subscriptions") : undefined,
                })
              }
            />
          ))}
        </View>

        <Field label="What is it">
          <TextInput
            value={draft.label}
            onChangeText={(label) => onChange({ ...draft, label })}
            placeholder="Rent, Netflix, salary…"
            placeholderTextColor={palette.muted}
            className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui text-[15px] text-foreground"
          />
        </Field>

        <Field label="How much">
          <TextInput
            value={amount}
            onChangeText={(text) => {
              setAmount(text);
              onChange({ ...draft, amount: parseAmount(text) ?? 0 });
            }}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={palette.muted}
            className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui-bold text-[20px] text-foreground"
          />
        </Field>

        <Field label="How often">
          <View className="flex-row flex-wrap gap-2">
            {EVERY.map((option) => (
              <Chip
                key={option.key}
                label={option.label}
                on={draft.every === option.key}
                onPress={() => onChange({ ...draft, every: option.key })}
              />
            ))}
          </View>
        </Field>

        <Field label="Which wallet">
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

        {draft.kind === "expense" && (
          <Field label="What for">
            <PickerField
              icon={categoryOf(draft.category).icon}
              label={categoryOf(draft.category).label}
              onPress={() => setPicking(true)}
            />
          </Field>
        )}

        <View className="flex-row gap-2 pt-1">
          {/* Only for one that exists. Offering Delete on something never saved
              is offering to undo nothing. */}
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
              {isNew ? "Add repeat" : "Save"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Drawer>
  );
}

/**
 * Everything that repeats, as a sheet rather than a page.
 *
 * It used to be its own screen behind a tile. That is a lot of navigation for
 * a list most people touch twice a year — once to add rent, once when Netflix
 * goes up — so the dashboard carries the total and this opens for the detail.
 *
 * Nothing here writes a transaction. These rules say what a month costs; the
 * ledger says what actually left a wallet, and the two are kept apart on
 * purpose.
 */
export function RepeatsSheet({
  rules,
  accounts,
  onEdit,
  onAdd,
  onClose,
}: {
  rules: readonly Recurring[];
  accounts: readonly Account[];
  onEdit: (rule: Recurring) => void;
  onAdd: () => void;
  onClose: () => void;
}): JSX.Element {
  const palette = usePalette();

  return (
    <Drawer onClose={onClose}>
      <SheetHead title="What repeats" onClose={onClose} />
      <ScrollView contentContainerClassName="px-3 pt-2 pb-2 gap-2">
        {/* Said once, here, because the sheet used to have a button that wrote
            these into the ledger and someone who remembers it deserves to know
            it is gone rather than broken. */}
        {rules.length > 0 && (
          <Typography.Paragraph className="px-3 pb-1 font-ui text-muted text-[11.5px] leading-[17px]">
            A forecast, not a ledger — none of these move money on their own. Log a bill when you
            actually pay it.
          </Typography.Paragraph>
        )}

        {rules.length === 0 ? (
          <Typography.Paragraph className="px-3 py-4 text-center font-read text-muted text-[14px] leading-[22px]">
            Nothing yet. Rent, Netflix, your salary: anything landing on the same day each month.
            They shape the monthly forecast; they never move money on their own.
          </Typography.Paragraph>
        ) : (
          rules.map((rule) => {
            const account = accounts.find((item) => item.id === rule.accountId);
            const brand = account ? ACCOUNT_TYPES[account.type].colour : palette.muted;
            return (
              <Pressable
                key={rule.id}
                accessibilityRole="button"
                accessibilityLabel={`${rule.label}, ${peso(rule.amount)} ${rule.every}`}
                onPress={() => onEdit(rule)}
                className="min-h-[58px] flex-row items-center gap-3 rounded-xl px-3 active:bg-surface-tertiary"
              >
                <View
                  className="h-9 w-9 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${brand}1A` }}
                >
                  <Ionicons
                    name={
                      rule.kind === "income"
                        ? "arrow-down"
                        : (categoryOf(rule.category).icon as never)
                    }
                    size={16}
                    color={brand}
                  />
                </View>
                <View className="flex-1">
                  <Typography.Paragraph className="font-ui-medium text-[14px]" numberOfLines={1}>
                    {rule.label}
                  </Typography.Paragraph>
                  <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
                    {EVERY.find((option) => option.key === rule.every)?.label} ·{" "}
                    {account?.name ?? "Unknown"}
                  </Typography.Paragraph>
                </View>
                <Text
                  style={{
                    fontFamily: "Archivo_600SemiBold",
                    fontSize: 14.5,
                    color: rule.kind === "income" ? palette.onDevice : palette.foreground,
                  }}
                >
                  {peso(rule.kind === "income" ? rule.amount : -rule.amount, { sign: true })}
                </Text>
              </Pressable>
            );
          })
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a repeat"
          onPress={onAdd}
          disabled={accounts.length === 0}
          className="mx-1 min-h-[48px] flex-row items-center justify-center gap-2 rounded-full border border-border border-dashed active:bg-surface-tertiary"
          style={{ opacity: accounts.length === 0 ? 0.45 : 1 }}
        >
          <Ionicons name="add" size={18} color={palette.muted} />
          <Text style={{ fontFamily: "Archivo_500Medium", fontSize: 13, color: palette.muted }}>
            {accounts.length === 0 ? "Add a wallet first" : "Add a repeat"}
          </Text>
        </Pressable>
      </ScrollView>
    </Drawer>
  );
}
