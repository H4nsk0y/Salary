import { supabase } from "./supabaseClient.js";

const PROFILE_SELECT =
  "role, oklad, gender, position, display_name, avatar_url, hide_money, money_pin_hash, money_pin_salt, auto_collapse_table_panels, tab_number, branch, employment_date, egais_file_reminders_enabled, hide_calculator_nav";

const PROFILE_SELECT_WITHOUT_HIDE_CALCULATOR_NAV =
  "role, oklad, gender, position, display_name, avatar_url, hide_money, money_pin_hash, money_pin_salt, auto_collapse_table_panels, tab_number, branch, employment_date, egais_file_reminders_enabled";

const PROFILE_SELECT_WITHOUT_EGAIS_REMINDERS =
  "role, oklad, gender, position, display_name, avatar_url, hide_money, money_pin_hash, money_pin_salt, auto_collapse_table_panels, tab_number, branch, employment_date, hide_calculator_nav";

const PROFILE_SELECT_WITHOUT_EGAIS_REMINDERS_AND_HIDE_CALCULATOR_NAV =
  "role, oklad, gender, position, display_name, avatar_url, hide_money, money_pin_hash, money_pin_salt, auto_collapse_table_panels, tab_number, branch, employment_date";

const PROFILE_SELECT_WITH_BRANCH =
  "role, oklad, gender, position, display_name, avatar_url, hide_money, money_pin_hash, money_pin_salt, auto_collapse_table_panels, tab_number, branch";

const PROFILE_SELECT_LEGACY =
  "role, oklad, gender, position, display_name, avatar_url, hide_money, money_pin_hash, money_pin_salt, auto_collapse_table_panels, tab_number";

const ADMIN_PROFILE_SELECT =
  "user_id, role, oklad, gender, position, display_name, avatar_url, hide_money, created_at, tab_number, branch, employment_date";

const ADMIN_PROFILE_SELECT_WITHOUT_EMPLOYMENT =
  "user_id, role, oklad, gender, position, display_name, avatar_url, hide_money, created_at, tab_number, branch";

const ADMIN_PROFILE_SELECT_LEGACY =
  "user_id, role, oklad, gender, position, display_name, avatar_url, hide_money, created_at, tab_number";

const NOTIFICATION_SELECT =
  "id, type, title, body, url, created_at, expires_at, department_key, read_at";

const NOTIFICATION_SELECT_LEGACY =
  "id, type, title, body, url, created_at, expires_at, department_key";

const MY_PROFILE_MUTABLE_FIELDS = new Set([
  "hide_money",
  "money_pin_hash",
  "money_pin_salt",
  "auto_collapse_table_panels",
  "hide_calculator_nav",
  "egais_file_reminders_enabled",
]);

function isNotFoundError(error) {
  return (
    error &&
    (error.code === "PGRST116" ||
      error.status === 406 ||
      /0 rows/i.test(error.message ?? ""))
  );
}

function isMissingBranchColumnError(error) {
  const text = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ].filter(Boolean).join(" ");

  return (
    /branch/i.test(text) &&
    /(column|schema cache|does not exist|could not find|42703|PGRST204)/i.test(text)
  );
}

function isMissingEmploymentDateColumnError(error) {
  const text = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ].filter(Boolean).join(" ");

  return (
    /employment_date/i.test(text) &&
    /(column|schema cache|does not exist|could not find|42703|PGRST204)/i.test(text)
  );
}

function isMissingEgaisFileRemindersColumnError(error) {
  const text = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ].filter(Boolean).join(" ");

  return (
    /egais_file_reminders_enabled/i.test(text) &&
    /(column|schema cache|does not exist|could not find|42703|PGRST204)/i.test(text)
  );
}

function isMissingHideCalculatorNavColumnError(error) {
  const text = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ].filter(Boolean).join(" ");

  return (
    /hide_calculator_nav/i.test(text) &&
    /(column|schema cache|does not exist|could not find|42703|PGRST204)/i.test(text)
  );
}

function isMissingWeeklyHoursColumnError(error) {
  const text = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ].filter(Boolean).join(" ");

  return (
    /weekly_hours/i.test(text) &&
    /(column|schema cache|does not exist|could not find|42703|PGRST204)/i.test(text)
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
  if (!userId) throw new Error("NO_SESSION");

  return userId;
}

export async function getMyProfile() {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isNotFoundError(error)) return null;

    if (isMissingHideCalculatorNavColumnError(error)) {
      let { data: fallbackData, error: fallbackError } = await supabase
        .from("profiles")
        .select(PROFILE_SELECT_WITHOUT_HIDE_CALCULATOR_NAV)
        .eq("user_id", userId)
        .maybeSingle();

      if (fallbackError && isMissingEgaisFileRemindersColumnError(fallbackError)) {
        const fallback = await supabase
          .from("profiles")
          .select(PROFILE_SELECT_WITHOUT_EGAIS_REMINDERS_AND_HIDE_CALCULATOR_NAV)
          .eq("user_id", userId)
          .maybeSingle();
        fallbackData = fallback.data;
        fallbackError = fallback.error;
      }

      if (!fallbackError) {
        return fallbackData
          ? attachWeeklyHours({
              ...fallbackData,
              egais_file_reminders_enabled:
                fallbackData.egais_file_reminders_enabled === true,
              hide_calculator_nav: false,
            }, userId)
          : null;
      }

      if (isNotFoundError(fallbackError)) return null;
      throw fallbackError;
    }

    if (isMissingEgaisFileRemindersColumnError(error)) {
      let { data: fallbackData, error: fallbackError } = await supabase
        .from("profiles")
        .select(PROFILE_SELECT_WITHOUT_EGAIS_REMINDERS)
        .eq("user_id", userId)
        .maybeSingle();

      if (fallbackError && isMissingHideCalculatorNavColumnError(fallbackError)) {
        const fallback = await supabase
          .from("profiles")
          .select(PROFILE_SELECT_WITHOUT_EGAIS_REMINDERS_AND_HIDE_CALCULATOR_NAV)
          .eq("user_id", userId)
          .maybeSingle();
        fallbackData = fallback.data;
        fallbackError = fallback.error;
      }

      if (!fallbackError) {
        return fallbackData
          ? attachWeeklyHours({
              ...fallbackData,
              egais_file_reminders_enabled: false,
              hide_calculator_nav: fallbackData.hide_calculator_nav === true,
            }, userId)
          : null;
      }

      if (isNotFoundError(fallbackError)) return null;
      throw fallbackError;
    }

    if (isMissingEmploymentDateColumnError(error)) {
      const { data: withBranchData, error: withBranchError } = await supabase
        .from("profiles")
        .select(PROFILE_SELECT_WITH_BRANCH)
        .eq("user_id", userId)
        .maybeSingle();

      if (!withBranchError) {
        return withBranchData ? attachWeeklyHours({ ...withBranchData, employment_date: null }, userId) : null;
      }

      if (!isMissingBranchColumnError(withBranchError)) {
        if (isNotFoundError(withBranchError)) return null;
        throw withBranchError;
      }
    }

    if (isMissingBranchColumnError(error) || isMissingEmploymentDateColumnError(error)) {
      const { data: legacyData, error: legacyError } = await supabase
        .from("profiles")
        .select(PROFILE_SELECT_LEGACY)
        .eq("user_id", userId)
        .maybeSingle();

      if (legacyError) {
        if (isNotFoundError(legacyError)) return null;
        throw legacyError;
      }

      return legacyData ? attachWeeklyHours({ ...legacyData, branch: null, employment_date: null }, userId) : null;
    }

    throw error;
  }

  return data ? attachWeeklyHours(data, userId) : null;
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
  tabNumber,
  branch,
  employmentDate,
  weeklyHours,
}) {
  const userId = await requireUserId();

  const patch = { user_id: userId };

  if (displayName !== undefined) patch.display_name = displayName;
  if (oklad !== undefined) patch.oklad = oklad;
  if (gender !== undefined) patch.gender = gender;
  if (position !== undefined) patch.position = position;
  if (avatarUrl !== undefined) patch.avatar_url = avatarUrl;
  if (tabNumber !== undefined) patch.tab_number = tabNumber;
  if (branch !== undefined) patch.branch = branch;
  if (employmentDate !== undefined) patch.employment_date = employmentDate;
  if (weeklyHours !== undefined) patch.weekly_hours = normalizeWeeklyHours(weeklyHours);

  const { error } = await supabase
    .from("profiles")
    .upsert(patch, { onConflict: "user_id" });

  if (error) {
    if (employmentDate !== undefined && isMissingEmploymentDateColumnError(error)) {
      throw new Error("В базе пока нет поля даты трудоустройства. Запусти supabase-sql/007_profile_employment_date.sql в Supabase SQL Editor.");
    }

    if (branch !== undefined && isMissingBranchColumnError(error)) {
      throw new Error("В базе пока нет поля филиала. Запусти supabase-sql/004_profile_branch.sql в Supabase SQL Editor.");
    }

    if (weeklyHours !== undefined && isMissingWeeklyHoursColumnError(error)) {
      throw new Error("В базе пока нет поля нормы недели. Запусти supabase-sql/021_weekly_hours.sql в Supabase SQL Editor.");
    }

    throw error;
  }
}

export async function updateMyProfileFields(fields) {
  const userId = await requireUserId();
  const source = fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
  const unknownFields = Object.keys(source).filter((key) => !MY_PROFILE_MUTABLE_FIELDS.has(key));
  if (unknownFields.length) {
    throw new Error(`Запрещённые поля профиля: ${unknownFields.join(", ")}`);
  }

  const patch = { user_id: userId, ...source };

  const { error } = await supabase
    .from("profiles")
    .upsert(patch, { onConflict: "user_id" });

  if (error) {
    if (
      Object.prototype.hasOwnProperty.call(patch, "hide_calculator_nav") &&
      isMissingHideCalculatorNavColumnError(error)
    ) {
      throw new Error("В базе пока нет поля скрытия калькулятора. Запусти supabase-sql/020_hide_calculator_nav.sql в Supabase SQL Editor.");
    }

    throw error;
  }
}

function normalizeWeeklyHours(value) {
  const n = Number(value);
  if (n === 35) return 35;
  if (n === 40) return 40;
  return null;
}

async function fetchWeeklyHoursMap(userIds = []) {
  const ids = [...new Set(
    (Array.isArray(userIds) ? userIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  )];
  if (!ids.length) return new Map();

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, weekly_hours")
    .in("user_id", ids);

  if (error) {
    if (isMissingWeeklyHoursColumnError(error)) return new Map();
    throw error;
  }

  return new Map((data ?? []).map((row) => [row.user_id, normalizeWeeklyHours(row.weekly_hours)]));
}

async function attachWeeklyHours(profile, userId) {
  if (!profile) return profile;
  const weeklyMap = await fetchWeeklyHoursMap([userId ?? profile.user_id]);
  return { ...profile, weekly_hours: weeklyMap.get(userId ?? profile.user_id) ?? null };
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

export async function listMyTimesheetsBefore(year, month, options = {}) {
  const userId = await requireUserId();
  const normalized = assertValidYearMonth(year, month);
  const withPayload = Boolean(options.withPayload);
  const select = withPayload
    ? "year, month, payload, updated_at"
    : "year, month, updated_at";

  const { data, error } = await supabase
    .from("timesheets")
    .select(select)
    .eq("user_id", userId)
    .or(`year.lt.${normalized.year},and(year.eq.${normalized.year},month.lt.${normalized.month})`)
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(240);

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

export async function getMyManagedDepartment() {
  const userId = await requireUserId();

  const { data: editorRow, error: editorError } = await supabase
    .from("department_editors")
    .select("department_key")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (editorError) {
    if (isNotFoundError(editorError)) return null;
    throw editorError;
  }

  if (!editorRow?.department_key) return null;

  const { data: departmentRow, error: departmentError } = await supabase
    .from("departments")
    .select("key, name")
    .eq("key", editorRow.department_key)
    .maybeSingle();

  if (departmentError) {
    if (isNotFoundError(departmentError)) {
      return { key: editorRow.department_key, name: editorRow.department_key };
    }
    throw departmentError;
  }

  return departmentRow ?? { key: editorRow.department_key, name: editorRow.department_key };
}

export async function getDepartmentByKey(departmentKey) {
  const key = String(departmentKey ?? "").trim();
  if (!key) throw new Error("Не указан отдел.");

  const { data, error } = await supabase
    .from("departments")
    .select("key, name")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }

  return data ?? null;
}

export async function listAllDepartments() {
  const { data, error } = await supabase
    .from("departments")
    .select("key, name, created_at")
    .order("name", { ascending: true });

  if (error) throw error;
  return data ?? [];
}


export async function listManagedDepartmentMembers(departmentKey) {
  const key = String(departmentKey ?? "").trim();
  if (!key) throw new Error("Не указан отдел.");

  let { data: memberRows, error: membersError } = await supabase
    .from("department_members")
    .select("user_id, sort_order, created_at")
    .eq("department_key", key)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (membersError && isMissingDepartmentMemberOrderColumnError(membersError)) {
    const fallback = await supabase
      .from("department_members")
      .select("user_id, created_at")
      .eq("department_key", key)
      .order("created_at", { ascending: true });

    memberRows = fallback.data;
    membersError = fallback.error;
  }

  if (membersError) throw membersError;

  const userIds = (memberRows ?? [])
    .map((row) => String(row.user_id || "").trim())
    .filter(Boolean);

  if (!userIds.length) return [];

  let { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select(ADMIN_PROFILE_SELECT)
    .in("user_id", userIds);

  if (
    profilesError &&
    (isMissingEmploymentDateColumnError(profilesError) || isMissingBranchColumnError(profilesError))
  ) {
    const fallback = await supabase
      .from("profiles")
      .select(ADMIN_PROFILE_SELECT_WITHOUT_EMPLOYMENT)
      .in("user_id", userIds);

    profiles = fallback.data;
    profilesError = fallback.error;
  }

  if (profilesError && isMissingBranchColumnError(profilesError)) {
    const fallback = await supabase
      .from("profiles")
      .select(ADMIN_PROFILE_SELECT_LEGACY)
      .in("user_id", userIds);

    profiles = fallback.data;
    profilesError = fallback.error;
  }

  if (profilesError) throw profilesError;

  const profileMap = new Map((profiles ?? []).map((row) => [row.user_id, row]));
  const weeklyHoursMap = await fetchWeeklyHoursMap(userIds);

 return userIds.map((userId) => {
    const profile = profileMap.get(userId) ?? null;
    return {
      user_id: userId,
      display_name:
        profile?.display_name ||
        profile?.position ||
        `Сотрудник ${userId.slice(0, 8)}`,
      role: profile?.role ?? "user",
      oklad: profile?.oklad ?? null,
      gender: profile?.gender ?? null,
      weekly_hours: weeklyHoursMap.get(userId) ?? null,
      branch: profile?.branch ?? null,
      position: profile?.position ?? "",
      tab_number: profile?.tab_number ?? "",
      employment_date: profile?.employment_date ?? null,
      avatar_url: profile?.avatar_url ?? null,
      hide_money: profile?.hide_money ?? false,
      created_at: profile?.created_at ?? null,
      sort_order: memberRows?.find((row) => row.user_id === userId)?.sort_order ?? null,
    };
  });
}

export async function listEgaisDepartmentTimesheetView(year, month) {
  const normalized = assertValidYearMonth(year, month);

  const { data, error } = await supabase.rpc("list_egais_department_timesheet_view", {
    p_year: normalized.year,
    p_month: normalized.month,
  });

  if (error) throw error;
  return data ?? [];
}

export async function listStaffVoteCandidates() {
  const { data, error } = await supabase.rpc("list_staff_vote_candidates");
  if (error) throw error;
  return data ?? [];
}

export async function getStaffVotePeriods() {
  const { data, error } = await supabase.rpc("get_staff_vote_periods");
  if (error) throw error;
  return data ?? [];
}

export async function submitStaffVote({ periodType, nomineeUserId, comment = "" } = {}) {
  const type = String(periodType ?? "").trim();
  const nomineeId = String(nomineeUserId ?? "").trim();
  const text = String(comment ?? "").trim();

  if (!["week", "month"].includes(type)) throw new Error("Некорректный период голосования.");
  if (!nomineeId) throw new Error("Выберите сотрудника.");
  if (text.length > 500) throw new Error("Комментарий не может быть длиннее 500 символов.");

  const { error } = await supabase.rpc("submit_staff_vote", {
    p_period_type: type,
    p_nominee_user_id: nomineeId,
    p_comment: text || null,
  });

  if (error) throw error;
}

export async function listCompletedStaffVoteComments(periodType, periodStart) {
  const type = String(periodType ?? "").trim();
  const start = String(periodStart ?? "").trim();
  if (!["week", "month"].includes(type) || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];

  const { data, error } = await supabase.rpc("list_completed_staff_vote_comments", {
    p_period_type: type,
    p_period_start: start,
  });

  if (error) throw error;
  return data ?? [];
}

function isMissingDepartmentMemberOrderColumnError(error) {
  const text = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ].filter(Boolean).join(" ");

  return (
    /sort_order/i.test(text) &&
    /(column|schema cache|does not exist|could not find|42703|PGRST204)/i.test(text)
  );
}

export async function setDepartmentMemberOrder(departmentKey, userIds) {
  const key = String(departmentKey ?? "").trim();
  const ids = (Array.isArray(userIds) ? userIds : [])
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);

  if (!key) throw new Error("Не указан отдел.");
  if (!ids.length) throw new Error("Не указан порядок сотрудников.");

  const { error } = await supabase.rpc("set_department_member_order", {
    p_department_key: key,
    p_user_ids: ids,
  });

  if (error) throw error;
}

export async function saveMyTimesheetActual(year, month, actual, status = "draft") {
  const normalized = assertValidYearMonth(year, month);
  await requireUserId();

  const { error } = await supabase.rpc("save_my_timesheet_actual", {
    p_year: normalized.year,
    p_month: normalized.month,
    p_actual: actual ?? {},
    p_status: String(status || "draft"),
  });

  if (error) throw error;
}

export async function managedLoadTimesheet(userId, year, month) {
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

export async function managedListTimesheetsBefore(userIds, year, month) {
  const ids = [...new Set(
    (Array.isArray(userIds) ? userIds : [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean)
  )];

  if (!ids.length) return [];

  const normalized = assertValidYearMonth(year, month);

  const { data, error } = await supabase
    .from("timesheets")
    .select("user_id, year, month, payload")
    .in("user_id", ids)
    .or(`year.lt.${normalized.year},and(year.eq.${normalized.year},month.lt.${normalized.month})`)
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(5000);

  if (error) throw error;
  return data ?? [];
}

export async function managedSaveManyTimesheets(items) {
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

function isMissingNotificationReadAtColumnError(error) {
  const text = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ].filter(Boolean).join(" ");

  return (
    /read_at/i.test(text) &&
    /(column|schema cache|does not exist|could not find|42703|PGRST204)/i.test(text)
  );
}

export async function notifyDepartmentTimesheetSaved({ departmentKey, year, month } = {}) {
  const key = String(departmentKey ?? "").trim();
  const normalized = assertValidYearMonth(year, month);

  if (!key) throw new Error("Не указан отдел.");

  const { error } = await supabase.rpc("notify_department_timesheet_saved", {
    p_department_key: key,
    p_year: normalized.year,
    p_month: normalized.month,
  });

  if (error) throw error;
}

export async function notifyPersonalTimesheetChanges({
  departmentKey,
  year,
  month,
  changes = [],
} = {}) {
  const key = String(departmentKey ?? "").trim();
  const normalized = assertValidYearMonth(year, month);
  const normalizedChanges = (Array.isArray(changes) ? changes : [])
    .map((item) => ({
      user_id: String(item?.userId ?? "").trim(),
      summary: String(item?.summary ?? "").trim().slice(0, 900),
    }))
    .filter((item) => item.user_id);

  if (!key) throw new Error("Не указан отдел.");
  if (!normalizedChanges.length) return 0;

  const { data, error } = await supabase.rpc("notify_personal_timesheet_changes", {
    p_department_key: key,
    p_year: normalized.year,
    p_month: normalized.month,
    p_changes: normalizedChanges,
  });

  if (error) throw error;
  return Number(data) || 0;
}

export async function sendPushNotifications({
  departmentKey,
  type = "department_timesheet_saved",
  allUsers = false,
} = {}) {
  const key = String(departmentKey ?? "").trim();
  if (!key && !allUsers) throw new Error("Не указан отдел.");

  const { data, error } = await supabase.functions.invoke("send-push-notifications", {
    body: {
      departmentKey: key || null,
      type,
      allUsers: Boolean(allUsers),
    },
  });

  if (error) throw error;
  return data ?? null;
}

export async function sendDepartmentAnnouncement({
  departmentKey = null,
  title,
  body,
} = {}) {
  await requireUserId();

  const key = String(departmentKey ?? "").trim();
  const normalizedTitle = String(title ?? "").trim();
  const normalizedBody = String(body ?? "").trim();

  if (!normalizedTitle) throw new Error("Укажите заголовок объявления.");
  if (!normalizedBody) throw new Error("Напишите текст объявления.");

  const { data, error } = await supabase.rpc("send_department_announcement", {
    p_department_key: key || null,
    p_title: normalizedTitle,
    p_body: normalizedBody,
  });

  if (error) throw error;
  return data ?? { recipient_count: 0, is_global: !key };
}

export async function listMyNotifications() {
  await requireUserId();

  let { data, error } = await supabase
    .from("user_notifications")
    .select(NOTIFICATION_SELECT)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(20);

  if (error && isMissingNotificationReadAtColumnError(error)) {
    const fallback = await supabase
      .from("user_notifications")
      .select(NOTIFICATION_SELECT_LEGACY)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(20);

    data = fallback.data?.map((item) => ({ ...item, read_at: null }));
    error = fallback.error;
  }

  if (error) throw error;
  return data ?? [];
}

export async function markMyNotificationsRead(notificationIds = []) {
  await requireUserId();

  const ids = [...new Set(
    (Array.isArray(notificationIds) ? notificationIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id))
  )];

  if (!ids.length) return;

  const { error } = await supabase.rpc("mark_my_notifications_read", {
    p_notification_ids: ids,
  });

  if (error) throw error;
}

export async function deleteMyNotification(notificationId) {
  await requireUserId();

  const id = Number(notificationId);
  if (!Number.isFinite(id)) throw new Error("Некорректное уведомление.");

  const { error } = await supabase
    .from("user_notifications")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

export async function deleteAllMyNotifications() {
  const userId = await requireUserId();

  const { error } = await supabase
    .from("user_notifications")
    .delete()
    .eq("user_id", userId);

  if (error) throw error;
}

export async function submitEasterRunnerScore({ mode, score, passed } = {}) {
  await requireUserId();

  const { data, error } = await supabase.rpc("submit_easter_runner_score", {
    p_mode: String(mode ?? "").trim(),
    p_score: Number(score) || 0,
    p_passed: Number(passed) || 0,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

export async function listEasterRunnerLeaderboard(mode = "normal", limit = 5) {
  await requireUserId();

  const { data, error } = await supabase.rpc("list_easter_runner_leaderboard", {
    p_mode: String(mode ?? "").trim(),
    p_limit: Number(limit) || 5,
  });

  if (error) throw error;
  return data ?? [];
}

export async function upsertMyPushSubscription({
  endpoint,
  p256dh,
  auth,
  userAgent = "",
  platform = "",
} = {}) {
  await requireUserId();

  const { data, error } = await supabase.rpc("upsert_my_push_subscription", {
    p_endpoint: String(endpoint ?? "").trim(),
    p_p256dh: String(p256dh ?? "").trim(),
    p_auth: String(auth ?? "").trim(),
    p_user_agent: String(userAgent ?? "").trim(),
    p_platform: String(platform ?? "").trim(),
  });

  if (error) throw error;
  return data ?? null;
}

export async function disableMyPushSubscription(endpoint) {
  await requireUserId();

  const { error } = await supabase.rpc("disable_my_push_subscription", {
    p_endpoint: String(endpoint ?? "").trim(),
  });

  if (error) throw error;
}

export async function getMyDepartmentMembershipKey() {
  const userId = await requireUserId();

  const { data: memberRow, error: memberError } = await supabase
    .from("department_members")
    .select("department_key")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (memberError && !isNotFoundError(memberError)) throw memberError;
  return memberRow?.department_key ?? null;
}

export async function getMyDepartmentKey() {
  const memberDepartmentKey = await getMyDepartmentMembershipKey();
  if (memberDepartmentKey) return memberDepartmentKey;

  const userId = await requireUserId();

  const { data: editorRow, error: editorError } = await supabase
    .from("department_editors")
    .select("department_key")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (editorError && !isNotFoundError(editorError)) throw editorError;
  return editorRow?.department_key ?? null;
}

export async function getMyShiftChecklistState() {
  await requireUserId();

  const { data, error } = await supabase.rpc("get_my_shift_checklist_state");
  if (error) throw error;
  return data ?? { active: null, latest_completed: null };
}

export async function startMyShiftChecklist({ items, remindersEnabled = true } = {}) {
  await requireUserId();

  const { data, error } = await supabase.rpc("start_my_shift_checklist", {
    p_items: Array.isArray(items) ? items : [],
    p_reminders_enabled: remindersEnabled === true,
  });

  if (error) throw error;
  return data ?? null;
}

export async function updateMyShiftChecklist(checklistId, { items, remindersEnabled } = {}) {
  await requireUserId();
  const id = Number(checklistId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Некорректный чек-лист.");

  const { data, error } = await supabase.rpc("update_my_shift_checklist", {
    p_checklist_id: id,
    p_items: Array.isArray(items) ? items : [],
    p_reminders_enabled: remindersEnabled === true,
  });

  if (error) throw error;
  return data ?? null;
}

export async function finishMyShiftChecklist(checklistId) {
  await requireUserId();
  const id = Number(checklistId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Некорректный чек-лист.");

  const { data, error } = await supabase.rpc("finish_my_shift_checklist", {
    p_checklist_id: id,
  });

  if (error) throw error;
  return data ?? null;
}

export async function getMyChatDepartment() {
  return getMyDepartmentKey();
}

export async function listMyDepartmentMessages(limit = 100) {
  const departmentKey = await getMyChatDepartment();
  if (!departmentKey) return [];

  const { data, error } = await supabase
    .from("department_messages")
    .select("id, department_key, user_id, text, created_at, updated_at, deleted_at")
    .eq("department_key", departmentKey)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function sendDepartmentMessage(text) {
  const userId = await requireUserId();
  const departmentKey = await getMyChatDepartment();

  const messageText = String(text ?? "").trim();
  if (!departmentKey) throw new Error("Отдел для чата не найден.");
  if (!messageText) throw new Error("Сообщение пустое.");
  if (messageText.length > 2000) throw new Error("Сообщение слишком длинное.");

  const { data, error } = await supabase
    .from("department_messages")
    .insert({
      department_key: departmentKey,
      user_id: userId,
      text: messageText,
    })
    .select("id, department_key, user_id, text, created_at, updated_at, deleted_at")
    .single();

  if (error) throw error;
  return data;
}

export async function updateDepartmentMessage(messageId, text) {
  const userId = await requireUserId();
  const messageText = String(text ?? "").trim();

  if (!messageId) throw new Error("Не указан id сообщения.");
  if (!messageText) throw new Error("Сообщение пустое.");
  if (messageText.length > 2000) throw new Error("Сообщение слишком длинное.");

  const { data, error } = await supabase
    .from("department_messages")
    .update({
      text: messageText,
      updated_at: new Date().toISOString(),
    })
    .eq("id", messageId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id, department_key, user_id, text, created_at, updated_at, deleted_at")
    .single();

  if (error) throw error;
  return data;
}

export async function softDeleteDepartmentMessage(messageId) {
  const userId = await requireUserId();

  if (!messageId) throw new Error("Не указан id сообщения.");

  const { error } = await supabase
    .from("department_messages")
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", messageId)
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;
}

export function subscribeToMyDepartmentMessages(onChange) {
  let channel = null;

  return (async () => {
    const departmentKey = await getMyChatDepartment();
    if (!departmentKey) return () => {};

    channel = supabase
      .channel(`department-messages:${departmentKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "department_messages",
          filter: `department_key=eq.${departmentKey}`,
        },
        (payload) => {
          onChange?.(payload);
        }
      )
      .subscribe();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  })();
}

export async function listDepartmentShiftOverview({
  departmentKey = null,
  startDate = null,
  days = 2,
} = {}) {
  const key = String(departmentKey ?? "").trim();
  const date = String(startDate ?? "").trim();
  const normalizedDays = Number(days);

  const { data, error } = await supabase.rpc("list_department_shift_overview", {
    p_department_key: key || null,
    p_start_date: date || null,
    p_days: Number.isInteger(normalizedDays) ? normalizedDays : 2,
  });

  if (error) throw error;
  return data ?? [];
}

export async function createDepartmentTask({
  departmentKey,
  taskDate,
  dueAt,
  text,
  assignmentMode,
  userIds = [],
} = {}) {
  const key = String(departmentKey ?? "").trim();
  const date = String(taskDate ?? "").trim();
  const due = String(dueAt ?? "").trim();
  const taskText = String(text ?? "").trim();
  const mode = String(assignmentMode ?? "").trim();
  const recipients = [...new Set(
    (Array.isArray(userIds) ? userIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  )];

  if (!key) throw new Error("Не указан отдел.");
  if (!date) throw new Error("Не указана дата задачи.");
  if (!due) throw new Error("Не указан срок выполнения.");
  if (!taskText) throw new Error("Введите текст задачи.");

  const { data, error } = await supabase.rpc("create_department_task", {
    p_department_key: key,
    p_task_date: date,
    p_due_at: due,
    p_text: taskText,
    p_assignment_mode: mode,
    p_user_ids: recipients,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

export async function listMyDepartmentTasks({
  departmentKey = null,
  limit = 100,
} = {}) {
  const key = String(departmentKey ?? "").trim();
  const { data, error } = await supabase.rpc("list_my_department_tasks", {
    p_department_key: key || null,
    p_limit: Math.min(300, Math.max(1, Number(limit) || 100)),
  });

  if (error) throw error;
  return data ?? [];
}

export async function deleteDepartmentTask(taskId) {
  const id = Number(taskId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Некорректная задача.");

  const { error } = await supabase.rpc("delete_department_task", {
    p_task_id: id,
  });

  if (error) throw error;
}

export async function upsertMyPresence(pageName = "") {
  const userId = await requireUserId();
  const now = new Date().toISOString();
  const page = String(pageName ?? "").trim().slice(0, 80) || null;

  const { error } = await supabase
    .from("user_presence")
    .upsert(
      {
        user_id: userId,
        last_seen: now,
        page,
        updated_at: now,
      },
      { onConflict: "user_id" }
    );

  if (error) throw error;
}

export async function ownerListUsers() {
  const newest = await supabase.rpc("owner_list_users_v3");

  if (!newest.error) return newest.data ?? [];

  const newestErrorText = [
    newest.error?.message,
    newest.error?.details,
    newest.error?.hint,
    newest.error?.code,
  ].filter(Boolean).join(" ");

  if (!/owner_list_users_v3|PGRST202|schema cache|could not find/i.test(newestErrorText)) {
    throw newest.error;
  }

  const modern = await supabase.rpc("owner_list_users_v2");

  if (!modern.error) return modern.data ?? [];

  const modernErrorText = [
    modern.error?.message,
    modern.error?.details,
    modern.error?.hint,
    modern.error?.code,
  ].filter(Boolean).join(" ");

  if (!/owner_list_users_v2|PGRST202|schema cache|could not find/i.test(modernErrorText)) {
    throw modern.error;
  }

  const { data, error } = await supabase.rpc("owner_list_users");

  if (error) throw error;
  return data ?? [];
}

export async function ownerUpdateUserProfile({
  userId,
  displayName = null,
  position = null,
  gender = null,
  tabNumber = null,
  branch = null,
  employmentDate = null,
  weeklyHours = null,
  oklad = null,
} = {}) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("Не указан пользователь.");

  const weekly = normalizeWeeklyHours(weeklyHours);
  const next = await supabase.rpc("owner_update_user_profile_v2", {
    p_user_id: uid,
    p_display_name: displayName || null,
    p_position: position || null,
    p_gender: gender || null,
    p_tab_number: tabNumber || null,
    p_branch: branch || null,
    p_employment_date: employmentDate || null,
    p_weekly_hours: weekly,
    p_oklad: oklad === "" || oklad == null ? null : Number(oklad),
  });

  if (!next.error) return;

  const nextErrorText = [
    next.error?.message,
    next.error?.details,
    next.error?.hint,
    next.error?.code,
  ].filter(Boolean).join(" ");

  if (!/owner_update_user_profile_v2|PGRST202|schema cache|could not find/i.test(nextErrorText)) {
    throw next.error;
  }

  if (weekly === 35) {
    throw new Error("В базе пока нет поля нормы недели. Запусти supabase-sql/021_weekly_hours.sql в Supabase SQL Editor.");
  }

  const { error } = await supabase.rpc("owner_update_user_profile", {
    p_user_id: uid,
    p_display_name: displayName || null,
    p_position: position || null,
    p_gender: gender || null,
    p_tab_number: tabNumber || null,
    p_branch: branch || null,
    p_employment_date: employmentDate || null,
    p_oklad: oklad === "" || oklad == null ? null : Number(oklad),
  });

  if (error) throw error;
}

export async function ownerListUserTimesheets(userId, limit = 36) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("Не указан пользователь.");

  const { data, error } = await supabase.rpc("owner_list_user_timesheets", {
    p_user_id: uid,
    p_limit: Math.min(120, Math.max(1, Number(limit) || 36)),
  });

  if (error) throw error;
  return data ?? [];
}

export async function ownerListUserAudit(userId = null, limit = 100) {
  const uid = String(userId ?? "").trim();
  const { data, error } = await supabase.rpc("owner_list_user_audit", {
    p_user_id: uid || null,
    p_limit: Math.min(500, Math.max(1, Number(limit) || 100)),
  });

  if (error) throw error;
  return data ?? [];
}

export async function ownerRunAccountAction({
  action,
  userId,
  redirectTo = "",
} = {}) {
  const normalizedAction = String(action ?? "").trim();
  const uid = String(userId ?? "").trim();
  if (!normalizedAction) throw new Error("Не указано действие.");
  if (!uid) throw new Error("Не указан пользователь.");

  const { data, error } = await supabase.functions.invoke("owner-account-admin", {
    body: {
      action: normalizedAction,
      userId: uid,
      redirectTo: String(redirectTo ?? "").trim(),
    },
  });

  if (error) {
    let serverMessage = "";
    try {
      const response = typeof error?.context?.clone === "function"
        ? error.context.clone()
        : error?.context;
      const payload = await response?.json?.();
      serverMessage = String(payload?.error || "").trim();
    } catch {
      serverMessage = "";
    }
    throw new Error(serverMessage || error.message || "Не удалось выполнить действие с аккаунтом.");
  }

  if (data?.error) throw new Error(String(data.error));
  return data ? attachWeeklyHours(data, userId) : null;
}

export async function ownerListPayrollAnalytics({ year = null, departmentKey = null } = {}) {
  const y = Number(year);
  const normalizedYear = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : null;
  const key = String(departmentKey ?? "").trim();

  const { data, error } = await supabase.rpc("owner_list_payroll_analytics", {
    p_year: normalizedYear,
    p_department_key: key || null,
  });

  if (error) throw error;
  return data ?? [];
}

export async function ownerSetUserDepartment(userId, departmentKey = null) {
  const uid = String(userId ?? "").trim();
  const key = String(departmentKey ?? "").trim();

  if (!uid) throw new Error("Не указан сотрудник.");

  const { error } = await supabase.rpc("owner_set_user_department", {
    p_user_id: uid,
    p_department_key: key || null,
  });

  if (error) throw error;
}

export async function ownerSetDepartmentEditor(departmentKey, userId, isEditor) {
  const key = String(departmentKey ?? "").trim();
  const uid = String(userId ?? "").trim();

  if (!key) throw new Error("Не указан отдел.");
  if (!uid) throw new Error("Не указан сотрудник.");

  const { error } = await supabase.rpc("owner_set_department_editor", {
    p_department_key: key,
    p_user_id: uid,
    p_is_editor: Boolean(isEditor),
  });

  if (error) throw error;
}

export async function ownerCreateDepartmentInvite({
  departmentKey,
  expiresInDays = 14,
  maxUses = null,
} = {}) {
  const key = String(departmentKey ?? "").trim();
  const days = Number(expiresInDays);
  const uses = Number(maxUses);

  if (!key) throw new Error("Не указан отдел.");

  const { data, error } = await supabase.rpc("owner_create_department_invite", {
    p_department_key: key,
    p_expires_in_days: Number.isInteger(days) ? days : 14,
    p_max_uses: Number.isInteger(uses) && uses > 0 ? uses : null,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

export async function ownerListDepartmentInvites() {
  const { data, error } = await supabase.rpc("owner_list_department_invites");

  if (error) throw error;
  return data ?? [];
}

export async function ownerRevokeDepartmentInvite(token) {
  const value = String(token ?? "").trim();
  if (!value) throw new Error("Не указан токен приглашения.");

  const { error } = await supabase.rpc("owner_revoke_department_invite", {
    p_token: value,
  });

  if (error) throw error;
}

export async function ownerDeleteDepartmentInvite(token) {
  const value = String(token ?? "").trim();
  if (!value) throw new Error("Не указан токен приглашения.");

  const { error } = await supabase.rpc("owner_delete_department_invite", {
    p_token: value,
  });

  if (error) throw error;
}

export async function acceptDepartmentInvite(token) {
  const value = String(token ?? "").trim();
  if (!value) throw new Error("Не указан токен приглашения.");

  const { data, error } = await supabase.rpc("accept_department_invite", {
    p_token: value,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

export async function ownerListDepartmentMembers(departmentKey) {
  const key = String(departmentKey ?? "").trim();
  if (!key) throw new Error("Не указан отдел.");

  const { data, error } = await supabase.rpc("owner_list_department_members", {
    p_department_key: key,
  });

  if (error) throw error;
  return data ?? [];
}

export async function ownerListAvailableProfiles(departmentKey) {
  const key = String(departmentKey ?? "").trim();
  if (!key) throw new Error("Не указан отдел.");

  const { data, error } = await supabase.rpc("owner_list_available_profiles", {
    p_department_key: key,
  });

  if (error) throw error;
  return data ?? [];
}

export async function ownerAddDepartmentMember(departmentKey, userId) {
  const key = String(departmentKey ?? "").trim();
  const uid = String(userId ?? "").trim();

  if (!key) throw new Error("Не указан отдел.");
  if (!uid) throw new Error("Не указан сотрудник.");

  const { error } = await supabase.rpc("owner_add_department_member", {
    p_department_key: key,
    p_user_id: uid,
  });

  if (error) throw error;
}

export async function ownerRemoveDepartmentMember(departmentKey, userId) {
  const key = String(departmentKey ?? "").trim();
  const uid = String(userId ?? "").trim();

  if (!key) throw new Error("Не указан отдел.");
  if (!uid) throw new Error("Не указан сотрудник.");

  const { error } = await supabase.rpc("owner_remove_department_member", {
    p_department_key: key,
    p_user_id: uid,
  });

  if (error) throw error;
}

export async function ownerListDepartmentEditors(departmentKey) {
  const key = String(departmentKey ?? "").trim();
  if (!key) throw new Error("Не указан отдел.");

  const { data, error } = await supabase.rpc("owner_list_department_editors", {
    p_department_key: key,
  });

  if (error) throw error;
  return data ?? [];
}

export async function ownerAddDepartmentEditor(departmentKey, userId) {
  const key = String(departmentKey ?? "").trim();
  const uid = String(userId ?? "").trim();

  if (!key) throw new Error("Не указан отдел.");
  if (!uid) throw new Error("Не указан сотрудник.");

  const { error } = await supabase.rpc("owner_add_department_editor", {
    p_department_key: key,
    p_user_id: uid,
  });

  if (error) throw error;
}

export async function ownerRemoveDepartmentEditor(departmentKey, userId) {
  const key = String(departmentKey ?? "").trim();
  const uid = String(userId ?? "").trim();

  if (!key) throw new Error("Не указан отдел.");
  if (!uid) throw new Error("Не указан сотрудник.");

  const { error } = await supabase.rpc("owner_remove_department_editor", {
    p_department_key: key,
    p_user_id: uid,
  });

  if (error) throw error;
}
