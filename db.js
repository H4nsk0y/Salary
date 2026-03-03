// /db.js
import { supabase } from "./supabaseClient.js";

function isNotFoundError(error) {
  return (
    error &&
    (error.code === "PGRST116" || error.status === 406 || /0 rows/i.test(error.message ?? ""))
  );
}

async function requireUserId() {
  const { data: s, error: sErr } = await supabase.auth.getSession();
  if (sErr) throw sErr;
  const uid = s.session?.user?.id;
  if (!uid) throw new Error("NO_SESSION");
  return uid;
}

export async function getMyProfile() {
  const uid = await requireUserId();
  const { data, error } = await supabase
    .from("profiles")
    .select("role, oklad, display_name, avatar_url")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
  return data ?? null;
}

export async function updateMyOklad(oklad) {
  const uid = await requireUserId();
  const { error } = await supabase.from("profiles").update({ oklad }).eq("user_id", uid);
  if (error) throw error;
}

export async function updateMyProfile({ displayName, oklad, avatarUrl }) {
  const uid = await requireUserId();

  const patch = {};
  if (displayName !== undefined) patch.display_name = displayName;
  if (oklad !== undefined) patch.oklad = oklad;
  if (avatarUrl !== undefined) patch.avatar_url = avatarUrl;

  const { error } = await supabase.from("profiles").update(patch).eq("user_id", uid);
  if (error) throw error;
}

export async function loadTimesheet(year, month) {
  const uid = await requireUserId();

  const { data, error } = await supabase
    .from("timesheets")
    .select("payload")
    .eq("user_id", uid)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  if (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }

  return data?.payload ?? null;
}

export async function saveTimesheet(year, month, payload) {
  const uid = await requireUserId();

  const { error } = await supabase
    .from("timesheets")
    .upsert({ user_id: uid, year, month, payload }, { onConflict: "user_id,year,month" });

  if (error) throw error;
}

export async function listMyTimesheets(limit = 24) {
  const uid = await requireUserId();

  const { data, error } = await supabase
    .from("timesheets")
    .select("year, month, updated_at")
    .eq("user_id", uid)
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function adminListProfiles(limit = 100) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, role, oklad, display_name, avatar_url, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function adminListTimesheets(limit = 100) {
  const { data, error } = await supabase
    .from("timesheets")
    .select("user_id, year, month, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}