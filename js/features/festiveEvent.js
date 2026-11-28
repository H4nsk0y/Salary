import { stopBackgroundMusic } from "../backgroundMusic.js";
import { mountFestiveHunt } from "./festiveHunt.js";
import { isFestiveHuntSeason, FESTIVE_HUNT_START, FESTIVE_HUNT_END } from './festiveHuntModel.js';

const MUSIC_KEY = "alvisa.festive2026.music";
const POSITION_KEY = "alvisa.festive2026.position";
const SNOW_KEY = "alvisa.festive2026.snow";
const CLAIM_EVENT = "alvisa:audio-claim";
const TRACK_URL = new URL("../../media/festive-new-year-160k.mp3", import.meta.url).href;

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Preferences are optional. */ }
}

export function mountFestiveEvent() {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new URL("../../styles/festive-event.css", import.meta.url).href;
  document.head.append(stylesheet);
  const canvas = document.createElement("canvas");
  canvas.className = "festive-snow";
  canvas.setAttribute("aria-hidden", "true");
  const dock = document.createElement("div");
  dock.className = "festive-controls";
  dock.setAttribute("role", "group");
  dock.setAttribute("aria-label", "Новогоднее настроение");
  const musicButton = document.createElement("button");
  musicButton.type = "button";
  musicButton.className = "festive-music";
  const musicIcon = document.createElement("span");
  musicIcon.textContent = "♫";
  musicIcon.setAttribute("aria-hidden", "true");
  musicButton.append(musicIcon);
  const snowButton = document.createElement("button");
  snowButton.type = "button";
  snowButton.className = "festive-snow-toggle";
  const snowIcon = document.createElement("span");
  snowIcon.textContent = "❄";
  snowIcon.setAttribute("aria-hidden", "true");
  snowButton.append(snowIcon);
  dock.append(musicButton, snowButton);
  document.body.append(canvas, dock);

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let snowEnabled = read(SNOW_KEY) !== "0";
  let musicEnabled = read(MUSIC_KEY) === "1";
  let blocked = false;
  let disposed = false;
  let audio = null;
  let frame = 0;
  let previousTime = 0;
  let width = 0;
  let height = 0;
  let flakes = [];
  let lastPositionSave = 0;
  let disposeHunt = null;
  let huntLoading = false;
  let huntBoundary = 0;
  async function refreshHunt() {
    if (disposed || !isFestiveHuntSeason()) {
      disposeHunt?.();
      disposeHunt = null;
      return;
    }
    if (disposeHunt || huntLoading) return;
    huntLoading = true;
    try {
      const dispose = await mountFestiveHunt();
      if (disposed || !isFestiveHuntSeason()) dispose();
      else disposeHunt = dispose;
    } catch (error) { console.warn('Праздничный привет недоступен:', error); }
    finally { huntLoading = false; }
  }
  function scheduleHuntBoundary() {
    clearTimeout(huntBoundary);
    const now = Date.now();
    const next = now < FESTIVE_HUNT_START ? FESTIVE_HUNT_START : now < FESTIVE_HUNT_END ? FESTIVE_HUNT_END : 0;
    if (next) huntBoundary = setTimeout(() => { void refreshHunt(); scheduleHuntBoundary(); }, Math.min(next - now, 2_147_000_000));
  }
  const context = canvas.getContext("2d");

  function updateButtons() {
    const playing = musicEnabled && audio && !audio.paused;
    const musicLabel = blocked ? "Продолжить новогоднюю музыку" : playing ? "Выключить новогоднюю музыку" : "Включить новогоднюю музыку";
    musicButton.title = musicLabel;
    musicButton.setAttribute("aria-label", musicLabel);
    musicButton.setAttribute("aria-pressed", String(Boolean(playing)));
    musicButton.classList.toggle("is-muted", !playing);
    const snowVisible = snowEnabled && !reducedMotion.matches;
    const snowLabel = reducedMotion.matches ? "Снег отключён: включено уменьшение анимации" : snowEnabled ? "Выключить снег" : "Включить снег";
    snowButton.title = snowLabel;
    snowButton.setAttribute("aria-label", snowLabel);
    snowButton.setAttribute("aria-pressed", String(snowVisible));
    snowButton.disabled = reducedMotion.matches;
  }

  function savePosition() {
    if (audio) write(POSITION_KEY, String(audio.currentTime || 0));
  }
  function stopMusic(persist = true) {
    musicEnabled = false;
    blocked = false;
    savePosition();
    audio?.pause();
    if (persist) write(MUSIC_KEY, "0");
    updateButtons();
  }
  async function playMusic() {
    window.dispatchEvent(new CustomEvent(CLAIM_EVENT, { detail: { source: "festive" } }));
    stopBackgroundMusic();
    musicEnabled = true;
    write(MUSIC_KEY, "1");
    if (!audio) {
      audio = new Audio(TRACK_URL);
      audio.loop = true;
      audio.preload = "none";
      audio.volume = 0.25;
      audio.addEventListener("loadedmetadata", () => {
        const position = Number(read(POSITION_KEY));
        if (position > 0 && position < audio.duration) audio.currentTime = position;
      }, { once: true });
      audio.addEventListener("timeupdate", () => {
        if (Date.now() - lastPositionSave < 2000) return;
        lastPositionSave = Date.now();
        savePosition();
      });
      audio.addEventListener("error", () => {
        stopMusic();
        musicButton.title = "Не удалось загрузить музыку. Попробуйте ещё раз";
        musicButton.setAttribute("aria-label", musicButton.title);
      });
      audio.addEventListener("pause", updateButtons);
      audio.addEventListener("play", updateButtons);
    }
    try {
      await audio.play();
      if (disposed || !musicEnabled) audio.pause();
      blocked = false;
    } catch {
      blocked = true;
    }
    updateButtons();
  }
  musicButton.addEventListener("click", () => {
    if (musicEnabled && !blocked) stopMusic();
    else void playMusic();
  });

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.min(64, Math.max(24, Math.round(width / 23)));
    flakes = Array.from({ length: count }, () => ({
      x: Math.random() * width, y: Math.random() * height,
      radius: 1 + Math.random() * 1.5, speed: 16 + Math.random() * 18,
      phase: Math.random() * Math.PI * 2,
    }));
  }
  function draw(time) {
    const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 0;
    previousTime = time;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(241,238,232,0.48)";
    for (const flake of flakes) {
      flake.y += flake.speed * delta;
      flake.x += Math.sin(time / 3000 + flake.phase) * 5 * delta;
      if (flake.y > height + 4) { flake.y = -4; flake.x = Math.random() * width; }
      context.beginPath();
      context.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
      context.fill();
    }
    frame = requestAnimationFrame(draw);
  }
  function syncSnow() {
    cancelAnimationFrame(frame);
    previousTime = 0;
    const visible = Boolean(context) && snowEnabled && !reducedMotion.matches && !document.hidden;
    canvas.hidden = !visible;
    if (visible && !disposed) frame = requestAnimationFrame(draw);
    updateButtons();
  }
  snowButton.addEventListener("click", () => {
    snowEnabled = !snowEnabled;
    write(SNOW_KEY, snowEnabled ? "1" : "0");
    syncSnow();
  });
  function onClaim(event) {
    if (event.detail?.source !== "festive") stopMusic();
  }
  function onStorage(event) {
    if (event.key === MUSIC_KEY) {
      if (event.newValue === "1") void playMusic();
      else stopMusic(false);
    }
    if (event.key === SNOW_KEY) {
      snowEnabled = event.newValue !== "0";
      syncSnow();
    }
  }
  window.addEventListener(CLAIM_EVENT, onClaim);
  window.addEventListener("storage", onStorage);
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", syncSnow);
  reducedMotion.addEventListener("change", syncSnow);
  resize();
  syncSnow();
  void refreshHunt();
  const huntTimer = setInterval(refreshHunt, 60000);
  scheduleHuntBoundary();
  document.addEventListener('visibilitychange', refreshHunt);
  if (musicEnabled) void playMusic();
  return () => {
    disposed = true;
    clearInterval(huntTimer);
    clearTimeout(huntBoundary);
    document.removeEventListener('visibilitychange', refreshHunt);
    disposeHunt?.();
    stopMusic(false);
    cancelAnimationFrame(frame);
    window.removeEventListener(CLAIM_EVENT, onClaim);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", syncSnow);
    reducedMotion.removeEventListener("change", syncSnow);
    canvas.remove();
    dock.remove();
    stylesheet.remove();
  };
}
