// /profile.js
import { supabase } from "./supabaseClient.js";
import { requireSession, signOut } from "./auth.js";
import { getMyProfile, updateMyProfile, listMyTimesheets } from "./db.js";
import { parseNumber } from "./calc.js";

const logoutBtn = document.getElementById("logoutBtn");
const errorBox = document.getElementById("errorBox");
const infoBox = document.getElementById("infoBox");

const avatarImg = document.getElementById("avatarImg");
const avatarFallback = document.getElementById("avatarFallback");
const avatarFile = document.getElementById("avatarFile");
const uploadBtn = document.getElementById("uploadBtn");
const removeBtn = document.getElementById("removeBtn");

const roleBadge = document.getElementById("roleBadge");

const form = document.getElementById("profileForm");
const saveBtn = document.getElementById("saveBtn");
const statusLine = document.getElementById("statusLine");

const displayNameEl = document.getElementById("displayName");
const okladEl = document.getElementById("oklad");
const emailEl = document.getElementById("email");

// NEW: history
const historyBox = document.getElementById("timesheetHistory");

let userId = null;
let currentAvatarUrl = null;
let currentAvatarPath = null;

const monthNames = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

function setError(msg) {
  if (!msg) { errorBox.classList.add("hidden"); errorBox.textContent = ""; return; }
  errorBox.classList.remove("hidden"); errorBox.textContent = msg;
}
function setInfo(msg) {
  if (!msg) { infoBox.classList.add("hidden"); infoBox.textContent = ""; return; }
  infoBox.classList.remove("hidden"); infoBox.textContent = msg;
}
function setStatus(msg) { statusLine.textContent = msg || "—"; }

function showAvatar(url) {
  currentAvatarUrl = url || null;
  if (url) {
    avatarImg.src = url;
    avatarImg.classList.remove("hidden");
    avatarFallback.classList.add("hidden");
  } else {
    avatarImg.classList.add("hidden");
    avatarFallback.classList.remove("hidden");
  }
}

function getInitials(name, email) {
  const base = (name || "").trim();
  if (base) return base.slice(0, 1).toUpperCase();
  const e = (email || "").trim();
  return e ? e.slice(0, 1).toUpperCase() : "A";
}
function setFallbackLetter(letter) { avatarFallback.textContent = letter || "A"; }

function guessExt(file) {
  const type = (file.type || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  return "png";
}

async function getSessionUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

async function uploadAvatar(file) {
  if (!userId) throw new Error("NO_USER");
  const ext = guessExt(file);
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
    cacheControl: "3600",
    upsert: true,
    contentType: file.type || undefined,
  });
  if (upErr) throw upErr;

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  const publicUrl = data?.publicUrl;
  if (!publicUrl) throw new Error("NO_PUBLIC_URL");

  currentAvatarPath = path;
  return publicUrl;
}

async function removeAvatar() {
  const tryPaths = [];
  if (currentAvatarPath) tryPaths.push(currentAvatarPath);

  if (currentAvatarUrl) {
    const m = currentAvatarUrl.match(/avatars\/([^?]+)/i);
    if (m?.[1]) tryPaths.push(m[1]);
  }

  const uniq = Array.from(new Set(tryPaths)).filter(Boolean);
  if (uniq.length) await supabase.storage.from("avatars").remove(uniq);

  await updateMyProfile({ avatarUrl: null });
  currentAvatarUrl = null;
  currentAvatarPath = null;
  showAvatar(null);
}

function renderHistory(items) {
  if (!historyBox) return;

  if (!items.length) {
    historyBox.innerHTML = `<div class="text-sm text-slate-300/80">Пока нет сохранённых табелей.</div>`;
    return;
  }

  historyBox.innerHTML = `
    <div class="overflow-x-auto rounded-2xl ring-1 ring-white/10">
      <table class="w-full text-left text-sm">
        <thead class="bg-white/5 text-slate-300">
          <tr>
            <th class="px-4 py-3">Период</th>
            <th class="px-4 py-3">Обновлён</th>
            <th class="px-4 py-3 text-right">Действия</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-white/10" id="historyTbody"></tbody>
      </table>
    </div>
  `;

  const tbody = document.getElementById("historyTbody");
  for (const row of items) {
    const tr = document.createElement("tr");
    const period = `${monthNames[row.month]} ${row.year}`;
    const updated = row.updated_at ? new Date(row.updated_at).toLocaleString("ru-RU") : "—";

    tr.innerHTML = `
      <td class="px-4 py-3 text-slate-100">${period}</td>
      <td class="px-4 py-3 text-slate-300">${updated}</td>
      <td class="px-4 py-3 text-right">
        <a class="rounded-xl bg-white/5 px-3 py-2 text-xs text-slate-200 ring-1 ring-white/10 hover:bg-white/10"
           href="table.html?year=${row.year}&month=${row.month}">
          Открыть
        </a>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

async function loadProfile() {
  setError(null);
  setInfo(null);
  setStatus("Загружаю профиль…");

  const user = await getSessionUser();
  userId = user.id;

  emailEl.value = user.email || "";

  const profile = await getMyProfile();

  const role = profile?.role || "user";
  roleBadge.classList.remove("hidden");
  roleBadge.textContent = role === "admin" ? "admin" : "user";

  displayNameEl.value = profile?.display_name || "";
  if (typeof profile?.oklad === "number") okladEl.value = String(profile.oklad);
  else okladEl.value = "";

  setFallbackLetter(getInitials(displayNameEl.value, user.email));

  if (profile?.avatar_url) showAvatar(profile.avatar_url);
  else showAvatar(null);

  // history
  try {
    const items = await listMyTimesheets(24);
    renderHistory(items);
  } catch {
    renderHistory([]);
  }

  setStatus("Готово.");
}

async function saveProfile() {
  setError(null);
  setInfo(null);

  const displayName = String(displayNameEl.value || "").trim();
  const okladRaw = parseNumber(okladEl.value);

  if (String(okladEl.value || "").trim() && !Number.isFinite(okladRaw)) {
    setError("Оклад должен быть числом.");
    return;
  }

  saveBtn.disabled = true;
  saveBtn.classList.add("opacity-70", "cursor-not-allowed");
  setStatus("Сохраняю…");

  try {
    await updateMyProfile({
      displayName: displayName || null,
      oklad: Number.isFinite(okladRaw) ? okladRaw : null,
      avatarUrl: currentAvatarUrl ?? null,
    });

    setInfo("Сохранено ✅");
    setStatus(`Сохранено: ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`);
    setFallbackLetter(getInitials(displayName, emailEl.value));
  } catch (e) {
    setError(e?.message || "Не удалось сохранить профиль.");
    setStatus("Ошибка сохранения.");
  } finally {
    saveBtn.disabled = false;
    saveBtn.classList.remove("opacity-70", "cursor-not-allowed");
  }
}

uploadBtn.addEventListener("click", () => avatarFile.click());

avatarFile.addEventListener("change", async () => {
  const file = avatarFile.files?.[0];
  if (!file) return;

  setError(null);
  setInfo(null);
  setStatus("Загружаю фото…");

  try {
    const maxMb = 5;
    if (file.size > maxMb * 1024 * 1024) throw new Error(`Файл слишком большой. Максимум ${maxMb} МБ.`);

    const url = await uploadAvatar(file);
    showAvatar(url);

    await updateMyProfile({ avatarUrl: url });
    setInfo("Фото обновлено ✅");
    setStatus("Фото сохранено.");
  } catch (e) {
    setError(e?.message || "Не удалось загрузить фото.");
    setStatus("Ошибка загрузки фото.");
  } finally {
    avatarFile.value = "";
  }
});

removeBtn.addEventListener("click", async () => {
  setError(null);
  setInfo(null);
  setStatus("Удаляю фото…");
  try {
    await removeAvatar();
    setInfo("Фото удалено ✅");
    setStatus("Готово.");
  } catch (e) {
    setError(e?.message || "Не удалось удалить фото.");
    setStatus("Ошибка удаления.");
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveProfile();
});

logoutBtn.addEventListener("click", async () => {
  try { await signOut(); }
  finally { location.href = "login.html?next=profile.html"; }
});

(async () => {
  try { await requireSession(); }
  catch { location.href = "login.html?next=profile.html"; return; }
  await loadProfile();
})();