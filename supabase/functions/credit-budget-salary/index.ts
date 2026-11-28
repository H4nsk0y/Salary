import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { buildBudgetSalary } from "../../../js/features/budgetSalary.js";
import { normalizeBudget, receiveDueSalary, salaryMonths, todayISO, maintainBudget } from "../../../js/features/budgetModel.js";

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function matchesSecret(actual: string, expected: string) {
  const a = new TextEncoder().encode(actual);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

serve(async request => {
  if (request.method !== "POST") return response({ error: "METHOD_NOT_ALLOWED" }, 405);
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || !matchesSecret(request.headers.get("x-cron-secret") ?? "", secret)) return response({ error: "UNAUTHORIZED" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return response({ error: "CONFIGURATION_REQUIRED" }, 503);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const today = todayISO();
    const months = salaryMonths(today).map(({ year, month }) => `and(year.eq.${year},month.eq.${month})`).join(",");
    let credited = 0, conflicts = 0, failed = 0;
    for (let offset = 0; ; offset += 200) {
      const { data: budgets, error } = await client.from('finance_budgets')
        .select('user_id,state,revision').order('user_id').range(offset, offset + 199);
      if (error) throw error;
      if (!budgets?.length) break;
      const { data: profiles, error: profileError } = await client.from('profiles')
        .select('user_id,branch,oklad,gender,weekly_hours,position,tax_rate').in('user_id', budgets.map(row => row.user_id));
      if (profileError) throw profileError;
      for (const profile of profiles ?? []) {
        try {
          const row = budgets.find(row => row.user_id === profile.user_id);
          if (!row) continue;
          const stored = normalizeBudget(row.state);
          const state = maintainBudget(stored, today);
          const { data: tables, error: tableError } = await client.from("timesheets")
            .select("year,month,payload").eq("user_id", profile.user_id).or(months);
          if (tableError) throw tableError;
          const salary = await buildBudgetSalary(tables ?? [], today, profile.branch, undefined, profile);
          const next = receiveDueSalary(state, salary);
          if (next === stored) continue;
          const { data: saved, error: saveError } = await client.from("finance_budgets")
            .update({ state: normalizeBudget(next), revision: row.revision + 1 }).eq("user_id", profile.user_id)
            .eq("revision", row.revision).select("revision").maybeSingle();
          if (saveError) throw saveError;
          if (saved) credited++; else conflicts++;
        } catch {
          failed++;
        }
      }
      if (budgets.length < 200) break;
    }
    // No amounts, profiles, or budget contents are returned or logged.
    return response({ credited, conflicts, failed }, failed ? 503 : 200);
  } catch {
    return response({ error: "BUDGET_CREDIT_FAILED" }, 503);
  }
});
