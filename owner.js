import { requireSession, signOut } from "./auth.js";
import {
  getMyProfile,
  listAllDepartments,
  ownerListDepartmentMembers,
  ownerListAvailableProfiles,
  ownerAddDepartmentMember,
  ownerRemoveDepartmentMember,
  ownerListDepartmentEditors,
  ownerAddDepartmentEditor,
  ownerRemoveDepartmentEditor,
} from "./db.js";
import { startPresenceHeartbeat } from "./presence.js";


document.body.classList.add("is-loaded");

const logoutBtn = document.getElementById("logoutBtn");
const statusPill = document.getElementById("statusPill");
const errorBox = document.getElementById("errorBox");
const departmentsGrid = document.getElementById("departmentsGrid");
const departmentsCount = document.getElementById("departmentsCount");

const departmentManagerSection = document.getElementById("departmentManagerSection");
const departmentManagerTitle = document.getElementById("departmentManagerTitle");
const departmentManagerMeta = document.getElementById("departmentManagerMeta");
const departmentOpenTimesheetLink = document.getElementById("departmentOpenTimesheetLink");
const refreshDepartmentBtn = document.getElementById("refreshDepartmentBtn");
const departmentMembersCount = document.getElementById("departmentMembersCount");
const departmentMembersList = document.getElementById("departmentMembersList");
const availableUsersSelect = document.getElementById("availableUsersSelect");
const availableUsersCount = document.getElementById("availableUsersCount");
const addMemberBtn = document.getElementById("addMemberBtn");

const departmentEditorsCount = document.getElementById("departmentEditorsCount");
const departmentEditorsList = document.getElementById("departmentEditorsList");
const editorUsersSelect = document.getElementById("editorUsersSelect");
const editorUsersCount = document.getElementById("editorUsersCount");
const addEditorBtn = document.getElementById("addEditorBtn");

let selectedDepartment = null;
let isDepartmentBusy = false;

function setStatus(text, tone = "neutral") {
  if (!statusPill) return;

  statusPill.textContent = text;
  statusPill.classList.remove(
    "text-slate-300", "bg-white/5",
    "text-emerald-200", "bg-emerald-500/10",
    "text-rose-200", "bg-rose-500/10",
    "text-sky-200", "bg-sky-500/10"
  );

  if (tone === "ok") statusPill.classList.add("text-emerald-200", "bg-emerald-500/10");
  else if (tone === "err") statusPill.classList.add("text-rose-200", "bg-rose-500/10");
  else if (tone === "busy") statusPill.classList.add("text-sky-200", "bg-sky-500/10");
  else statusPill.classList.add("text-slate-300", "bg-white/5");
}

function setError(msg) {
  if (!errorBox) return;

  if (!msg) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    return;
  }

  errorBox.classList.remove("hidden");
  errorBox.textContent = msg;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildPersonLabel(row) {
  const displayName = String(row?.display_name ?? "").trim();
  const position = String(row?.position ?? row?.position_name ?? "").trim();
  const tabNumber = String(row?.tab_number ?? "").trim();

  const main = displayName || position || "Сотрудник";
  const metaParts = [];
  if (position && position !== main) metaParts.push(position);
  if (tabNumber) metaParts.push(`Таб. № ${tabNumber}`);

  return {
    main,
    meta: metaParts.join(" • "),
  };
}

function renderDepartments(departments) {
  if (!departmentsGrid) return;

  departmentsGrid.innerHTML = "";

  if (!departments.length) {
    const empty = document.createElement("div");
    empty.className = "rounded-3xl bg-slate-950/25 p-4 ring-1 ring-white/10 text-sm text-slate-300/90";
    empty.textContent = "Отделы не найдены.";
    departmentsGrid.appendChild(empty);
    if (departmentsCount) departmentsCount.textContent = "0 отделов";
    return;
  }

  if (departmentsCount) {
    departmentsCount.textContent = `${departments.length} отделов`;
  }

  for (const department of departments) {
    const card = document.createElement("article");
    card.className = "glass-card rounded-3xl p-5 ring-1 ring-white/10";

    const title = document.createElement("div");
    title.className = "text-lg font-semibold text-slate-100";
    title.textContent = department.name || department.key;

    const key = document.createElement("div");
    key.className = "mt-1 text-xs text-slate-400";
    key.textContent = `Ключ: ${department.key}`;

    const actions = document.createElement("div");
    actions.className = "mt-4 flex flex-wrap gap-2";

    const openBtn = document.createElement("a");
    openBtn.href = `admin.html?department=${encodeURIComponent(department.key)}`;
    openBtn.className =
      "rounded-2xl bg-indigo-500/15 px-4 py-2.5 text-sm font-semibold text-indigo-200 ring-1 ring-indigo-400/30 transition-all hover:bg-indigo-500/20 hover:ring-indigo-300/50";
    openBtn.textContent = "Открыть табель";

    const manageBtn = document.createElement("button");
    manageBtn.type = "button";
    manageBtn.className =
      "rounded-2xl bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 ring-1 ring-white/15 transition-all hover:bg-white/10";
    manageBtn.textContent = "Управлять составом";
    manageBtn.addEventListener("click", async () => {
      await openDepartmentManager(department);
    });

    actions.append(openBtn, manageBtn);
    card.append(title, key, actions);
    departmentsGrid.appendChild(card);
  }
}

function renderDepartmentMembers(rows) {
  if (!departmentMembersList) return;

  departmentMembersList.innerHTML = "";

  const list = Array.isArray(rows) ? rows : [];
  if (departmentMembersCount) {
    departmentMembersCount.textContent = `${list.length} сотрудников`;
  }

  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "rounded-2xl bg-slate-950/30 p-4 text-sm text-slate-300 ring-1 ring-white/10";
    empty.textContent = "В этом отделе пока нет сотрудников.";
    departmentMembersList.appendChild(empty);
    return;
  }

  for (const row of list) {
    const item = document.createElement("div");
    item.className = "rounded-2xl bg-slate-950/30 p-4 ring-1 ring-white/10";

    const label = buildPersonLabel(row);

    const top = document.createElement("div");
    top.className = "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between";

    const left = document.createElement("div");
    left.className = "min-w-0";

    const main = document.createElement("div");
    main.className = "truncate text-sm font-semibold text-slate-100";
    main.textContent = label.main;

    const meta = document.createElement("div");
    meta.className = "mt-1 text-xs text-slate-400";
    meta.textContent = label.meta || `ID: ${row.user_id}`;

    left.append(main, meta);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className =
      "rounded-2xl bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-200 ring-1 ring-rose-500/20 transition-all hover:bg-rose-500/15";
    removeBtn.textContent = "Убрать из отдела";
    removeBtn.addEventListener("click", async () => {
      if (!selectedDepartment?.key) return;

      const ok = confirm(`Убрать "${label.main}" из отдела "${selectedDepartment.name || selectedDepartment.key}"?`);
      if (!ok) return;

      try {
        setStatus("Убираю сотрудника…", "busy");
        setError(null);
        await ownerRemoveDepartmentMember(selectedDepartment.key, row.user_id);
        await loadDepartmentManagement(selectedDepartment);
        setStatus("Сотрудник убран из отдела", "ok");
      } catch (e) {
        setStatus("Ошибка удаления", "err");
        setError(e?.message || "Не удалось убрать сотрудника из отдела.");
      }
    });

    top.append(left, removeBtn);
    item.appendChild(top);
    departmentMembersList.appendChild(item);
  }
}

function renderAvailableProfiles(rows) {
  if (!availableUsersSelect) return;

  const list = Array.isArray(rows) ? rows : [];
  availableUsersSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = list.length
    ? "Выберите сотрудника"
    : "Нет свободных сотрудников";
  availableUsersSelect.appendChild(placeholder);

  for (const row of list) {
    const label = buildPersonLabel(row);
    const opt = document.createElement("option");
    opt.value = row.user_id;
    opt.textContent = label.meta ? `${label.main} — ${label.meta}` : label.main;
    availableUsersSelect.appendChild(opt);
  }

  availableUsersSelect.disabled = !list.length;
  if (addMemberBtn) addMemberBtn.disabled = !list.length;

  if (availableUsersCount) {
    availableUsersCount.textContent = `${list.length} свободных сотрудников`;
  }
}

function renderEditorCandidates(rows, editorUserIds) {
  if (!editorUsersSelect) return;

  const taken = new Set(Array.isArray(editorUserIds) ? editorUserIds : []);
  const list = (Array.isArray(rows) ? rows : []).filter((row) => !taken.has(row.user_id));

  editorUsersSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = list.length
    ? "Выберите сотрудника"
    : "Некого назначать";
  editorUsersSelect.appendChild(placeholder);

  for (const row of list) {
    const label = buildPersonLabel(row);
    const opt = document.createElement("option");
    opt.value = row.user_id;
    opt.textContent = label.meta ? `${label.main} — ${label.meta}` : label.main;
    editorUsersSelect.appendChild(opt);
  }

  editorUsersSelect.disabled = !list.length;
  if (addEditorBtn) addEditorBtn.disabled = !list.length;

  if (editorUsersCount) {
    editorUsersCount.textContent = `${list.length} кандидатов`;
  }
}

function renderDepartmentEditors(rows) {
  if (!departmentEditorsList) return;

  departmentEditorsList.innerHTML = "";

  const list = Array.isArray(rows) ? rows : [];
  if (departmentEditorsCount) {
    departmentEditorsCount.textContent = `${list.length} редакторов`;
  }

  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "rounded-2xl bg-slate-950/30 p-4 text-sm text-slate-300 ring-1 ring-white/10";
    empty.textContent = "Редакторы ещё не назначены.";
    departmentEditorsList.appendChild(empty);
    return;
  }

  for (const row of list) {
    const item = document.createElement("div");
    item.className = "rounded-2xl bg-slate-950/30 p-4 ring-1 ring-white/10";

    const label = buildPersonLabel(row);

    const top = document.createElement("div");
    top.className = "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between";

    const left = document.createElement("div");
    left.className = "min-w-0";

    const main = document.createElement("div");
    main.className = "truncate text-sm font-semibold text-slate-100";
    main.textContent = label.main;

    const meta = document.createElement("div");
    meta.className = "mt-1 text-xs text-slate-400";
    meta.textContent = label.meta || `ID: ${row.user_id}`;

    left.append(main, meta);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className =
      "rounded-2xl bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-200 ring-1 ring-amber-500/20 transition-all hover:bg-amber-500/15";
    removeBtn.textContent = "Снять права";
    removeBtn.addEventListener("click", async () => {
      if (!selectedDepartment?.key) return;

      const ok = confirm(`Снять права редактора у "${label.main}"?`);
      if (!ok) return;

      try {
        setStatus("Снимаю права…", "busy");
        setError(null);
        await ownerRemoveDepartmentEditor(selectedDepartment.key, row.user_id);
        await loadDepartmentManagement(selectedDepartment);
        setStatus("Права редактора сняты", "ok");
      } catch (e) {
        setStatus("Ошибка", "err");
        setError(e?.message || "Не удалось снять права редактора.");
      }
    });

    top.append(left, removeBtn);
    item.appendChild(top);
    departmentEditorsList.appendChild(item);
  }
}


async function loadDepartmentManagement(department) {
  if (!department?.key) return;
  if (isDepartmentBusy) return;

  isDepartmentBusy = true;

  try {
    setStatus("Загружаю состав отдела…", "busy");
    setError(null);

    const [members, available, editors] = await Promise.all([
      ownerListDepartmentMembers(department.key),
      ownerListAvailableProfiles(department.key),
      ownerListDepartmentEditors(department.key),
    ]);

    selectedDepartment = department;

    if (departmentManagerSection) {
      departmentManagerSection.classList.remove("hidden");
    }

    if (departmentManagerTitle) {
      departmentManagerTitle.textContent = `Управление отделом: ${department.name || department.key}`;
    }

    if (departmentManagerMeta) {
      departmentManagerMeta.textContent = `Ключ отдела: ${department.key}`;
    }

    if (departmentOpenTimesheetLink) {
      departmentOpenTimesheetLink.href = `admin.html?department=${encodeURIComponent(department.key)}`;
    }

    renderDepartmentMembers(members);
    renderAvailableProfiles(available);
    renderDepartmentEditors(editors);

    const editorUserIds = editors.map((row) => row.user_id);
    const editorCandidates = [...members, ...available];
    renderEditorCandidates(editorCandidates, editorUserIds);

    setStatus("Состав отдела загружен", "ok");
  } finally {
    isDepartmentBusy = false;
  }
}

async function openDepartmentManager(department) {
  await loadDepartmentManagement(department);

  departmentManagerSection?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

logoutBtn?.addEventListener("click", async () => {
  try {
    await signOut();
  } finally {
    location.href = "login.html?next=owner.html";
  }
});

refreshDepartmentBtn?.addEventListener("click", async () => {
  if (!selectedDepartment?.key) return;

  try {
    await loadDepartmentManagement(selectedDepartment);
  } catch (e) {
    setStatus("Ошибка обновления", "err");
    setError(e?.message || "Не удалось обновить состав отдела.");
  }
});

addMemberBtn?.addEventListener("click", async () => {
  if (!selectedDepartment?.key) return;

  const userId = String(availableUsersSelect?.value || "").trim();
  if (!userId) {
    setError("Сначала выберите сотрудника.");
    return;
  }

  const optionText =
    availableUsersSelect?.selectedOptions?.[0]?.textContent?.trim() || "Сотрудник";

  try {
    setStatus("Добавляю сотрудника…", "busy");
    setError(null);

    await ownerAddDepartmentMember(selectedDepartment.key, userId);
    await loadDepartmentManagement(selectedDepartment);

    setStatus("Сотрудник добавлен в отдел", "ok");
    setError(null);
  } catch (e) {
    setStatus("Ошибка добавления", "err");
    setError(e?.message || `Не удалось добавить "${optionText}" в отдел.`);
  }
});

addEditorBtn?.addEventListener("click", async () => {
  if (!selectedDepartment?.key) return;

  const userId = String(editorUsersSelect?.value || "").trim();
  if (!userId) {
    setError("Сначала выберите сотрудника для назначения.");
    return;
  }

  try {
    setStatus("Назначаю редактора…", "busy");
    setError(null);

    await ownerAddDepartmentEditor(selectedDepartment.key, userId);
    await loadDepartmentManagement(selectedDepartment);

    setStatus("Редактор назначен", "ok");
  } catch (e) {
    setStatus("Ошибка", "err");
    setError(e?.message || "Не удалось назначить редактора.");
  }
});

(async () => {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=owner.html";
    return;
  }

  try {
    setStatus("Проверяю доступ…", "busy");
    setError(null);

    const profile = await getMyProfile();
    if (profile?.role !== "owner") {
      setStatus("Доступ запрещён", "err");
      setError("Эта страница доступна только овнеру.");
      return;
    }

    startPresenceHeartbeat("Owner: отделы");

    setStatus("Загружаю отделы…", "busy");
    const departments = await listAllDepartments();
    renderDepartments(departments);

    setStatus("Готово", "ok");
  } catch (e) {
    setStatus("Ошибка загрузки", "err");
    setError(e?.message || "Не удалось загрузить список отделов.");
  }
})();
