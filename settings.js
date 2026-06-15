// FILE: /settings.js

import { requireSession } from "./auth.js";
import "./scrollbar.js";
import { getMyProfile, updateMyProfileFields } from "./db.js";
import {
  isNotificationToastsEnabled,
  setNotificationToastsEnabled,
} from "./notificationSettings.js";
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushNotificationState,
} from "./pushNotifications.js";
import { startPresenceHeartbeat } from "./presence.js";
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
const autoCollapseTablePanelsToggle = document.getElementById("autoCollapseTablePanelsToggle");
const notificationToastsToggle = document.getElementById("notificationToastsToggle");
const pushNotificationsBtn = document.getElementById("pushNotificationsBtn");
const pushNotificationsHint = document.getElementById("pushNotificationsHint");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");

let currentSettings = {
  hide_money: false,
  money_pin_hash: null,
  money_pin_salt: null,
  auto_collapse_table_panels: false,
  notification_toasts: true,
};

let pendingSettings = {
  hide_money: false,
  money_pin_hash: null,
  money_pin_salt: null,
  auto_collapse_table_panels: false,
  notification_toasts: true,
};

function cloneSettings(settings) {
  return {
    hide_money: settings?.hide_money === true,
    money_pin_hash: settings?.money_pin_hash ?? null,
    money_pin_salt: settings?.money_pin_salt ?? null,
    auto_collapse_table_panels: settings?.auto_collapse_table_panels === true,
    notification_toasts: settings?.notification_toasts !== false,
  };
}

function syncToggle() {
  if (hideMoneyToggle) {
    hideMoneyToggle.checked = pendingSettings.hide_money === true;
  }

  if (autoCollapseTablePanelsToggle) {
    autoCollapseTablePanelsToggle.checked =
      pendingSettings.auto_collapse_table_panels === true;
  }

  if (notificationToastsToggle) {
    notificationToastsToggle.checked = pendingSettings.notification_toasts !== false;
  }
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
    auto_collapse_table_panels: profile?.auto_collapse_table_panels === true,
    notification_toasts: isNotificationToastsEnabled(),
  };

  pendingSettings = cloneSettings(currentSettings);
  syncToggle();

  if (profile?.hide_money === true && !hasMoneyPin(profile)) {
    setStatus("Нужно задать PIN", "err");
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

function handleAutoCollapseTablePanelsToggleChange() {
  if (!autoCollapseTablePanelsToggle) return;

  pendingSettings.auto_collapse_table_panels =
    autoCollapseTablePanelsToggle.checked === true;

  markDirty("Есть несохранённые изменения");
}

function applyPushButtonState(state) {
  if (!pushNotificationsBtn || !pushNotificationsHint) return;

  pushNotificationsBtn.disabled = false;
  pushNotificationsBtn.classList.remove("text-emerald-200", "ring-emerald-400/20", "text-rose-200", "ring-rose-400/20");

  if (!state?.supported) {
    pushNotificationsBtn.disabled = true;
    pushNotificationsBtn.textContent = "Недоступно";
    pushNotificationsHint.textContent =
      state?.reason || "Ваш браузер не поддерживает push-уведомления или сайт открыт без HTTPS.";
    return;
  }

  if (!state?.configured) {
    pushNotificationsBtn.disabled = true;
    pushNotificationsBtn.textContent = "Не настроено";
    pushNotificationsHint.textContent = "Для включения нужен публичный VAPID-ключ.";
    return;
  }

  if (state.permission === "denied") {
    pushNotificationsBtn.textContent = "Проверить снова";
    pushNotificationsBtn.classList.add("text-rose-200", "ring-rose-400/20");
    pushNotificationsHint.textContent =
      "Браузер не выдаёт разрешение. Если окно было случайно закрыто, попробуйте ещё раз или разрешите уведомления в настройках сайта.";
    return;
  }

  if (state.subscribed) {
    pushNotificationsBtn.textContent = "Отключить";
    pushNotificationsBtn.classList.add("text-emerald-200", "ring-emerald-400/20");
    pushNotificationsHint.textContent =
      "Этот браузер подписан на уведомления. Отправка начнет работать после подключения серверной рассылки.";
    return;
  }

  pushNotificationsBtn.textContent = "Включить";
  pushNotificationsHint.textContent =
    "Нажмите, чтобы разрешить уведомления в этом браузере.";
}

async function refreshPushNotificationState() {
  if (!pushNotificationsBtn) return;

  try {
    applyPushButtonState(await getPushNotificationState());
  } catch (e) {
    pushNotificationsBtn.disabled = true;
    pushNotificationsBtn.textContent = "Ошибка";
    if (pushNotificationsHint) {
      pushNotificationsHint.textContent =
        e?.message || "Не удалось проверить поддержку уведомлений.";
    }
  }
}

function handleNotificationToastsToggleChange() {
  if (!notificationToastsToggle) return;

  pendingSettings.notification_toasts = notificationToastsToggle.checked === true;
  markDirty("Есть несохранённые изменения");
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
      auto_collapse_table_panels:
        pendingSettings.auto_collapse_table_panels === true,
    });

    currentSettings = cloneSettings(pendingSettings);
    setNotificationToastsEnabled(pendingSettings.notification_toasts !== false);
    syncToggle();
    setStatus("Сохранено", "ok");
  } catch (e) {
    syncToggle();
    setStatus("Ошибка сохранения", "err");
    setError(e?.message || "Не удалось сохранить настройки.");
  }
}

async function handlePushNotificationsClick() {
  if (!pushNotificationsBtn) return;

  pushNotificationsBtn.disabled = true;
  pushNotificationsBtn.textContent = "Секунду…";
  setError(null);

  try {
    const state = await getPushNotificationState();
    const nextState = state.subscribed
      ? await disablePushNotifications()
      : await enablePushNotifications();

    applyPushButtonState(nextState);
    setStatus(nextState.subscribed ? "Уведомления включены" : "Уведомления отключены", "ok");
  } catch (e) {
    await refreshPushNotificationState();
    setStatus("Ошибка уведомлений", "err");
    setError(e?.message || "Не удалось изменить настройки уведомлений.");
  }
}

hideMoneyToggle?.addEventListener("change", () => {
  void handleHideMoneyToggleChange();
});

autoCollapseTablePanelsToggle?.addEventListener("change", () => {
  handleAutoCollapseTablePanelsToggleChange();
});

notificationToastsToggle?.addEventListener("change", () => {
  handleNotificationToastsToggleChange();
});

pushNotificationsBtn?.addEventListener("click", () => {
  void handlePushNotificationsClick();
});

saveSettingsBtn?.addEventListener("click", () => void saveSettings());

(async () => {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=settings.html";
    return;
  }

  startPresenceHeartbeat("Настройки");

  try {
    await loadSettings();
    await refreshPushNotificationState();
  } catch (e) {
    setStatus("Ошибка загрузки", "err");
    setError(e?.message || "Не удалось загрузить настройки.");
  }
})();
