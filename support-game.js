import { getSession } from "./auth.js";

const REWARD_KEY_PREFIX = "alvisa.easterRunner.reward.v1";
const PENDING_REWARD_KEY = "alvisa.easterRunner.pendingReward.v1";
const REWARD_SCORE = 350;
const SPEED_STEP_SCORE = 200;
const WORLD_HEIGHT = 360;
const GROUND_Y = 294;

const elements = {
  trigger: document.getElementById("supportEasterTrigger"),
  overlay: document.getElementById("easterGameOverlay"),
  canvas: document.getElementById("easterGameCanvas"),
  close: document.getElementById("easterGameCloseBtn"),
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
  dino.y = GROUND_Y - dino.height;
  dino.velocityY = 0;
  dino.grounded = true;
  elements.score.textContent = "0";
  elements.passed.textContent = "0";
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
  elements.overlay.classList.add("hidden");
  elements.overlay.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  phase = "ready";
  elements.trigger.focus();
}

function startGame() {
  resetRunner();
  phase = "running";
  hideMessage();
  lastFrameTime = performance.now();
}

function jump() {
  if (phase === "ready" || phase === "gameover") {
    startGame();
    return;
  }
  if (phase !== "running" || !dino.grounded) return;
  dino.velocityY = -790;
  dino.grounded = false;
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
  score += points;
  elements.score.textContent = String(score);
  elements.passed.textContent = String(passedObstacles);
  scorePopups.push({ x: dino.x + 28, y: dino.y - 8, text: `+${points}`, life: 0.8 });

  const nextSpeedLevel = Math.floor(score / SPEED_STEP_SCORE);
  if (nextSpeedLevel > speedLevel) {
    speedLevel = nextSpeedLevel;
    scorePopups.push({ x: worldWidth / 2, y: 95, text: "УСКОРЕНИЕ!", life: 1.25, large: true });
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
  elements.start?.addEventListener("click", startGame);
  elements.jump?.addEventListener("click", jump);
  elements.canvas?.addEventListener("pointerdown", jump);
  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", () => {
    if (!elements.overlay.classList.contains("hidden")) resizeCanvas();
  });
}

async function initialize() {
  bindEvents();
  try {
    const session = await getSession();
    currentUserId = session?.user?.id || null;
  } catch {
    currentUserId = null;
  }
}

void initialize();
