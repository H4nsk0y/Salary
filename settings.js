/* =========================
   FILE: /settings.js
   ========================= */

import { requireSession } from "./auth.js";
import { getMyProfile, updateMyProfileFields } from "./db.js";
import {
  createMoneyPinSecret,
  hasMoneyPin,
  isMoneyProtectionEnabled,
  requestMoneyPin,
  requestVerifiedMoneyPin,
} from "./moneyPrivacy.js";

const statusPill = document.getElementById("statusPill");
const errorBox = document.getElementById("errorBox");
const hideMoneyToggle = document.getElementById("hideMoneyToggle");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");

let currentSettings = {
  hide_money: false,
  money_pin_hash: null,
  money_pin_salt: null,
};

let pendingSettings = {
  hide_money: false,
  money_pin_hash: null,
  money_pin_salt: null,
};

function cloneSettings(settings) {
  return {
    hide_money: settings?.hide_money === true,
    money_pin_hash: settings?.money_pin_hash ?? null,
    money_pin_salt: settings?.money_pin_salt ?? null,
  };
}

function syncToggle() {
  if (!hideMoneyToggle) return;
  hideMoneyToggle.checked = pendingSettings.hide_money === true;
}

function markDirty(text = "Есть несохранённые изменения") {
  setStatus(text, "neutral");
}

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

  currentSettings = {
    hide_money: isMoneyProtectionEnabled(profile),
    money_pin_hash: profile?.money_pin_hash ?? null,
    money_pin_salt: profile?.money_pin_salt ?? null,
  };

  pendingSettings = cloneSettings(currentSettings);
  syncToggle();

  if (profile?.hide_money === true && !hasMoneyPin(profile)) {
    setStatus("Нужно задать PIN", "err");
    //setError("Раньше скрытие было включено без PIN-кода. Включите его заново и задайте новый PIN.");
    return;
  }

  setStatus("Настройки загружены", "ok");
}

async function handleHideMoneyToggleChange() {
  if (!hideMoneyToggle) return;

  const wantsEnable = hideMoneyToggle.checked;
  const wasEnabled = pendingSettings.hide_money === true;

  if (wantsEnable === wasEnabled) return;

  setError(null);

  if (wantsEnable) {
    const pin = await requestMoneyPin({
      mode: "create",
      title: "Включить защиту выплат",
      description:
        "Придумайте новый 4-значный PIN-код. Он будет нужен, чтобы показать оклад и выплаты.",
      confirmText: "Сохранить PIN",
    });

    if (!pin) {
      syncToggle();
      return;
    }

    try {
      const secret = await createMoneyPinSecret(pin);
      pendingSettings.hide_money = true;
      pendingSettings.money_pin_hash = secret.money_pin_hash;
      pendingSettings.money_pin_salt = secret.money_pin_salt;
      syncToggle();
      markDirty("PIN задан. Сохраните настройки");
    } catch (e) {
      syncToggle();
      setStatus("Ошибка", "err");
      setError(e?.message || "Не удалось подготовить PIN-код.");
    }

    return;
  }

  if (currentSettings.hide_money !== true) {
    pendingSettings = cloneSettings(currentSettings);
    syncToggle();
    setStatus("Изменение отменено", "neutral");
    return;
  }

  const ok = await requestVerifiedMoneyPin(currentSettings, {
    title: "Отключить защиту выплат",
    description:
      "Введите текущий 4-значный PIN-код, чтобы отключить автоматическое скрытие.",
    confirmText: "Отключить",
  });

  if (!ok) {
    syncToggle();
    return;
  }

  pendingSettings.hide_money = false;
  pendingSettings.money_pin_hash = null;
  pendingSettings.money_pin_salt = null;
  syncToggle();
  markDirty("Защита будет отключена после сохранения");
}

async function saveSettings() {
  if (!hideMoneyToggle) return;

  if (pendingSettings.hide_money === true) {
    if (!pendingSettings.money_pin_hash || !pendingSettings.money_pin_salt) {
      setStatus("Ошибка сохранения", "err");
      setError("Сначала задайте PIN-код для защиты выплат.");
      syncToggle();
      return;
    }
  }

  setStatus("Сохраняю…", "busy");
  setError(null);

  try {
    await updateMyProfileFields({
      hide_money: pendingSettings.hide_money === true,
      money_pin_hash: pendingSettings.money_pin_hash,
      money_pin_salt: pendingSettings.money_pin_salt,
    });

    currentSettings = cloneSettings(pendingSettings);
    syncToggle();
    setStatus("Сохранено", "ok");
  } catch (e) {
    syncToggle();
    setStatus("Ошибка сохранения", "err");
    setError(e?.message || "Не удалось сохранить настройки.");
  }
}

hideMoneyToggle?.addEventListener("change", () => {
  void handleHideMoneyToggleChange();
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
