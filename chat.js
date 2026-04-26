import { requireSession, signOut } from "./auth.js";
import { supabase } from "./supabaseClient.js";
import {
  getMyProfile,
  getMyChatDepartment,
  listMyDepartmentMessages,
  sendDepartmentMessage,
  subscribeToMyDepartmentMessages,
} from "./db.js";
import { startPresenceHeartbeat } from "./presence.js";

document.body.classList.add("is-loaded");

const logoutBtn = document.getElementById("logoutBtn");
const reloadBtn = document.getElementById("reloadBtn");
const errorBox = document.getElementById("errorBox");
const statusPill = document.getElementById("statusPill");
const chatSubtitle = document.getElementById("chatSubtitle");
const memberHint = document.getElementById("memberHint");

const messagesList = document.getElementById("messagesList");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const charCounter = document.getElementById("charCounter");

let myUserId = null;
let myProfile = null;
let myDepartmentKey = "";
let unsubscribeRealtime = null;
let isSending = false;

function setError(message) {
  if (!errorBox) return;

  if (!message) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    return;
  }

  errorBox.classList.remove("hidden");
  errorBox.textContent = message;
}

function setStatus(text, tone = "neutral") {
  if (!statusPill) return;

  statusPill.textContent = text;
  statusPill.className =
    "inline-flex items-center rounded-full px-4 py-1.5 text-xs ring-1";

  if (tone === "ok") {
    statusPill.classList.add("bg-emerald-500/10", "text-emerald-200", "ring-emerald-400/20");
    return;
  }

  if (tone === "err") {
    statusPill.classList.add("bg-rose-500/10", "text-rose-200", "ring-rose-400/20");
    return;
  }

  if (tone === "busy") {
    statusPill.classList.add("bg-sky-500/10", "text-sky-200", "ring-sky-400/20");
    return;
  }

  statusPill.classList.add("bg-white/5", "text-slate-300", "ring-white/10");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveDisplayName(profile, fallback = "Сотрудник") {
  return (
    String(profile?.display_name ?? "").trim() ||
    String(profile?.full_name ?? "").trim() ||
    String(profile?.name ?? "").trim() ||
    String(profile?.email ?? "").trim() ||
    fallback
  );
}

function extractAvatarPath(storedValue) {
  const value = String(storedValue || "").trim();
  if (!value) return null;

  if (!/^https?:\/\//i.test(value)) return value;

  try {
    const url = new URL(value);

    const signedMarker = "/storage/v1/object/sign/avatars/";
    const publicMarker = "/storage/v1/object/public/avatars/";

    const signedIdx = url.pathname.indexOf(signedMarker);
    if (signedIdx !== -1) {
      return decodeURIComponent(url.pathname.slice(signedIdx + signedMarker.length));
    }

    const publicIdx = url.pathname.indexOf(publicMarker);
    if (publicIdx !== -1) {
      return decodeURIComponent(url.pathname.slice(publicIdx + publicMarker.length));
    }

    return null;
  } catch {
    return null;
  }
}

async function createAvatarSignedUrl(storedValue) {
  const path = extractAvatarPath(storedValue);
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from("avatars")
    .createSignedUrl(path, 60 * 60);

  if (error) return null;
  return data?.signedUrl ?? null;
}

function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "A";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();

  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}

async function enrichMessages(messages) {
  const rows = Array.isArray(messages) ? messages : [];
  const userIds = [...new Set(rows.map((message) => message.user_id).filter(Boolean))];

  if (!userIds.length) {
    return rows;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, position, avatar_url")
    .in("user_id", userIds);

  if (error) {
    return rows.map((message) => {
      const profileName = message.user_id === myUserId
        ? resolveDisplayName(myProfile, "Вы")
        : "Сотрудник";

      return {
        ...message,
        profile_name: profileName,
        profile_avatar_url: null,
        profile_initials: getInitials(profileName),
      };
    });
  }

  const profileRows = data ?? [];

  const avatarEntries = await Promise.all(
    profileRows.map(async (row) => {
      const profileName =
        String(row.display_name ?? "").trim() ||
        String(row.position ?? "").trim() ||
        "Сотрудник";

      const signedUrl = await createAvatarSignedUrl(row.avatar_url);

      return [
        row.user_id,
        {
          name: profileName,
          avatarUrl: signedUrl,
          initials: getInitials(profileName),
        },
      ];
    })
  );

  const profileMap = new Map(avatarEntries);

  return rows.map((message) => {
    const fallbackName = message.user_id === myUserId
      ? resolveDisplayName(myProfile, "Вы")
      : "Сотрудник";

    const meta = profileMap.get(message.user_id);

    return {
      ...message,
      profile_name: meta?.name || fallbackName,
      profile_avatar_url: meta?.avatarUrl || null,
      profile_initials: meta?.initials || getInitials(fallbackName),
    };
  });
}

function renderMessages(messages) {
  if (!messagesList) return;

  if (!Array.isArray(messages) || messages.length === 0) {
    messagesList.innerHTML = `
      <div class="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-slate-400">
        Пока сообщений нет
      </div>
    `;
    return;
  }

  messagesList.innerHTML = messages.map((message) => {
    const own = message.user_id === myUserId;
    const name = escapeHtml(message.profile_name || "Сотрудник");
    const text = escapeHtml(message.text).replace(/\n/g, "<br>");
    const time = formatDateTime(message.created_at);
    const avatarUrl = String(message.profile_avatar_url || "").trim();
    const initials = escapeHtml(message.profile_initials || "A");

    const avatarHtml = avatarUrl
      ? `<img src="${escapeHtml(avatarUrl)}" alt="${name}" class="h-10 w-10 rounded-full object-cover ring-1 ring-white/10 shrink-0" />`
      : `<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs font-bold text-slate-200 ring-1 ring-white/10">${initials}</div>`;

    return `
      <div class="mb-3 flex ${own ? "justify-end" : "justify-start"}">
        <div class="flex max-w-[92%] items-end gap-3 ${own ? "flex-row-reverse" : ""}">
          ${avatarHtml}

          <div class="max-w-[88%] rounded-2xl px-4 py-3 ring-1 ${
            own
              ? "bg-indigo-500/15 text-slate-100 ring-indigo-400/20"
              : "bg-white/5 text-slate-100 ring-white/10"
          }">
            <div class="mb-1 flex items-center gap-2 text-xs ${own ? "justify-end" : ""}">
              <span class="font-semibold ${own ? "text-indigo-200" : "text-sky-200"}">${name}</span>
              <span class="text-slate-400">${time}</span>
            </div>
            <div class="text-sm leading-6 break-words">${text}</div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  messagesList.scrollTop = messagesList.scrollHeight;
}

async function loadMessages() {
  if (!myDepartmentKey) return;

  setStatus("Загружаю сообщения…", "busy");
  setError(null);

  try {
    const messages = await listMyDepartmentMessages(200);
    const enriched = await enrichMessages(messages);
    renderMessages(enriched);
    setStatus("Чат подключен", "ok");
  } catch (error) {
    setStatus("Ошибка загрузки", "err");
    setError(error?.message || "Не удалось загрузить сообщения.");
  }
}

function updateCharCounter() {
  if (!charCounter || !messageInput) return;
  const value = String(messageInput.value ?? "");
  charCounter.textContent = `${value.length} / 2000`;
}

async function handleSendMessage(event) {
  event.preventDefault();
  if (isSending) return;

  const text = String(messageInput?.value ?? "").trim();
  if (!text) return;

  isSending = true;
  if (sendBtn) sendBtn.disabled = true;
  setStatus("Отправляю…", "busy");
  setError(null);

  try {
    await sendDepartmentMessage(text);
    messageInput.value = "";
    updateCharCounter();
    await loadMessages();
    setStatus("Сообщение отправлено", "ok");
    messageInput.focus();
  } catch (error) {
    setStatus("Ошибка отправки", "err");
    setError(error?.message || "Не удалось отправить сообщение.");
  } finally {
    isSending = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

function bindEvents() {
  logoutBtn?.addEventListener("click", async () => {
    try {
      await signOut();
    } finally {
      location.href = "login.html?next=chat.html";
    }
  });

  reloadBtn?.addEventListener("click", async () => {
    await loadMessages();
  });

  messageForm?.addEventListener("submit", handleSendMessage);

  messageInput?.addEventListener("input", updateCharCounter);

  messageInput?.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await handleSendMessage(event);
    }
  });
}

async function initCurrentUser() {
  await requireSession();

  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;

  myUserId = data?.user?.id ?? null;
  if (!myUserId) {
    throw new Error("NO_SESSION");
  }
}

async function init() {
  try {
    await initCurrentUser();
  } catch {
    location.href = "login.html?next=chat.html";
    return;
  }

  startPresenceHeartbeat("Чат");

  try {
    myProfile = await getMyProfile();
    myDepartmentKey = await getMyChatDepartment();

    if (!myDepartmentKey) {
      setStatus("Нет отдела", "err");
      setError("У вас нет отдела для чата. Проверьте department_members / department_editors.");
      if (messageInput) messageInput.disabled = true;
      if (sendBtn) sendBtn.disabled = true;
      return;
    }

    const displayName = resolveDisplayName(myProfile, "Сотрудник");
    if (chatSubtitle) chatSubtitle.textContent = `Отдел: ${myDepartmentKey}`;
    if (memberHint) memberHint.textContent = displayName;

    bindEvents();
    updateCharCounter();
    await loadMessages();

    const unsubscribeFactory = await subscribeToMyDepartmentMessages(async () => {
      await loadMessages();
    });

    unsubscribeRealtime =
      typeof unsubscribeFactory === "function" ? unsubscribeFactory : null;
  } catch (error) {
    setStatus("Ошибка", "err");
    setError(error?.message || "Не удалось инициализировать чат.");
  }
}

window.addEventListener("beforeunload", () => {
  if (typeof unsubscribeRealtime === "function") {
    unsubscribeRealtime();
  }
});

init();
