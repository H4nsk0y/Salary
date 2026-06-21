import { getSession } from "./auth.js";

const REWARD_KEY_PREFIX = "alvisa.easterRunner.reward.v1";
const PENDING_REWARD_KEY = "alvisa.easterRunner.pendingReward.v1";
const SOUND_SETTING_KEY = "alvisa.easterRunner.soundEnabled.v1";
const REWARD_SCORE = 350;
const SCORE_SOUND_THRESHOLD = 300;
const SPEED_STEP_SCORE = 200;
const MUSIC_STEP_MS = 150;
const WORLD_HEIGHT = 360;
const GROUND_Y = 294;
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
};

const context = elements.canvas?.getContext("2d");
const idleRunnerImage = new Image();
const runRunnerImage = new Image();
const jumpRunnerImage = new Image();
const palletImage = new Image();
const warehouseBackgroundImage = new Image();
idleRunnerImage.src = "./images/easter-runner-idle.png";
runRunnerImage.src = "./images/easter-runner-run.png";
jumpRunnerImage.src = "./images/easter-runner-jump.png";
palletImage.src = "./images/easter-pallet.png";
warehouseBackgroundImage.src = "./images/easter-warehouse-bg.png";

let currentUserId = null;
let triggerClicks = 0;
let triggerTimer = null;
let animationFrame = 0;
let lastFrameTime = 0;
let worldWidth = 960;
let phase = "ready";
let score = 0;
let passedObstacles = 0;
let speed = 360;
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

const dino = {
  x: 105,
  y: GROUND_Y - 82,
  width: 50,
  height: 82,
  velocityY: 0,
  grounded: true,
};

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
  score = 0;
  passedObstacles = 0;
  speed = 360;
  speedLevel = 0;
  spawnTimer = 1.1;
  obstacles = [];
  particles = [];
  scorePopups = [];
  rewardUnlockedThisRun = false;
  scoreSoundPlayed = false;
  musicStep = 0;
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

function showMessage({ eyebrow, title, text, button }) {
  elements.messageEyebrow.textContent = eyebrow;
  elements.messageTitle.textContent = title;
  elements.messageText.textContent = text;
  elements.start.querySelector("span").textContent = button;
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
    text: "Перепрыгивайте палеты и продержитесь как можно дольше.",
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

function spawnObstacle() {
  const height = 52 + Math.random() * 20;
  const width = height * 0.89;
  obstacles.push({
    x: worldWidth + width,
    y: GROUND_Y - height,
    width,
    height,
    counted: false,
  });
}

function addScore(obstacle) {
  if (obstacle.counted || obstacle.x + obstacle.width >= dino.x) return;
  obstacle.counted = true;
  passedObstacles += 1;
  const points = passedObstacles % 10 === 0 ? 10 : 3;
  const previousScore = score;
  score += points;
  elements.score.textContent = String(score);
  elements.passed.textContent = String(passedObstacles);
  scorePopups.push({ x: dino.x + 28, y: dino.y - 8, text: `+${points}`, life: 0.8 });

  const nextSpeedLevel = Math.floor(score / SPEED_STEP_SCORE);
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
  return (
    dino.x + insetX < obstacle.x + obstacle.width - 5 &&
    dino.x + dino.width - insetX > obstacle.x + 5 &&
    dino.y + insetY < obstacle.y + obstacle.height &&
    dino.y + dino.height - 4 > obstacle.y + 6
  );
}

function loseGame() {
  phase = "gameover";
  syncPauseButton();
  stopBackgroundMusic();
  playDefeatSound();
  showMessage({
    eyebrow: "Забег окончен",
    title: `${score} очков`,
    text: `Перепрыгнуто палет: ${passedObstacles}. Попробуйте побить свой результат.`,
    button: "Ещё раз",
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
  speed = 360 + speedLevel * 92;
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
    spawnTimer = Math.max(0.68, 1.15 + Math.random() * 0.72 - speedLevel * 0.06);
  }

  for (const obstacle of obstacles) {
    obstacle.x -= speed * delta;
    addScore(obstacle);
    if (phase === "running" && collisionWith(obstacle)) loseGame();
  }
  obstacles = obstacles.filter((obstacle) => obstacle.x + obstacle.width > -30);
  updateParticles(delta);
}

function drawCoverImage(image) {
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = worldWidth / WORLD_HEIGHT;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;

  if (sourceRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = image.naturalWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }

  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, worldWidth, WORLD_HEIGHT);
}

function drawBackground() {
  if (warehouseBackgroundImage.complete && warehouseBackgroundImage.naturalWidth) {
    drawCoverImage(warehouseBackgroundImage);
    context.fillStyle = "rgba(2,6,23,.12)";
    context.fillRect(0, 0, worldWidth, WORLD_HEIGHT);
  } else {
    context.fillStyle = "#071125";
    context.fillRect(0, 0, worldWidth, WORLD_HEIGHT);
  }

  context.strokeStyle = "rgba(110,231,183,.45)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, GROUND_Y + 1);
  context.lineTo(worldWidth, GROUND_Y + 1);
  context.stroke();

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
    if (palletImage.complete && palletImage.naturalWidth) {
      context.drawImage(palletImage, obstacle.x, obstacle.y, obstacle.width, obstacle.height);
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
  bindEvents();
  try {
    const session = await getSession();
    currentUserId = session?.user?.id || null;
  } catch {
    currentUserId = null;
  }
}

void initialize();
