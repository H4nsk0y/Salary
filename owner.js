import { requireSession, signOut } from "./auth.js";
import { getMyProfile, listAllDepartments } from "./db.js";

document.body.classList.add("is-loaded");

const logoutBtn = document.getElementById("logoutBtn");
const statusPill = document.getElementById("statusPill");
const errorBox = document.getElementById("errorBox");
const departmentsGrid = document.getElementById("departmentsGrid");
const departmentsCount = document.getElementById("departmentsCount");

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

function renderDepartments(departments) {
  if (!departmentsGrid) return;

  departmentsGrid.innerHTML = "";

  if (!departments.length) {
    const empty = document.createElement("div");
    empty.className = "rounded-3xl bg-slate-950/25 p-4 ring-1 ring-white/10 text-sm text-slate-300/90";
    empty.textContent = "Отделы не найдены.";
    departmentsGrid.appendChild(empty);
    departmentsCount.textContent = "0 отделов";
    return;
  }

  departmentsCount.textContent = `${departments.length} отделов`;

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

    actions.appendChild(openBtn);
    card.append(title, key, actions);
    departmentsGrid.appendChild(card);
  }
}

logoutBtn?.addEventListener("click", async () => {
  try {
    await signOut();
  } finally {
    location.href = "login.html?next=owner.html";
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

    setStatus("Загружаю отделы…", "busy");
    const departments = await listAllDepartments();
    renderDepartments(departments);

    setStatus("Готово", "ok");
  } catch (e) {
    setStatus("Ошибка загрузки", "err");
    setError(e?.message || "Не удалось загрузить список отделов.");
  }
})();