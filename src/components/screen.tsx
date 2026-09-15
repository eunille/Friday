import { Typography } from "heroui-native";
import type { JSX, ReactNode } from "react";
import { View } from "react-native";

import { TIERS, useAI } from "../lib/ai";

/**
 * Title block shared by Notes, Search and Library.
 *
 * The chip on the right names the model that is actually loaded. It is the
 * only place in the app that says so persistently, which is the whole claim
 * worth making: this answer came from something sitting on the phone.
 */
export function ScreenHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}): JSX.Element {
  const { tier } = useAI();

  return (
    <View className="gap-2 pb-1">
      <View className="flex-row items-center justify-between gap-3">
        <Typography.Heading type="h1" className="font-ui-bold text-[30px] tracking-tight">
          {title}
        </Typography.Heading>
        {tier && (
          <View className="rounded-full border border-border px-2.5 py-1">
            <Typography.Paragraph className="font-ui text-muted text-[11px]">
              {TIERS[tier].name}
            </Typography.Paragraph>
          </View>
        )}
      </View>
      {children && (
        <Typography.Paragraph className="font-read text-muted text-[15px] leading-6">
          {children}
        </Typography.Paragraph>
      )}
    </View>
  );
}
