import { supabase } from "./supabaseClient.js";

const PROFILE_SELECT =
  "role, oklad, gender, position, display_name, avatar_url, hide_money, money_pin_hash, money_pin_salt";

const ADMIN_PROFILE_SELECT =
  "user_id, role, oklad, gender, position, display_name, avatar_url, hide_money, created_at";

function isNotFoundError(error) {
  return (
    error &&
    (error.code === "PGRST116" ||
      error.status === 406 ||
      /0 rows/i.test(error.message ?? ""))
  );
}

function assertValidYearMonth(year, month) {
  const y = Number(year);
  const m = Number(month);

  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    throw new Error("Некорректный год.");
  }

  if (!Number.isInteger(m) || m < 0 || m > 11) {
    throw new Error("Некорректный месяц.");
  }

  return { year: y, month: m };
}

async function requireUserId() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const userId = sessionData.session?.user?.id;
  if (!userId) {
    throw new Error("NO_SESSION");
  }

  return userId;
}

async function requireAdmin() {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  if (!data || data.role !== "admin") {
    throw new Error("Доступ запрещён. Нужна роль admin.");
  }

  return userId;
}

/** =========================
 *  PROFILE (me)
 *  ========================= */

export async function getMyProfile() {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }

  return data ?? null;
}

export async function updateMyOklad(oklad) {
  const userId = await requireUserId();

  const { error } = await supabase
    .from("profiles")
    .update({ oklad })
    .eq("user_id", userId);

  if (error) throw error;
}

export async function updateMyProfile({
  displayName,
  oklad,
  gender,
  position,
  avatarUrl,
}) {
  const userId = await requireUserId();

  const patch = { user_id: userId };

  if (displayName !== undefined) patch.display_name = displayName;
  if (oklad !== undefined) patch.oklad = oklad;
  if (gender !== undefined) patch.gender = gender;
  if (position !== undefined) patch.position = position;
  if (avatarUrl !== undefined) patch.avatar_url = avatarUrl;

  const { error } = await supabase
    .from("profiles")
    .upsert(patch, { onConflict: "user_id" });

  if (error) throw error;
}

export async function updateMyProfileFields(fields) {
  const userId = await requireUserId();
  const patch = { user_id: userId, ...(fields || {}) };

  const { error } = await supabase
    .from("profiles")
    .upsert(patch, { onConflict: "user_id" });

  if (error) throw error;
}

export async function updateMyMoneyPin({
  hideMoney = true,
  moneyPinHash,
  moneyPinSalt,
}) {
  const userId = await requireUserId();

  const patch = {
    user_id: userId,
    hide_money: Boolean(hideMoney),
    money_pin_hash: moneyPinHash ?? null,
    money_pin_salt: moneyPinSalt ?? null,
  };

  const { error } = await supabase
    .from("profiles")
    .upsert(patch, { onConflict: "user_id" });

  if (error) throw error;
}

/** =========================
 *  TIMESHEETS (me)
 *  ========================= */

export async function loadTimesheet(year, month) {
  const userId = await requireUserId();
  const normalized = assertValidYearMonth(year, month);

  const { data, error } = await supabase
    .from("timesheets")
    .select("payload")
    .eq("user_id", userId)
    .eq("year", normalized.year)
    .eq("month", normalized.month)
    .maybeSingle();

  if (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }

  return data?.payload ?? null;
}

export async function saveTimesheet(year, month, payload) {
  const userId = await requireUserId();
  const normalized = assertValidYearMonth(year, month);

  const row = {
    user_id: userId,
    year: normalized.year,
    month: normalized.month,
    payload: payload ?? null,
  };

  const { error } = await supabase
    .from("timesheets")
    .upsert(row, { onConflict: "user_id,year,month" });

  if (error) throw error;
}

export async function listMyTimesheets(limit = 24) {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("timesheets")
    .select("year, month, updated_at")
    .eq("user_id", userId)
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function listMyTimesheetsByYear(year, options = {}) {
  const userId = await requireUserId();
  const y = Number(year);

  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    throw new Error("Некорректный год.");
  }

  const withPayload = Boolean(options.withPayload);
  const select = withPayload
    ? "year, month, payload, updated_at"
    : "year, month, updated_at";

  const { data, error } = await supabase
    .from("timesheets")
    .select(select)
    .eq("user_id", userId)
    .eq("year", y)
    .order("month", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function deleteMyTimesheet(year, month) {
  const userId = await requireUserId();
  const normalized = assertValidYearMonth(year, month);

  const { error } = await supabase
    .from("timesheets")
    .delete()
    .eq("user_id", userId)
    .eq("year", normalized.year)
    .eq("month", normalized.month);

  if (error) throw error;
}

export async function getTimesheetMeta(year, month) {
  const userId = await requireUserId();
  const normalized = assertValidYearMonth(year, month);

  const { data, error } = await supabase
    .from("timesheets")
    .select("year, month, updated_at")
    .eq("user_id", userId)
    .eq("year", normalized.year)
    .eq("month", normalized.month)
    .maybeSingle();

  if (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }

  return data ?? null;
}

/** =========================
 *  ADMIN
 *  ========================= */

export async function adminListProfiles(limit = 100) {
  await requireAdmin();

  const { data, error } = await supabase
    .from("profiles")
    .select(ADMIN_PROFILE_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function adminListTimesheets(limit = 100) {
  await requireAdmin();

  const { data, error } = await supabase
    .from("timesheets")
    .select("user_id, year, month, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function adminGetProfilesByIds(userIds) {
  await requireAdmin();

  const ids = Array.isArray(userIds)
    ? userIds.map((value) => String(value)).filter(Boolean)
    : [];

  if (!ids.length) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select(ADMIN_PROFILE_SELECT)
    .in("user_id", ids);

  if (error) throw error;
  return data ?? [];
}

export async function adminLoadTimesheet(userId, year, month) {
  await requireAdmin();
  const normalized = assertValidYearMonth(year, month);

  const { data, error } = await supabase
    .from("timesheets")
    .select("payload, updated_at")
    .eq("user_id", userId)
    .eq("year", normalized.year)
    .eq("month", normalized.month)
    .maybeSingle();

  if (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }

  return data?.payload ?? null;
}

export async function adminSaveTimesheet(userId, year, month, payload) {
  await requireAdmin();
  const normalized = assertValidYearMonth(year, month);

  const row = {
    user_id: userId,
    year: normalized.year,
    month: normalized.month,
    payload: payload ?? null,
  };

  const { error } = await supabase
    .from("timesheets")
    .upsert(row, { onConflict: "user_id,year,month" });

  if (error) throw error;
}

export async function adminSaveManyTimesheets(items) {
  await requireAdmin();

  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return;

  const normalizedRows = rows.map((item) => {
    const normalized = assertValidYearMonth(item?.year, item?.month);

    return {
      user_id: item?.user_id,
      year: normalized.year,
      month: normalized.month,
      payload: item?.payload ?? null,
    };
  });

  const { error } = await supabase
    .from("timesheets")
    .upsert(normalizedRows, { onConflict: "user_id,year,month" });

  if (error) throw error;
}