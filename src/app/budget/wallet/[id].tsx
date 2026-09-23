import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useMemo, useState, type JSX } from "react";
import { ScrollView, Text, View } from "react-native";

import { useConfirm } from "../../../components/dialog";
import {
  BrandMark,
  BrandSurface,
  TxnEditor,
  TxnRow,
  WalletEditor,
} from "../../../components/money";
import { IconButton, PageHeader } from "../../../components/screen";
import { DataGate, useAI } from "../../../lib/ai";
import {
  ACCOUNT_TYPES,
  accountFlow,
  balanceOf,
  monthKey,
  peso,
  type Account,
  type Txn,
} from "../../../lib/budget";
import {
  countTxns,
  deleteAccount,
  deleteTxn,
  listAccounts,
  listTxns,
  saveAccount,
  saveTxn,
} from "../../../lib/ledger";

/** One figure under the balance. Fixed white: it is drawn on the brand colour. */
function Flow({ icon, label, value }: { icon: string; label: string; value: number }): JSX.Element {
  return (
    <View className="flex-row items-center gap-1.5">
      <Ionicons name={icon as never} size={13} color="#fff" style={{ opacity: 0.75 }} />
      <Text style={{ color: "#fff", fontFamily: "Archivo_600SemiBold", fontSize: 14 }}>
        {peso(value)}
      </Text>
      <Text style={{ color: "#fff", opacity: 0.7, fontFamily: "Archivo_400Regular", fontSize: 12 }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Everything that happened to one wallet.
 *
 * The dashboard answers "how am I doing"; this answers "what went through
 * GCash", which is the question you ask when the app and the bank's own screen
 * disagree. So it is built to be reconciled against: the balance at the top,
 * then every row that moved it, transfers included.
 */
function Wallet(): JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db } = useAI();
  const router = useRouter();
  const confirm = useConfirm();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [draft, setDraft] = useState<Txn | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);

  const refresh = useCallback(() => {
    if (!db) return;
    void listAccounts(db).then(setAccounts);
    void listTxns(db).then(setTxns);
  }, [db]);

  useFocusEffect(refresh);

  const account = accounts.find((row) => row.id === id);

  // Selected by id rather than by a non-zero effect: a row that names this
  // wallet belongs in its statement whatever the arithmetic comes to.
  const mine = useMemo(
    () => txns.filter((txn) => txn.accountId === id || txn.toAccountId === id),
    [txns, id]
  );

  const month = monthKey(new Date().toISOString());
  const flow = useMemo(() => accountFlow(id, txns, month), [id, txns, month]);

  const saveWallet = useCallback(() => {
    if (!db || !editing) return;
    void saveAccount(db, editing).then(() => {
      setEditing(null);
      refresh();
    });
  }, [db, editing, refresh]);

  const dropWallet = useCallback(() => {
    if (!db || !editing) return;
    const target = editing;
    void countTxns(db, target.id).then((count) => {
      // The sheet closes first: two stacked modals on Android leave the
      // backdrop behind when the inner one goes.
      setEditing(null);
      confirm.ask({
        title: `Delete ${target.name}?`,
        message:
          count > 0
            ? `${count} transaction${count === 1 ? "" : "s"} recorded against it go too, or the totals would stop matching the list that is meant to explain them.`
            : "Nothing has been recorded against it yet.",
        action: "Delete",
        destructive: true,
        // Back to the dashboard afterwards: staying would leave this screen
        // looking at a wallet that no longer exists.
        onConfirm: () => void deleteAccount(db, target.id).then(() => router.back()),
      });
    });
  }, [db, editing, confirm, router]);

  const commit = useCallback(() => {
    if (!db || !draft) return;
    void saveTxn(db, draft).then(() => {
      setDraft(null);
      refresh();
    });
  }, [db, draft, refresh]);

  const remove = useCallback(() => {
    if (!db || !draft) return;
    const target = draft;
    setDraft(null);
    confirm.ask({
      title: "Delete this transaction?",
      message: `${peso(target.amount)} comes back out of every balance and total it is counted in.`,
      action: "Delete",
      destructive: true,
      onConfirm: () => void deleteTxn(db, target.id).then(refresh),
    });
  }, [db, draft, confirm, refresh]);

  // Deleted from somewhere else, or a stale link. Says so rather than drawing a
  // wallet-shaped hole full of zeroes. The length check keeps the first frame,
  // before the read lands, from flashing this.
  if (accounts.length > 0 && !account) {
    return (
      <View className="flex-1 bg-background">
        <PageHeader title="Wallet" onBack={() => router.back()} />
        <Typography.Paragraph className="px-6 pt-10 text-center font-read text-muted text-[15px] leading-6">
          This wallet is gone.
        </Typography.Paragraph>
      </View>
    );
  }

  if (!account) return <View className="flex-1 bg-background" />;

  const brand = ACCOUNT_TYPES[account.type];
  const balance = balanceOf(account, txns);

  return (
    <View className="flex-1 bg-background">
      <PageHeader
        title={account.name}
        onBack={() => router.back()}
        right={
          <IconButton
            name="create-outline"
            label="Edit wallet"
            bordered
            onPress={() => setEditing(account)}
          />
        }
      />

      <ScrollView contentContainerClassName="px-4 pt-4 pb-10 gap-4">
        {/* The wallet's own colour, full width. On the dashboard this brand is
            one card among several; here it is the subject, so it carries the
            page the way --money carries the dashboard. */}
        {/* Padding on the inner View, not the card — see BrandSurface. */}
        <View
          className="overflow-hidden rounded-[22px]"
          style={{
            backgroundColor: brand.colour,
            shadowColor: brand.colour,
            shadowOpacity: 0.4,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
          }}
        >
          <BrandSurface colour={brand.colour} radius={22} />
          <View className="gap-3 p-4">
          <View className="flex-row items-center gap-2.5">
            <BrandMark type={account.type} size={34} />
            <Text
              style={{
                color: "#fff",
                opacity: 0.85,
                fontFamily: "Archivo_500Medium",
                fontSize: 12.5,
              }}
            >
              {brand.label}
            </Text>
          </View>
          <View>
            <Text
              style={{
                color: "#fff",
                fontFamily: "Archivo_600SemiBold",
                fontSize: 34,
                letterSpacing: -0.5,
              }}
            >
              {peso(balance)}
            </Text>
          </View>
          <View className="flex-row flex-wrap gap-x-5 gap-y-1">
            <Flow icon="arrow-down" label="in this month" value={flow.inward} />
            <Flow icon="arrow-up" label="out this month" value={flow.outward} />
          </View>
          </View>
        </View>

        <View className="flex-row items-center justify-between">
          <Typography.Heading type="h3" className="font-ui-bold text-[14px]">
            Activity
          </Typography.Heading>
          {mine.length > 0 && (
            <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
              {`${mine.length} ${mine.length === 1 ? "entry" : "entries"}`}
            </Typography.Paragraph>
          )}
        </View>

        {mine.length === 0 ? (
          <Typography.Paragraph className="pt-2 text-center font-read text-muted text-[15px] leading-6">
            Nothing has gone through {account.name} yet. The balance above is what you started it
            with.
          </Typography.Paragraph>
        ) : (
          <View className="overflow-hidden rounded-2xl border border-border bg-surface">
            {mine.map((txn, index) => (
              <TxnRow
                key={txn.id}
                txn={txn}
                accounts={accounts}
                first={index === 0}
                onPress={() => setDraft(txn)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {draft && (
        <TxnEditor
          key={draft.id}
          draft={draft}
          used={txns}
          accounts={accounts.filter((row) => !row.archived)}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={commit}
          onDelete={remove}
        />
      )}
      {editing && (
        <WalletEditor
          key={editing.id}
          draft={editing}
          txns={txns}
          isNew={false}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={saveWallet}
          onDelete={dropWallet}
        />
      )}
      {confirm.dialog}
    </View>
  );
}

export default function WalletScreen(): JSX.Element {
  return (
    <DataGate>
      <Wallet />
    </DataGate>
  );
}
