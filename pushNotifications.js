import {
  disableMyPushSubscription,
  upsertMyPushSubscription,
} from "./db.js";
import { VAPID_PUBLIC_KEY } from "./pushConfig.js";

function isLocalhost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function isSecureContextForPush() {
  return window.isSecureContext || isLocalhost();
}

export function isPushNotificationSupported() {
  return Boolean(
    isSecureContextForPush() &&
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
    throw new Error("Браузер не поддерживает уведомления или сайт открыт без HTTPS.");
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
    throw new Error("Браузер не поддерживает уведомления или сайт открыт без HTTPS.");
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
