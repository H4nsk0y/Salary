import {
  createMyPushTestNotification,
  disableMyPushSubscription,
  sendPushNotifications,
  upsertMyPushSubscription,
} from "./db.js";
import { VAPID_PUBLIC_KEY } from "./pushConfig.js";

function isLocalhost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function isSecureContextForPush() {
  return window.isSecureContext || isLocalhost();
}

function isIosDevice() {
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return /iPad|iPhone|iPod/i.test(ua) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandaloneDisplay() {
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true
  );
}

function getPushUnsupportedReason() {
  if (!isSecureContextForPush()) {
    return "Сайт открыт без HTTPS. Для push-уведомлений нужен защищённый адрес.";
  }

  if (isIosDevice() && !isStandaloneDisplay()) {
    return "На iPhone уведомления работают только из версии сайта, добавленной на экран «Домой». Откройте сайт через иконку на рабочем столе.";
  }

  if (!("Notification" in window)) {
    return "Этот браузер не поддерживает системные уведомления.";
  }

  if (!("serviceWorker" in navigator)) {
    return "Этот браузер не поддерживает Service Worker, который нужен для push-уведомлений.";
  }

  if (!("PushManager" in window)) {
    return isIosDevice()
      ? "На этом iPhone Push API недоступен. Проверьте iOS 16.4+ и откройте сайт именно через иконку на экране «Домой»."
      : "Этот браузер не поддерживает Push API.";
  }

  return "Браузер не поддерживает push-уведомления.";
}

export function isPushNotificationSupported() {
  return Boolean(
    isSecureContextForPush() &&
      (!isIosDevice() || isStandaloneDisplay()) &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

async function getServiceWorkerRegistration() {
  if (!isPushNotificationSupported()) {
    throw new Error(getPushUnsupportedReason());
  }

  const registration = await navigator.serviceWorker.register("./service-worker.js");
  return navigator.serviceWorker.ready.then(() => registration);
}

function subscriptionToRpcPayload(subscription) {
  const json = subscription?.toJSON?.() ?? {};
  const endpoint = String(json.endpoint || subscription?.endpoint || "").trim();
  const p256dh = String(json.keys?.p256dh || "").trim();
  const auth = String(json.keys?.auth || "").trim();

  if (!endpoint || !p256dh || !auth) {
    throw new Error("Браузер не вернул данные push-подписки.");
  }

  return {
    endpoint,
    p256dh,
    auth,
    userAgent: navigator.userAgent || "",
    platform: navigator.platform || "",
  };
}

export async function getPushNotificationState() {
  if (!isPushNotificationSupported()) {
    return {
      supported: false,
      configured: Boolean(VAPID_PUBLIC_KEY),
      permission: "unsupported",
      subscribed: false,
      reason: getPushUnsupportedReason(),
    };
  }

  if (!VAPID_PUBLIC_KEY) {
    return {
      supported: true,
      configured: false,
      permission: Notification.permission,
      subscribed: false,
    };
  }

  const registration = await getServiceWorkerRegistration();
  const subscription = await registration.pushManager.getSubscription();

  return {
    supported: true,
    configured: true,
    permission: Notification.permission,
    subscribed: Boolean(subscription),
  };
}

export async function enablePushNotifications() {
  if (!VAPID_PUBLIC_KEY) {
    throw new Error("Не задан публичный VAPID-ключ для push-уведомлений.");
  }

  if (!isPushNotificationSupported()) {
    throw new Error(getPushUnsupportedReason());
  }

  let permission = Notification.permission;

  if (permission === "default") {
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    if (permission === "denied") {
      throw new Error("Уведомления заблокированы в настройках браузера.");
    }

    throw new Error("Разрешение на уведомления не выдано. Можно попробовать ещё раз.");
  }

  const registration = await getServiceWorkerRegistration();
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  await upsertMyPushSubscription(subscriptionToRpcPayload(subscription));
  return getPushNotificationState();
}

export async function disablePushNotifications() {
  const registration = await getServiceWorkerRegistration();
  const subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    return getPushNotificationState();
  }

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await disableMyPushSubscription(endpoint);
  return getPushNotificationState();
}

export async function sendPushTestNotification() {
  const state = await getPushNotificationState();
  if (!state.subscribed || state.permission !== "granted") {
    throw new Error("Сначала включите уведомления на этом устройстве.");
  }

  await createMyPushTestNotification();
  const result = await sendPushNotifications({ type: "push_test" });
  if (Number(result?.sent) < 1) {
    throw new Error(result?.message || "Сервер не нашёл активную push-подписку этого устройства.");
  }
  return result;
}
