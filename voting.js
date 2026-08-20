import { requireSession } from "./auth.js";
import {
  getStaffVotePeriods,
  listCompletedStaffVoteComments,
  listStaffVoteCandidates,
  submitStaffVote,
} from "./db.js?v=20260820-2";
import { startPresenceHeartbeat } from "./presence.js";

const statusBox = document.getElementById("votingStatus");
const errorBox = document.getElementById("votingError");
const grid = document.getElementById("votingGrid");

const PERIOD_META = {
  week: {
    title: "Сотрудник недели",
    currentLabel: "Голосование недели",
    empty: "Ну и ну! Похоже, на этой неделе все сотрудники - яма.",
  },
  month: {
    title: "Сотрудник месяца",
    currentLabel: "Голосование месяца",
    empty: "Ну и ну! Похоже, в этом месяце все сотрудники - яма.",
  },
};

let candidates = [];
let periods = [];
let commentsByPeriod = new Map();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function setError(message = "") {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.classList.toggle("hidden", !message);
}

function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDate(value) {
  const date = parseDate(value);
  return date
    ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(date)
    : "";
}

function formatRange(start, exclusiveEnd) {
  const end = parseDate(exclusiveEnd);
  if (!end) return "";
  end.setUTCDate(end.getUTCDate() - 1);
  const endText = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(end);
  return `${formatDate(start)} - ${endText}`;
}

function getInitials(name) {
  const parts = String(name || "Сотрудник").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "С";
}

function safeAvatarUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.href);
    return url.protocol === "https:" || url.origin === window.location.origin ? url.href : "";
  } catch {
    return "";
  }
}

function createAvatar(name, avatarUrl, className) {
  const safeUrl = safeAvatarUrl(avatarUrl);
  if (safeUrl) {
    const image = element("img", className);
    image.src = safeUrl;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      const fallback = element("div", className, getInitials(name));
      image.replaceWith(fallback);
    }, { once: true });
    return image;
  }
  return element("div", className, getInitials(name));
}

function resultKey(period) {
  return `${period.period_type}:${period.previous_period_start}`;
}

function normalizeMentions(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderComments(period) {
  const comments = commentsByPeriod.get(resultKey(period)) || [];
  if (!comments.length) return null;

  const details = element("details", "comments-details");
  const summary = element("summary", "comments-summary", `Анонимные комментарии: ${comments.length}`);
  const list = element("div", "comments-list");

  comments.forEach((item) => {
    const row = element("div", "comment-item");
    row.append(
      element(
        "div",
        "comment-about",
        `О ${item.nominee_display_name || "сотруднике"} · ${item.nominee_department_name || "Без отдела"}`
      ),
      element("div", "comment-text", item.comment || "")
    );
    list.append(row);
  });

  details.append(summary, list);
  return details;
}

function renderPreviousResult(period) {
  const area = element("section", "result-area");
  area.append(element("div", "result-caption", `Итоги: ${formatRange(period.previous_period_start, period.previous_period_end)}`));

  if (!Number(period.total_votes)) {
    area.append(element("div", "empty-result", PERIOD_META[period.period_type].empty));
    return area;
  }

  const stage = element("div", "winner-stage");
  const avatarWrap = element("div", "winner-avatar-wrap");
  avatarWrap.append(
    createAvatar(period.winner_display_name, period.winner_avatar_url, "winner-avatar"),
    element("span", "winner-place", "1")
  );

  stage.append(
    avatarWrap,
    element("div", "winner-name", period.winner_display_name || "Сотрудник"),
    element("div", "winner-department", period.winner_department_name || "Без отдела"),
    element("div", "winner-score", `${period.top_votes} ${voteWord(period.top_votes)} из ${period.total_votes}`)
  );

  const mentions = normalizeMentions(period.honorable_mentions);
  if (mentions.length) {
    const honorable = element("div", "honorable");
    honorable.append(element("strong", "", "Достойны упоминания: "));
    honorable.append(document.createTextNode(mentions.map((item) => item.display_name || "Сотрудник").join(", ")));
    stage.append(honorable);
  }

  const comments = renderComments(period);
  area.append(stage);
  if (comments) area.append(comments);
  return area;
}

function voteWord(count) {
  const value = Math.abs(Number(count)) % 100;
  const last = value % 10;
  if (value > 10 && value < 20) return "голосов";
  if (last === 1) return "голос";
  if (last >= 2 && last <= 4) return "голоса";
  return "голосов";
}

function appendCandidateOptions(select) {
  const byDepartment = new Map();
  candidates.forEach((candidate) => {
    const department = candidate.department_name || "Без отдела";
    if (!byDepartment.has(department)) byDepartment.set(department, []);
    byDepartment.get(department).push(candidate);
  });

  const placeholder = element("option", "", "Выберите сотрудника");
  placeholder.value = "";
  select.append(placeholder);

  [...byDepartment.entries()].forEach(([department, rows]) => {
    const group = document.createElement("optgroup");
    group.label = department;
    rows.forEach((candidate) => {
      const option = element("option", "", candidate.display_name || "Сотрудник");
      option.value = candidate.user_id;
      group.append(option);
    });
    select.append(group);
  });
}

function renderCandidatePreview(candidate) {
  const preview = element("div", "candidate-preview");
  preview.append(createAvatar(candidate.display_name, candidate.avatar_url, "candidate-avatar"));
  const copy = element("div", "min-w-0");
  copy.append(
    element("div", "candidate-name", candidate.display_name || "Сотрудник"),
    element("div", "candidate-department", candidate.department_name || "Без отдела")
  );
  preview.append(copy);
  return preview;
}

function readableSubmitError(error) {
  const message = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
  if (/ALREADY_VOTED/i.test(message)) return "Вы уже проголосовали в этом периоде.";
  if (/SELF_VOTE_DENIED/i.test(message)) return "За себя голосовать нельзя.";
  if (/NOMINEE_NOT_FOUND/i.test(message)) return "Этот сотрудник больше недоступен для голосования.";
  if (/COMMENT_TOO_LONG/i.test(message)) return "Комментарий не может быть длиннее 500 символов.";
  if (/function .*staff_vote|schema cache|PGRST202/i.test(message)) {
    return "Голосование еще не подключено к базе данных.";
  }
  return "Не удалось сохранить голос. Попробуйте еще раз.";
}

function renderVoteForm(period) {
  const area = element("section", "vote-area");
  area.append(element("div", "vote-caption", PERIOD_META[period.period_type].currentLabel));
  area.append(element("div", "period-date", formatRange(period.current_period_start, period.current_period_end)));

  if (period.has_voted) {
    area.append(element("div", "voted-message", "Ваш голос принят. Результат откроется после завершения периода."));
    return area;
  }

  if (!candidates.length) {
    area.append(element("div", "voted-message", "Сейчас нет сотрудников, доступных для голосования."));
    return area;
  }

  const form = element("form", "vote-form");
  const selectLabel = element("label", "field-label", "Кого хотите отметить?");
  const select = element("select", "vote-select");
  select.name = "nominee";
  select.required = true;
  appendCandidateOptions(select);
  selectLabel.append(select);

  const previewSlot = element("div", "hidden");
  const commentLabel = element("label", "field-label", "Почему именно этот сотрудник? Необязательно");
  const comment = element("textarea", "vote-comment");
  comment.name = "comment";
  comment.maxLength = 500;
  comment.placeholder = "Комментарий станет виден после завершения голосования, без вашего имени";
  const counter = element("span", "vote-note", "0 / 500");
  commentLabel.append(comment, counter);

  const submit = element("button", "vote-submit", "Отдать голос");
  submit.type = "submit";
  const note = element("p", "vote-note", "Один голос на этот период. Изменить выбор после отправки нельзя.");

  select.addEventListener("change", () => {
    const candidate = candidates.find((item) => item.user_id === select.value);
    previewSlot.replaceChildren();
    previewSlot.classList.toggle("hidden", !candidate);
    if (candidate) previewSlot.append(renderCandidatePreview(candidate));
  });

  comment.addEventListener("input", () => {
    counter.textContent = `${comment.value.length} / 500`;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("");
    if (!select.value) {
      setError("Выберите сотрудника.");
      select.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = "Сохраняю...";
    try {
      await submitStaffVote({
        periodType: period.period_type,
        nomineeUserId: select.value,
        comment: comment.value,
      });
      await loadDashboard();
    } catch (error) {
      console.error("Staff vote submit failed:", error);
      setError(readableSubmitError(error));
      submit.disabled = false;
      submit.textContent = "Отдать голос";
    }
  });

  form.append(selectLabel, previewSlot, commentLabel, submit, note);
  area.append(form);
  return area;
}

function renderPeriod(period) {
  const meta = PERIOD_META[period.period_type];
  const card = element("article", "period-card");
  const head = element("header", "period-head");
  const heading = element("div");
  heading.append(
    element("h2", "period-title", meta.title),
    element("div", "period-date", "Прошлый завершенный период")
  );
  head.append(heading, element("span", "period-state", period.has_voted ? "Голос учтен" : "Идет голосование"));
  card.append(head, renderPreviousResult(period), renderVoteForm(period));
  return card;
}

function renderDashboard() {
  grid.replaceChildren();
  periods.forEach((period) => {
    if (PERIOD_META[period.period_type]) grid.append(renderPeriod(period));
  });
}

async function loadDashboard() {
  if (statusBox) {
    statusBox.classList.remove("hidden");
    statusBox.textContent = "Загружаю голосование...";
  }
  setError("");

  const [candidateRows, periodRows] = await Promise.all([
    listStaffVoteCandidates(),
    getStaffVotePeriods(),
  ]);
  candidates = candidateRows;
  periods = periodRows;

  const commentEntries = await Promise.all(periods.map(async (period) => {
    try {
      const rows = await listCompletedStaffVoteComments(period.period_type, period.previous_period_start);
      return [resultKey(period), rows];
    } catch (error) {
      console.warn("Completed vote comments unavailable:", error);
      return [resultKey(period), []];
    }
  }));
  commentsByPeriod = new Map(commentEntries);
  renderDashboard();
  if (statusBox) statusBox.classList.add("hidden");
}

async function init() {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=voting.html";
    return;
  }

  startPresenceHeartbeat("Голосование");
  try {
    await loadDashboard();
  } catch (error) {
    console.error("Staff voting load failed:", error);
    if (statusBox) statusBox.classList.add("hidden");
    setError(readableSubmitError(error));
  }
}

void init();
