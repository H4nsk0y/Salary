// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

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

function normalizeText(value: unknown, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
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

async function verifyDepartmentAccess({
  supabaseUrl,
  supabaseAnonKey,
  authorization,
  departmentKey,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  authorization: string;
  departmentKey: string;
}) {
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data, error } = await userClient.rpc("can_edit_department", {
    target_department_key: departmentKey,
  });

  if (error) throw error;
  return data === true;
}

async function verifyOwnerAccess({
  supabaseUrl,
  supabaseAnonKey,
  authorization,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  authorization: string;
}) {
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data, error } = await userClient.rpc("is_owner");
  if (error) throw error;
  return data === true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const supabaseAnonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublicKey = requiredEnv("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = requiredEnv("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
    const authorization = req.headers.get("Authorization") || "";

    if (!authorization) {
      return jsonResponse({ error: "NO_SESSION" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const departmentKey = normalizeText(body.departmentKey, 120);
    const type = normalizeText(body.type || "department_timesheet_saved", 120);
    const allUsers = body.allUsers === true;
    const lookbackMinutes = Math.min(60, Math.max(1, Number(body.lookbackMinutes) || 10));
    const limit = Math.min(200, Math.max(1, Number(body.limit) || 100));

    if (!departmentKey && !allUsers) {
      return jsonResponse({ error: "DEPARTMENT_REQUIRED" }, 400);
    }

    const allowed = allUsers
      ? await verifyOwnerAccess({ supabaseUrl, supabaseAnonKey, authorization })
      : await verifyDepartmentAccess({
          supabaseUrl,
          supabaseAnonKey,
          authorization,
          departmentKey,
        });

    if (!allowed) {
      return jsonResponse({ error: "ACCESS_DENIED" }, 403);
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const since = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    let notificationsQuery = serviceClient
      .from("user_notifications")
      .select("id, user_id, type, title, body, url, created_at, department_key")
      .eq("type", type)
      .is("push_sent_at", null)
      .gt("expires_at", now)
      .gte("created_at", since);

    if (!allUsers) {
      notificationsQuery = notificationsQuery.eq("department_key", departmentKey);
    }

    const { data: notifications, error: notificationsError } = await notificationsQuery
      .order("created_at", { ascending: false })
      .limit(limit);

    if (notificationsError) throw notificationsError;

    const rows = notifications ?? [];
    if (!rows.length) {
      return jsonResponse({ ok: true, notifications: 0, sent: 0, failed: 0, disabled: 0 });
    }

    const userIds = [...new Set(rows.map((item: any) => item.user_id).filter(Boolean))];
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

    let sent = 0;
    let failed = 0;
    let disabled = 0;

    for (const notification of rows) {
      const userSubscriptions = subscriptionsByUser.get(String(notification.user_id)) ?? [];

      for (const subscription of userSubscriptions) {
        const payload = JSON.stringify({
          title: notification.title || "Alvisa",
          body: notification.body || "Появилось новое уведомление.",
          url: notification.url || "profile.html",
          tag: `alvisa-${notification.id}`,
        });

        try {
          await webpush.sendNotification(subscriptionFromRow(subscription), payload);
          sent += 1;
        } catch (error) {
          failed += 1;
          const statusCode = Number(error?.statusCode || error?.status || 0);

          if (statusCode === 404 || statusCode === 410) {
            disabled += 1;
            await serviceClient
              .from("push_subscriptions")
              .update({
                enabled: false,
                updated_at: new Date().toISOString(),
              })
              .eq("id", subscription.id);
          }
        }
      }
    }

    const pushError =
      failed > 0
        ? `Ошибок push-отправки: ${failed}; отключено подписок: ${disabled}; отправлено: ${sent}`
        : null;

    await serviceClient
      .from("user_notifications")
      .update({
        push_sent_at: new Date().toISOString(),
        push_error: pushError,
      })
      .in("id", rows.map((item: any) => item.id));

    return jsonResponse({
      ok: true,
      notifications: rows.length,
      subscriptions: subscriptions?.length ?? 0,
      sent,
      failed,
      disabled,
    });
  } catch (error) {
    return jsonResponse({
      error: "SEND_PUSH_FAILED",
      message: error?.message || String(error),
    }, 500);
  }
});
