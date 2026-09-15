import { useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useState, type JSX } from "react";
import { TextInput, View } from "react-native";

import { ChoiceRow, Group, PageHeader, PageScroll, SectionTitle } from "../components/screen";
import { LENGTHS, ModelGate, TONES, systemPrompt, useAI, type AISettings } from "../lib/ai";
import { usePalette } from "../lib/theme";

function Settings(): JSX.Element {
  const { settings, setSettings } = useAI();
  const router = useRouter();
  const palette = usePalette();

  // Typing shouldn't write to SQLite on every keystroke; the field commits when
  // it loses focus or the page closes.
  const [instructions, setInstructions] = useState(settings.instructions);

  const update = (patch: Partial<AISettings>): void =>
    setSettings({ ...settings, instructions, ...patch });

  return (
    <View className="flex-1 bg-background">
      <PageHeader
        title="AI behaviour"
        onBack={() => {
          if (instructions !== settings.instructions) setSettings({ ...settings, instructions });
          router.back();
        }}
      />

      <PageScroll>
        <SectionTitle>Answer length</SectionTitle>
        <Group>
          {(Object.keys(LENGTHS) as (keyof typeof LENGTHS)[]).map((key, index) => (
            <ChoiceRow
              key={key}
              first={index === 0}
              label={LENGTHS[key].label}
              note={LENGTHS[key].note}
              selected={settings.length === key}
              onPress={() => update({ length: key })}
            />
          ))}
        </Group>

        <SectionTitle>Tone</SectionTitle>
        <Group>
          {(Object.keys(TONES) as (keyof typeof TONES)[]).map((key, index) => (
            <ChoiceRow
              key={key}
              first={index === 0}
              label={TONES[key].label}
              note={TONES[key].note}
              selected={settings.tone === key}
              onPress={() => update({ tone: key })}
            />
          ))}
        </Group>

        <SectionTitle>Your own instructions</SectionTitle>
        <TextInput
          className="min-h-24 rounded-2xl border border-border bg-surface px-4 py-3 font-read text-[16px] leading-[24px] text-foreground"
          placeholder="For example: answer in British English, and never use bullet points."
          placeholderTextColor={palette.placeholder}
          value={instructions}
          onChangeText={setInstructions}
          onBlur={() => setSettings({ ...settings, instructions })}
          multiline
          textAlignVertical="top"
        />

        <View className="gap-2 rounded-2xl border border-border bg-surface p-4">
          <Typography.Paragraph className="font-ui-medium text-[13px]">
            What the model is told
          </Typography.Paragraph>
          {/* Shown in full rather than described. If an answer comes back wrong,
              this is the thing to read. */}
          <Typography.Paragraph className="font-read text-muted text-[14px] leading-[22px]">
            {systemPrompt({ ...settings, instructions })}
          </Typography.Paragraph>
        </View>

        <Typography.Paragraph className="font-read text-muted text-[14px] leading-[22px]">
          These apply to answers in Ask. Summaries and quizzes set their own rules on their own
          screens.
        </Typography.Paragraph>
      </PageScroll>
    </View>
  );
}

export default function SettingsScreen(): JSX.Element {
  return (
    <ModelGate>
      <Settings />
    </ModelGate>
  );
}
