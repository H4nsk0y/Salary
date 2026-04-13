import { requireSession } from "./auth.js";
import { getMyProfile, updateMyProfileFields } from "./db.js";

const statusPill = document.getElementById("statusPill");
const errorBox = document.getElementById("errorBox");
const hideMoneyToggle = document.getElementById("hideMoneyToggle");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");

function setStatus(text, tone = "neutral") {
  if (!statusPill) return;

  statusPill.textContent = text;
  statusPill.className = "status-pill";

  if (tone === "ok") {
    statusPill.classList.add("bg-emerald-500/10", "text-emerald-200", "border-emerald-400/20");
    return;
  }

  if (tone === "err") {
    statusPill.classList.add("bg-rose-500/10", "text-rose-200", "border-rose-400/20");
    return;
  }

  if (tone === "busy") {
    statusPill.classList.add("bg-sky-500/10", "text-sky-200", "border-sky-400/20");
    return;
  }

  statusPill.classList.add("bg-white/5", "text-slate-300", "border-white/10");
}

function setError(msg) {
  if (!errorBox) return;

  if (!msg) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    errorBox.classList.remove("shake");
    return;
  }

  errorBox.classList.remove("hidden");
  errorBox.textContent = msg;
  errorBox.classList.remove("shake");
  errorBox.offsetWidth;
  errorBox.classList.add("shake");
}

async function loadSettings() {
  setStatus("Загружаю настройки…", "busy");
  setError(null);

  const profile = await getMyProfile();
  const hideMoney = profile?.hide_money !== false;

  if (hideMoneyToggle) {
    hideMoneyToggle.checked = hideMoney;
  }

  setStatus("Настройки загружены", "ok");
}

async function saveSettings() {
  if (!hideMoneyToggle) return;

  setStatus("Сохраняю…", "busy");
  setError(null);

  try {
    await updateMyProfileFields({
      hide_money: hideMoneyToggle.checked,
    });

    setStatus("Сохранено", "ok");
  } catch (e) {
    setStatus("Ошибка сохранения", "err");
    setError(e?.message || "Не удалось сохранить настройки.");
  }
}

hideMoneyToggle?.addEventListener("change", () => {
  setStatus("Есть несохранённые изменения", "neutral");
});

saveSettingsBtn?.addEventListener("click", () => void saveSettings());

(async () => {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=settings.html";
    return;
  }

  try {
    await loadSettings();
  } catch (e) {
    setStatus("Ошибка загрузки", "err");
    setError(e?.message || "Не удалось загрузить настройки.");
  }
})();