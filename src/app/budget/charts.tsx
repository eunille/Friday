import { useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import Svg, { Circle, G, Line, Path, Rect } from "react-native-svg";

import { PageHeader, SectionTitle } from "../../components/screen";
import { DataGate, useAI } from "../../lib/ai";
import {
  CATEGORIES,
  byCategory,
  effectOn,
  monthKey,
  monthsEnding,
  netWorth,
  peso,
  pesoShort,
  totalsFor,
  type Account,
  type Txn,
} from "../../lib/budget";
import { listAccounts, listTxns } from "../../lib/ledger";
import { usePalette } from "../../lib/theme";

/**
 * Charts are drawn in viewBox units and scaled by the SVG, so nothing has to
 * measure the screen first. A measured chart renders once at zero width and
 * then jumps; this one is right on its first frame at any width.
 */
const W = 300;
const MONTHS = 6;

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function label(month: string): string {
  return SHORT[Number(month.slice(5)) - 1] ?? month;
}

function Card({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <View className="gap-2.5 rounded-2xl border border-border bg-surface p-3.5">
      <View className="gap-0.5">
        <SectionTitle>{title}</SectionTitle>
        {note ? (
          <Typography.Paragraph className="font-ui text-muted text-[11.5px]">
            {note}
          </Typography.Paragraph>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** In against out, per month. Two bars, because the gap between them is the point. */
function InOut({ txns, month }: { txns: readonly Txn[]; month: string }): JSX.Element {
  const palette = usePalette();
  const H = 120;
  const rows = monthsEnding(month, MONTHS).map((key) => ({ key, ...totalsFor(txns, key) }));
  // Floored at 1 so an empty run divides by something rather than producing NaN
  // heights that silently render nothing.
  const peak = Math.max(1, ...rows.map((row) => Math.max(row.income, row.expense)));

  const slot = W / rows.length;
  const width = Math.min(13, slot / 3.2);

  return (
    <View className="gap-1.5">
      <Svg width="100%" height={H + 4} viewBox={`0 0 ${W} ${H + 4}`}>
        <Line x1={0} y1={H} x2={W} y2={H} stroke={palette.border} strokeWidth={1} />
        {rows.map((row, index) => {
          const centre = slot * index + slot / 2;
          const inHeight = (row.income / peak) * (H - 6);
          const outHeight = (row.expense / peak) * (H - 6);
          return (
            <G key={row.key}>
              <Rect
                x={centre - width - 1.5}
                y={H - inHeight}
                width={width}
                height={inHeight}
                rx={2.5}
                fill={palette.onDevice}
              />
              <Rect
                x={centre + 1.5}
                y={H - outHeight}
                width={width}
                height={outHeight}
                rx={2.5}
                fill={palette.foreground}
              />
            </G>
          );
        })}
      </Svg>
      <View className="flex-row justify-around">
        {rows.map((row) => (
          <Typography.Paragraph key={row.key} className="font-ui text-muted text-[10px]">
            {label(row.key)}
          </Typography.Paragraph>
        ))}
      </View>
      <View className="flex-row gap-4 pt-0.5">
        {[
          { text: "In", colour: palette.onDevice },
          { text: "Out", colour: palette.foreground },
        ].map((key) => (
          <View key={key.text} className="flex-row items-center gap-1.5">
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: key.colour }} />
            <Typography.Paragraph className="font-ui text-muted text-[11px]">
              {key.text}
            </Typography.Paragraph>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Where it went, as a ring.
 *
 * Each segment is one circle with a dash pattern rather than an arc path: the
 * maths is a multiplication instead of trigonometry, and there is no seam where
 * two arcs would meet.
 *
 * Deliberately monochrome. The wallet cards own the saturated colour in this
 * app, and a pie of eleven hues beside them would be exactly the paint chart
 * the palette exists to avoid. Darkest slice is the biggest, which is the
 * ranking the reader wanted anyway.
 */
function Ring({ txns, month }: { txns: readonly Txn[]; month: string }): JSX.Element {
  const palette = usePalette();
  const rows = byCategory(txns, month);
  const total = rows.reduce((sum, row) => sum + row.total, 0);

  if (total === 0) {
    return (
      <Typography.Paragraph className="py-6 text-center font-read text-muted text-[13.5px]">
        Nothing spent this month yet.
      </Typography.Paragraph>
    );
  }

  // Top five plus a gathered remainder: past six, slices get thinner than their
  // own stroke and the legend runs longer than the chart.
  const top = rows.slice(0, 5);
  const rest = rows.slice(5).reduce((sum, row) => sum + row.total, 0);
  const slices = rest > 0 ? [...top, { category: "other" as const, total: rest }] : top;

  const R = 46;
  const C = 2 * Math.PI * R;

  // Each segment's start is the sum of the ones before it. Computed per slice
  // rather than carried in a running variable, because a counter mutated inside
  // the render closure is exactly what breaks under the React Compiler — and
  // with at most six slices the repeated sum costs nothing worth saving.
  const segments = slices.map((slice, index) => ({
    category: slice.category,
    dash: (slice.total / total) * C,
    offset: (slices.slice(0, index).reduce((sum, row) => sum + row.total, 0) / total) * C,
  }));

  return (
    <View className="flex-row items-center gap-4">
      <Svg width={124} height={124} viewBox="0 0 124 124">
        <G rotation={-90} origin="62, 62">
          {segments.map((segment, index) => (
            <Circle
              key={segment.category}
              cx={62}
              cy={62}
              r={R}
              fill="none"
              stroke={palette.foreground}
              strokeOpacity={1 - index * 0.16}
              strokeWidth={17}
              strokeDasharray={`${segment.dash} ${C - segment.dash}`}
              strokeDashoffset={-segment.offset}
            />
          ))}
        </G>
      </Svg>
      <View className="flex-1 gap-1">
        {slices.map((slice, index) => (
          <View key={slice.category} className="flex-row items-center gap-2">
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                backgroundColor: palette.foreground,
                opacity: 1 - index * 0.16,
              }}
            />
            <Typography.Paragraph className="flex-1 font-ui text-[11.5px]" numberOfLines={1}>
              {CATEGORIES[slice.category].label}
            </Typography.Paragraph>
            <Typography.Paragraph className="font-ui-medium text-muted text-[11px]">
              {Math.round((slice.total / total) * 100)}%
            </Typography.Paragraph>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * What the total was at the end of each month.
 *
 * Worked *backwards* from today's balance by undoing each month's movements,
 * not forwards from zero. Opening balances are only true as of now, so a
 * forward walk would start the line in the wrong place and drift further from
 * the truth with every month it drew.
 */
function Trend({
  accounts,
  txns,
  month,
}: {
  accounts: readonly Account[];
  txns: readonly Txn[];
  month: string;
}): JSX.Element {
  const palette = usePalette();
  const H = 90;
  const months = monthsEnding(month, MONTHS);

  const today = netWorth(accounts, txns);
  const ends: number[] = [];
  let running = today;
  for (let index = months.length - 1; index >= 0; index -= 1) {
    ends[index] = running;
    const moved = txns
      .filter((txn) => monthKey(txn.at) === months[index])
      .reduce(
        (sum, txn) => sum + accounts.reduce((part, account) => part + effectOn(txn, account.id), 0),
        0
      );
    running -= moved;
  }

  const low = Math.min(...ends);
  const high = Math.max(...ends);
  // A flat line has zero span; without the floor every point would divide by
  // zero and the path would collapse to NaN.
  const span = Math.max(1, high - low);
  const x = (index: number): number => (index / Math.max(1, months.length - 1)) * W;
  const y = (value: number): number => H - 6 - ((value - low) / span) * (H - 14);

  const path = ends
    .map((value, index) => `${index === 0 ? "M" : "L"}${x(index)} ${y(value)}`)
    .join(" ");

  return (
    <View className="gap-1.5">
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Path d={`${path} L${W} ${H} L0 ${H} Z`} fill={palette.foreground} fillOpacity={0.07} />
        <Path d={path} fill="none" stroke={palette.foreground} strokeWidth={2} />
        <Circle
          cx={x(ends.length - 1)}
          cy={y(ends[ends.length - 1])}
          r={3.5}
          fill={palette.foreground}
        />
      </Svg>
      <View className="flex-row justify-between">
        <Typography.Paragraph className="font-ui text-muted text-[10px]">
          {label(months[0])} · {pesoShort(ends[0])}
        </Typography.Paragraph>
        <Typography.Paragraph className="font-ui-medium text-[10px]">
          now · {pesoShort(today)}
        </Typography.Paragraph>
      </View>
    </View>
  );
}

function Charts(): JSX.Element {
  const { db } = useAI();
  const router = useRouter();
  const palette = usePalette();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);

  const refresh = useCallback(() => {
    if (!db) return;
    void listAccounts(db).then(setAccounts);
    void listTxns(db).then(setTxns);
  }, [db]);

  useEffect(refresh, [refresh]);

  const month = monthKey(new Date().toISOString());
  const live = useMemo(() => accounts.filter((account) => !account.archived), [accounts]);
  const totals = useMemo(() => totalsFor(txns, month), [txns, month]);

  return (
    <View className="flex-1 bg-background">
      <PageHeader title="Charts" onBack={() => router.back()} />

      <ScrollView contentContainerClassName="px-4 pt-4 pb-10 gap-4">
        {txns.length === 0 ? (
          <Typography.Paragraph className="pt-6 text-center font-read text-muted text-[15px] leading-6">
            Nothing to draw yet. Log a few transactions and the shape of your month turns up here.
          </Typography.Paragraph>
        ) : (
          <>
            <View className="flex-row gap-2.5">
              {[
                { label: "In this month", value: totals.income, tint: palette.onDevice },
                { label: "Out this month", value: totals.expense, tint: palette.foreground },
                {
                  label: "Kept",
                  value: totals.net,
                  tint: totals.net < 0 ? palette.danger : palette.onDevice,
                },
              ].map((tile) => (
                <View
                  key={tile.label}
                  className="flex-1 gap-0.5 rounded-2xl border border-border bg-surface p-3"
                >
                  <Typography.Paragraph className="font-ui text-muted text-[10px]">
                    {tile.label}
                  </Typography.Paragraph>
                  <Text
                    style={{ fontFamily: "Archivo_600SemiBold", fontSize: 14, color: tile.tint }}
                    numberOfLines={1}
                  >
                    {pesoShort(tile.value)}
                  </Text>
                </View>
              ))}
            </View>

            <Card title="In and out" note={`Last ${MONTHS} months`}>
              <InOut txns={txns} month={month} />
            </Card>

            <Card title="Where it went" note={`${peso(totals.expense)} this month`}>
              <Ring txns={txns} month={month} />
            </Card>

            <Card title="Total over time" note="Every wallet added up, month by month">
              <Trend accounts={live} txns={txns} month={month} />
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}

export default function ChartsScreen(): JSX.Element {
  return (
    <DataGate>
      <Charts />
    </DataGate>
  );
}
