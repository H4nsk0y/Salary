// /db.js
import { supabase } from "./supabaseClient.js";

function isNotFoundError(error) {
  return (
    error &&
    (error.code === "PGRST116" ||
      error.status === 406 ||
      /0 rows/i.test(error.message ?? ""))
  );
}

async function requireUserId() {
  const { data: s, error: sErr } = await supabase.auth.getSession();
  if (sErr) throw sErr;
  const uid = s.session?.user?.id;
  if (!uid) throw new Error("NO_SESSION");
  return uid;
}

/** =========================
 *  PROFILE (me)
 *  ========================= */

export async function getMyProfile() {
  const uid = await requireUserId();
  const { data, error } = await supabase
    .from("profiles")
    .select("role, oklad, gender, display_name, avatar_url")
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
  const { error } = await supabase
    .from("profiles")
    .update({ oklad })
    .eq("user_id", uid);

  if (error) throw error;
}

export async function updateMyProfile({ displayName, oklad, gender, avatarUrl }) {
  const uid = await requireUserId();

   const patch = {};
  if (displayName !== undefined) patch.display_name = displayName;
  if (oklad !== undefined) patch.oklad = oklad;
  if (gender !== undefined) patch.gender = gender;
  if (avatarUrl !== undefined) patch.avatar_url = avatarUrl;

  const { error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("user_id", uid);

  if (error) throw error;
}

/** Удобный алиас (если где-то в коде хочется просто "fields") */
export async function updateMyProfileFields(fields) {
  const uid = await requireUserId();
  const { error } = await supabase.from("profiles").update(fields).eq("user_id", uid);
  if (error) throw error;
}

/** =========================
 *  TIMESHEETS (me)
 *  ========================= */

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
    .upsert(
      { user_id: uid, year, month, payload },
      { onConflict: "user_id,year,month" }
    );

  if (error) throw error;
}

/**
 * Список табелей пользователя (метаданные)
 * — полезно для ЛК "последние месяцы"
 */
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

/**
 * ✅ Для подсчёта переработки за год / истории:
 * Можно вернуть только мету или сразу payload.
 *
 * @param {number} year
 * @param {{withPayload?: boolean}} options
 */
export async function listMyTimesheetsByYear(year, options = {}) {
  const uid = await requireUserId();
  const withPayload = Boolean(options.withPayload);

  const select = withPayload
    ? "year, month, payload, updated_at"
    : "year, month, updated_at";

  const { data, error } = await supabase
    .from("timesheets")
    .select(select)
    .eq("user_id", uid)
    .eq("year", year)
    .order("month", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/** ✅ Удалить табель за конкретный месяц */
export async function deleteMyTimesheet(year, month) {
  const uid = await requireUserId();

  const { error } = await supabase
    .from("timesheets")
    .delete()
    .eq("user_id", uid)
    .eq("year", year)
    .eq("month", month);

  if (error) throw error;
}

/** (опционально) проверить, есть ли табель без payload */
export async function getTimesheetMeta(year, month) {
  const uid = await requireUserId();

  const { data, error } = await supabase
    .from("timesheets")
    .select("year, month, updated_at")
    .eq("user_id", uid)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  if (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }

  return data ?? null;
}

/** =========================
 *  ADMIN (requires RLS policies)
 *  ========================= */

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