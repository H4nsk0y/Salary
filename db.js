import { supabase } from "./supabaseClient.js";

const PROFILE_SELECT =
  "role, oklad, gender, position, display_name, avatar_url, hide_money, money_pin_hash, money_pin_salt, auto_collapse_table_panels, tab_number, branch, employment_date";

const PROFILE_SELECT_WITH_BRANCH =
  "role, oklad, gender, position, display_name, avatar_url, hide_money, money_pin_hash, money_pin_salt, auto_collapse_table_panels, tab_number, branch";

const PROFILE_SELECT_LEGACY =
  "role, oklad, gender, position, display_name, avatar_url, hide_money, money_pin_hash, money_pin_salt, auto_collapse_table_panels, tab_number";

const ADMIN_PROFILE_SELECT =
  "user_id, role, oklad, gender, position, display_name, avatar_url, hide_money, created_at, tab_number, branch, employment_date";

const ADMIN_PROFILE_SELECT_WITHOUT_EMPLOYMENT =
  "user_id, role, oklad, gender, position, display_name, avatar_url, hide_money, created_at, tab_number, branch";

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

    if (isMissingEmploymentDateColumnError(error)) {
      const { data: withBranchData, error: withBranchError } = await supabase
        .from("profiles")
        .select(PROFILE_SELECT_WITH_BRANCH)
        .eq("user_id", userId)
        .maybeSingle();

      if (!withBranchError) {
        return withBranchData ? { ...withBranchData, employment_date: null } : null;
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

      return legacyData ? { ...legacyData, branch: null, employment_date: null } : null;
    }

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
  tabNumber,
  branch,
  employmentDate,
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

    throw error;
  }
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

  const { data: memberRows, error: membersError } = await supabase
    .from("department_members")
    .select("user_id")
    .eq("department_key", key)
    .order("created_at", { ascending: true });

  if (membersError) throw membersError;

  const userIds = (memberRows ?? [])
    .map((row) => String(row.user_id || "").trim())
    .filter(Boolean);

  if (!userIds.length) return [];

  let { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select(ADMIN_PROFILE_SELECT)
    .in("user_id", userIds);

  if (profilesError && isMissingEmploymentDateColumnError(profilesError)) {
    const fallback = await supabase
      .from("profiles")
      .select(ADMIN_PROFILE_SELECT_WITHOUT_EMPLOYMENT)
      .in("user_id", userIds);

    profiles = fallback.data;
    profilesError = fallback.error;
  }

  if (profilesError) throw profilesError;

  const profileMap = new Map((profiles ?? []).map((row) => [row.user_id, row]));

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
      branch: profile?.branch ?? null,
      position: profile?.position ?? "",
      tab_number: profile?.tab_number ?? "",
      employment_date: profile?.employment_date ?? null,
      avatar_url: profile?.avatar_url ?? null,
      hide_money: profile?.hide_money ?? false,
      created_at: profile?.created_at ?? null,
    };
  });
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

export async function listMyNotifications() {
  await requireUserId();

  const { data, error } = await supabase
    .from("user_notifications")
    .select("id, type, title, body, url, created_at, expires_at, department_key")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;
  return data ?? [];
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

export async function getMyChatDepartment() {
  const userId = await requireUserId();

  const { data: memberRow, error: memberError } = await supabase
    .from("department_members")
    .select("department_key")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (memberError && !isNotFoundError(memberError)) throw memberError;
  if (memberRow?.department_key) {
    return memberRow.department_key;
  }

  const { data: editorRow, error: editorError } = await supabase
    .from("department_editors")
    .select("department_key")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (editorError && !isNotFoundError(editorError)) throw editorError;
  return editorRow?.department_key ?? null;
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
  const { data, error } = await supabase.rpc("owner_list_users");

  if (error) throw error;
  return data ?? [];
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
