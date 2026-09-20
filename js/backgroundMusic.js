const MUSIC_ENABLED_KEY = "alvisa.backgroundMusic.enabled.v1";
const MUSIC_POSITION_KEY = "alvisa.backgroundMusic.position.v1";
const MUSIC_EVENT = "alvisa:background-music-change";
const TRACK_URL = new URL("../media/almost-here.mp3", import.meta.url).href;

let audio = null;
let enabled = readEnabled();
let resumeListenersInstalled = false;
let lastPositionSaveAt = 0;

function readEnabled() {
  try {
    return localStorage.getItem(MUSIC_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function readPosition() {
  try {
    const value = Number(localStorage.getItem(MUSIC_POSITION_KEY));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function saveEnabled(value) {
  try {
    localStorage.setItem(MUSIC_ENABLED_KEY, value ? "1" : "0");
  } catch {
    // Music remains usable for the current page when storage is unavailable.
  }
}

function savePosition(force = false) {
  if (!audio) return;
  const now = Date.now();
  if (!force && now - lastPositionSaveAt < 1000) return;
  lastPositionSaveAt = now;
  try {
    localStorage.setItem(MUSIC_POSITION_KEY, String(audio.currentTime || 0));
  } catch {
    // Position persistence is optional.
  }
}

function dispatchState(blocked = false) {
  window.dispatchEvent(new CustomEvent(MUSIC_EVENT, {
    detail: { enabled, playing: Boolean(audio && !audio.paused), blocked },
  }));
}

function ensureAudio() {
  if (audio) return audio;

  audio = new Audio(TRACK_URL);
  audio.loop = true;
  audio.preload = "none";
  audio.volume = 0.65;
  audio.addEventListener("loadedmetadata", () => {
    const savedPosition = readPosition();
    if (savedPosition > 0 && Number.isFinite(audio.duration) && savedPosition < audio.duration) {
      audio.currentTime = savedPosition;
    }
  }, { once: true });
  audio.addEventListener("timeupdate", () => savePosition());
  audio.addEventListener("play", () => dispatchState(false));
  audio.addEventListener("pause", () => dispatchState(false));
  return audio;
}

function removeResumeListeners() {
  if (!resumeListenersInstalled) return;
  resumeListenersInstalled = false;
  document.removeEventListener("pointerdown", resumeAfterInteraction, true);
  document.removeEventListener("keydown", resumeAfterInteraction, true);
}

async function resumeAfterInteraction() {
  removeResumeListeners();
  if (enabled) await playBackgroundMusic();
}

function installResumeListeners() {
  if (resumeListenersInstalled) return;
  resumeListenersInstalled = true;
  document.addEventListener("pointerdown", resumeAfterInteraction, { capture: true, once: true });
  document.addEventListener("keydown", resumeAfterInteraction, { capture: true, once: true });
}

export function isBackgroundMusicEnabled() {
  return enabled;
}

export async function playBackgroundMusic() {
  enabled = true;
  saveEnabled(true);
  const player = ensureAudio();

  try {
    await player.play();
    removeResumeListeners();
    dispatchState(false);
    return true;
  } catch {
    installResumeListeners();
    dispatchState(true);
    return false;
  }
}

export function stopBackgroundMusic() {
  enabled = false;
  saveEnabled(false);
  removeResumeListeners();
  if (audio) {
    savePosition(true);
    audio.pause();
  }
  dispatchState(false);
}

export async function toggleBackgroundMusic() {
  if (enabled) {
    stopBackgroundMusic();
    return false;
  }

  await playBackgroundMusic();
  return true;
}

window.addEventListener("beforeunload", () => savePosition(true));
window.addEventListener("storage", (event) => {
  if (event.key !== MUSIC_ENABLED_KEY) return;
  enabled = event.newValue === "1";
  if (enabled) void playBackgroundMusic();
  else stopBackgroundMusic();
});

if (enabled) void playBackgroundMusic();
