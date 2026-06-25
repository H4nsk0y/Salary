import { getSession } from "./auth.js";
import { listEasterRunnerLeaderboard, submitEasterRunnerScore } from "./db.js";

const REWARD_KEY_PREFIX = "alvisa.easterRunner.reward.v1";
const PENDING_REWARD_KEY = "alvisa.easterRunner.pendingReward.v1";
const SOUND_SETTING_KEY = "alvisa.easterRunner.soundEnabled.v1";
const MODE_SETTING_KEY = "alvisa.easterRunner.mode.v1";
const LEADERBOARD_LIMIT = 5;
const REWARD_SCORE = 350;
const SCORE_SOUND_THRESHOLD = 300;
const MUSIC_STEP_MS = 150;
const WORLD_HEIGHT = 360;
const GROUND_Y = 294;
const BACKGROUND_SCROLL_FACTOR = 0.16;
const HARDCORE_SECRET_OBSTACLE_CHANCE = 0.08;
const HARDCORE_SECRET_SPEED_MULTIPLIER = 1.85;
const GAME_MODES = {
  normal: {
    key: "normal",
    label: "Обычный",
    badge: "NORMAL",
    intro: "Перепрыгивайте палеты и продержитесь как можно дольше. Каждый обычный прыжок дает +3 очка, каждый 10-й - +10.",
    baseSpeed: 720,
    speedBoost: 92,
    speedStepScore: 200,
    initialSpawn: 1.1,
    spawnBase: 1.15,
    spawnRandom: 0.72,
    spawnPenalty: 0.06,
    minSpawn: 0.68,
    obstacleWeights: { single: 5, tall: 3, chaos: 2 },
    getPoints: (passed) => (passed % 10 === 0 ? 10 : 3),
  },
  hardcore: {
    key: "hardcore",
    label: "Хардкор",
    badge: "HARD",
    intro: "Скорость сразу высокая, за каждую палету дается 1 очко, а ускорение включается каждые 15 очков.",
    baseSpeed: 806,
    speedBoost: 93.6,
    speedStepScore: 15,
    initialSpawn: 0.85,
    spawnBase: 0.9,
    spawnRandom: 0.46,
    spawnPenalty: 0.035,
    minSpawn: 0.56,
    obstacleWeights: { single: 3, tall: 4, chaos: 4 },
    getPoints: () => 1,
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
  jump: document.getElementById("easterGameJumpBtn"),
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
const palletImage = new Image();
const palletTallImage = new Image();
const palletChaosImage = new Image();
const warehouseBackgroundImage = new Image();
idleRunnerImage.src = "./images/easter-runner-idle.png";
runRunnerImage.src = "./images/easter-runner-run.png";
jumpRunnerImage.src = "./images/easter-runner-jump.png";
palletImage.src = "./images/easter-pallet.png";
palletTallImage.src = "./images/easter-pallet-tall.png";
palletChaosImage.src = "./images/easter-pallet-chaos.png";
warehouseBackgroundImage.src = "./images/easter-warehouse-bg.png";

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

const dino = {
  x: 105,
  y: GROUND_Y - 82,
  width: 50,
  height: 82,
  velocityY: 0,
  grounded: true,
};

function getModeConfig(modeKey = currentMode) {
  return GAME_MODES[modeKey] || GAME_MODES.normal;
}

function getObstacleRatio(type) {
  const image = type.image;
  if (image?.naturalWidth && image?.naturalHeight) {
    return image.naturalWidth / image.naturalHeight;
  }
  return type.fallbackRatio;
}

function syncModeControls() {
  const mode = getModeConfig();
  elements.modeButtons.forEach((button) => {
    const selected = button.dataset.easterMode === mode.key;
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = phase === "running" || phase === "paused";
  });
  if (elements.leaderboardTitle) elements.leaderboardTitle.textContent = `Топ-5: ${mode.label}`;
  if (elements.leaderboardBadge) elements.leaderboardBadge.textContent = mode.badge;
}

function setGameMode(modeKey) {
  if (!GAME_MODES[modeKey] || phase === "running" || phase === "paused") return;
  currentMode = modeKey;
  localStorage.setItem(MODE_SETTING_KEY, currentMode);
  syncModeControls();

  if (phase === "ready") {
    elements.messageText.textContent = getModeConfig().intro;
  }

  if (phase === "gameover" && !elements.leaderboard?.classList.contains("hidden")) {
    void renderLeaderboard(null, currentMode);
  }
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
  score = 0;
  passedObstacles = 0;
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
  dino.y = GROUND_Y - dino.height;
  dino.velocityY = 0;
  dino.grounded = true;
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

function playBackgroundMusicStep() {
  if (!soundEnabled || phase !== "running" || document.hidden) {
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
  if (!soundEnabled || phase !== "running" || document.hidden) return;
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
    if (phase === "running") startBackgroundMusic();
  } else {
    stopBackgroundMusic();
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
    text: getModeConfig().intro,
    button: "Начать",
  });
  requestAnimationFrame(() => {
    resizeCanvas();
    lastFrameTime = performance.now();
    animationFrame = requestAnimationFrame(gameLoop);
    elements.start.focus();
  });
}

function closeGame() {
  stopBackgroundMusic();
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
  startBackgroundMusic();
}

function pauseGame({ focusControl = true } = {}) {
  if (phase !== "running") return;
  phase = "paused";
  stopBackgroundMusic();
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
  startBackgroundMusic();
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
  if (phase !== "running" || !dino.grounded) return;
  dino.velocityY = -790;
  dino.grounded = false;
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
  const secretSpeed = mode.key === "hardcore" && Math.random() < HARDCORE_SECRET_OBSTACLE_CHANCE
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

function addScore(obstacle) {
  if (obstacle.counted || obstacle.x + obstacle.width >= dino.x) return;
  obstacle.counted = true;
  passedObstacles += 1;
  const mode = getModeConfig();
  const points = mode.getPoints(passedObstacles);
  const previousScore = score;
  score += points;
  elements.score.textContent = String(score);
  elements.passed.textContent = String(passedObstacles);
  scorePopups.push({ x: dino.x + 28, y: dino.y - 8, text: `+${points}`, life: 0.8 });

  const nextSpeedLevel = Math.floor(score / mode.speedStepScore);
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

function collisionWith(obstacle) {
  const insetX = 8;
  const insetY = 7;
  const obstacleInsetX = obstacle.type?.insetX ?? 5;
  const obstacleInsetTop = obstacle.type?.insetTop ?? 6;
  const dinoLeft = dino.x + insetX;
  const dinoRight = dino.x + dino.width - insetX;
  const dinoTop = dino.y + insetY;
  const dinoBottom = dino.y + dino.height - 4;
  const obstacleLeft = obstacle.x + obstacleInsetX;
  const obstacleRight = obstacle.x + obstacle.width - obstacleInsetX;
  const obstacleTop = obstacle.y + obstacleInsetTop;
  const obstacleBottom = obstacle.y + obstacle.height;
  const hasVerticalOverlap = dinoTop < obstacleBottom && dinoBottom > obstacleTop;
  const hasCurrentOverlap = dinoLeft < obstacleRight && dinoRight > obstacleLeft;

  if (hasVerticalOverlap && hasCurrentOverlap) return true;
  if (!hasVerticalOverlap || obstacle.previousX === undefined) return false;

  const previousLeft = obstacle.previousX + obstacleInsetX;
  const previousRight = obstacle.previousX + obstacle.width - obstacleInsetX;
  const sweptLeft = Math.min(previousLeft, obstacleLeft);
  const sweptRight = Math.max(previousRight, obstacleRight);

  return dinoLeft < sweptRight && dinoRight > sweptLeft;
}

function loseGame() {
  const finishedMode = currentMode;
  const finalScore = score;
  const finalPassed = passedObstacles;
  phase = "gameover";
  syncPauseButton();
  stopBackgroundMusic();
  playDefeatSound();
  showMessage({
    eyebrow: "Забег окончен",
    title: `${finalScore} очков`,
    text: `Перепрыгнуто палет: ${finalPassed}. Попробуйте побить общий рекорд.`,
    button: "Ещё раз",
    leaderboard: true,
  });
  void saveAndRenderLeaderboard({
    modeKey: finishedMode,
    finalScore,
    finalPassed,
  });
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
  speed = mode.baseSpeed + speedLevel * mode.speedBoost;
  backgroundOffset += speed * BACKGROUND_SCROLL_FACTOR * delta;
  dino.velocityY += 2200 * delta;
  dino.y += dino.velocityY * delta;
  const groundTop = GROUND_Y - dino.height;
  if (dino.y >= groundTop) {
    dino.y = groundTop;
    dino.velocityY = 0;
    dino.grounded = true;
  }

  spawnTimer -= delta;
  if (spawnTimer <= 0) {
    spawnObstacle();
    spawnTimer = Math.max(mode.minSpawn, mode.spawnBase + Math.random() * mode.spawnRandom - speedLevel * mode.spawnPenalty);
  }

  for (const obstacle of obstacles) {
    const obstacleSpeed = obstacle.secretSpeed ?? speed;
    obstacle.previousX = obstacle.x;
    obstacle.x -= obstacleSpeed * delta;
    if (phase === "running" && collisionWith(obstacle)) {
      loseGame();
      break;
    }
    if (phase === "running") addScore(obstacle);
  }
  obstacles = obstacles.filter((obstacle) => obstacle.x + obstacle.width > -30);
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
  const image = phase === "running" && !dino.grounded
    ? jumpRunnerImage
    : phase === "running"
      ? runRunnerImage
      : idleRunnerImage;
  const renderHeight = dino.grounded ? 98 : 92;
  const renderWidth = image.naturalWidth && image.naturalHeight
    ? renderHeight * (image.naturalWidth / image.naturalHeight)
    : 74;
  const runBob = phase === "running" && dino.grounded
    ? Math.sin(performance.now() / 85) * 1.8
    : 0;
  const drawX = dino.x - 14;
  const drawY = dino.y + dino.height - renderHeight + runBob;

  if (image.complete && image.naturalWidth) {
    context.drawImage(image, drawX, drawY, renderWidth, renderHeight);
    return;
  }
  context.fillStyle = "#1e3a5f";
  context.fillRect(dino.x, dino.y, dino.width, dino.height);
}

function drawObstacles() {
  obstacles.forEach((obstacle) => {
    const image = obstacle.type?.image || palletImage;
    if (image.complete && image.naturalWidth) {
      context.drawImage(image, obstacle.x, obstacle.y, obstacle.width, obstacle.height);
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
    closeGame();
    return;
  }
  if (event.code === "KeyP") {
    event.preventDefault();
    togglePause();
    return;
  }
  if (event.code === "Space" || event.key === "ArrowUp") {
    event.preventDefault();
    jump();
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
  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", () => setGameMode(button.dataset.easterMode));
  });
  elements.start?.addEventListener("click", handleStartButton);
  elements.jump?.addEventListener("click", jump);
  elements.canvas?.addEventListener("pointerdown", jump);
  window.addEventListener("keydown", handleKeydown);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && phase === "running") pauseGame({ focusControl: false });
  });
  window.addEventListener("resize", () => {
    if (!elements.overlay.classList.contains("hidden")) resizeCanvas();
  });
}

async function initialize() {
  syncSoundButton();
  syncPauseButton();
  syncModeControls();
  bindEvents();
  try {
    const session = await getSession();
    currentUserId = session?.user?.id || null;
  } catch {
    currentUserId = null;
  }
}

void initialize();
