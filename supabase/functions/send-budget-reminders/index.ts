import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import { normalizeBudget, upcomingBudgetBills, todayISO } from "../../../js/features/budgetModel.js";

const respond = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function matches(a: string, b: string) {
  const left = new TextEncoder().encode(a), right = new TextEncoder().encode(b);
  let different = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) different |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return different === 0;
}
serve(async request => {
  if (request.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || !matches(request.headers.get("x-cron-secret") ?? "", secret)) return respond({ error: "UNAUTHORIZED" }, 401);
  try {
    const env = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error("MISSING_CONFIG"); return value; };
    const client = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com", env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
    const { data: owners, error } = await client.from("profiles").select("user_id").eq("role", "owner");
    if (error) throw error;
    let sent = 0, failed = 0;
    for (const owner of owners ?? []) {
      try {
        const { data: devices, error: deviceError } = await client.from("push_subscriptions")
          .select("id,endpoint,p256dh,auth").eq("user_id", owner.user_id).eq("enabled", true);
        if (deviceError) throw deviceError;
        if (!devices?.length) continue;
        const { data: budget, error: budgetError } = await client.from("finance_budgets").select("state").eq("user_id", owner.user_id).maybeSingle();
        if (budgetError) throw budgetError;
        if (!budget || !upcomingBudgetBills(normalizeBudget(budget.state), todayISO()).length) continue;
        const { data: claims, error: claimError } = await client.rpc("claim_budget_bill_reminder", { p_user_id: owner.user_id });
        if (claimError) throw claimError;
        const claim = claims?.[0];
        if (!claim) continue;
        let delivered = false;
        for (const device of devices) {
          try {
            // The lock-screen payload deliberately contains no financial amounts or payment names.
            await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, JSON.stringify({
              title: "Ближайшие обязательные платежи",
              body: "Приближается срок обязательных платежей. Откройте «Мой бюджет», чтобы проверить список.",
              url: "budget.html", tag: "alvisa-budget-bills-" + claim.reminder_day,
            }), { TTL: 86400, timeout: 10000 });
            delivered = true;
          } catch (error) {
            const status = Number((error as { statusCode?: number }).statusCode ?? 0);
            if (status === 404 || status === 410) await client.from("push_subscriptions").update({ enabled: false, updated_at: new Date().toISOString() }).eq("id", device.id);
          }
        }
        if (delivered) {
          const time = new Date().toISOString();
          const { error: updateError } = await client.from("budget_bill_push_days").update({ delivered_at: time })
            .eq("user_id", owner.user_id).eq("reminder_day", claim.reminder_day);
          if (updateError) throw updateError;
          await client.from("user_notifications").update({ push_sent_at: time, push_error: null }).eq("id", claim.notification_id);
          sent++;
        } else {
          await client.from("user_notifications").update({ push_error: "Push-сервис не подтвердил доставку. Будет повторная попытка." }).eq("id", claim.notification_id);
          failed++;
        }
      } catch { failed++; }
    }
    return respond({ sent, failed }, failed ? 503 : 200);
  } catch { return respond({ error: "BUDGET_REMINDER_FAILED" }, 503); }
});
