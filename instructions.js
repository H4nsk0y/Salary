import { requireSession } from "./auth.js";
import { getMyDepartmentMembershipKey } from "./db.js";
import { startPresenceHeartbeat } from "./presence.js";
import "./scrollbar.js";

const EGAIS_DEPARTMENT_KEY = "egais";

const loadingState = document.getElementById("loadingState");
const accessDeniedState = document.getElementById("accessDeniedState");
const instructionsContent = document.getElementById("instructionsContent");
const instructionSearch = document.getElementById("instructionSearch");
const emptySearchState = document.getElementById("emptySearchState");
const filterButtons = [...document.querySelectorAll("[data-filter]")];
const cards = [...document.querySelectorAll("[data-card]")];
const sections = [...document.querySelectorAll("[data-section]")];

let activeFilter = "all";

function normalizeSearchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
}

function getSearchHaystack(element) {
  return normalizeSearchText([
    element.textContent,
    element.dataset.tags,
  ].filter(Boolean).join(" "));
}

function matchesFilter(element) {
  if (activeFilter === "all") return true;
  return getSearchHaystack(element).includes(normalizeSearchText(activeFilter));
}

function matchesQuery(element, query) {
  if (!query) return true;
  return getSearchHaystack(element).includes(query);
}

function applyFilters() {
  const query = normalizeSearchText(instructionSearch?.value);
  let visibleCards = 0;

  for (const card of cards) {
    const isVisible = matchesFilter(card) && matchesQuery(card, query);
    card.classList.toggle("hidden", !isVisible);
    if (isVisible) visibleCards += 1;
  }

  for (const section of sections) {
    const isVisible = matchesFilter(section) && matchesQuery(section, query);
    section.classList.toggle("hidden", !isVisible);
  }

  emptySearchState?.classList.toggle("hidden", visibleCards > 0);
}

function setActiveFilter(nextFilter) {
  activeFilter = nextFilter || "all";
  for (const button of filterButtons) {
    button.classList.toggle("is-active", button.dataset.filter === activeFilter);
  }
  applyFilters();
}

function showAccessDenied() {
  loadingState?.classList.add("hidden");
  instructionsContent?.classList.add("hidden");
  accessDeniedState?.classList.remove("hidden");
}

function showContent() {
  loadingState?.classList.add("hidden");
  accessDeniedState?.classList.add("hidden");
  instructionsContent?.classList.remove("hidden");
}

function setupInteractions() {
  instructionSearch?.addEventListener("input", applyFilters);

  for (const button of filterButtons) {
    button.addEventListener("click", () => {
      setActiveFilter(button.dataset.filter || "all");
    });
  }
}

// Функция заморожена: код сохранен для возможного возвращения раздела.
location.replace("index.html");
