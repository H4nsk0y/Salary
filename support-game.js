import { getSession } from "./auth.js";
import { listEasterRunnerLeaderboard, submitEasterRunnerScore } from "./db.js";

const REWARD_KEY_PREFIX = "alvisa.easterRunner.reward.v1";
const PENDING_REWARD_KEY = "alvisa.easterRunner.pendingReward.v1";
const SOUND_SETTING_KEY = "alvisa.easterRunner.soundEnabled.v1";
const MODE_SETTING_KEY = "alvisa.easterRunner.mode.v1";
const BOSS_FIGHT_UNLOCK_KEY_PREFIX = "alvisa.easterRunner.bossFightUnlocked.v1";
const PENDING_BOSS_FIGHT_UNLOCK_KEY = "alvisa.easterRunner.pendingBossFightUnlock.v1";
const LEADERBOARD_LIMIT = 5;
const REWARD_SCORE = 350;
const SCORE_SOUND_THRESHOLD = 300;
const MUSIC_STEP_MS = 150;
const WORLD_HEIGHT = 360;
const GROUND_Y = 294;
const BACKGROUND_SCROLL_FACTOR = 0.16;
const HARDCORE_SECRET_OBSTACLE_CHANCE = 0.05;
const HARDCORE_SECRET_SPEED_MULTIPLIER = 1.85;
const HARDCORE_EVENT_START_AT = Date.parse("2026-07-19T00:00:00+03:00");
const HARDCORE_EVENT_END_AT = Date.parse("2026-07-27T00:00:00+03:00");
const SLIDE_DURATION = 0.68;
const DAMAGE_REVEAL_MS = 900;
const BOSS_SCORE_THRESHOLDS = [300, 600, 1000];
const BOSS_DIFFICULTY_MULTIPLIERS = [1, 2, 4];
const BOSS_ENTRANCE_DURATION = 1.45;
const BOSS_INITIAL_ATTACK_DELAY = 1.6;
const BOSS_ATTACK_POSE_DURATION = 0.5;
const BOSS_WAVE_COUNT = 4;
const BOSS_WAVE_BREAK = 1.067;
const BOSS_VICTORY_POSE_DURATION = 3.2;
const BOSS_TURBO_SPEED_MULTIPLIER = 2.2275;
const BOSS_FIGHT_WAVE_SPEED_MULTIPLIER = 1.15;
const BOSS_WAVES = [
  {
    duration: 32,
    projectileSpeed: 480,
    attackInterval: 1.85,
    highAttackChance: 0.18,
    burstChance: 0,
    burstGap: 1.12,
    turboChance: 0,
  },
  {
    duration: 36,
    projectileSpeed: 624,
    attackInterval: 1.58,
    highAttackChance: 0.32,
    burstChance: 0.14,
    burstGap: 1.02,
    turboChance: 0.025,
  },
  {
    duration: 40,
    projectileSpeed: 811,
    attackInterval: 1.32,
    highAttackChance: 0.46,
    burstChance: 0.24,
    burstGap: 0.9,
    turboChance: 0.045,
  },
  {
    duration: 44,
    projectileSpeed: 1055,
    attackInterval: 1.08,
    highAttackChance: 0.6,
    burstChance: 0.34,
    burstGap: 0.78,
    turboChance: 0.07,
  },
];
const GAME_MODES = {
  normal: {
    key: "normal",
    label: "Обычный",
    badge: "NORMAL",
    intro: "Перепрыгивайте палеты, подкатывайтесь под рич-траки и продержитесь как можно дольше. Прыжок: W, пробел или стрелка вверх. Подкат: S или стрелка вниз.",
    baseSpeed: 720,
    speedBoost: 92,
    speedStepScore: 200,
    initialSpawn: 1.1,
    spawnBase: 1.15,
    spawnRandom: 0.72,
    spawnPenalty: 0.06,
    minSpawn: 0.68,
    obstacleWeights: { single: 5, tall: 3, chaos: 2, richTruck: 2 },
    getPoints: (passed) => (passed % 10 === 0 ? 10 : 3),
  },
  hardcore: {
    key: "hardcore",
    label: "Хардкор",
    badge: "HARD",
    intro: "Скорость сразу высокая: прыгайте через палеты и успевайте делать подкат под рич-траки. Прыжок: W, пробел или стрелка вверх. Подкат: S или стрелка вниз.",
    baseSpeed: 806,
    speedBoost: 93.6,
    speedStepScore: 15,
    initialSpawn: 0.85,
    spawnBase: 0.9,
    spawnRandom: 0.46,
    spawnPenalty: 0.035,
    minSpawn: 0.56,
    obstacleWeights: { single: 3, tall: 4, chaos: 4, richTruck: 3 },
    getPoints: (passed) => (passed % 10 === 0 ? 10 : 3),
  },
  bossfight: {
    key: "bossfight",
    label: "Босс-файт",
    badge: "BOSS",
    intro: "Бесконечная тренировка против босса. После каждой волны снаряды становятся быстрее. Прыжок: W, пробел или стрелка вверх. Подкат: S или стрелка вниз.",
    baseSpeed: 0,
    speedBoost: 0,
    speedStepScore: Number.POSITIVE_INFINITY,
    initialSpawn: Number.POSITIVE_INFINITY,
    spawnBase: Number.POSITIVE_INFINITY,
    spawnRandom: 0,
    spawnPenalty: 0,
    minSpawn: Number.POSITIVE_INFINITY,
    obstacleWeights: {},
    getPoints: () => 0,
  },
};
const MUSIC_BARS = [
  [659.25, 0, 783.99, 880, 783.99, 0, 659.25, 587.33, 523.25, 0, 587.33, 659.25, 783.99, 659.25, 587.33, 0],
  [523.25, 0, 659.25, 783.99, 880, 783.99, 659.25, 0, 698.46, 659.25, 587.33, 523.25, 587.33, 0, 659.25, 0],
  [880, 0, 783.99, 659.25, 587.33, 659.25, 783.99, 0, 987.77, 880, 783.99, 659.25, 698.46, 0, 783.99, 0],
  [659.25, 587.33, 523.25, 0, 659.25, 783.99, 880, 0, 783.99, 698.46, 659.25, 587.33, 523.25, 0, 0, 0],
  [523.25, 587.33, 659.25, 0, 523.25, 659.25, 783.99, 0, 587.33, 659.25, 698.46, 659.25, 587.33, 523.25, 493.88, 0],
  [659.25, 0, 698.46, 659.25, 587.33, 0, 523.25, 493.88, 523.25, 587.33, 659.25, 783.99, 698.46, 659.25, 587.33, 0],
  [783.99, 880, 987.77, 0, 880, 783.99, 698.46, 0, 659.25, 698.46, 783.99, 880, 783.99, 0, 659.25, 0],
  [587.33, 659.25, 783.99, 0, 698.46, 659.25, 587.33, 0, 523.25, 587.33, 659.25, 698.46, 659.25, 587.33, 523.25, 0],
  [659.25, 783.99, 880, 0, 1046.5, 987.77, 880, 0, 783.99, 880, 987.77, 783.99, 698.46, 659.25, 587.33, 0],
  [523.25, 0, 587.33, 659.25, 698.46, 0, 659.25, 587.33, 523.25, 493.88, 523.25, 587.33, 659.25, 0, 523.25, 0],
  [880, 783.99, 698.46, 659.25, 783.99, 0, 659.25, 0, 587.33, 659.25, 698.46, 783.99, 880, 0, 783.99, 0],
  [659.25, 0, 783.99, 880, 783.99, 698.46, 659.25, 0, 587.33, 523.25, 587.33, 659.25, 523.25, 0, 0, 0],
];
const MUSIC_MELODY = MUSIC_BARS.flat();
const MUSIC_BASS_BY_BAR = [130.81, 174.61, 220, 196, 130.81, 146.83, 196, 174.61, 220, 130.81, 174.61, 196];

const elements = {
  trigger: document.getElementById("supportEasterTrigger"),
  overlay: document.getElementById("easterGameOverlay"),
  canvas: document.getElementById("easterGameCanvas"),
  close: document.getElementById("easterGameCloseBtn"),
  pause: document.getElementById("easterGamePauseBtn"),
  pauseIcon: document.getElementById("easterGamePauseIcon"),
  resumeIcon: document.getElementById("easterGameResumeIcon"),
  sound: document.getElementById("easterGameSoundBtn"),
  soundOnIcon: document.getElementById("easterGameSoundOnIcon"),
  soundOffIcon: document.getElementById("easterGameSoundOffIcon"),
  fullscreen: document.getElementById("easterGameFullscreenBtn"),
  enterFullscreenIcon: document.getElementById("easterGameEnterFullscreenIcon"),
  exitFullscreenIcon: document.getElementById("easterGameExitFullscreenIcon"),
  jump: document.getElementById("easterGameJumpBtn"),
  slide: document.getElementById("easterGameSlideBtn"),
  start: document.getElementById("easterGameStartBtn"),
  score: document.getElementById("easterGameScore"),
  passed: document.getElementById("easterGamePassed"),
  message: document.getElementById("easterGameMessage"),
  messageEyebrow: document.getElementById("easterGameMessageEyebrow"),
  messageTitle: document.getElementById("easterGameMessageTitle"),
  messageText: document.getElementById("easterGameMessageText"),
  modePicker: document.getElementById("easterGameModePicker"),
  modeButtons: Array.from(document.querySelectorAll("[data-easter-mode]")),
  leaderboard: document.getElementById("easterGameLeaderboard"),
  leaderboardTitle: document.getElementById("easterGameLeaderboardTitle"),
  leaderboardBadge: document.getElementById("easterGameLeaderboardBadge"),
  leaderboardList: document.getElementById("easterGameLeaderboardList"),
  leaderboardEmpty: document.getElementById("easterGameLeaderboardEmpty"),
};

const context = elements.canvas?.getContext("2d");
const idleRunnerImage = new Image();
const runRunnerImage = new Image();
const jumpRunnerImage = new Image();
const slideRunnerImage = new Image();
const legDamageRunnerImage = new Image();
const headDamageRunnerImage = new Image();
const palletImage = new Image();
const palletTallImage = new Image();
const palletChaosImage = new Image();
const richTruckImage = new Image();
const warehouseBackgroundImage = new Image();
const bossImage = new Image();
const bossAttackImage = new Image();
const bossHighAttackImage = new Image();
const bossWinImage = new Image();
const bossLossImage = new Image();
const acidImage = new Image();
const acidPuddleImage = new Image();
const bossMusic = new Audio("./audio/easter-boss-theme.mp3");
const gameImages = [
  idleRunnerImage,
  runRunnerImage,
  jumpRunnerImage,
  slideRunnerImage,
  legDamageRunnerImage,
  headDamageRunnerImage,
  palletImage,
  palletTallImage,
  palletChaosImage,
  richTruckImage,
  warehouseBackgroundImage,
  bossImage,
  bossAttackImage,
  bossHighAttackImage,
  bossWinImage,
  bossLossImage,
  acidImage,
  acidPuddleImage,
];
gameImages.forEach((image) => {
  image.decoding = "async";
});
idleRunnerImage.src = "./images/easter-runner-idle.png";
runRunnerImage.src = "./images/easter-runner-run.png";
jumpRunnerImage.src = "./images/easter-runner-jump.png";
slideRunnerImage.src = "./images/easter-runner_ride.png";
legDamageRunnerImage.src = "./images/easter-runner-damage_1.png";
headDamageRunnerImage.src = "./images/easter-runner-damage_2.png";
palletImage.src = "./images/easter-pallet.png";
palletTallImage.src = "./images/easter-pallet-tall.png";
palletChaosImage.src = "./images/easter-pallet-chaos.png";
richTruckImage.src = "./images/easter-rich-truck.png";
warehouseBackgroundImage.src = "./images/easter-warehouse-bg.png";
bossImage.src = "./images/boss.png";
bossAttackImage.src = "./images/boss_attack.png";
bossHighAttackImage.src = "./images/boss_attack_2.png";
bossWinImage.src = "./images/boss_win.png";
bossLossImage.src = "./images/boss_loss.png";
acidImage.src = "./images/sliz.png";
acidPuddleImage.src = "./images/luja.png";
bossMusic.loop = true;
bossMusic.preload = "auto";
bossMusic.volume = 0.22;

async function prepareGameAssets() {
  await Promise.allSettled(gameImages.map(async (image) => {
    if (!image.complete) {
      await new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    }
    if (image.complete && image.naturalWidth && typeof image.decode === "function") {
      await image.decode().catch(() => {});
    }
  }));

  const warmupCanvas = document.createElement("canvas");
  warmupCanvas.width = 2;
  warmupCanvas.height = 2;
  const warmupContext = warmupCanvas.getContext("2d");
  gameImages.forEach((image) => {
    if (warmupContext && image.complete && image.naturalWidth) {
      warmupContext.drawImage(image, 0, 0, 1, 1);
    }
  });
}

const OBSTACLE_TYPES = {
  single: {
    key: "single",
    image: palletImage,
    fallbackRatio: 0.89,
    minHeight: 52,
    maxHeight: 70,
    insetX: 5,
    insetTop: 6,
  },
  tall: {
    key: "tall",
    image: palletTallImage,
    fallbackRatio: 0.94,
    minHeight: 78,
    maxHeight: 96,
    insetX: 7,
    insetTop: 7,
  },
  chaos: {
    key: "chaos",
    image: palletChaosImage,
    fallbackRatio: 0.74,
    minHeight: 86,
    maxHeight: 104,
    insetX: 8,
    insetTop: 8,
  },
  richTruck: {
    key: "richTruck",
    image: richTruckImage,
    fallbackRatio: 1,
    renderRatio: 0.68,
    minHeight: 206,
    maxHeight: 232,
    insetX: 0,
    insetTop: 0,
    airborne: true,
  },
};

let currentUserId = null;
let currentMode = GAME_MODES[localStorage.getItem(MODE_SETTING_KEY)] ? localStorage.getItem(MODE_SETTING_KEY) : "normal";
let triggerClicks = 0;
let triggerTimer = null;
let animationFrame = 0;
let lastFrameTime = 0;
let worldWidth = 960;
let phase = "ready";
let score = 0;
let passedObstacles = 0;
let passedPallets = 0;
let speed = GAME_MODES.normal.baseSpeed;
let speedLevel = 0;
let spawnTimer = 1.1;
let obstacles = [];
let particles = [];
let scorePopups = [];
let rewardUnlockedThisRun = false;
let scoreSoundPlayed = false;
let soundEnabled = localStorage.getItem(SOUND_SETTING_KEY) !== "false";
let audioContext = null;
let musicTimer = 0;
let musicStep = 0;
let backgroundOffset = 0;
let damageType = null;
let damageStartedAt = 0;
let acidProjectiles = [];
let bossFight = createBossFightState();
let defeatedBosses = 0;
let bossFightModeUnlocked = false;

const dino = {
  x: 105,
  y: GROUND_Y - 82,
  width: 50,
  height: 82,
  velocityY: 0,
  grounded: true,
  sliding: false,
  slideTimer: 0,
};

function createBossFightState() {
  return {
    active: false,
    stage: "none",
    encounter: 0,
    difficultyMultiplier: 1,
    endless: false,
    x: 0,
    targetX: 0,
    entranceElapsed: 0,
    attackTimer: BOSS_INITIAL_ATTACK_DELAY,
    attackPoseTimer: 0,
    attackState: "idle",
    currentAttack: null,
    attackQueue: [],
    wave: 1,
    waveElapsed: 0,
    waveBreakTimer: 0,
    waveEnding: false,
    victoryTimer: 0,
    shotsFired: 0,
  };
}

function getModeConfig(modeKey = currentMode) {
  return GAME_MODES[modeKey] || GAME_MODES.normal;
}

function isHardcoreEventActive(now = Date.now()) {
  return now >= HARDCORE_EVENT_START_AT && now < HARDCORE_EVENT_END_AT;
}

function getHardcoreSecretObstacleChance() {
  return isHardcoreEventActive()
    ? HARDCORE_SECRET_OBSTACLE_CHANCE / 2
    : HARDCORE_SECRET_OBSTACLE_CHANCE;
}

function getModeIntro(mode = getModeConfig()) {
  if (mode.key === "hardcore" && isHardcoreEventActive()) {
    return `${mode.intro} Ивент до конца 26 июля: палета +5, каждая 5-я +10, каждая 10-я +20, сверхбыстрое препятствие +80 очков.`;
  }
  return mode.intro;
}

function getObstacleRatio(type) {
  if (Number.isFinite(type?.renderRatio) && type.renderRatio > 0) return type.renderRatio;
  const image = type.image;
  if (image?.naturalWidth && image?.naturalHeight) {
    return image.naturalWidth / image.naturalHeight;
  }
  return type.fallbackRatio;
}

function syncModeControls() {
  const mode = getModeConfig();
  elements.modeButtons.forEach((button) => {
    const modeKey = button.dataset.easterMode;
    const locked = button.dataset.easterMode === "bossfight" && !bossFightModeUnlocked;
    const title = button.querySelector(".easter-mode-title");
    const hint = button.querySelector(".easter-mode-hint");
    button.classList.toggle("is-locked", locked);
    button.disabled = locked || phase === "running" || phase === "paused";
    if (modeKey === "bossfight") {
      if (title) title.textContent = locked ? "Секретный уровень" : "Босс-файт";
      if (hint) {
        hint.textContent = locked
          ? "Условие открытия неизвестно"
          : "Бесконечные волны для тренировки";
      }
    }
    if (modeKey === "hardcore" && hint) {
      hint.textContent = isHardcoreEventActive()
        ? "Ивент: палеты +5/+10/+20, быстрое +80"
        : "Быстро, каждый 10-й палет +10";
    }
    const selected = modeKey === mode.key;
    button.setAttribute("aria-pressed", String(selected));
  });
  if (elements.leaderboardTitle) elements.leaderboardTitle.textContent = `Топ-5: ${mode.label}`;
  if (elements.leaderboardBadge) elements.leaderboardBadge.textContent = mode.badge;
}

function setGameMode(modeKey) {
  if (
    !GAME_MODES[modeKey]
    || (modeKey === "bossfight" && !bossFightModeUnlocked)
    || phase === "running"
    || phase === "paused"
  ) return;
  currentMode = modeKey;
  localStorage.setItem(MODE_SETTING_KEY, currentMode);
  syncModeControls();

  if (phase === "ready") {
    elements.messageText.textContent = getModeIntro();
  }

  if (phase === "gameover" && !elements.leaderboard?.classList.contains("hidden")) {
    void renderLeaderboard(null, currentMode);
  }
}

function getBossFightUnlockKey(userId = currentUserId) {
  return userId
    ? `${BOSS_FIGHT_UNLOCK_KEY_PREFIX}:${userId}`
    : PENDING_BOSS_FIGHT_UNLOCK_KEY;
}

function refreshBossFightModeAccess() {
  const pendingUnlock = localStorage.getItem(PENDING_BOSS_FIGHT_UNLOCK_KEY) === "true";
  const accountUnlock = currentUserId
    ? localStorage.getItem(getBossFightUnlockKey(currentUserId)) === "true"
    : false;
  const previousVictory = currentUserId
    ? Boolean(localStorage.getItem(`${REWARD_KEY_PREFIX}:${currentUserId}`))
    : Boolean(localStorage.getItem(PENDING_REWARD_KEY));

  if (currentUserId && (pendingUnlock || previousVictory)) {
    localStorage.setItem(getBossFightUnlockKey(currentUserId), "true");
    localStorage.removeItem(PENDING_BOSS_FIGHT_UNLOCK_KEY);
  }

  bossFightModeUnlocked = pendingUnlock || accountUnlock || previousVictory;
  if (currentMode === "bossfight" && !bossFightModeUnlocked) {
    currentMode = "normal";
    localStorage.setItem(MODE_SETTING_KEY, currentMode);
  }
  syncModeControls();
}

function unlockBossFightMode() {
  if (bossFightModeUnlocked) return;
  bossFightModeUnlocked = true;
  localStorage.setItem(getBossFightUnlockKey(), "true");
  syncModeControls();
}

function resizeCanvas() {
  if (!elements.canvas || !context) return;
  const rect = elements.canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  worldWidth = Math.max(480, WORLD_HEIGHT * (rect.width / Math.max(1, rect.height)));
  elements.canvas.width = Math.round(worldWidth * ratio);
  elements.canvas.height = Math.round(WORLD_HEIGHT * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  dino.x = Math.min(105, worldWidth * 0.18);
}

function resetRunner() {
  const mode = getModeConfig();
  stopBossMusic({ rewind: true });
  score = 0;
  passedObstacles = 0;
  passedPallets = 0;
  speed = mode.baseSpeed;
  speedLevel = 0;
  spawnTimer = mode.initialSpawn;
  obstacles = [];
  particles = [];
  scorePopups = [];
  rewardUnlockedThisRun = false;
  scoreSoundPlayed = false;
  musicStep = 0;
  backgroundOffset = 0;
  damageType = null;
  damageStartedAt = 0;
  acidProjectiles = [];
  bossFight = createBossFightState();
  defeatedBosses = 0;
  dino.y = GROUND_Y - dino.height;
  dino.velocityY = 0;
  dino.grounded = true;
  dino.sliding = false;
  dino.slideTimer = 0;
  elements.score.textContent = "0";
  elements.passed.textContent = "0";
}

function getAudioContext() {
  if (!soundEnabled) return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) audioContext = new AudioContextClass();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

function playTone({ frequency, endFrequency = frequency, duration = 0.12, delay = 0, type = "sine", gain = 0.04 }) {
  const audio = getAudioContext();
  if (!audio) return;
  const startAt = audio.currentTime + delay;
  const stopAt = startAt + duration;
  const oscillator = audio.createOscillator();
  const volume = audio.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(1, frequency), startAt);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), stopAt);
  volume.gain.setValueAtTime(0.0001, startAt);
  volume.gain.exponentialRampToValueAtTime(gain, startAt + Math.min(0.018, duration / 3));
  volume.gain.exponentialRampToValueAtTime(0.0001, stopAt);
  oscillator.connect(volume);
  volume.connect(audio.destination);
  oscillator.start(startAt);
  oscillator.stop(stopAt + 0.02);
}

function playMetalClick({ delay = 0, gain = 0.012 } = {}) {
  const audio = getAudioContext();
  if (!audio) return;
  const duration = 0.035;
  const startAt = audio.currentTime + delay;
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    const fade = 1 - index / samples.length;
    samples[index] = (Math.random() * 2 - 1) * fade * fade;
  }

  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const volume = audio.createGain();
  source.buffer = buffer;
  filter.type = "highpass";
  filter.frequency.setValueAtTime(2600, startAt);
  volume.gain.setValueAtTime(gain, startAt);
  volume.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  source.connect(filter);
  filter.connect(volume);
  volume.connect(audio.destination);
  source.start(startAt);
}

function playJumpSound() {
  playTone({ frequency: 220, endFrequency: 480, duration: 0.11, type: "square", gain: 0.025 });
  playTone({ frequency: 330, endFrequency: 620, duration: 0.08, delay: 0.025, gain: 0.02 });
}

function playScoreSound() {
  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    playTone({ frequency, endFrequency: frequency * 1.04, duration: 0.2, delay: index * 0.11, type: "triangle", gain: 0.04 });
  });
}

function playPointSound(points) {
  if (points >= 10) {
    playMetalClick({ gain: 0.016 });
    playTone({ frequency: 1450, endFrequency: 2050, duration: 0.055, type: "sine", gain: 0.012 });
    playMetalClick({ delay: 0.085, gain: 0.014 });
    playTone({ frequency: 1900, endFrequency: 2700, duration: 0.065, delay: 0.085, type: "sine", gain: 0.011 });
    return;
  }
  playMetalClick();
  playTone({ frequency: 1500, endFrequency: 2150, duration: 0.05, type: "sine", gain: 0.009 });
}

function playDefeatSound() {
  playTone({ frequency: 190, endFrequency: 65, duration: 0.5, type: "sawtooth", gain: 0.035 });
  playTone({ frequency: 120, endFrequency: 50, duration: 0.46, delay: 0.06, type: "triangle", gain: 0.035 });
}

function stopBackgroundMusic() {
  window.clearTimeout(musicTimer);
  musicTimer = 0;
}

function stopBossMusic({ rewind = false } = {}) {
  bossMusic.pause();
  if (rewind) bossMusic.currentTime = 0;
}

function startBossMusic({ restart = false } = {}) {
  if (!soundEnabled || phase !== "running" || document.hidden || !bossFight.active) return;
  stopBackgroundMusic();
  if (restart) bossMusic.currentTime = 0;
  void bossMusic.play().catch(() => {});
}

function playBackgroundMusicStep() {
  if (!soundEnabled || phase !== "running" || document.hidden || bossFight.active) {
    stopBackgroundMusic();
    return;
  }

  const melodyFrequency = MUSIC_MELODY[musicStep % MUSIC_MELODY.length];
  if (melodyFrequency) {
    playTone({
      frequency: melodyFrequency,
      endFrequency: melodyFrequency,
      duration: 0.105,
      type: "square",
      gain: 0.006,
    });
  }
  if (musicStep % 4 === 0) {
    const barIndex = Math.floor(musicStep / 16) % MUSIC_BASS_BY_BAR.length;
    const bassRoot = MUSIC_BASS_BY_BAR[barIndex];
    const bassFrequency = Math.floor(musicStep / 4) % 2 === 0 ? bassRoot : bassRoot * 1.5;
    playTone({
      frequency: bassFrequency,
      endFrequency: bassFrequency,
      duration: 0.13,
      type: "triangle",
      gain: 0.004,
    });
  }

  musicStep = (musicStep + 1) % MUSIC_MELODY.length;
  musicTimer = window.setTimeout(playBackgroundMusicStep, MUSIC_STEP_MS);
}

function startBackgroundMusic() {
  stopBackgroundMusic();
  if (!soundEnabled || phase !== "running" || document.hidden || bossFight.active) return;
  playBackgroundMusicStep();
}

function syncSoundButton() {
  if (!elements.sound) return;
  const supported = Boolean(window.AudioContext || window.webkitAudioContext);
  elements.sound.classList.toggle("hidden", !supported);
  if (!supported) return;
  elements.sound.setAttribute("aria-pressed", String(soundEnabled));
  elements.sound.setAttribute("aria-label", soundEnabled ? "Отключить звук" : "Включить звук");
  elements.sound.title = soundEnabled ? "Отключить звук" : "Включить звук";
  elements.soundOnIcon.classList.toggle("hidden", !soundEnabled);
  elements.soundOffIcon.classList.toggle("hidden", soundEnabled);
}

function syncPauseButton() {
  if (!elements.pause) return;
  const paused = phase === "paused";
  const available = phase === "running" || paused;
  elements.pause.disabled = !available;
  elements.pause.setAttribute("aria-pressed", String(paused));
  elements.pause.setAttribute("aria-label", paused ? "Продолжить игру" : "Поставить на паузу");
  elements.pause.title = paused ? "Продолжить игру" : "Поставить на паузу";
  elements.pauseIcon.classList.toggle("hidden", paused);
  elements.resumeIcon.classList.toggle("hidden", !paused);
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_SETTING_KEY, String(soundEnabled));
  syncSoundButton();
  if (soundEnabled) {
    getAudioContext();
    if (phase === "running") {
      if (bossFight.active) startBossMusic();
      else startBackgroundMusic();
    }
  } else {
    stopBackgroundMusic();
    stopBossMusic();
    if (audioContext?.state === "running") void audioContext.suspend();
  }
}

function setLeaderboardMessage(message) {
  if (!elements.leaderboardList || !elements.leaderboardEmpty) return;
  elements.leaderboardList.replaceChildren();
  elements.leaderboardEmpty.textContent = message;
  elements.leaderboardEmpty.classList.remove("hidden");
}

async function renderLeaderboard(currentUser = null, modeKey = currentMode) {
  if (!elements.leaderboardList || !elements.leaderboardEmpty) return;
  const mode = getModeConfig(modeKey);
  if (elements.leaderboardTitle) elements.leaderboardTitle.textContent = `Топ-5: ${mode.label}`;
  if (elements.leaderboardBadge) elements.leaderboardBadge.textContent = mode.badge;

  let entries = [];
  try {
    entries = await listEasterRunnerLeaderboard(mode.key, LEADERBOARD_LIMIT);
  } catch (error) {
    console.warn("Не удалось загрузить таблицу лидеров", error);
    setLeaderboardMessage("Общий топ появится после запуска SQL-скрипта для таблицы лидеров.");
    return;
  }

  elements.leaderboardList.replaceChildren();
  elements.leaderboardEmpty.textContent = `Пока нет результатов в режиме "${mode.label}". Этот забег может стать первым.`;
  elements.leaderboardEmpty.classList.toggle("hidden", entries.length > 0);

  entries.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = `easter-leaderboard-row${entry.user_id === currentUser ? " is-current" : ""}`;

    const rank = document.createElement("div");
    rank.className = "easter-leaderboard-rank";
    rank.textContent = String(entry.rank || index + 1);

    const result = document.createElement("div");
    result.className = "min-w-0";

    const scoreLine = document.createElement("div");
    scoreLine.className = "easter-leaderboard-score";
    scoreLine.textContent = entry.display_name || "Сотрудник";

    const meta = document.createElement("div");
    meta.className = "easter-leaderboard-meta";
    meta.textContent = `Палеты: ${entry.passed}`;

    const scoreValue = document.createElement("div");
    scoreValue.className = "easter-leaderboard-date";
    scoreValue.textContent = `${entry.score} очков`;

    result.append(scoreLine, meta);
    row.append(rank, result, scoreValue);
    elements.leaderboardList.append(row);
  });
}

async function saveAndRenderLeaderboard({ modeKey, finalScore, finalPassed } = {}) {
  setLeaderboardMessage("Загружаем общий топ...");

  try {
    await submitEasterRunnerScore({
      mode: modeKey,
      score: finalScore,
      passed: finalPassed,
    });
  } catch (error) {
    console.warn("Не удалось сохранить результат", error);
    setLeaderboardMessage("Не удалось сохранить результат. Проверь, запущен ли SQL-скрипт для таблицы лидеров.");
    return;
  }

  await renderLeaderboard(currentUserId, modeKey);
}

function showMessage({ eyebrow, title, text, button, leaderboard = false, modePicker = true }) {
  syncModeControls();
  elements.messageEyebrow.textContent = eyebrow;
  elements.messageTitle.textContent = title;
  elements.messageText.textContent = text;
  elements.start.querySelector("span").textContent = button;
  elements.modePicker?.classList.toggle("hidden", !modePicker);
  elements.message.classList.toggle("with-leaderboard", leaderboard);
  elements.leaderboard?.classList.toggle("hidden", !leaderboard);
  elements.message.classList.remove("hidden");
}

function hideMessage() {
  elements.message.classList.add("hidden");
}

function openGame() {
  if (!elements.overlay || !context) return;
  elements.overlay.classList.remove("hidden");
  elements.overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  phase = "ready";
  syncPauseButton();
  resetRunner();
  showMessage({
    eyebrow: "Пасхалка найдена",
    title: "ЕГАИСные гонки",
    text: getModeIntro(),
    button: "Начать",
  });
  requestAnimationFrame(() => {
    resizeCanvas();
    lastFrameTime = performance.now();
    animationFrame = requestAnimationFrame(gameLoop);
    elements.start.focus();
  });
}

function nativeFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function isGameFullscreen() {
  return elements.overlay?.classList.contains("is-game-fullscreen") || false;
}

function syncFullscreenButton() {
  const expanded = isGameFullscreen();
  elements.fullscreen?.setAttribute("aria-pressed", String(expanded));
  elements.fullscreen?.setAttribute("aria-label", expanded ? "Выйти из полноэкранного режима" : "На весь экран");
  elements.fullscreen?.setAttribute("title", expanded ? "Свернуть" : "На весь экран");
  elements.enterFullscreenIcon?.classList.toggle("hidden", expanded);
  elements.exitFullscreenIcon?.classList.toggle("hidden", !expanded);
}

function refreshFullscreenLayout() {
  requestAnimationFrame(() => {
    resizeCanvas();
    requestAnimationFrame(resizeCanvas);
  });
}

async function enterGameFullscreen() {
  if (!elements.overlay) return;
  elements.overlay.classList.add("is-game-fullscreen");
  syncFullscreenButton();
  refreshFullscreenLayout();

  const requestFullscreen = elements.overlay.requestFullscreen
    || elements.overlay.webkitRequestFullscreen;
  if (!requestFullscreen || nativeFullscreenElement()) return;

  try {
    await requestFullscreen.call(elements.overlay);
  } catch {
    // CSS expansion remains available on browsers without element fullscreen.
  }
}

async function exitGameFullscreen() {
  const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
  if (nativeFullscreenElement() && exitFullscreen) {
    try {
      await exitFullscreen.call(document);
    } catch {
      // The CSS state is still cleared below.
    }
  }
  elements.overlay?.classList.remove("is-game-fullscreen");
  syncFullscreenButton();
  refreshFullscreenLayout();
}

function toggleGameFullscreen() {
  if (isGameFullscreen()) void exitGameFullscreen();
  else void enterGameFullscreen();
}

function closeGame() {
  stopBackgroundMusic();
  stopBossMusic({ rewind: true });
  if (nativeFullscreenElement()) {
    const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
    if (exitFullscreen) {
      try {
        const exitResult = exitFullscreen.call(document);
        if (exitResult?.catch) void exitResult.catch(() => {});
      } catch {
        // Closing the overlay still restores the regular page state.
      }
    }
  }
  elements.overlay.classList.remove("is-game-fullscreen");
  syncFullscreenButton();
  elements.overlay.classList.add("hidden");
  elements.overlay.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  phase = "ready";
  syncPauseButton();
  elements.trigger.focus();
}

function startGame() {
  getAudioContext();
  resetRunner();
  phase = "running";
  syncPauseButton();
  hideMessage();
  lastFrameTime = performance.now();
  if (currentMode === "bossfight") beginBossFight();
  else startBackgroundMusic();
}

function pauseGame({ focusControl = true } = {}) {
  if (phase !== "running") return;
  phase = "paused";
  stopBackgroundMusic();
  stopBossMusic();
  syncPauseButton();
  showMessage({
    eyebrow: "Забег приостановлен",
    title: "Пауза",
    text: "Игра продолжится с того же места.",
    button: "Продолжить",
    modePicker: false,
  });
  if (focusControl) elements.start.focus();
}

function resumeGame() {
  if (phase !== "paused") return;
  phase = "running";
  syncPauseButton();
  hideMessage();
  lastFrameTime = performance.now();
  if (bossFight.active) startBossMusic();
  else startBackgroundMusic();
}

function togglePause() {
  if (phase === "running") pauseGame();
  else if (phase === "paused") resumeGame();
}

function handleStartButton() {
  if (phase === "paused") resumeGame();
  else startGame();
}

function jump() {
  if (phase === "ready" || phase === "gameover") {
    startGame();
    return;
  }
  if (phase !== "running" || !dino.grounded || dino.sliding) return;
  dino.velocityY = -790;
  dino.grounded = false;
  dino.sliding = false;
  dino.slideTimer = 0;
  playJumpSound();
  for (let index = 0; index < 5; index += 1) {
    particles.push({
      x: dino.x + 12,
      y: GROUND_Y - 4,
      velocityX: -70 - Math.random() * 80,
      velocityY: -20 - Math.random() * 45,
      life: 0.45,
      color: "rgba(148,163,184,.55)",
      size: 3 + Math.random() * 3,
    });
  }
}

function slide() {
  if (phase === "ready" || phase === "gameover") {
    startGame();
    return;
  }
  if (phase !== "running" || !dino.grounded || dino.sliding) return;
  dino.sliding = true;
  dino.slideTimer = SLIDE_DURATION;
  playMetalClick({ gain: 0.014 });
  for (let index = 0; index < 7; index += 1) {
    particles.push({
      x: dino.x + 16 + Math.random() * 36,
      y: GROUND_Y - 7,
      velocityX: -95 - Math.random() * 130,
      velocityY: -8 - Math.random() * 18,
      life: 0.36,
      color: "rgba(203,213,225,.46)",
      size: 2 + Math.random() * 4,
    });
  }
}

function chooseObstacleType() {
  const weights = getModeConfig().obstacleWeights;
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = Math.random() * total;

  for (const [key, weight] of entries) {
    cursor -= weight;
    if (cursor <= 0) return OBSTACLE_TYPES[key] || OBSTACLE_TYPES.single;
  }

  return OBSTACLE_TYPES.single;
}

function spawnObstacle() {
  const type = chooseObstacleType();
  const height = type.minHeight + Math.random() * (type.maxHeight - type.minHeight);
  const width = height * getObstacleRatio(type);
  const mode = getModeConfig();
  const secretSpeed = mode.key === "hardcore" && Math.random() < getHardcoreSecretObstacleChance()
    ? mode.baseSpeed * HARDCORE_SECRET_SPEED_MULTIPLIER
    : null;

  obstacles.push({
    x: worldWidth + width,
    previousX: worldWidth + width,
    y: GROUND_Y - height,
    width,
    height,
    type,
    secretSpeed,
    counted: false,
  });
}

function beginBossFight() {
  const endless = currentMode === "bossfight";
  if (bossFight.active || (!endless && currentMode !== "hardcore")) return;

  const encounter = endless ? 1 : defeatedBosses + 1;
  if (encounter > BOSS_SCORE_THRESHOLDS.length) return;
  const bossHeight = 255;
  const bossWidth = bossImage.naturalWidth && bossImage.naturalHeight
    ? bossHeight * (bossImage.naturalWidth / bossImage.naturalHeight)
    : 150;

  obstacles = [];
  spawnTimer = Number.POSITIVE_INFINITY;
  bossFight = {
    ...createBossFightState(),
    active: true,
    stage: "entering",
    encounter,
    difficultyMultiplier: BOSS_DIFFICULTY_MULTIPLIERS[encounter - 1],
    endless,
    x: worldWidth + bossWidth + 24,
    targetX: worldWidth - bossWidth - 28,
  };
  stopBackgroundMusic();
  startBossMusic({ restart: true });
  scorePopups.push({
    x: worldWidth / 2,
    y: 122,
    text: "БОСС-ФАЙТ!",
    life: 2,
    large: true,
  });
  playTone({ frequency: 130, endFrequency: 65, duration: 0.42, type: "sawtooth", gain: 0.045 });
}

function getObstaclePoints(mode, obstacle) {
  const isPallet = obstacle.type?.key !== "richTruck";
  if (isPallet) passedPallets += 1;

  if (mode.key !== "hardcore" || !isHardcoreEventActive()) {
    return mode.getPoints(passedObstacles);
  }
  if (obstacle.secretSpeed) return 80;
  if (!isPallet) return 3;
  if (passedPallets % 10 === 0) return 20;
  if (passedPallets % 5 === 0) return 10;
  return 5;
}

function addScore(obstacle) {
  if (obstacle.counted || obstacle.x + obstacle.width >= dino.x) return;
  obstacle.counted = true;
  passedObstacles += 1;
  const mode = getModeConfig();
  const points = getObstaclePoints(mode, obstacle);
  const previousScore = score;
  score += points;
  elements.score.textContent = String(score);
  elements.passed.textContent = String(passedObstacles);
  scorePopups.push({ x: dino.x + 28, y: dino.y - 8, text: `+${points}`, life: 0.8 });

  const nextBossScore = BOSS_SCORE_THRESHOLDS[defeatedBosses];
  if (
    mode.key === "hardcore"
    && Number.isFinite(nextBossScore)
    && score >= nextBossScore
    && !bossFight.active
  ) {
    beginBossFight();
    if (!scoreSoundPlayed) {
      scoreSoundPlayed = true;
      playScoreSound();
    }
    return;
  }

  const nextSpeedLevel = mode.key === "hardcore"
    ? Math.floor(passedObstacles / mode.speedStepScore)
    : Math.floor(score / mode.speedStepScore);
  if (nextSpeedLevel > speedLevel) {
    speedLevel = nextSpeedLevel;
    scorePopups.push({ x: worldWidth / 2, y: 95, text: "УСКОРЕНИЕ!", life: 1.25, large: true });
  }

  if (!scoreSoundPlayed && previousScore < SCORE_SOUND_THRESHOLD && score >= SCORE_SOUND_THRESHOLD) {
    scoreSoundPlayed = true;
    playScoreSound();
  } else {
    playPointSound(points);
  }

  if (!rewardUnlockedThisRun && score >= REWARD_SCORE) unlockReward();
}

function getBossWaveConfig() {
  return BOSS_WAVES[Math.min(BOSS_WAVES.length - 1, Math.max(0, bossFight.wave - 1))];
}

function getBossDifficultyMultiplier() {
  return Math.max(1, bossFight.difficultyMultiplier || 1);
}

function getBossWaveSpeedMultiplier() {
  return bossFight.endless
    ? Math.pow(BOSS_FIGHT_WAVE_SPEED_MULTIPLIER, Math.max(0, bossFight.wave - 1))
    : 1;
}

function chooseBossAttackType(config, previousType = null) {
  if (previousType) return previousType === "low" ? "high" : "low";
  return Math.random() < config.highAttackChance ? "high" : "low";
}

function buildBossAttackSequence() {
  const config = getBossWaveConfig();
  const difficulty = getBossDifficultyMultiplier();
  const burstChance = Math.min(0.85, config.burstChance * difficulty);
  const tripleBurstChance = Math.min(0.8, 0.28 * difficulty);
  const turboChance = Math.min(0.45, config.turboChance * difficulty);
  const isBurst = bossFight.wave > 1 && Math.random() < burstChance;
  const burstCount = isBurst && bossFight.wave >= BOSS_WAVE_COUNT && Math.random() < tripleBurstChance
    ? 3
    : isBurst ? 2 : 1;
  const sequence = [];
  let previousType = null;

  for (let index = 0; index < burstCount; index += 1) {
    const type = chooseBossAttackType(config, previousType);
    sequence.push({
      type,
      turbo: !isBurst && Math.random() < turboChance,
    });
    previousType = type;
  }

  return sequence;
}

function beginBossCharge(attack) {
  bossFight.currentAttack = attack;
  bossFight.attackState = "charging";
  bossFight.attackPoseTimer = attack.turbo
    ? BOSS_ATTACK_POSE_DURATION * (2 / 3)
    : BOSS_ATTACK_POSE_DURATION;
  const isHigh = attack.type === "high";
  const isTurbo = attack.turbo;
  playTone({
    frequency: isTurbo ? 245 : isHigh ? 175 : 105,
    endFrequency: isTurbo ? 390 : isHigh ? 110 : 155,
    duration: isTurbo ? 0.32 : 0.22,
    type: "sawtooth",
    gain: isTurbo ? 0.028 : 0.018,
  });
  if (isTurbo) {
    scorePopups.push({
      x: worldWidth * 0.72,
      y: 78,
      text: "БЫСТРАЯ АТАКА!",
      life: 0.9,
      large: true,
    });
  }
}

function spawnAcidProjectile(attack) {
  const isHigh = attack.type === "high";
  const projectileImage = isHigh ? acidImage : acidPuddleImage;
  const width = isHigh ? 136 : 132;
  const ratio = projectileImage.naturalWidth && projectileImage.naturalHeight
    ? projectileImage.naturalHeight / projectileImage.naturalWidth
    : isHigh ? 0.72 : 0.25;
  const height = width * ratio;
  const config = getBossWaveConfig();
  const speed = config.projectileSpeed
    * getBossDifficultyMultiplier()
    * getBossWaveSpeedMultiplier()
    * (attack.turbo ? BOSS_TURBO_SPEED_MULTIPLIER : 1);
  const y = isHigh
    ? GROUND_Y - height - 63
    : GROUND_Y - height - 2;

  acidProjectiles.push({
    x: bossFight.x - 8,
    previousX: bossFight.x - 8,
    y,
    width,
    height,
    speed,
    type: attack.type,
    turbo: attack.turbo,
    counted: false,
    hitInsetX: isHigh ? 0.18 : 0.12,
    hitInsetY: isHigh ? 0.12 : 0.15,
    hitTop: isHigh ? GROUND_Y - 164 : null,
    hitBottom: isHigh ? GROUND_Y - 56 : null,
  });
  bossFight.shotsFired += 1;
  playTone({
    frequency: isHigh ? 260 : 180,
    endFrequency: isHigh ? 105 : 78,
    duration: 0.18,
    type: "sawtooth",
    gain: attack.turbo ? 0.035 : 0.025,
  });
}

function beginBossDefeat() {
  if (["defeated", "final-victory", "retreating"].includes(bossFight.stage)) return;
  const isFinalEncounter = bossFight.encounter === BOSS_SCORE_THRESHOLDS.length;
  defeatedBosses = Math.max(defeatedBosses, bossFight.encounter);
  if (bossFight.encounter === 1) unlockBossFightMode();
  bossFight.stage = isFinalEncounter ? "final-victory" : "defeated";
  bossFight.attackState = "idle";
  bossFight.currentAttack = null;
  bossFight.attackQueue = [];
  bossFight.victoryTimer = BOSS_VICTORY_POSE_DURATION;
  stopBossMusic({ rewind: true });
  scorePopups.push({
    x: worldWidth / 2,
    y: 122,
    text: isFinalEncounter ? "ВЫ СПАСЛИ АЛВИСУ!" : "ОНА ЕЩЁ ВЕРНЁТСЯ",
    life: 2.4,
    large: true,
  });
  createVictoryParticles();
  playScoreSound();
}

function finishFinalBossVictory() {
  if (phase !== "running") return;
  const finishedMode = currentMode;
  const finalScore = score;
  const finalPassed = passedObstacles;
  phase = "gameover";
  syncPauseButton();
  stopBackgroundMusic();
  stopBossMusic({ rewind: true });
  showMessage({
    eyebrow: "АЛВИСА СПАСЕНА",
    title: "Вы спасли АЛВИСУ",
    text: `Все три босса побеждены. Итоговый результат: ${finalScore} очков.`,
    button: "Сыграть ещё раз",
    leaderboard: true,
  });
  void saveAndRenderLeaderboard({
    modeKey: finishedMode,
    finalScore,
    finalPassed,
  });
}

function beginBossRetreat() {
  if (bossFight.stage === "retreating") return;
  bossFight.stage = "retreating";
  bossFight.attackState = "idle";
  bossFight.currentAttack = null;
  bossFight.attackPoseTimer = 0;
}

function collisionWithAcid(projectile) {
  const runner = getRunnerHitbox();
  const insetX = projectile.width * projectile.hitInsetX;
  const insetY = projectile.height * projectile.hitInsetY;
  const left = projectile.x + insetX;
  const right = projectile.x + projectile.width - insetX;
  const previousLeft = projectile.previousX + insetX;
  const previousRight = projectile.previousX + projectile.width - insetX;
  const sweptLeft = Math.min(left, previousLeft);
  const sweptRight = Math.max(right, previousRight);
  const top = projectile.hitTop ?? projectile.y + insetY;
  const bottom = projectile.hitBottom ?? projectile.y + projectile.height - insetY;

  return (
    runner.left < sweptRight &&
    runner.right > sweptLeft &&
    runner.top < bottom &&
    runner.bottom > top
  );
}

function updateBossFight(delta) {
  if (!bossFight.active) return;

  if (bossFight.stage === "entering") {
    bossFight.entranceElapsed += delta;
    const progress = Math.min(1, bossFight.entranceElapsed / BOSS_ENTRANCE_DURATION);
    const eased = 1 - Math.pow(1 - progress, 3);
    bossFight.x += (bossFight.targetX - bossFight.x) * Math.min(1, eased * 0.12 + delta * 4);

    if (progress >= 1 || Math.abs(bossFight.x - bossFight.targetX) < 1) {
      bossFight.x = bossFight.targetX;
      bossFight.stage = "fighting";
      bossFight.attackTimer = Math.max(0.45, BOSS_INITIAL_ATTACK_DELAY / getBossDifficultyMultiplier());
    }
    return;
  }

  if (bossFight.stage === "player-lost") return;

  if (bossFight.stage === "defeated" || bossFight.stage === "final-victory") {
    bossFight.victoryTimer = Math.max(0, bossFight.victoryTimer - delta);
    if (bossFight.victoryTimer <= 0) {
      if (bossFight.stage === "final-victory") finishFinalBossVictory();
      else beginBossRetreat();
    }
    return;
  }

  if (bossFight.stage === "retreating") {
    bossFight.x += Math.max(360, worldWidth * 0.48) * delta;
    if (bossFight.x > worldWidth + 260) {
      bossFight = createBossFightState();
      acidProjectiles = [];
      spawnTimer = 0.9;
      startBackgroundMusic();
    }
    return;
  }

  if (bossFight.stage === "wave-break" && acidProjectiles.length === 0) {
    bossFight.waveBreakTimer = Math.max(0, bossFight.waveBreakTimer - delta);
    if (bossFight.waveBreakTimer <= 0) {
      bossFight.wave += 1;
      bossFight.waveElapsed = 0;
      bossFight.waveEnding = false;
      bossFight.attackTimer = Math.max(0.4, 1.15 / getBossDifficultyMultiplier());
      bossFight.stage = "fighting";
      scorePopups.push({
        x: worldWidth / 2,
        y: 122,
        text: `ВОЛНА ${bossFight.wave}`,
        life: 1.5,
        large: true,
      });
    }
  }

  if (bossFight.stage === "fighting") {
    const config = getBossWaveConfig();
    bossFight.waveElapsed += delta;
    if (bossFight.waveElapsed >= config.duration) bossFight.waveEnding = true;

    if (bossFight.attackState === "charging") {
      bossFight.attackPoseTimer = Math.max(0, bossFight.attackPoseTimer - delta);
      if (bossFight.attackPoseTimer <= 0) {
        spawnAcidProjectile(bossFight.currentAttack);
        bossFight.attackState = "idle";
        bossFight.currentAttack = null;
        const difficulty = getBossDifficultyMultiplier();
        bossFight.attackTimer = bossFight.attackQueue.length
          ? Math.max(0.26, config.burstGap / difficulty)
          : Math.max(0.3, config.attackInterval / difficulty) + Math.random() * (0.28 / difficulty);
      }
    } else {
      bossFight.attackTimer -= delta;
      if (bossFight.attackTimer <= 0) {
        if (!bossFight.attackQueue.length && !bossFight.waveEnding) {
          bossFight.attackQueue = buildBossAttackSequence();
        }
        const nextAttack = bossFight.attackQueue.shift();
        if (nextAttack) beginBossCharge(nextAttack);
      }
    }

    if (
      bossFight.waveEnding
      && bossFight.attackState === "idle"
      && bossFight.attackQueue.length === 0
    ) {
      if (!bossFight.endless && bossFight.wave >= BOSS_WAVE_COUNT) {
        bossFight.stage = "clearing";
      } else {
        bossFight.stage = "wave-break";
        bossFight.waveBreakTimer = BOSS_WAVE_BREAK;
      }
    }
  }

  for (const projectile of acidProjectiles) {
    projectile.previousX = projectile.x;
    projectile.x -= projectile.speed * delta;
    if (
      bossFight.endless
      && !projectile.counted
      && projectile.x + projectile.width < dino.x
    ) {
      projectile.counted = true;
      score += 1;
      passedObstacles += 1;
      elements.score.textContent = String(score);
      elements.passed.textContent = String(passedObstacles);
      playPointSound(1);
    }
    if (phase === "running" && collisionWithAcid(projectile)) {
      loseGame({ type: { key: projectile.type === "high" ? "acidHigh" : "acidLow" } });
      break;
    }
  }
  acidProjectiles = acidProjectiles.filter((projectile) => projectile.x + projectile.width > -30);
  if (bossFight.stage === "clearing" && acidProjectiles.length === 0) beginBossDefeat();
}

function collisionWith(obstacle) {
  const runner = getRunnerHitbox();
  const hitboxes = getObstacleHitboxes(obstacle, obstacle.x);
  const previousHitboxes = obstacle.previousX === undefined
    ? []
    : getObstacleHitboxes(obstacle, obstacle.previousX);

  return hitboxes.some((box, index) => {
    const hasVerticalOverlap = runner.top < box.bottom && runner.bottom > box.top;
    if (!hasVerticalOverlap) return false;

    const hasCurrentOverlap = runner.left < box.right && runner.right > box.left;
    if (hasCurrentOverlap) return true;

    const previous = previousHitboxes[index];
    if (!previous) return false;

    const sweptLeft = Math.min(previous.left, box.left);
    const sweptRight = Math.max(previous.right, box.right);
    return runner.left < sweptRight && runner.right > sweptLeft;
  });
}

function getRunnerHitbox() {
  if (dino.sliding && dino.grounded) {
    return {
      left: dino.x + 2,
      right: dino.x + 82,
      top: GROUND_Y - 38,
      bottom: GROUND_Y - 5,
    };
  }

  return {
    left: dino.x + 8,
    right: dino.x + dino.width - 8,
    top: dino.y + 7,
    bottom: dino.y + dino.height - 4,
  };
}

function getObstacleHitboxes(obstacle, x = obstacle.x) {
  if (obstacle.type?.key === "richTruck") {
    return [
      {
        left: x + obstacle.width * 0.18,
        right: x + obstacle.width * 0.86,
        top: Math.max(obstacle.y + 18, GROUND_Y - obstacle.height + 20),
        bottom: GROUND_Y - 45,
      },
      {
        left: x + obstacle.width * 0.24,
        right: x + obstacle.width * 0.80,
        top: GROUND_Y - 88,
        bottom: GROUND_Y - 52,
      },
    ];
  }

  const obstacleInsetX = obstacle.type?.insetX ?? 5;
  const obstacleInsetTop = obstacle.type?.insetTop ?? 6;
  return [
    {
      left: x + obstacleInsetX,
      right: x + obstacle.width - obstacleInsetX,
      top: obstacle.y + obstacleInsetTop,
      bottom: obstacle.y + obstacle.height,
    },
  ];
}

function loseGame(obstacle) {
  const finishedMode = currentMode;
  const finalScore = score;
  const finalPassed = passedObstacles;
  const finalBossWave = bossFight.wave;
  const bossTraining = finishedMode === "bossfight";
  const collisionType = obstacle?.type?.key;
  const lostDuringBossFight = bossFight.active
    && !["defeated", "final-victory", "retreating", "player-lost"].includes(bossFight.stage);
  damageType = collisionType === "richTruck" || collisionType === "acidHigh" ? "head" : "leg";
  damageStartedAt = performance.now();
  if (lostDuringBossFight) {
    bossFight.stage = "player-lost";
    bossFight.attackState = "idle";
    bossFight.currentAttack = null;
    bossFight.attackQueue = [];
    acidProjectiles = [];
  }
  phase = "gameover";
  syncPauseButton();
  stopBackgroundMusic();
  stopBossMusic({ rewind: true });
  playDefeatSound();
  const collisionStartedAt = damageStartedAt;
  setTimeout(() => {
    if (phase !== "gameover" || damageStartedAt !== collisionStartedAt) return;
    showMessage({
      eyebrow: bossTraining ? "Тренировка окончена" : "Забег окончен",
      title: bossTraining ? `Волна ${finalBossWave}` : `${finalScore} очков`,
      text: bossTraining
        ? `Успешно отражено снарядов: ${finalPassed}. Следующая попытка начнётся с первой волны.`
        : `Пройдено препятствий: ${finalPassed}. Попробуйте побить общий рекорд.`,
      button: "Ещё раз",
      leaderboard: !bossTraining,
    });
  }, DAMAGE_REVEAL_MS);
  if (!bossTraining) {
    void saveAndRenderLeaderboard({
      modeKey: finishedMode,
      finalScore,
      finalPassed,
    });
  }
}

function saveReward() {
  const completedAt = new Date().toISOString();
  if (currentUserId) {
    localStorage.setItem(`${REWARD_KEY_PREFIX}:${currentUserId}`, completedAt);
  } else {
    localStorage.setItem(PENDING_REWARD_KEY, completedAt);
  }
}

function createVictoryParticles() {
  const colors = ["#fbbf24", "#34d399", "#38bdf8", "#f472b6", "#c4b5fd"];
  for (let index = 0; index < 130; index += 1) {
    particles.push({
      x: Math.random() * worldWidth,
      y: -20 - Math.random() * 160,
      velocityX: -45 + Math.random() * 90,
      velocityY: 85 + Math.random() * 180,
      life: 2.8 + Math.random() * 1.8,
      color: randomColor(colors),
      size: 4 + Math.random() * 6,
      confetti: true,
    });
  }
}

function randomColor(colors) {
  return colors[Math.floor(Math.random() * colors.length)];
}

function unlockReward() {
  rewardUnlockedThisRun = true;
  saveReward();
  createVictoryParticles();
  scorePopups.push({ x: worldWidth / 2, y: 132, text: "СЕКРЕТ ОТКРЫТ", life: 1.8, large: true });
}

function updateParticles(delta) {
  particles.forEach((particle) => {
    particle.x += particle.velocityX * delta;
    particle.y += particle.velocityY * delta;
    particle.velocityY += (particle.confetti ? 35 : 130) * delta;
    particle.life -= delta;
  });
  particles = particles.filter((particle) => particle.life > 0 && particle.y < WORLD_HEIGHT + 30);
  scorePopups.forEach((popup) => {
    popup.y -= 45 * delta;
    popup.life -= delta;
  });
  scorePopups = scorePopups.filter((popup) => popup.life > 0);
}

function updateGame(delta) {
  const mode = getModeConfig();
  speed = bossFight.active ? 0 : mode.baseSpeed + speedLevel * mode.speedBoost;
  if (!bossFight.active) backgroundOffset += speed * BACKGROUND_SCROLL_FACTOR * delta;
  if (dino.slideTimer > 0) {
    dino.slideTimer = Math.max(0, dino.slideTimer - delta);
  }
  if (!dino.grounded || dino.slideTimer <= 0) {
    dino.sliding = false;
  }
  dino.velocityY += 2200 * delta;
  dino.y += dino.velocityY * delta;
  const groundTop = GROUND_Y - dino.height;
  if (dino.y >= groundTop) {
    dino.y = groundTop;
    dino.velocityY = 0;
    dino.grounded = true;
  }
  if (dino.slideTimer > 0 && dino.grounded) dino.sliding = true;

  if (!bossFight.active) spawnTimer -= delta;
  if (!bossFight.active && spawnTimer <= 0) {
    spawnObstacle();
    spawnTimer = Math.max(mode.minSpawn, mode.spawnBase + Math.random() * mode.spawnRandom - speedLevel * mode.spawnPenalty);
  }

  for (const obstacle of obstacles) {
    const obstacleSpeed = obstacle.secretSpeed ?? speed;
    obstacle.previousX = obstacle.x;
    obstacle.x -= obstacleSpeed * delta;
    if (phase === "running" && collisionWith(obstacle)) {
      loseGame(obstacle);
      break;
    }
    if (phase === "running") addScore(obstacle);
  }
  obstacles = obstacles.filter((obstacle) => obstacle.x + obstacle.width > -30);
  updateBossFight(delta);
  updateParticles(delta);
}

function drawScrollingBackgroundImage(image) {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const tileHeight = WORLD_HEIGHT;
  const tileWidth = Math.max(worldWidth, tileHeight * imageRatio);
  const offset = backgroundOffset % tileWidth;

  for (let x = -offset; x < worldWidth + tileWidth; x += tileWidth) {
    context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, x - 1, 0, tileWidth + 2, tileHeight);
  }
}

function drawBackground() {
  if (warehouseBackgroundImage.complete && warehouseBackgroundImage.naturalWidth) {
    drawScrollingBackgroundImage(warehouseBackgroundImage);
    context.fillStyle = "rgba(2,6,23,.12)";
    context.fillRect(0, 0, worldWidth, WORLD_HEIGHT);
  } else {
    context.fillStyle = "#071125";
    context.fillRect(0, 0, worldWidth, WORLD_HEIGHT);
  }
}

function drawRunner() {
  const damageImage = damageType === "head" ? headDamageRunnerImage : legDamageRunnerImage;
  const image = phase === "gameover" && damageType
    ? damageImage
    : phase === "running" && dino.sliding
    ? slideRunnerImage
    : phase === "running" && !dino.grounded
    ? jumpRunnerImage
    : phase === "running" && !bossFight.active
      ? runRunnerImage
      : idleRunnerImage;

  const isDamageFrame = phase === "gameover" && Boolean(damageType);
  const impactElapsed = isDamageFrame ? Math.max(0, performance.now() - damageStartedAt) : 0;
  const impactProgress = Math.min(1, impactElapsed / 260);
  const impactScale = isDamageFrame
    ? impactProgress < 0.55
      ? 0.82 + (impactProgress / 0.55) * 0.28
      : 1.1 - ((impactProgress - 0.55) / 0.45) * 0.1
    : 1;
  const baseRenderHeight = isDamageFrame ? 112 : dino.sliding ? 70 : dino.grounded ? 98 : 92;
  const renderHeight = baseRenderHeight * impactScale;
  const renderWidth = image.naturalWidth && image.naturalHeight
    ? renderHeight * (image.naturalWidth / image.naturalHeight)
    : dino.sliding ? 92 : 74;
  const runBob = phase === "running" && dino.grounded && !dino.sliding
    ? Math.sin(performance.now() / 85) * 1.8
    : 0;
  const impactShake = isDamageFrame && impactElapsed < 220
    ? Math.sin(impactElapsed / 18) * 4 * (1 - impactElapsed / 220)
    : 0;
  const drawX = (dino.sliding ? dino.x - 18 : dino.x - 14) + impactShake;
  const drawY = dino.y + dino.height - renderHeight + runBob;

  if (image.complete && image.naturalWidth) {
    context.drawImage(image, drawX, drawY, renderWidth, renderHeight);
    return;
  }
  context.fillStyle = "#1e3a5f";
  context.fillRect(dino.x, dino.y, dino.width, dino.height);
}

function drawBoss() {
  if (!bossFight.active) return;

  const attacking = bossFight.attackState === "charging";
  let image = bossImage;
  if (bossFight.stage === "player-lost") image = bossLossImage;
  else if (["defeated", "final-victory", "retreating"].includes(bossFight.stage)) image = bossWinImage;
  else if (attacking && bossFight.currentAttack?.type === "high") image = bossHighAttackImage;
  else if (attacking) image = bossAttackImage;
  const renderHeight = 255;
  const renderWidth = image.naturalWidth && image.naturalHeight
    ? renderHeight * (image.naturalWidth / image.naturalHeight)
    : attacking ? 228 : 150;
  const idleWidth = bossImage.naturalWidth && bossImage.naturalHeight
    ? renderHeight * (bossImage.naturalWidth / bossImage.naturalHeight)
    : 150;
  const bossRight = bossFight.x + idleWidth;
  const drawX = image === bossImage ? bossFight.x : bossRight - renderWidth;
  const canBob = !["player-lost", "defeated", "final-victory"].includes(bossFight.stage);
  const bossBob = canBob ? Math.sin(performance.now() / 180) * 3 : 0;
  const drawY = GROUND_Y - renderHeight + 7 + bossBob;

  if (image.complete && image.naturalWidth) {
    context.drawImage(image, drawX, drawY, renderWidth, renderHeight);
  }

  context.save();
  context.textAlign = "center";
  context.font = "900 14px Inter, sans-serif";
  context.fillStyle = "#fecaca";
  let bossStatus = bossFight.endless
    ? `ВОЛНА ${bossFight.wave}`
    : `ВОЛНА ${bossFight.wave}/${BOSS_WAVE_COUNT}`;
  if (bossFight.stage === "entering") bossStatus = "БОСС ПРИБЛИЖАЕТСЯ";
  if (bossFight.stage === "wave-break") bossStatus = "ПЕРЕДЫШКА";
  if (bossFight.stage === "clearing") bossStatus = "ПОСЛЕДНЯЯ АТАКА";
  if (bossFight.stage === "defeated") bossStatus = "ОНА ЕЩЁ ВЕРНЁТСЯ";
  if (bossFight.stage === "final-victory") bossStatus = "ВЫ СПАСЛИ АЛВИСУ!";
  if (bossFight.stage === "player-lost") bossStatus = "БОСС ПОБЕДИЛ";
  if (bossFight.stage === "retreating") bossStatus = "ОНА ЕЩЁ ВЕРНЁТСЯ";
  context.fillText(
    bossStatus,
    Math.max(worldWidth * 0.55, bossRight - idleWidth / 2),
    38
  );
  context.restore();
}

function drawAcidProjectiles() {
  for (const projectile of acidProjectiles) {
    const projectileImage = projectile.type === "low" ? acidPuddleImage : acidImage;
    context.save();
    if (projectile.turbo) {
      context.shadowColor = "#facc15";
      context.shadowBlur = 18;
    }
    if (projectileImage.complete && projectileImage.naturalWidth) {
      context.drawImage(
        projectileImage,
        projectile.x,
        projectile.y,
        projectile.width,
        projectile.height
      );
    } else {
      context.fillStyle = "#84cc16";
      context.beginPath();
      context.arc(
        projectile.x + projectile.width / 2,
        projectile.y + projectile.height / 2,
        projectile.height / 2,
        0,
        Math.PI * 2
      );
      context.fill();
    }
    context.restore();
  }
}

function drawObstacles() {
  obstacles.forEach((obstacle) => {
    const image = obstacle.type?.image || palletImage;
    if (image.complete && image.naturalWidth) {
      const crop = obstacle.type?.crop;
      if (crop) {
        context.drawImage(
          image,
          crop.sx,
          crop.sy,
          crop.sw,
          crop.sh,
          obstacle.x,
          obstacle.y,
          obstacle.width,
          obstacle.height
        );
      } else {
        context.drawImage(image, obstacle.x, obstacle.y, obstacle.width, obstacle.height);
      }
    } else {
      context.fillStyle = "#b77932";
      context.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
    }
  });
}

function drawEffects() {
  particles.forEach((particle) => {
    context.globalAlpha = Math.min(1, Math.max(0, particle.life));
    context.fillStyle = particle.color;
    context.fillRect(particle.x, particle.y, particle.size, particle.confetti ? particle.size * 0.55 : particle.size);
  });
  context.globalAlpha = 1;

  context.textAlign = "center";
  scorePopups.forEach((popup) => {
    context.globalAlpha = Math.min(1, popup.life * 1.7);
    context.font = popup.large ? "900 24px Inter, sans-serif" : "800 18px Inter, sans-serif";
    context.fillStyle = popup.large || popup.text === "+10" ? "#fbbf24" : "#a7f3d0";
    context.fillText(popup.text, popup.x, popup.y);
  });
  context.globalAlpha = 1;
}

function drawGame() {
  drawBackground();
  drawObstacles();
  drawBoss();
  drawAcidProjectiles();
  drawRunner();
  drawEffects();
}

function gameLoop(now) {
  if (elements.overlay.classList.contains("hidden")) return;
  const delta = Math.min(0.034, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;
  if (phase === "running") updateGame(delta);
  else updateParticles(delta);
  drawGame();
  animationFrame = requestAnimationFrame(gameLoop);
}

function handleKeydown(event) {
  if (elements.overlay.classList.contains("hidden")) return;
  if (event.key === "Escape") {
    if (isGameFullscreen()) void exitGameFullscreen();
    else closeGame();
    return;
  }
  if (event.code === "KeyP") {
    event.preventDefault();
    togglePause();
    return;
  }
  if (event.code === "Space" || event.code === "KeyW" || event.key === "ArrowUp") {
    event.preventDefault();
    jump();
    return;
  }
  if (event.key === "ArrowDown" || event.code === "KeyS") {
    event.preventDefault();
    if (!event.repeat) slide();
  }
}

function bindEvents() {
  elements.trigger?.addEventListener("click", () => {
    triggerClicks += 1;
    window.clearTimeout(triggerTimer);
    if (triggerClicks >= 3) {
      triggerClicks = 0;
      openGame();
      return;
    }
    triggerTimer = window.setTimeout(() => { triggerClicks = 0; }, 1200);
  });
  elements.close?.addEventListener("click", closeGame);
  elements.pause?.addEventListener("click", togglePause);
  elements.sound?.addEventListener("click", toggleSound);
  elements.fullscreen?.addEventListener("click", toggleGameFullscreen);
  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", () => setGameMode(button.dataset.easterMode));
  });
  elements.start?.addEventListener("click", handleStartButton);
  elements.jump?.addEventListener("click", jump);
  elements.slide?.addEventListener("click", slide);
  elements.canvas?.addEventListener("pointerdown", jump);
  window.addEventListener("keydown", handleKeydown);
  const handleFullscreenChange = () => {
    if (!nativeFullscreenElement()) {
      elements.overlay?.classList.remove("is-game-fullscreen");
    }
    syncFullscreenButton();
    refreshFullscreenLayout();
  };
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && phase === "running") pauseGame({ focusControl: false });
  });
  window.addEventListener("resize", () => {
    if (!elements.overlay.classList.contains("hidden")) resizeCanvas();
  });
}

async function initialize() {
  void prepareGameAssets();
  bossMusic.load();
  syncSoundButton();
  syncPauseButton();
  syncFullscreenButton();
  syncModeControls();
  bindEvents();
  try {
    const session = await getSession();
    currentUserId = session?.user?.id || null;
  } catch {
    currentUserId = null;
  }
  refreshBossFightModeAccess();
}

void initialize();
