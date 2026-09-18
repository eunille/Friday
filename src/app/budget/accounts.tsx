import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useConfirm } from "../../components/dialog";
import { IconButton, PageHeader } from "../../components/screen";
import { DataGate, newNoteId, useAI } from "../../lib/ai";
import {
  ACCOUNT_TYPES,
  balanceOf,
  netWorth,
  parseAmount,
  peso,
  pesoShort,
  type Account,
  type AccountType,
  type Txn,
} from "../../lib/budget";
import { countTxns, deleteAccount, listAccounts, listTxns, saveAccount } from "../../lib/ledger";
import { usePalette } from "../../lib/theme";

const TYPES = Object.keys(ACCOUNT_TYPES) as AccountType[];

/** Fixed order, so the list never reshuffles under a finger. */
const GROUPS = ["E-wallets", "Banks", "Cash", "Credit", "Other"] as const;

/**
 * One wallet.
 *
 * The card is the brand colour and everything on it is white, which is the
 * whole point — you find GCash by its blue, not by reading five labels. The
 * rest of the app stays monochrome so these are the only saturated things here.
 */
function AccountCard({
  account,
  balance,
  onPress,
}: {
  account: Account;
  balance: number;
  onPress: () => void;
}): JSX.Element {
  const brand = ACCOUNT_TYPES[account.type];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${account.name}, ${peso(balance)}`}
      onPress={onPress}
      className="min-h-[104px] flex-1 justify-between rounded-[18px] p-3.5 active:opacity-85"
      style={{ backgroundColor: brand.colour }}
    >
      <View className="flex-row items-center gap-2">
        <View className="h-6 w-6 items-center justify-center rounded-lg bg-white/25">
          <Text style={{ color: "#fff", fontFamily: "Archivo_600SemiBold", fontSize: 11 }}>
            {account.name.slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <Text
          numberOfLines={1}
          style={{ flex: 1, color: "#fff", fontFamily: "Archivo_600SemiBold", fontSize: 13.5 }}
        >
          {account.name}
        </Text>
      </View>
      <View>
        <Text
          style={{
            color: "rgba(255,255,255,0.75)",
            fontFamily: "Archivo_500Medium",
            fontSize: 9.5,
          }}
        >
          {brand.label.toUpperCase()}
        </Text>
        <Text style={{ color: "#fff", fontFamily: "Archivo_600SemiBold", fontSize: 17 }}>
          {peso(balance)}
        </Text>
      </View>
    </Pressable>
  );
}

/** Add and edit are the same three fields, so they are the same sheet. */
function Editor({
  draft,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Account;
  onChange: (next: Account) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}): JSX.Element {
  const palette = usePalette();

  // Seeded once, never synced back. The caller remounts this per account, so an
  // effect mirroring `draft` would re-run on every keystroke and rewrite what is
  // being typed — "250." would become "250" under the cursor.
  const [amount, setAmount] = useState(() =>
    draft.openingBalance === 0 ? "" : String(draft.openingBalance / 100)
  );
  const existing = draft.name.trim() !== "";

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
        <View className="gap-4 rounded-t-[26px] border border-border bg-surface p-5 pb-8">
          <View className="flex-row items-center justify-between">
            <Typography.Heading type="h2" className="font-ui-bold text-[19px]">
              {existing ? "Edit account" : "New account"}
            </Typography.Heading>
            <IconButton name="close" label="Close" tone="muted" onPress={onClose} />
          </View>

          <TextInput
            value={draft?.name ?? ""}
            onChangeText={(name) => draft && onChange({ ...draft, name })}
            placeholder="Account name"
            placeholderTextColor={palette.muted}
            className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui text-[15px] text-foreground"
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
            <View className="flex-row gap-2 px-1">
              {TYPES.map((type) => {
                const brand = ACCOUNT_TYPES[type];
                const on = draft?.type === type;
                return (
                  <Pressable
                    key={type}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() =>
                      draft &&
                      onChange({
                        ...draft,
                        type,
                        // An untouched name follows the type, so picking GCash
                        // fills in "GCash" and most accounts need no typing.
                        name: draft.name.trim() === "" ? brand.label : draft.name,
                      })
                    }
                    className="min-h-[36px] justify-center rounded-full border px-3.5"
                    style={{
                      backgroundColor: on ? brand.colour : "transparent",
                      borderColor: on ? brand.colour : palette.border,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "Archivo_600SemiBold",
                        fontSize: 12.5,
                        color: on ? "#fff" : palette.muted,
                      }}
                    >
                      {brand.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View className="gap-1.5">
            <TextInput
              value={amount}
              onChangeText={(text) => {
                setAmount(text);
                const centavos = parseAmount(text);
                if (draft) onChange({ ...draft, openingBalance: centavos ?? 0 });
              }}
              keyboardType="decimal-pad"
              placeholder="Starting balance"
              placeholderTextColor={palette.muted}
              className="rounded-xl border border-border bg-background px-3.5 py-3 font-ui text-[15px] text-foreground"
            />
            <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
              What is in it right now. Everything you log from here moves it.
            </Typography.Paragraph>
          </View>

          <View className="flex-row gap-2">
            {existing && (
              <Pressable
                accessibilityRole="button"
                onPress={onDelete}
                className="min-h-[46px] justify-center rounded-full border border-border px-4 active:opacity-70"
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
              disabled={!existing}
              onPress={onSave}
              className="min-h-[46px] flex-1 items-center justify-center rounded-full active:opacity-80"
              style={{ backgroundColor: palette.accent, opacity: existing ? 1 : 0.4 }}
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
        </View>
      </View>
    </Modal>
  );
}

function Accounts(): JSX.Element {
  const { db } = useAI();
  const router = useRouter();
  const palette = usePalette();
  const confirm = useConfirm();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [draft, setDraft] = useState<Account | null>(null);
  const [filter, setFilter] = useState<string>("All");

  const refresh = useCallback(() => {
    if (!db) return;
    void listAccounts(db).then(setAccounts);
    void listTxns(db).then(setTxns);
  }, [db]);

  useEffect(refresh, [refresh]);

  const live = useMemo(() => accounts.filter((account) => !account.archived), [accounts]);
  const total = useMemo(() => netWorth(live, txns), [live, txns]);

  const sections = useMemo(
    () =>
      GROUPS.map((group) => ({
        group,
        items: live.filter(
          (account) =>
            ACCOUNT_TYPES[account.type].group === group && (filter === "All" || filter === group)
        ),
      })).filter((section) => section.items.length > 0),
    [live, filter]
  );

  const commit = useCallback(() => {
    if (!db || !draft) return;
    void saveAccount(db, draft).then(() => {
      setDraft(null);
      refresh();
    });
  }, [db, draft, refresh]);

  const remove = useCallback(() => {
    if (!db || !draft) return;
    const target = draft;
    void countTxns(db, target.id).then((count) => {
      // The sheet closes first: two stacked modals on Android leaves the
      // backdrop behind when the inner one goes.
      setDraft(null);
      confirm.ask({
        title: `Delete ${target.name}?`,
        message:
          count > 0
            ? `${count} transaction${count === 1 ? "" : "s"} recorded against it go too, or the totals would stop matching the list that is meant to explain them.`
            : "Nothing has been recorded against it yet.",
        action: "Delete",
        destructive: true,
        onConfirm: () => void deleteAccount(db, target.id).then(refresh),
      });
    });
  }, [db, draft, confirm, refresh]);

  return (
    <View className="flex-1 bg-background">
      <PageHeader
        title="Accounts"
        onBack={() => router.back()}
        right={
          <IconButton
            name="add"
            label="Add account"
            bordered
            onPress={() =>
              setDraft({ id: newNoteId(), name: "", type: "gcash", openingBalance: 0 })
            }
          />
        }
      />

      <ScrollView contentContainerClassName="px-4 pt-4 pb-10 gap-4">
        <View className="gap-1 rounded-[22px] p-4" style={{ backgroundColor: palette.ink }}>
          <Text
            style={{
              color: palette.inkForeground,
              opacity: 0.6,
              fontFamily: "Archivo_600SemiBold",
              fontSize: 10.5,
              letterSpacing: 1,
            }}
          >
            NET WORTH
          </Text>
          <Text
            style={{
              color: palette.inkForeground,
              fontFamily: "Archivo_600SemiBold",
              fontSize: 30,
            }}
          >
            {peso(total)}
          </Text>
          <Text
            style={{
              color: palette.inkForeground,
              opacity: 0.55,
              fontFamily: "Archivo_400Regular",
              fontSize: 12,
            }}
          >
            {live.length === 0
              ? "Add a wallet to start"
              : `Across ${live.length} account${live.length === 1 ? "" : "s"}, cards counted as owed`}
          </Text>
        </View>

        {live.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
            <View className="flex-row gap-2 px-1">
              {["All", ...GROUPS].map((chip) => {
                const on = filter === chip;
                return (
                  <Pressable
                    key={chip}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => setFilter(chip)}
                    className="min-h-[34px] justify-center rounded-full border px-3.5"
                    style={{
                      backgroundColor: on ? palette.accent : "transparent",
                      borderColor: on ? palette.accent : palette.border,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "Archivo_600SemiBold",
                        fontSize: 12.5,
                        color: on ? palette.accentForeground : palette.muted,
                      }}
                    >
                      {chip}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        )}

        {live.length === 0 ? (
          <Typography.Paragraph className="pt-4 text-center font-read text-muted text-[15px] leading-6">
            No wallets yet. Add GCash, a bank, or the cash in your pocket — the balances here are
            worked out from what you log, never typed in twice.
          </Typography.Paragraph>
        ) : (
          sections.map((section) => {
            const subtotal = section.items.reduce(
              (sum, account) => sum + balanceOf(account, txns),
              0
            );
            return (
              <View key={section.group} className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Typography.Heading type="h3" className="font-ui-bold text-[14px]">
                    {section.group}
                  </Typography.Heading>
                  <Typography.Paragraph className="font-ui-medium text-muted text-[12.5px]">
                    {pesoShort(subtotal)}
                  </Typography.Paragraph>
                </View>
                {/* Two per row, and an odd one out keeps its half rather than
                    stretching across — a lone full-width card reads as a
                    different kind of thing entirely. */}
                <View className="flex-row flex-wrap gap-2.5">
                  {section.items.map((account) => (
                    <View key={account.id} style={{ width: "48%", flexGrow: 1, maxWidth: "48.5%" }}>
                      <AccountCard
                        account={account}
                        balance={balanceOf(account, txns)}
                        onPress={() => setDraft(account)}
                      />
                    </View>
                  ))}
                </View>
              </View>
            );
          })
        )}

        {live.length > 0 && (
          <View className="flex-row items-center gap-2 pt-1">
            <Ionicons name="lock-closed" size={13} color={palette.muted} />
            <Typography.Paragraph className="flex-1 font-ui text-muted text-[11.5px]">
              Stored on this phone only. Nothing here is uploaded.
            </Typography.Paragraph>
          </View>
        )}
      </ScrollView>

      {/* Keyed and conditional, so each account gets a fresh sheet whose fields
          start from that account rather than from the last one edited. */}
      {draft && (
        <Editor
          key={draft.id}
          draft={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={commit}
          onDelete={remove}
        />
      )}
      {confirm.dialog}
    </View>
  );
}

export default function AccountsScreen(): JSX.Element {
  return (
    <DataGate>
      <Accounts />
    </DataGate>
  );
}
