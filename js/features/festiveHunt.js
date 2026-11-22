import { getSession } from "../auth.js";
import { createHuntState, isValidHuntState, hashFestiveIdentity, HUNT_PAGES, GUEST_HUNT_PAGES, FESTIVE_GREETINGS } from "./festiveHuntModel.js";

const ART_URL = new URL("../../images/festive-ded-moroz.png", import.meta.url).href;
const LAUGH_URL = new URL("../../media/festive-laugh.mp3", import.meta.url).href;

export async function mountFestiveHunt({ onLaughChange = () => {} } = {}) {
  const session = await getSession().catch(() => null);
  const identity = session?.user?.id || "guest";
  const pages = session ? HUNT_PAGES : GUEST_HUNT_PAGES;
  const page = location.pathname.split("/").pop() || "index.html";
  const storageKey = `alvisa.festive2026.hunt.${hashFestiveIdentity(identity)}`;
  let state;
  try { state = JSON.parse(localStorage.getItem(storageKey)); } catch { /* A new hunt needs no account data. */ }
  if (!isValidHuntState(state, pages)) {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] ^ hashFestiveIdentity(identity);
    state = createHuntState(seed, pages, page);
  }
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* The hunt still works without persistence. */ }
  }
  save();
  const place = state.places.find(place => place.page === page && !state.found.includes(place.id));
  if (!place) return () => {};

  const host = document.createElement("aside");
  host.className = "festive-find";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "festive-father-frost";
  button.setAttribute("aria-label", "Дед Мороз с Кантиани — открыть поздравление");
  button.title = "Праздничный привет от Деда Мороза";
  const image = document.createElement("img");
  image.src = ART_URL;
  image.alt = "";
  image.width = 72;
  image.height = 108;
  image.decoding = "async";
  button.append(image);
  host.append(button);
  document.body.append(host);
  let positionTimer = 0;
  let destroyed = false;
  let laugh = null;
  let dialog = null;

  function stopLaugh() {
    laugh?.pause();
    onLaughChange(false);
  }
  function playLaugh() {
    if (!laugh) {
      laugh = new Audio(LAUGH_URL);
      laugh.preload = "none";
      laugh.volume = 0.65;
      laugh.addEventListener("ended", () => onLaughChange(false));
      laugh.addEventListener("error", () => onLaughChange(false));
    }
    laugh.currentTime = 0;
    onLaughChange(true);
    void laugh.play().catch(() => onLaughChange(false));
  }
  function showGreeting() {
    if (dialog?.open) return;
    if (!state.found.includes(place.id)) state.found.push(place.id);
    save();
    const greeting = FESTIVE_GREETINGS[place.id];
    dialog = document.createElement("dialog");
    dialog.className = "festive-greeting";
    dialog.setAttribute("aria-labelledby", "festiveGreetingTitle");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "festive-greeting-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Закрыть поздравление");
    close.title = "Закрыть";
    const content = document.createElement("div");
    content.className = "festive-greeting-content";
    const heading = document.createElement("h2");
    heading.id = "festiveGreetingTitle";
    heading.textContent = greeting.title;
    content.append(heading);
    for (const text of greeting.paragraphs) {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      content.append(paragraph);
    }
    const progress = document.createElement("p");
    progress.className = "festive-greeting-progress";
    progress.textContent = state.found.length === 3 ? "Все три праздничных привета найдены. С Новым годом!" : `Праздничных приветов найдено: ${state.found.length} из 3`;
    content.append(progress);
    dialog.append(close, content);
    document.body.append(dialog);
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.addEventListener("close", () => {
      stopLaugh();
      dialog.remove();
      host.remove();
      document.querySelector(".festive-music")?.focus({ preventScroll: true });
    }, { once: true });
    dialog.showModal();
    button.hidden = true;
    playLaugh();
  }
  button.addEventListener("click", showGreeting);

  // Look for a clear patch of the viewport; dense screens get an in-flow fallback.
  function position() {
    positionTimer = 0;
    if (destroyed || dialog?.open || !button.isConnected) return;
    const obstacles = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim() || !node.parentElement || node.parentElement.closest("script, style, .festive-find, .festive-snow, [hidden]")) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width && rect.height && rect.bottom > 0 && rect.top < innerHeight) obstacles.push(rect);
      }
    }
    for (const element of document.querySelectorAll("button, input, select, textarea, a, table, canvas:not(.festive-snow), [role=button], .app-top-header, .festive-controls")) {
      if (host.contains(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width && rect.height) obstacles.push(rect);
    }
    const top = Math.max(96, (document.querySelector(".app-top-header")?.getBoundingClientRect().bottom || 72) + 16);
    const lastTop = innerHeight - 192;
    const sides = place.side === "left" ? [16, innerWidth - 88] : [innerWidth - 88, 16];
    for (let offset = 0; offset < 5; offset++) {
      const y = top + ((place.height + offset) % 5) / 4 * Math.max(0, lastTop - top);
      for (const x of sides) {
        const clear = x >= 8 && y + 108 < innerHeight - 70 && !obstacles.some(rect => x < rect.right + 8 && x + 72 > rect.left - 8 && y < rect.bottom + 8 && y + 108 > rect.top - 8);
        if (!clear) continue;
        host.classList.remove("is-inline");
        button.style.left = `${x}px`;
        button.style.top = `${y}px`;
        return;
      }
    }
    host.classList.add("is-inline");
    const main = document.querySelector("main");
    if (main && host.parentElement !== main) main.append(host);
  }
  function queuePosition() {
    if (!positionTimer) positionTimer = setTimeout(position, 120);
  }
  window.addEventListener("resize", queuePosition);
  window.addEventListener("scroll", queuePosition, { passive: true });
  window.addEventListener("load", queuePosition, { once: true });
  image.addEventListener("load", queuePosition, { once: true });
  queuePosition();
  return () => {
    destroyed = true;
    clearTimeout(positionTimer);
    stopLaugh();
    window.removeEventListener("resize", queuePosition);
    window.removeEventListener("scroll", queuePosition);
    window.removeEventListener("load", queuePosition);
    dialog?.close();
    dialog?.remove();
    host.remove();
  };
}
