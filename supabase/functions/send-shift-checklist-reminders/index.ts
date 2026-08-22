// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
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

function subscriptionFromRow(row: any) {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  };
}

function normalizedItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any) => ({
      text: String(item?.text ?? "").trim().slice(0, 160),
      done: item?.done === true,
    }))
    .filter((item) => item.text);
}

function reminderContent(items: Array<{ text: string; done: boolean }>) {
  const remaining = items.filter((item) => !item.done);
  if (!remaining.length) {
    return {
      title: "Чек-лист смены",
      body: "Все пункты выполнены. Не забудьте нажать «Смену сдал».",
    };
  }

  const first = remaining[0].text;
  const suffix = remaining.length > 1 ? ` Еще осталось: ${remaining.length}.` : "";
  const firstWithPunctuation = /[.!?…]$/.test(first) ? first : `${first}.`;
  return {
    title: "Проверьте чек-лист",
    body: `Еще не выполнено: ${firstWithPunctuation}${suffix}`.slice(0, 500),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!req.headers.get("Authorization")) return jsonResponse({ error: "NO_AUTHORIZATION" }, 401);

  try {
    const expectedSecret = requiredEnv("CRON_SECRET");
    const receivedSecret = req.headers.get("x-cron-secret") || "";
    if (!receivedSecret || !constantTimeEqual(receivedSecret, expectedSecret)) {
      return jsonResponse({ error: "INVALID_CRON_SECRET" }, 401);
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
    const now = new Date();
    const nowIso = now.toISOString();

    const { data: dueRows, error: dueError } = await serviceClient
      .from("shift_checklists")
      .select("id, user_id, department_key, items, next_reminder_at")
      .eq("status", "active")
      .eq("reminders_enabled", true)
      .lte("next_reminder_at", nowIso)
      .order("next_reminder_at", { ascending: true })
      .limit(100);

    if (dueError) throw dueError;
    if (!dueRows?.length) {
      return jsonResponse({ ok: true, due: 0, users: 0, sent: 0, failed: 0 });
    }

    const userIds = [...new Set(dueRows.map((row: any) => row.user_id).filter(Boolean))];
    const { data: subscriptions, error: subscriptionsError } = await serviceClient
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", userIds)
      .eq("enabled", true);

    if (subscriptionsError) throw subscriptionsError;

    const subscriptionsByUser = new Map<string, any[]>();
    for (const subscription of subscriptions ?? []) {
      const key = String(subscription.user_id);
      const bucket = subscriptionsByUser.get(key) ?? [];
      bucket.push(subscription);
      subscriptionsByUser.set(key, bucket);
    }

    let claimed = 0;
    let notifiedUsers = 0;
    let sent = 0;
    let failed = 0;
    let disabled = 0;

    for (const checklist of dueRows) {
      const nextReminderAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
      const { data: claimedRows, error: claimError } = await serviceClient
        .from("shift_checklists")
        .update({ next_reminder_at: nextReminderAt })
        .eq("id", checklist.id)
        .eq("status", "active")
        .eq("reminders_enabled", true)
        .lte("next_reminder_at", nowIso)
        .select("id");

      if (claimError) throw claimError;
      if (!claimedRows?.length) continue;
      claimed += 1;

      const userSubscriptions = subscriptionsByUser.get(String(checklist.user_id)) ?? [];
      if (!userSubscriptions.length) continue;

      const content = reminderContent(normalizedItems(checklist.items));
      let userSent = 0;
      let userFailed = 0;

      for (const subscription of userSubscriptions) {
        const payload = JSON.stringify({
          title: content.title,
          body: content.body,
          url: "checklist.html",
          tag: `alvisa-shift-checklist-${checklist.id}`,
        });

        try {
          await webpush.sendNotification(subscriptionFromRow(subscription), payload);
          sent += 1;
          userSent += 1;
        } catch (error) {
          failed += 1;
          userFailed += 1;
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

      const pushError = userFailed
        ? `Ошибок push-отправки: ${userFailed}; отправлено: ${userSent}`
        : null;
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const { error: notificationError } = await serviceClient
        .from("user_notifications")
        .insert({
          user_id: checklist.user_id,
          actor_user_id: null,
          department_key: checklist.department_key,
          type: "shift_checklist_reminder",
          title: content.title,
          body: content.body,
          url: "checklist.html",
          created_at: createdAt,
          expires_at: expiresAt,
          push_sent_at: createdAt,
          push_error: pushError,
        });

      if (notificationError) throw notificationError;
      notifiedUsers += 1;
    }

    return jsonResponse({
      ok: true,
      due: dueRows.length,
      claimed,
      users: notifiedUsers,
      sent,
      failed,
      disabled,
    });
  } catch (error) {
    return jsonResponse({
      error: "SHIFT_CHECKLIST_REMINDERS_FAILED",
      message: error?.message || String(error),
    }, 500);
  }
});
