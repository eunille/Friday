import * as Notifications from "expo-notifications";

import { dueDates, peso, type Recurring } from "./budget";

/**
 * Reminders for what is about to leave your account.
 *
 * Local notifications only. Nothing is registered with a push service and no
 * token leaves the phone — the app's whole claim is that your material stays
 * here, and a push token is the one thing that would quietly stop that being
 * true.
 *
 * Only bills are scheduled. A budget going over is not a time-based event: it
 * happens when you spend, which the phone cannot notice while the app is shut.
 * Pretending otherwise would mean a reminder arriving a day late that reads
 * like a reproach. Budget state lives on Plan, where it is current.
 */

/** How far before a bill to say something. A day is enough to move money. */
const NOTICE_DAYS = 1;

/** Far enough ahead to be useful, short enough that the OS keeps them all. */
const HORIZON_DAYS = 60;

/** Bounded, so a daily rule cannot fill the notification tray. */
const MAX_ALERTS = 30;

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
});

/**
 * Asks for permission, returning whether it was given.
 *
 * Called only when the user turns reminders on, never at startup: a permission
 * sheet on first launch, before anything has been explained, is how people
 * learn to tap Deny by reflex.
 */
export async function askAlerts(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;

  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export async function cancelAlerts(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Replaces every scheduled reminder with one per upcoming bill.
 *
 * Cancel-then-schedule rather than reconciling: the set is small, the rules
 * change rarely, and a diff would be more code with more ways to strand a
 * reminder for a bill that has since been deleted.
 *
 * Returns how many were scheduled, so the screen can say so rather than the
 * user having to take it on faith.
 */
export async function syncAlerts(rules: readonly Recurring[], now = new Date()): Promise<number> {
  await cancelAlerts();

  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const upcoming: { rule: Recurring; at: Date }[] = [];

  for (const rule of rules) {
    if (rule.kind !== "expense") continue;
    // dueDates counts from the rule's own start and skips what has already run,
    // so asking it about the horizon yields exactly the future occurrences.
    for (const iso of dueDates(rule, horizon)) {
      const at = new Date(new Date(iso).getTime() - NOTICE_DAYS * 86_400_000);
      // A reminder for a moment already past would fire at once, which reads as
      // the app shouting about a bill you have already paid.
      if (at > now) upcoming.push({ rule, at });
    }
  }

  upcoming.sort((a, b) => a.at.getTime() - b.at.getTime());
  const scheduled = upcoming.slice(0, MAX_ALERTS);

  for (const item of scheduled) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${item.rule.label} tomorrow`,
        body: `${peso(item.rule.amount)} is due.`,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: item.at,
      },
    });
  }

  return scheduled.length;
}
