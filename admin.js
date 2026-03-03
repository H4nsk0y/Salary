import { requireSession, signOut } from "./auth.js";
import { getMyProfile, adminListProfiles, adminListTimesheets } from "./db.js";

document.body.classList.add("is-loaded");

const errorBox = document.getElementById("errorBox");
const logoutBtn = document.getElementById("logoutBtn");

const profilesTbody = document.getElementById("profilesTbody");
const timesheetsTbody = document.getElementById("timesheetsTbody");

const reloadProfiles = document.getElementById("reloadProfiles");
const reloadTimesheets = document.getElementById("reloadTimesheets");

function setError(msg) {
  if (!msg) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    errorBox.classList.remove("shake");
    return;
  }
  errorBox.classList.remove("hidden");
  errorBox.textContent = msg;
  errorBox.classList.remove("shake");
  // eslint-disable-next-line no-unused-expressions
  errorBox.offsetWidth;
  errorBox.classList.add("shake");
}

function td(text) {
  const el = document.createElement("td");
  el.className = "px-4 py-3 text-slate-200/90";
  el.textContent = text;
  return el;
}

function shortId(id) {
  const s = String(id ?? "");
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function fmtTs(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString("ru-RU"); } catch { return String(ts); }
}

async function guardAdmin() {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=admin.html";
    return false;
  }

  const profile = await getMyProfile();
  if (!profile || profile.role !== "admin") {
    setError("Доступ запрещён. Нужна роль admin.");
    return false;
  }

  return true;
}

async function loadProfiles() {
  profilesTbody.innerHTML = "";
  const rows = await adminListProfiles(200);
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.appendChild(td(shortId(r.user_id)));
    tr.appendChild(td(r.role ?? "user"));
    tr.appendChild(td(r.oklad == null ? "—" : String(r.oklad)));
    profilesTbody.appendChild(tr);
  }
}

async function loadTimesheets() {
  timesheetsTbody.innerHTML = "";
  const rows = await adminListTimesheets(200);
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.appendChild(td(shortId(r.user_id)));
    tr.appendChild(td(String(r.year)));
    tr.appendChild(td(String(r.month)));
    tr.appendChild(td(fmtTs(r.updated_at)));
    timesheetsTbody.appendChild(tr);
  }
}

logoutBtn.addEventListener("click", async () => {
  try { await signOut(); } finally { location.href = "login.html"; }
});

reloadProfiles.addEventListener("click", async () => {
  try { setError(null); await loadProfiles(); }
  catch (e) { setError(e?.message || "Ошибка загрузки пользователей."); }
});

reloadTimesheets.addEventListener("click", async () => {
  try { setError(null); await loadTimesheets(); }
  catch (e) { setError(e?.message || "Ошибка загрузки табелей."); }
});

(async () => {
  try {
    setError(null);
    const ok = await guardAdmin();
    if (!ok) return;
    await loadProfiles();
    await loadTimesheets();
  } catch (e) {
    setError(e?.message || "Ошибка админки.");
  }
})();