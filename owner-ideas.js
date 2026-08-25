import { requireSession } from "./auth.js";
import { getMyProfile, ownerDeleteProjectIdea, ownerListProjectIdeas, ownerSetProjectIdeaStatus } from "./db.js";
import { startPresenceHeartbeat } from "./presence.js";
import { confirmDialog } from "./modal.js";

const statusPill = document.getElementById("statusPill");
const errorBox = document.getElementById("errorBox");
const statusFilter = document.getElementById("statusFilter");
const refreshBtn = document.getElementById("refreshBtn");
const ideasList = document.getElementById("ideasList");
const ideasCount = document.getElementById("ideasCount");

const STATUS_LABELS = { new: "Новая", reviewed: "Рассмотрено", archived: "Архив" };

function setStatus(text) { if (statusPill) statusPill.textContent = text; }
function setError(text = "") {
  if (!errorBox) return;
  errorBox.textContent = text;
  errorBox.classList.toggle("hidden", !text);
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function statusButton(row, status, label) {
  const button = element("button", "idea-status-button", label);
  button.type = "button";
  button.disabled = row.status === status;
  button.addEventListener("click", async () => {
    button.disabled = true;
    setError("");
    try {
      await ownerSetProjectIdeaStatus(row.id, status);
      await loadIdeas();
    } catch (error) {
      setError(error?.message || "Не удалось изменить статус идеи.");
      button.disabled = false;
    }
  });
  return button;
}

function deleteButton(row) {
  const button = element("button", "idea-status-button idea-delete-button", "Удалить");
  button.type = "button";
  button.addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "Удалить идею?",
      message: `Предложение пользователя «${row.display_name || "Пользователь"}» будет удалено без возможности восстановления.`,
      note: "Подходит для тестовых и ошибочно отправленных предложений.",
      confirmText: "Удалить",
      cancelText: "Оставить",
      tone: "danger",
    });
    if (!confirmed) return;

    button.disabled = true;
    setError("");
    try {
      await ownerDeleteProjectIdea(row.id);
      await loadIdeas();
    } catch (error) {
      setError(error?.message || "Не удалось удалить идею.");
      button.disabled = false;
    }
  });
  return button;
}

function renderIdeas(rows) {
  ideasList.replaceChildren();
  ideasCount.textContent = `${rows.length}`;
  if (!rows.length) {
    ideasList.append(element("div", "ideas-empty", "Здесь пока нет идей с выбранным статусом."));
    return;
  }

  rows.forEach((row) => {
    const card = element("article", "idea-card");
    const head = element("div", "idea-card-head");
    const author = element("div");
    author.append(element("strong", "idea-author", row.display_name || "Пользователь"));
    author.append(element("div", "idea-author-meta", [row.department_name, row.email].filter(Boolean).join(" · ") || "Без отдела"));
    const badge = element("span", `idea-status status-${row.status}`, STATUS_LABELS[row.status] || row.status);
    head.append(author, badge);
    const text = element("p", "idea-text", row.idea_text);
    const foot = element("div", "idea-card-foot");
    foot.append(element("time", "idea-date", formatDate(row.created_at)));
    const actions = element("div", "idea-actions");
    actions.append(
      statusButton(row, "new", "Новая"),
      statusButton(row, "reviewed", "Рассмотрено"),
      statusButton(row, "archived", "В архив"),
      deleteButton(row)
    );
    foot.append(actions);
    card.append(head, text, foot);
    ideasList.append(card);
  });
}

async function loadIdeas() {
  refreshBtn.disabled = true;
  setStatus("Загружаю…");
  setError("");
  try {
    const rows = await ownerListProjectIdeas(statusFilter.value || null);
    renderIdeas(rows);
    setStatus("Готово");
  } catch (error) {
    const raw = String(error?.message ?? error ?? "");
    setError(/owner_list_project_ideas|PGRST202/i.test(raw) ? "Выполните SQL-скрипт 033_project_ideas.sql в Supabase." : raw || "Не удалось загрузить идеи.");
    setStatus("Ошибка");
  } finally {
    refreshBtn.disabled = false;
  }
}

async function init() {
  try { await requireSession(); } catch { location.href = "login.html?next=owner-ideas.html"; return; }
  const profile = await getMyProfile();
  if (profile?.role !== "owner") { location.href = "profile.html"; return; }
  startPresenceHeartbeat("Идеи пользователей");
  await loadIdeas();
}

statusFilter?.addEventListener("change", () => void loadIdeas());
refreshBtn?.addEventListener("click", () => void loadIdeas());
void init();
