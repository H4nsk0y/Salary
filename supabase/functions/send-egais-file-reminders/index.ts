// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const MOSCOW_TIME_ZONE = "Europe/Moscow";
const EGAIS_DEPARTMENT_KEY = "egais";
const VALID_KINDS = new Set(["departure_check", "validation_check"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function subscriptionFromRow(row: any) {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
  };
}

function moscowDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    iso: `${values.year}-${values.month}-${values.day}`,
  };
}

function isExpectedTime(kind: string, parts: ReturnType<typeof moscowDateParts>) {
  if (kind === "departure_check") {
    return parts.hour === 13 && parts.minute <= 20;
  }

  return validationPhase(parts) !== null;
}

function validationPhase(parts: ReturnType<typeof moscowDateParts>) {
  if (parts.hour === 0 && parts.minute >= 10 && parts.minute <= 30) {
    return "night";
  }
  if (parts.hour === 8 && parts.minute >= 25 && parts.minute <= 50) {
    return "day_fallback";
  }
  return null;
}

function hourAt(values: unknown, index: number) {
  if (!Array.isArray(values)) return 0;
  const value = Number(values[index]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function shiftForDate(payload: any, dayIndex: number) {
  return {
    day: hourAt(payload?.dayHours, dayIndex),
    night: hourAt(payload?.nightHours, dayIndex),
  };
}

function isFullNightShift(shift: { day: number; night: number }) {
  const tolerance = 0.05;
  return (
    Math.abs(shift.day - 2) <= tolerance && Math.abs(shift.night - 5) <= tolerance
  ) || (
    Math.abs(shift.day - 4) <= tolerance && Math.abs(shift.night - 7) <= tolerance
  );
}

function hasAnyShift(shift: { day: number; night: number }) {
  return shift.day > 0 || shift.night > 0;
}

function isDayShift(shift: { day: number; night: number }) {
  return shift.day > 0 && shift.night === 0;
}

function reminderContent(kind: string) {
  if (kind === "departure_check") {
    return {
      title: "Проверка суточных файлов",
      body: "Проверить, ушли ли суточные.",
    };
  }

  return {
    title: "Проверка суточных файлов",
    body: "Проверить суточные на правильность.",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  if (!req.headers.get("Authorization")) {
    return jsonResponse({ error: "NO_AUTHORIZATION" }, 401);
  }

  try {
    const requestBody = await req.json().catch(() => ({}));
    const kind = String(requestBody?.kind || "").trim();
    if (!VALID_KINDS.has(kind)) {
      return jsonResponse({ error: "INVALID_REMINDER_KIND" }, 400);
    }

    const nowParts = moscowDateParts();
    if (!isExpectedTime(kind, nowParts)) {
      return jsonResponse({
        ok: true,
        skipped: "OUTSIDE_REMINDER_TIME",
        kind,
        moscowTime: `${String(nowParts.hour).padStart(2, "0")}:${String(nowParts.minute).padStart(2, "0")}`,
      });
    }

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublicKey = requiredEnv("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = requiredEnv("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: members, error: membersError } = await serviceClient
      .from("department_members")
      .select("user_id")
      .eq("department_key", EGAIS_DEPARTMENT_KEY);

    if (membersError) throw membersError;

    const memberUserIds = (members ?? []).map((row: any) => row.user_id).filter(Boolean);
    if (!memberUserIds.length) {
      return jsonResponse({ ok: true, kind, members: 0, sent: 0 });
    }

    const { data: timesheets, error: timesheetsError } = await serviceClient
      .from("timesheets")
      .select("user_id, payload")
      .in("user_id", memberUserIds)
      .eq("year", nowParts.year)
      .eq("month", nowParts.month - 1);

    if (timesheetsError) throw timesheetsError;

    const dayIndex = nowParts.day - 1;
    const shiftsByUserId = new Map<string, { day: number; night: number }>();
    for (const row of timesheets ?? []) {
      shiftsByUserId.set(String(row.user_id), shiftForDate(row.payload, dayIndex));
    }

    const fullNightUserIds = memberUserIds
      .map(String)
      .filter((userId) => isFullNightShift(shiftsByUserId.get(userId) ?? { day: 0, night: 0 }));
    const phase = kind === "validation_check" ? validationPhase(nowParts) : "departure";

    let scheduledUserIds: string[] = [];
    if (kind === "departure_check") {
      scheduledUserIds = memberUserIds
        .map(String)
        .filter((userId) => hasAnyShift(shiftsByUserId.get(userId) ?? { day: 0, night: 0 }));
    } else if (phase === "night") {
      scheduledUserIds = fullNightUserIds;
    } else if (phase === "day_fallback") {
      if (fullNightUserIds.length) {
        return jsonResponse({
          ok: true,
          kind,
          phase,
          skipped: "FULL_NIGHT_SHIFT_EXISTS",
          fullNightWorkers: fullNightUserIds.length,
          sent: 0,
        });
      }
      scheduledUserIds = memberUserIds
        .map(String)
        .filter((userId) => isDayShift(shiftsByUserId.get(userId) ?? { day: 0, night: 0 }));
    }

    if (!scheduledUserIds.length) {
      return jsonResponse({
        ok: true,
        kind,
        phase,
        members: memberUserIds.length,
        scheduled: 0,
        sent: 0,
      });
    }

    const { data: profiles, error: profilesError } = await serviceClient
      .from("profiles")
      .select("user_id")
      .in("user_id", scheduledUserIds)
      .eq("egais_file_reminders_enabled", true);

    if (profilesError) throw profilesError;

    const enabledUserIds = (profiles ?? []).map((row: any) => row.user_id).filter(Boolean);
    if (!enabledUserIds.length) {
      return jsonResponse({
        ok: true,
        kind,
        phase,
        members: memberUserIds.length,
        scheduled: scheduledUserIds.length,
        enabled: 0,
        sent: 0,
      });
    }

    const [{ data: subscriptions, error: subscriptionsError }, { data: deliveries, error: deliveriesError }] =
      await Promise.all([
        serviceClient
          .from("push_subscriptions")
          .select("id, user_id, endpoint, p256dh, auth")
          .in("user_id", enabledUserIds)
          .eq("enabled", true),
        serviceClient
          .from("egais_file_reminder_deliveries")
          .select("user_id")
          .in("user_id", enabledUserIds)
          .eq("reminder_date", nowParts.iso)
          .eq("reminder_kind", kind),
      ]);

    if (subscriptionsError) throw subscriptionsError;
    if (deliveriesError) throw deliveriesError;

    const deliveredUserIds = new Set((deliveries ?? []).map((row: any) => String(row.user_id)));
    const subscriptionsByUser = new Map<string, any[]>();

    for (const subscription of subscriptions ?? []) {
      const userId = String(subscription.user_id);
      const bucket = subscriptionsByUser.get(userId) ?? [];
      bucket.push(subscription);
      subscriptionsByUser.set(userId, bucket);
    }

    const content = reminderContent(kind);
    let sent = 0;
    let sentUsers = 0;
    let failed = 0;
    let disabled = 0;

    for (const userId of enabledUserIds.map(String)) {
      if (deliveredUserIds.has(userId)) continue;

      const userSubscriptions = subscriptionsByUser.get(userId) ?? [];
      let userSent = 0;

      for (const subscription of userSubscriptions) {
        const payload = JSON.stringify({
          title: content.title,
          body: content.body,
          url: "table.html",
          tag: `alvisa-egais-${kind}-${nowParts.iso}`,
        });

        try {
          await webpush.sendNotification(subscriptionFromRow(subscription), payload);
          userSent += 1;
          sent += 1;
        } catch (error) {
          failed += 1;
          const statusCode = Number(error?.statusCode || error?.status || 0);

          if (statusCode === 404 || statusCode === 410) {
            disabled += 1;
            await serviceClient
              .from("push_subscriptions")
              .update({ enabled: false, updated_at: new Date().toISOString() })
              .eq("id", subscription.id);
          }
        }
      }

      if (!userSent) continue;

      sentUsers += 1;
      const sentAt = new Date().toISOString();

      await serviceClient
        .from("egais_file_reminder_deliveries")
        .insert({
          user_id: userId,
          reminder_date: nowParts.iso,
          reminder_kind: kind,
          sent_at: sentAt,
        });

      await serviceClient
        .from("user_notifications")
        .insert({
          user_id: userId,
          actor_user_id: null,
          department_key: EGAIS_DEPARTMENT_KEY,
          type: "egais_file_reminder",
          title: content.title,
          body: content.body,
          url: "table.html",
          created_at: sentAt,
          expires_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
          push_sent_at: sentAt,
          push_error: null,
        });
    }

    return jsonResponse({
      ok: true,
      kind,
      phase,
      members: memberUserIds.length,
      scheduled: scheduledUserIds.length,
      enabled: enabledUserIds.length,
      sentUsers,
      sent,
      failed,
      disabled,
    });
  } catch (error) {
    return jsonResponse({
      error: "EGAIS_FILE_REMINDERS_FAILED",
      message: error?.message || String(error),
    }, 500);
  }
});
