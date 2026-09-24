import { requireSession } from "./auth.js";
import { getMyProfile, listMyTimesheetsByYear } from "./db.js";
import { buildYearReview } from "./yearReviewStats.js";

const loading = document.getElementById("loading");
const errorView = document.getElementById("errorView");
const errorText = document.getElementById("errorText");
const story = document.getElementById("story");
const progress = document.getElementById("storyProgress");
const scenes = [...document.querySelectorAll(".scene")];
const requestedYear = Number(new URLSearchParams(location.search).get("year"));
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const year = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100
  ? requestedYear
  : new Date().getFullYear();

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(Number(value) || 0);
}

function firstName(profile) {
  return String(profile?.display_name || "Вы").trim().split(/\s+/)[1] || String(profile?.display_name || "Вы").trim().split(/\s+/)[0] || "Вы";
}

function currentSceneIndex() {
  const center = story.scrollTop + story.clientHeight * .5;
  return Math.max(0, scenes.findIndex((scene) => center >= scene.offsetTop && center < scene.offsetTop + scene.offsetHeight));
}

let activeAnimation = 0;
let touchStartY = null;
let transitionLockedUntil = 0;

function easeInOutSine(value) {
  return -(Math.cos(Math.PI * value) - 1) / 2;
}

function animateToScene(index) {
  const targetIndex = Math.max(0, Math.min(scenes.length - 1, index));
  const targetTop = scenes[targetIndex]?.offsetTop ?? 0;
  const startTop = story.scrollTop;
  const distance = targetTop - startTop;
  const animationId = ++activeAnimation;

  if (reduceMotion || Math.abs(distance) < 2) {
    story.scrollTop = targetTop;
    updateProgress();
    return;
  }

  const duration = Math.min(1450, Math.max(1050, Math.abs(distance) * 1.02));
  const startedAt = performance.now();
  story.classList.add("is-animating");

  function step(timestamp) {
    if (animationId !== activeAnimation) return;
    const elapsed = Math.min(1, (timestamp - startedAt) / duration);
    story.scrollTop = startTop + distance * easeInOutSine(elapsed);
    updateProgress();
    if (elapsed < 1) {
      requestAnimationFrame(step);
      return;
    }
    story.scrollTop = targetTop;
    story.classList.remove("is-animating");
    transitionLockedUntil = performance.now() + 240;
    updateProgress();
  }

  requestAnimationFrame(step);
}

function updateProgress() {
  const index = currentSceneIndex();
  progress.style.width = `${((index + 1) / scenes.length) * 100}%`;
  scenes.forEach((scene, sceneIndex) => scene.classList.toggle("is-visible", Math.abs(sceneIndex - index) <= 1));
}

function go(offset) {
  if (story.classList.contains("is-animating") || performance.now() < transitionLockedUntil) return;
  animateToScene(currentSceneIndex() + offset);
}

function render(profile, summary) {
  document.querySelectorAll("[data-year]").forEach((node) => { node.textContent = summary.year; });
  setText("reviewName", firstName(profile));
  setText("totalHours", formatNumber(summary.totalHours, 1));
  setText("totalShifts", summary.shifts);
  setText("nightShifts", summary.nightShifts);
  setText("nightHours", formatNumber(summary.nightHours, 1));
  setText("holidayHours", formatNumber(summary.holidayHours, 1));
  setText("vacationDays", summary.vacationDays);
  setText("sickDays", summary.sickDays);
  setText("longestStreak", summary.longestStreak);
  setText("busiestMonth", summary.busiestMonth?.name || "Нет заполненных месяцев");
  setText("busiestMonthHours", formatNumber(summary.busiestMonth?.hours, 1));
  setText("busiestMonthShifts", summary.busiestMonth?.shifts || 0);
  const line = document.getElementById("busiestMonthLine");
  if (line) line.style.width = `${Math.min(100, Math.max(8, (summary.busiestMonth?.hours || 0) / Math.max(summary.totalHours, 1) * 420))}%`;

  if (summary.savedPayments > 0) {
    setText("paymentsValue", `${formatNumber(summary.savedPayments)} ₽`);
    setText("paymentsCaption", summary.confirmedPaymentMonths === summary.paymentMonths
      ? `Фактически подтверждённые выплаты за ${summary.paymentMonths} мес.`
      : `Сумма по сохранённым итогам за ${summary.paymentMonths} мес.; часть месяцев рассчитана автоматически.`);
  }
}

async function init() {
  try {
    await requireSession();
  } catch {
    location.href = `login.html?next=${encodeURIComponent(`year-review.html?year=${year}`)}`;
    return;
  }

  try {
    const [profile, rows] = await Promise.all([
      getMyProfile(),
      listMyTimesheetsByYear(year, { withPayload:true }),
    ]);
    if (!rows.some((row) => row?.payload)) throw new Error(`За ${year} год пока нет сохранённых табелей.`);
    render(profile, buildYearReview(rows, year));
    loading.classList.add("hidden");
    story.classList.remove("hidden");
    scenes[0]?.classList.add("is-visible");
    updateProgress();
  } catch (error) {
    loading.classList.add("hidden");
    errorText.textContent = String(error?.message || "Не удалось загрузить сохранённые табели.");
    errorView.classList.remove("hidden");
  }
}

document.getElementById("prevScene")?.addEventListener("click", () => go(-1));
document.getElementById("nextScene")?.addEventListener("click", () => go(1));
story.addEventListener("scroll", updateProgress, { passive:true });
story.addEventListener("wheel", (event) => {
  if (Math.abs(event.deltaY) < 8) return;
  event.preventDefault();
  go(event.deltaY > 0 ? 1 : -1);
}, { passive:false });
story.addEventListener("touchstart", (event) => {
  touchStartY = event.touches[0]?.clientY ?? null;
}, { passive:true });
story.addEventListener("touchmove", (event) => {
  if (touchStartY !== null) event.preventDefault();
}, { passive:false });
story.addEventListener("touchend", (event) => {
  if (touchStartY === null) return;
  const endY = event.changedTouches[0]?.clientY ?? touchStartY;
  const distance = touchStartY - endY;
  touchStartY = null;
  if (Math.abs(distance) >= 45) go(distance > 0 ? 1 : -1);
}, { passive:true });
document.addEventListener("keydown", (event) => {
  if (["ArrowDown", "PageDown", " "].includes(event.key)) { event.preventDefault(); go(1); }
  if (["ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); go(-1); }
  if (event.key === "Escape") location.href = "index.html";
});

void init();
