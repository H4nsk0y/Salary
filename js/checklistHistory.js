import { requireSession } from "./auth.js";
import { getMyShiftChecklistHistory } from "./db.js";
import { startPresenceHeartbeat } from "./presence.js";
import { checklistProgress, normalizeChecklistItems } from "./shiftChecklist.js?v=20260913-2";

const loadingNotice = document.getElementById("loadingNotice");
const errorNotice = document.getElementById("errorNotice");
const archive = document.getElementById("archive");
const archiveCount = document.getElementById("archiveCount");
const archiveList = document.getElementById("archiveList");
const emptyNotice = document.getElementById("emptyNotice");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата не указана";
  return date.toLocaleString("ru-RU", { day:"numeric", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

function pluralShifts(count) {
  const value = Math.abs(Number(count) || 0) % 100;
  const last = value % 10;
  if (value > 10 && value < 20) return `${count} смен`;
  if (last === 1) return `${count} смена`;
  if (last >= 2 && last <= 4) return `${count} смены`;
  return `${count} смен`;
}

function render(rows) {
  archiveList.innerHTML = "";
  archiveCount.textContent = pluralShifts(rows.length);
  archive.classList.toggle("hidden", rows.length === 0);
  emptyNotice.classList.toggle("hidden", rows.length > 0);

  rows.forEach((completed) => {
    const items = normalizeChecklistItems(completed?.items);
    const progress = checklistProgress(items);
    const entry = element("details", "entry");
    const summary = element("summary");
    const caption = element("div");
    caption.append(
      element("div", "entry-date", formatDate(completed?.completed_at)),
      element("div", "entry-meta", `${progress.completed} из ${progress.total} выполнено`)
    );
    summary.append(caption, element("div", "entry-percent", `${progress.percent}%`));
    const list = element("div", "items");
    items.forEach((item) => {
      const row = element("div", `item${item.done ? " done" : ""}`);
      row.append(element("span", "", item.done ? "✓" : "○"), element("span", "", item.text));
      list.append(row);
    });
    entry.append(summary, list);
    archiveList.append(entry);
  });
}

async function init() {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=checklist-history.html";
    return;
  }

  startPresenceHeartbeat("Архив чек-листов");
  try {
    render(await getMyShiftChecklistHistory());
  } catch (error) {
    errorNotice.textContent = String(error?.message || "Не удалось загрузить архив.");
    errorNotice.classList.remove("hidden");
  } finally {
    loadingNotice.classList.add("hidden");
  }
}

void init();
