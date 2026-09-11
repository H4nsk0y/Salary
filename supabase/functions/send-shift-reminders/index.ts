// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const TIME_ZONE = "Europe/Moscow";
const REMINDER_TYPE = "upcoming_shift_reminder";
const EPSILON = 0.05;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

function dateParts(date: Date) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    iso: `${values.year}-${values.month}-${values.day}`,
  };
}

function sameHours(value: number, expected: number) {
  return Math.abs(value - expected) <= EPSILON;
}

function numberAt(values: unknown, index: number) {
  const value = Number(Array.isArray(values) ? values[index] : 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function hasLeave(payload: any, index: number) {
  const value = Array.isArray(payload?.leaveType) ? payload.leaveType[index] : null;
  return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
}

function isNightRest(day: number, night: number) {
  return (sameHours(day, 1) || sameHours(day, 2)) && sameHours(night, 5);
}

function isNightShift(day: number, night: number) {
  return (sameHours(day, 2) && sameHours(night, 2)) ||
    ((sameHours(day, 3) || sameHours(day, 4)) && sameHours(night, 7));
}

function shiftDescription(payload: any, index: number, nextPayload: any, nextIndex: number) {
  if (!payload || hasLeave(payload, index)) return null;
  const day = numberAt(payload.dayHours, index);
  const night = numberAt(payload.nightHours, index);
  if (!(day > 0 || night > 0) || isNightRest(day, night)) return null;

  if (isNightShift(day, night)) {
    let hours = sameHours(day, 3) ? 10 : 11;
    if (sameHours(day, 2) && sameHours(night, 2)) {
      const nextDay = numberAt(nextPayload?.dayHours, nextIndex);
      const nextNight = numberAt(nextPayload?.nightHours, nextIndex);
      if ((sameHours(nextDay, 1) && sameHours(nextNight, 5)) ||
          (sameHours(nextDay, 3) && sameHours(nextNight, 7))) hours = 10;
    }
    return { kind: "night", text: `ночная смена · ${hours} ч` };
  }

  return { kind: night > 0 ? "mixed" : "day", text: `смена · ${Number((day + night).toFixed(2))} ч` };
}

function subscriptionFromRow(row: any) {
  return { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!req.headers.get("Authorization")) return response({ error: "NO_AUTHORIZATION" }, 401);

  try {
    const expectedSecret = requiredEnv("CRON_SECRET");
    const receivedSecret = req.headers.get("x-cron-secret") || "";
    if (!receivedSecret || !constantTimeEqual(receivedSecret, expectedSecret)) {
      return response({ error: "INVALID_CRON_SECRET" }, 401);
    }

    const now = new Date();
    const today = dateParts(now);
    if (today.hour !== 17 || today.minute > 20) {
      return response({ ok: true, skipped: "OUTSIDE_REMINDER_TIME" });
    }
    const tomorrow = dateParts(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const dayAfterTomorrow = dateParts(new Date(now.getTime() + 48 * 60 * 60 * 1000));

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublicKey = requiredEnv("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = requiredEnv("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: subscriptions, error: subscriptionsError } = await client
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .eq("enabled", true);
    if (subscriptionsError) throw subscriptionsError;

    const userIds = [...new Set((subscriptions ?? []).map((row: any) => String(row.user_id)).filter(Boolean))];
    if (!userIds.length) return response({ ok: true, users: 0, sent: 0 });

    const monthPairs = [...new Set([today, tomorrow, dayAfterTomorrow].map((part) => `${part.year}:${part.month - 1}`))]
      .map((pair) => pair.split(":").map(Number));
    const monthFilter = monthPairs
      .map(([year, month]) => `and(year.eq.${year},month.eq.${month})`)
      .join(",");
    const { data: timesheets, error: timesheetsError } = await client
      .from("timesheets")
      .select("user_id, year, month, payload")
      .in("user_id", userIds)
      .or(monthFilter);
    if (timesheetsError) throw timesheetsError;

    const payloads = new Map<string, any>();
    for (const row of timesheets ?? []) {
      payloads.set(`${row.user_id}:${row.year}:${row.month}`, row.payload);
    }
    const payloadFor = (userId: string, parts: ReturnType<typeof dateParts>) =>
      payloads.get(`${userId}:${parts.year}:${parts.month - 1}`) ?? null;

    const moscowDayStartUtc = new Date(Date.UTC(today.year, today.month - 1, today.day) - 3 * 60 * 60 * 1000).toISOString();
    const { data: existing, error: existingError } = await client
      .from("user_notifications")
      .select("user_id")
      .eq("type", REMINDER_TYPE)
      .gte("created_at", moscowDayStartUtc)
      .in("user_id", userIds);
    if (existingError) throw existingError;
    const alreadyNotified = new Set((existing ?? []).map((row: any) => String(row.user_id)));

    const pending: any[] = [];
    for (const userId of userIds) {
      if (alreadyNotified.has(userId)) continue;
      const todayPayload = payloadFor(userId, today);
      const tomorrowPayload = payloadFor(userId, tomorrow);
      const afterPayload = payloadFor(userId, dayAfterTomorrow);
      const tonight = shiftDescription(todayPayload, today.day - 1, tomorrowPayload, tomorrow.day - 1);
      const tonightNight = tonight?.kind === "night" ? tonight : null;
      const nextDay = shiftDescription(tomorrowPayload, tomorrow.day - 1, afterPayload, dayAfterTomorrow.day - 1);
      const tomorrowNonNight = nextDay?.kind === "night" ? null : nextDay;
      const shift = tonightNight ?? tomorrowNonNight;
      if (!shift) continue;

      pending.push({
        user_id: userId,
        actor_user_id: null,
        type: REMINDER_TYPE,
        title: "Ближайшая смена",
        body: `${tonightNight ? "Сегодня" : "Завтра"} у вас ${shift.text}. Проверьте график перед выходом.`,
        url: "table.html",
        expires_at: new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString(),
      });
    }

    if (!pending.length) return response({ ok: true, users: 0, sent: 0 });
    const { data: notifications, error: insertError } = await client
      .from("user_notifications")
      .insert(pending)
      .select("id, user_id, title, body, url");
    if (insertError) throw insertError;

    const subscriptionsByUser = new Map<string, any[]>();
    for (const subscription of subscriptions ?? []) {
      const key = String(subscription.user_id);
      subscriptionsByUser.set(key, [...(subscriptionsByUser.get(key) ?? []), subscription]);
    }

    let sent = 0;
    let failed = 0;
    for (const notification of notifications ?? []) {
      let userSent = 0;
      let userFailed = 0;
      for (const subscription of subscriptionsByUser.get(String(notification.user_id)) ?? []) {
        try {
          await webpush.sendNotification(subscriptionFromRow(subscription), JSON.stringify({
            title: notification.title,
            body: notification.body,
            url: notification.url,
            tag: `alvisa-upcoming-shift-${notification.id}`,
          }));
          sent += 1;
          userSent += 1;
        } catch (error) {
          failed += 1;
          userFailed += 1;
          const status = Number(error?.statusCode || error?.status || 0);
          if (status === 404 || status === 410) {
            await client.from("push_subscriptions").update({
              enabled: false,
              updated_at: new Date().toISOString(),
            }).eq("id", subscription.id);
          }
        }
      }

      await client.from("user_notifications").update({
        push_sent_at: userSent > 0 ? new Date().toISOString() : null,
        push_error: userFailed > 0 ? `Ошибок push-отправки: ${userFailed}` : null,
      }).eq("id", notification.id);
    }

    return response({ ok: true, users: notifications?.length ?? 0, sent, failed });
  } catch (error) {
    return response({ error: "SHIFT_REMINDERS_FAILED", message: error?.message || String(error) }, 500);
  }
});
