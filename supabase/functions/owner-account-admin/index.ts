// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_ACTIONS = new Set([
  "send_recovery",
  "revoke_sessions",
  "block",
  "unblock",
  "delete",
]);

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

function normalizeText(value: unknown, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function errorMessage(error: any) {
  return normalizeText(error?.message || error?.error_description || error?.error || error, 1000);
}

function safeRecoveryRedirect(value: unknown) {
  const allowedOrigins = new Set(
    (Deno.env.get("APP_ALLOWED_ORIGINS") || "https://h4nsk0y.ru,https://www.h4nsk0y.ru,https://h4nsk0y.github.io")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

  try {
    const url = new URL(normalizeText(value, 1000));
    if (url.protocol !== "https:" || !allowedOrigins.has(url.origin)) return "";
    const allowedPath = url.origin === "https://h4nsk0y.github.io" ? "/Salary/login.html" : "/login.html";
    if (url.pathname !== allowedPath) return "";
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  try {
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization) return jsonResponse({ error: "NO_SESSION" }, 401);

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const supabaseAnonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const publicClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: callerData, error: callerError } = await userClient.auth.getUser();
    if (callerError || !callerData?.user?.id) {
      return jsonResponse({ error: "NO_SESSION" }, 401);
    }

    const actorUserId = callerData.user.id;
    const { data: ownerProfile, error: ownerError } = await serviceClient
      .from("profiles")
      .select("role")
      .eq("user_id", actorUserId)
      .maybeSingle();

    if (ownerError) throw ownerError;
    if (ownerProfile?.role !== "owner") {
      return jsonResponse({ error: "ACCESS_DENIED" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = normalizeText(body.action, 50);
    const targetUserId = normalizeText(body.userId, 80);

    if (!ALLOWED_ACTIONS.has(action)) {
      return jsonResponse({ error: "INVALID_ACTION" }, 400);
    }
    if (!targetUserId) {
      return jsonResponse({ error: "USER_ID_REQUIRED" }, 400);
    }

    const { data: targetData, error: targetError } = await serviceClient.auth.admin.getUserById(targetUserId);
    if (targetError || !targetData?.user) {
      return jsonResponse({ error: "USER_NOT_FOUND" }, 404);
    }

    const targetUser = targetData.user;
    const { data: targetProfile, error: targetProfileError } = await serviceClient
      .from("profiles")
      .select("role, display_name, position")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (targetProfileError) throw targetProfileError;

    const targetName = normalizeText(
      targetProfile?.display_name || targetProfile?.position || targetUser.email || "Сотрудник",
      240,
    );

    if (action !== "send_recovery") {
      if (targetUserId === actorUserId) {
        return jsonResponse({ error: "SELF_ACTION_DENIED" }, 409);
      }
      if (targetProfile?.role === "owner") {
        return jsonResponse({ error: "OWNER_ACTION_DENIED" }, 409);
      }
    }

    const auditDetails = {
      target_name: targetName,
      email: normalizeText(targetUser.email, 320),
    };

    if (action === "send_recovery") {
      if (!targetUser.email) {
        return jsonResponse({ error: "EMAIL_NOT_FOUND" }, 409);
      }

      const redirectTo = safeRecoveryRedirect(body.redirectTo);
      const recoveryOptions = redirectTo ? { redirectTo } : undefined;
      const { error } = await publicClient.auth.resetPasswordForEmail(targetUser.email, recoveryOptions);
      if (error) throw error;

      const { error: auditError } = await serviceClient.rpc("service_owner_record_auth_action", {
        p_actor_user_id: actorUserId,
        p_target_user_id: targetUserId,
        p_action: "password_recovery_sent",
        p_details: auditDetails,
      });
      if (auditError) throw auditError;

      return jsonResponse({ ok: true, action });
    }

    if (action === "revoke_sessions") {
      const { data: sessionCount, error } = await serviceClient.rpc("service_owner_revoke_sessions", {
        p_actor_user_id: actorUserId,
        p_target_user_id: targetUserId,
      });
      if (error) throw error;
      return jsonResponse({ ok: true, action, sessionCount: Number(sessionCount) || 0 });
    }

    if (action === "block" || action === "unblock") {
      const isBlocking = action === "block";
      const { data: updated, error } = await serviceClient.auth.admin.updateUserById(targetUserId, {
        ban_duration: isBlocking ? "876000h" : "none",
      });
      if (error) throw error;

      if (isBlocking) {
        const { error: sessionsError } = await serviceClient.rpc("service_owner_revoke_sessions", {
          p_actor_user_id: actorUserId,
          p_target_user_id: targetUserId,
        });
        if (sessionsError) throw sessionsError;
      }

      const { error: auditError } = await serviceClient.rpc("service_owner_record_auth_action", {
        p_actor_user_id: actorUserId,
        p_target_user_id: targetUserId,
        p_action: isBlocking ? "user_blocked" : "user_unblocked",
        p_details: auditDetails,
      });
      if (auditError) throw auditError;

      return jsonResponse({
        ok: true,
        action,
        bannedUntil: updated?.user?.banned_until || null,
      });
    }

    if (action === "delete") {
      const { error } = await serviceClient.auth.admin.deleteUser(targetUserId, false);
      if (error) throw error;

      const { error: auditError } = await serviceClient.rpc("service_owner_record_auth_action", {
        p_actor_user_id: actorUserId,
        p_target_user_id: targetUserId,
        p_action: "user_deleted",
        p_details: auditDetails,
      });
      if (auditError) throw auditError;

      return jsonResponse({ ok: true, action });
    }

    return jsonResponse({ error: "INVALID_ACTION" }, 400);
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) || "INTERNAL_ERROR" }, 500);
  }
});
