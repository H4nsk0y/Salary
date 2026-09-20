import { getMyProfile } from "../db.js";
import {
  createMoneyAccessGuard,
  EYE_ICON,
  EYE_OFF_ICON,
  isMoneyProtectionEnabled,
  setRevealButtonState,
} from "../moneyPrivacy.js";

function replaceElementWithClone(element) {
  if (!element) return null;
  const clone = element.cloneNode(true);
  element.replaceWith(clone);
  return clone;
}

async function initializeCalculatorPrivacy() {
  const okladInput = document.getElementById("oklad");
  const resultsWrap = document.getElementById("resultsWrap");
  const resultsPeekText = document.getElementById("resultsPeekText");
  const resultsPeekIcon = document.getElementById("resultsPeekIcon");

  let profile = null;
  try {
    profile = await getMyProfile();
  } catch {
    profile = null;
  }

  const protectionEnabled = isMoneyProtectionEnabled(profile);
  const ensureMoneyAccess = createMoneyAccessGuard(profile, {
    title: "Показать результаты",
    description: "Введите 4-значный PIN-код, чтобы показать оклад и расчёт зарплаты.",
    confirmText: "Показать",
  });

  let okladVisible = !protectionEnabled;
  let resultsVisible = !protectionEnabled;
  const okladPeekBtn = replaceElementWithClone(document.getElementById("okladPeekBtn"));
  const resultsPeekBtn = replaceElementWithClone(document.getElementById("resultsPeekBtn"));

  const applyOkladVisibility = () => {
    if (!okladInput) return;
    okladInput.type = okladVisible ? "text" : "password";
    if (!okladPeekBtn) return;
    okladPeekBtn.innerHTML = okladVisible ? EYE_OFF_ICON : EYE_ICON;
    okladPeekBtn.setAttribute("aria-label", okladVisible ? "Скрыть оклад" : "Показать оклад");
  };

  const applyResultsVisibility = () => {
    resultsWrap?.classList.toggle("is-hidden", !resultsVisible);
    if (!resultsPeekBtn) return;
    setRevealButtonState({
      hidden: !resultsVisible,
      button: resultsPeekBtn,
      textEl: resultsPeekText,
      iconEl: resultsPeekIcon,
      showText: "Показать",
      hideText: "Скрыть",
      showAria: "Показать результаты",
      hideAria: "Скрыть результаты",
    });
  };

  applyOkladVisibility();
  applyResultsVisibility();

  okladPeekBtn?.addEventListener("click", async (event) => {
    event.preventDefault();
    if (!okladVisible && protectionEnabled && !(await ensureMoneyAccess())) return;
    okladVisible = !okladVisible;
    applyOkladVisibility();
  });

  resultsPeekBtn?.addEventListener("click", async () => {
    if (!resultsVisible && protectionEnabled && !(await ensureMoneyAccess())) return;
    resultsVisible = !resultsVisible;
    applyResultsVisibility();
  });
}

void initializeCalculatorPrivacy();
