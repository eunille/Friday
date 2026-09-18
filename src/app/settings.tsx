import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useState, type JSX } from "react";
import { Pressable, TextInput, View } from "react-native";

import { useConfirm } from "../components/dialog";
import { askAlerts, cancelAlerts, syncAlerts } from "../lib/alerts";
import { listRecurring } from "../lib/ledger";
import { ChoiceRow, Group, PageHeader, PageScroll, SectionTitle } from "../components/screen";
import {
  APPEARANCES,
  LENGTHS,
  ModelGate,
  TONES,
  eraseContent,
  systemPrompt,
  useAI,
  type AISettings,
} from "../lib/ai";
import { usePalette } from "../lib/theme";

function Settings(): JSX.Element {
  const { settings, setSettings, appearance, setAppearance, alerts, setAlerts, db, invalidate } =
    useAI();
  const router = useRouter();
  const confirm = useConfirm();
  const palette = usePalette();
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Turning it on asks for permission first and only sticks if it is given —
   * a switch that flips on while the OS is refusing to deliver anything is a
   * switch that lies.
   */
  const toggleAlerts = useCallback(() => {
    void (async () => {
      if (alerts) {
        await cancelAlerts();
        setAlerts(false);
        setNotice("Off. Nothing is scheduled.");
        return;
      }

      if (!(await askAlerts())) {
        setNotice("Android is blocking notifications for this app. Turn them on in system settings.");
        return;
      }

      const rules = db ? await listRecurring(db) : [];
      const count = await syncAlerts(rules);
      setAlerts(true);
      setNotice(
        count === 0
          ? "On. Nothing to remind you about yet — add something in Repeats."
          : `On. ${count} reminder${count === 1 ? "" : "s"} scheduled.`
      );
    })();
  }, [alerts, setAlerts, db]);

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
        <SectionTitle>Appearance</SectionTitle>
        <Group>
          {(Object.keys(APPEARANCES) as (keyof typeof APPEARANCES)[]).map((key, index) => (
            <ChoiceRow
              key={key}
              first={index === 0}
              label={APPEARANCES[key].label}
              note={APPEARANCES[key].note}
              selected={appearance === key}
              onPress={() => setAppearance(key)}
            />
          ))}
        </Group>

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

        {/* The app's whole claim is that your material never leaves the phone.
            What makes that checkable rather than a promise is being able to take
            it off the phone yourself, in one step, and watch it come back
            empty. */}
        <SectionTitle>Reminders</SectionTitle>
        <Group>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: alerts }}
            accessibilityLabel="Remind me before a bill is due"
            onPress={toggleAlerts}
            className="min-h-[52px] flex-row items-center gap-3 px-4 py-3 active:bg-surface-tertiary"
          >
            <Ionicons
              name={alerts ? "notifications" : "notifications-off-outline"}
              size={19}
              color={alerts ? palette.accent : palette.muted}
            />
            <View className="flex-1 gap-0.5">
              <Typography.Paragraph className="font-ui-medium text-[15px]">
                Before a bill is due
              </Typography.Paragraph>
              <Typography.Paragraph className="font-ui text-muted text-[12px]">
                {notice ?? "A day's warning on anything in Repeats."}
              </Typography.Paragraph>
            </View>
            <Ionicons
              name={alerts ? "toggle" : "toggle-outline"}
              size={26}
              color={alerts ? palette.accent : palette.muted}
            />
          </Pressable>
        </Group>

        <SectionTitle>Your data</SectionTitle>
        <Group>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              confirm.ask({
                title: "Erase everything?",
                message:
                  "Every note, conversation and quiz result on this phone, and everything the assistant learnt from them. The model stays downloaded and your settings are kept.",
                action: "Erase",
                destructive: true,
                onConfirm: () => {
                  if (db) void eraseContent(db).then(invalidate);
                },
              })
            }
            className="min-h-[52px] flex-row items-center gap-3 px-4 py-3 active:bg-surface-tertiary"
          >
            <Ionicons name="trash-outline" size={19} color={palette.danger} />
            <View className="flex-1 gap-0.5">
              <Typography.Paragraph
                className="font-ui-medium text-[15px]"
                style={{ color: palette.danger }}
              >
                Erase everything
              </Typography.Paragraph>
              <Typography.Paragraph className="font-ui text-muted text-[12px]">
                Notes, conversations and quiz results. Keeps the model and your settings.
              </Typography.Paragraph>
            </View>
          </Pressable>
        </Group>
      </PageScroll>
      {confirm.dialog}
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
