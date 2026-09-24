import { installDoubleRightClickFullscreen } from "./features/fullscreenShortcuts.js";
import {
  isBackgroundMusicEnabled,
  toggleBackgroundMusic,
} from "./backgroundMusic.js";
import { getSession } from "./auth.js";
import {
  getMyShiftChecklistState,
  listDepartmentActiveChecklists,
  listDepartmentShiftOverview,
  listMyNotifications,
} from "./db.js";
import { checklistProgress } from "./shiftChecklist.js?v=20260913-2";

const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d", { alpha: false });
const fullButton = document.getElementById("fullscreenBtn");
const musicButton = document.getElementById("musicToggleBtn");
const modeButtons = [...document.querySelectorAll("[data-mode]")];
const returnToPage = document.getElementById("returnToPage");
const pageParams = new URLSearchParams(location.search);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const shiftBoard = document.getElementById("shiftBoard");
const shiftClock = document.getElementById("shiftClock");
const shiftDate = document.getElementById("shiftDate");
const currentShiftTitle = document.getElementById("currentShiftTitle");
const currentShiftCount = document.getElementById("currentShiftCount");
const currentShiftPeople = document.getElementById("currentShiftPeople");
const nextShiftWhen = document.getElementById("nextShiftWhen");
const nextShiftPeople = document.getElementById("nextShiftPeople");
const shiftChecklistScore = document.getElementById("shiftChecklistScore");
const shiftChecklistText = document.getElementById("shiftChecklistText");
const shiftAnnouncement = document.getElementById("shiftAnnouncement");
const shiftBoardUpdated = document.getElementById("shiftBoardUpdated");

let width = 0;
let height = 0;
let mode = modeButtons.some((button) => button.dataset.mode === pageParams.get("mode"))
  ? pageParams.get("mode") : "ribbons";
let time = 0;
let lastFrame = 0;
let wakeLock = null;
let building = { x: 0, y: 0, vx: 125, vy: 93 };
const buildingImage = new Image();
buildingImage.src = "./images/app-icon-512.png";
const pointer = { x: 0, y: 0, active: false, dragging: false };
let idleTimer = null;
let shiftBoardLoaded = false;
let shiftBoardTimer = null;

modeButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
document.body.dataset.mode = mode;
const requestedReturn = pageParams.get("from");
if (requestedReturn && returnToPage) {
  try {
    const returnUrl = new URL(requestedReturn, location.href);
    if (returnUrl.origin === location.origin && returnUrl.pathname.endsWith(".html")
        && !returnUrl.pathname.endsWith("/screen-saver.html")) {
      returnToPage.href = returnUrl.href;
      returnToPage.textContent = "Вернуться";
    }
  } catch {
    // An invalid return URL must not stop the animation.
  }
}

function showControls() {
  document.body.classList.remove("is-idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add("is-idle"), 5000);
}

function syncMusicButton() {
  if (!musicButton) return;
  const isEnabled = isBackgroundMusicEnabled();
  const label = isEnabled ? "Выключить музыку" : "Включить музыку";
  musicButton.classList.toggle("is-active", isEnabled);
  musicButton.setAttribute("aria-pressed", String(isEnabled));
  musicButton.setAttribute("aria-label", label);
  musicButton.title = label;
  const hiddenLabel = musicButton.querySelector("[data-music-label]");
  if (hiddenLabel) hiddenLabel.textContent = label;
}

function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  width = innerWidth;
  height = innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  building.x = Math.min(Math.max(building.x || width * .5, 92), Math.max(92, width - 92));
  building.y = Math.min(Math.max(building.y || height * .5, 56), Math.max(56, height - 56));
}

function background() {
  ctx.fillStyle = "#080a0b";
  ctx.fillRect(0, 0, width, height);
}

function ribbons() {
  const colors = ["#7a1638", "#b74257", "#c6a15b", "#6ea8e8", "#749c8e", "#d6b9bd"];
  const unit = Math.min(width, height);
  for (let ribbon = 0; ribbon < colors.length; ribbon++) {
    const offset = ribbon * 1.08;
    for (let edge = 0; edge < 3; edge++) {
      ctx.beginPath();
      for (let step = 0; step <= 72; step++) {
        const progress = step / 72;
        const x = progress * (width + 200) - 100;
        const influence = pointer.active ? Math.exp(-Math.pow((x - pointer.x) / 210, 2)) * Math.sin((pointer.y - height * .5) / Math.max(height, 1) * 2) * unit * .16 : 0;
        const y = height * (.35 + ribbon * .055) + Math.sin(progress * 7.5 - time * .44 + offset) * unit * .22 + Math.cos(progress * 12 + time * .22 + offset) * unit * .055 + influence + edge * 7;
        if (step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = colors[ribbon];
      ctx.globalAlpha = edge === 0 ? .44 : .19;
      ctx.lineWidth = edge === 0 ? 3 : 12 + edge * 8;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function bouncingBuilding(delta) {
  if (!pointer.dragging) {
    building.x += building.vx * delta;
    building.y += building.vy * delta;
  }
  const halfWidth = Math.min(92, width * .22);
  const halfHeight = Math.min(55, height * .13);
  if (building.x <= halfWidth || building.x >= width - halfWidth) { building.vx *= -1; building.x = Math.max(halfWidth, Math.min(width - halfWidth, building.x)); }
  if (building.y <= halfHeight || building.y >= height - halfHeight) { building.vy *= -1; building.y = Math.max(halfHeight, Math.min(height - halfHeight, building.y)); }
  if (buildingImage.complete && buildingImage.naturalWidth) {
    ctx.drawImage(buildingImage, 55, 155, 405, 220, building.x - halfWidth, building.y - halfHeight, halfWidth * 2, halfHeight * 2);
  }
}

function orbits() {
  const centerX = width * .5 + Math.sin(time * .17) * width * .13 + (pointer.active ? (pointer.x - width * .5) * .18 : 0);
  const centerY = height * .52 + Math.cos(time * .13) * height * .1 + (pointer.active ? (pointer.y - height * .5) * .18 : 0);
  const base = Math.min(width, height) * .16;
  const colors = ["#c6a15b", "#6ea8e8", "#b74257", "#749c8e"];
  colors.forEach((color, index) => {
    const radius = base * (.7 + index * .48);
    const angle = time * (.25 + index * .11) * (index % 2 ? -1 : 1) + index * 1.7;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius * .58;
    ctx.strokeStyle = color;
    ctx.globalAlpha = .33;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(centerX, centerY, radius, radius * .58, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = .95;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 5 + index * 3, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function sameHours(value, expected) {
  return Math.abs((Number(value) || 0) - expected) < .05;
}

function isNightRest(row) {
  return (sameHours(row?.day_hours, 1) || sameHours(row?.day_hours, 2)) && sameHours(row?.night_hours, 5);
}

function isNightStart(row) {
  return (sameHours(row?.day_hours, 2) && sameHours(row?.night_hours, 2)) ||
    ((sameHours(row?.day_hours, 3) || sameHours(row?.day_hours, 4)) && sameHours(row?.night_hours, 7));
}

function initials(value) {
  return String(value || "С")
    .trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join("") || "С";
}

function shiftLabel(row) {
  const day = Number(row?.day_hours) || 0;
  const night = Number(row?.night_hours) || 0;
  if (isNightRest(row)) return "до 08:00";
  if (isNightStart(row)) return `Ночь ${day}/${night}`;
  if (night > 0 && day > 0) return `${day}/${night} ч`;
  return `${day || night} ч`;
}

function createPerson(row) {
  const person = document.createElement("div");
  person.className = "shift-person";
  const avatar = document.createElement("div");
  avatar.className = "shift-initials";
  avatar.textContent = initials(row?.display_name);
  const info = document.createElement("div");
  const name = document.createElement("div");
  name.className = "shift-person-name";
  name.textContent = row?.display_name || "Сотрудник";
  const position = document.createElement("div");
  position.className = "shift-person-position";
  position.textContent = row?.position_name || "Сотрудник отдела";
  info.append(name, position);
  const badge = document.createElement("div");
  badge.className = "shift-badge";
  badge.textContent = shiftLabel(row);
  person.append(avatar, info, badge);
  return person;
}

function renderPeople(container, rows, emptyText) {
  if (!container) return;
  container.innerHTML = "";
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "shift-empty";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }
  rows.forEach((row) => container.append(createPerson(row)));
}

function localIsoDate(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function selectBoardShifts(rows, now = new Date()) {
  const today = localIsoDate(now);
  const tomorrowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
  const tomorrow = localIsoDate(tomorrowDate);
  const todayRows = rows.filter((row) => row.target_date === today);
  const tomorrowRows = rows.filter((row) => row.target_date === tomorrow);
  const hour = now.getHours();

  if (hour < 8) {
    return {
      current: todayRows.filter(isNightRest),
      next: todayRows.filter((row) => Number(row.day_hours) > 0 && !isNightRest(row) && !isNightStart(row)),
      currentTitle: "Сейчас заканчивают ночь",
      nextWhen: "Сегодня утром",
    };
  }
  if (hour < 20) {
    return {
      current: todayRows.filter((row) => Number(row.day_hours) > 0 && !isNightRest(row) && !isNightStart(row)),
      next: todayRows.filter(isNightStart),
      currentTitle: "Сейчас на смене",
      nextWhen: "Сегодня вечером",
    };
  }
  return {
    current: todayRows.filter(isNightStart),
    next: tomorrowRows.filter((row) => Number(row.day_hours) > 0 && !isNightRest(row) && !isNightStart(row)),
    currentTitle: "Сейчас в ночной смене",
    nextWhen: "Завтра утром",
  };
}

function renderGuestBoard() {
  if (currentShiftTitle) currentShiftTitle.textContent = "Живая смена доступна после входа";
  if (currentShiftCount) currentShiftCount.textContent = "Гость";
  renderPeople(currentShiftPeople, [], "Войдите в ALVISA SALARY, чтобы увидеть сотрудников текущей и следующей смены.");
  renderPeople(nextShiftPeople, [], "После входа здесь появится следующая смена вашего отдела.");
  if (shiftChecklistScore) shiftChecklistScore.textContent = "—";
  if (shiftChecklistText) shiftChecklistText.innerHTML = '<div class="shift-message">Чек-листы смены доступны зарегистрированным пользователям.</div>';
  if (shiftAnnouncement) shiftAnnouncement.textContent = "Объявления отдела появятся после входа.";
}

async function loadShiftBoard() {
  if (!shiftBoard) return;
  const session = await getSession();
  if (!session) {
    renderGuestBoard();
    shiftBoardLoaded = true;
    return;
  }

  const [rows, checklist, activeChecklists, notifications] = await Promise.all([
    listDepartmentShiftOverview({ startDate: localIsoDate(), days: 2 }),
    getMyShiftChecklistState(),
    listDepartmentActiveChecklists().catch(() => []),
    listMyNotifications(),
  ]);
  const selected = selectBoardShifts(rows);
  if (currentShiftTitle) currentShiftTitle.textContent = selected.currentTitle;
  if (currentShiftCount) currentShiftCount.textContent = `${selected.current.length} чел.`;
  if (nextShiftWhen) nextShiftWhen.textContent = selected.nextWhen;
  renderPeople(currentShiftPeople, selected.current, "По заполненному графику сейчас никто не работает.");
  renderPeople(nextShiftPeople, selected.next, "Следующая смена в табеле пока не заполнена.");

  const checklistRows = activeChecklists.length
    ? activeChecklists
    : checklist?.active
      ? [{ display_name:"Мой чек-лист", items:checklist.active.items }]
      : [];
  if (shiftChecklistText) {
    shiftChecklistText.innerHTML = "";
    checklistRows.forEach((row) => {
      const fallback = checklistProgress(row.items);
      const total = Number(row.total_count) || fallback.total;
      const completed = Number(row.completed_count) || fallback.completed;
      const percent = total > 0 ? Math.round(completed * 100 / total) : 0;
      const item = document.createElement("div");
      item.className = "shift-check-row";
      const line = document.createElement("div");
      line.className = "shift-check-line";
      const name = document.createElement("span");
      name.textContent = row.display_name || "Сотрудник";
      const score = document.createElement("span");
      score.textContent = `${completed}/${total}`;
      line.append(name, score);
      const bar = document.createElement("div");
      bar.className = "shift-check-mini";
      const fill = document.createElement("span");
      fill.style.width = `${percent}%`;
      bar.append(fill);
      item.append(line, bar);
      shiftChecklistText.append(item);
    });
    if (!checklistRows.length) shiftChecklistText.innerHTML = '<div class="shift-message">Активных чек-листов сейчас нет.</div>';
  }
  if (shiftChecklistScore) shiftChecklistScore.textContent = `${checklistRows.length} активных`;

  const announcement = notifications.find((item) => item?.type === "department_announcement");
  if (shiftAnnouncement) {
    shiftAnnouncement.innerHTML = "";
    if (announcement) {
      const title = document.createElement("strong");
      title.textContent = announcement.title || "Объявление";
      const body = document.createElement("span");
      body.textContent = announcement.body || "";
      shiftAnnouncement.append(title, body);
    } else {
      shiftAnnouncement.textContent = "Новых объявлений отдела нет.";
    }
  }
  if (shiftBoardUpdated) shiftBoardUpdated.textContent = `обновлено ${new Date().toLocaleTimeString("ru-RU", { hour:"2-digit", minute:"2-digit" })}`;
  shiftBoardLoaded = true;
}

function updateClock() {
  const now = new Date();
  if (shiftClock) shiftClock.textContent = now.toLocaleTimeString("ru-RU", { hour:"2-digit", minute:"2-digit" });
  if (shiftDate) shiftDate.textContent = now.toLocaleDateString("ru-RU", { weekday:"long", day:"numeric", month:"long" });
}

function ensureShiftBoard() {
  updateClock();
  if (!shiftBoardLoaded) void loadShiftBoard().catch(() => renderGuestBoard());
  clearInterval(shiftBoardTimer);
  shiftBoardTimer = setInterval(() => {
    updateClock();
    void loadShiftBoard().catch(() => undefined);
  }, 60000);
}

function frame(timestamp) {
  const delta = Math.min((timestamp - (lastFrame || timestamp)) / 1000, .05);
  lastFrame = timestamp;
  time += delta * (reduceMotion ? .25 : 1);
  background();
  if (mode === "ribbons") ribbons();
  else if (mode === "building") bouncingBuilding(delta * (reduceMotion ? .25 : 1));
  else if (mode === "orbit") orbits();
  requestAnimationFrame(frame);
}

async function holdScreen() {
  if (!navigator.wakeLock?.request) {
    return;
  }
  if (document.visibilityState !== "visible" || wakeLock && !wakeLock.released) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; }, { once: true });
  } catch {
    // A browser or device policy may deny Wake Lock while leaving the animation usable.
  }
}

modeButtons.forEach((button) => button.addEventListener("click", () => {
  mode = button.dataset.mode;
  document.body.dataset.mode = mode;
  modeButtons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  if (mode === "shift") ensureShiftBoard();
  else {
    clearInterval(shiftBoardTimer);
    shiftBoardTimer = null;
  }
}));

musicButton?.addEventListener("click", async () => {
  await toggleBackgroundMusic();
  syncMusicButton();
});

window.addEventListener("alvisa:background-music-change", syncMusicButton);

fullButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    fullButton.title = "Полноэкранный режим недоступен в этом браузере.";
  }
});

installDoubleRightClickFullscreen(showControls, fullButton);

document.addEventListener("fullscreenchange", () => {
  fullButton.textContent = document.fullscreenElement ? "Выйти из полного экрана" : "На весь экран";
});
window.addEventListener("pointermove", (event) => {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.active = true;
  if (pointer.dragging) {
    building.vx = Math.max(-340, Math.min(340, (event.clientX - building.x) * 8));
    building.vy = Math.max(-340, Math.min(340, (event.clientY - building.y) * 8));
    building.x = event.clientX;
    building.y = event.clientY;
  }
  showControls();
}, { passive: true });
window.addEventListener("pointerdown", (event) => {
  showControls();
  if (event.target !== canvas) return;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.active = true;
  if (mode === "building") {
    pointer.dragging = Math.abs(building.x - event.clientX) < 100 && Math.abs(building.y - event.clientY) < 70;
    if (pointer.dragging) canvas.setPointerCapture(event.pointerId);
    else {
      const angle = Math.atan2(event.clientY - building.y, event.clientX - building.x);
      building.vx = Math.cos(angle) * 190;
      building.vy = Math.sin(angle) * 190;
    }
  }
}, { passive: true });
window.addEventListener("pointerup", () => { pointer.dragging = false; });
window.addEventListener("pointerleave", () => { pointer.active = false; });
window.addEventListener("keydown", showControls);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void holdScreen(); });
window.addEventListener("resize", resize);
resize();
syncMusicButton();
showControls();
requestAnimationFrame(frame);
void holdScreen();
updateClock();
if (mode === "shift") ensureShiftBoard();
