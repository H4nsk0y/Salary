const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d", { alpha: false });
const fullButton = document.getElementById("fullscreenBtn");
const modeButtons = [...document.querySelectorAll("[data-mode]")];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let width = 0;
let height = 0;
let mode = "ribbons";
let time = 0;
let lastFrame = 0;
let wakeLock = null;
let building = { x: 0, y: 0, vx: 125, vy: 93 };
const buildingImage = new Image();
buildingImage.src = "./images/app-icon-512.png";
const pointer = { x: 0, y: 0, active: false, dragging: false };
let idleTimer = null;

function showControls() {
  document.body.classList.remove("is-idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add("is-idle"), 5000);
}

function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  width = innerWidth;
  height = innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  building.x = Math.min(Math.max(building.x || width * .5, 92), Math.max(92, width - 92));
  building.y = Math.min(Math.max(building.y || height * .5, 56), Math.max(56, height - 56));
}

function background() {
  ctx.fillStyle = "#080a0b";
  ctx.fillRect(0, 0, width, height);
}

function ribbons() {
  const colors = ["#7a1638", "#b74257", "#c6a15b", "#6ea8e8", "#749c8e", "#d6b9bd"];
  const unit = Math.min(width, height);
  for (let ribbon = 0; ribbon < colors.length; ribbon++) {
    const offset = ribbon * 1.08;
    for (let edge = 0; edge < 3; edge++) {
      ctx.beginPath();
      for (let step = 0; step <= 72; step++) {
        const progress = step / 72;
        const x = progress * (width + 200) - 100;
        const influence = pointer.active ? Math.exp(-Math.pow((x - pointer.x) / 210, 2)) * Math.sin((pointer.y - height * .5) / Math.max(height, 1) * 2) * unit * .16 : 0;
        const y = height * (.35 + ribbon * .055) + Math.sin(progress * 7.5 - time * .44 + offset) * unit * .22 + Math.cos(progress * 12 + time * .22 + offset) * unit * .055 + influence + edge * 7;
        if (step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = colors[ribbon];
      ctx.globalAlpha = edge === 0 ? .44 : .19;
      ctx.lineWidth = edge === 0 ? 3 : 12 + edge * 8;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function bouncingBuilding(delta) {
  if (!pointer.dragging) {
    building.x += building.vx * delta;
    building.y += building.vy * delta;
  }
  const halfWidth = Math.min(92, width * .22);
  const halfHeight = Math.min(55, height * .13);
  if (building.x <= halfWidth || building.x >= width - halfWidth) { building.vx *= -1; building.x = Math.max(halfWidth, Math.min(width - halfWidth, building.x)); }
  if (building.y <= halfHeight || building.y >= height - halfHeight) { building.vy *= -1; building.y = Math.max(halfHeight, Math.min(height - halfHeight, building.y)); }
  if (buildingImage.complete && buildingImage.naturalWidth) {
    ctx.drawImage(buildingImage, 55, 155, 405, 220, building.x - halfWidth, building.y - halfHeight, halfWidth * 2, halfHeight * 2);
  }
}

function orbits() {
  const centerX = width * .5 + Math.sin(time * .17) * width * .13 + (pointer.active ? (pointer.x - width * .5) * .18 : 0);
  const centerY = height * .52 + Math.cos(time * .13) * height * .1 + (pointer.active ? (pointer.y - height * .5) * .18 : 0);
  const base = Math.min(width, height) * .16;
  const colors = ["#c6a15b", "#6ea8e8", "#b74257", "#749c8e"];
  colors.forEach((color, index) => {
    const radius = base * (.7 + index * .48);
    const angle = time * (.25 + index * .11) * (index % 2 ? -1 : 1) + index * 1.7;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius * .58;
    ctx.strokeStyle = color;
    ctx.globalAlpha = .33;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(centerX, centerY, radius, radius * .58, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = .95;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 5 + index * 3, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function frame(timestamp) {
  const delta = Math.min((timestamp - (lastFrame || timestamp)) / 1000, .05);
  lastFrame = timestamp;
  time += delta * (reduceMotion ? .25 : 1);
  background();
  if (mode === "ribbons") ribbons();
  else if (mode === "building") bouncingBuilding(delta * (reduceMotion ? .25 : 1));
  else orbits();
  requestAnimationFrame(frame);
}

async function holdScreen() {
  if (!navigator.wakeLock?.request) {
    return;
  }
  if (document.visibilityState !== "visible" || wakeLock && !wakeLock.released) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; }, { once: true });
  } catch {
    // A browser or device policy may deny Wake Lock while leaving the animation usable.
  }
}

modeButtons.forEach((button) => button.addEventListener("click", () => {
  mode = button.dataset.mode;
  modeButtons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
}));

fullButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    fullButton.title = "Полноэкранный режим недоступен в этом браузере.";
  }
});

document.addEventListener("fullscreenchange", () => {
  fullButton.textContent = document.fullscreenElement ? "Выйти из полного экрана" : "На весь экран";
});
window.addEventListener("pointermove", (event) => {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.active = true;
  if (pointer.dragging) {
    building.vx = Math.max(-340, Math.min(340, (event.clientX - building.x) * 8));
    building.vy = Math.max(-340, Math.min(340, (event.clientY - building.y) * 8));
    building.x = event.clientX;
    building.y = event.clientY;
  }
  showControls();
}, { passive: true });
window.addEventListener("pointerdown", (event) => {
  showControls();
  if (event.target !== canvas) return;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.active = true;
  if (mode === "building") {
    pointer.dragging = Math.abs(building.x - event.clientX) < 100 && Math.abs(building.y - event.clientY) < 70;
    if (pointer.dragging) canvas.setPointerCapture(event.pointerId);
    else {
      const angle = Math.atan2(event.clientY - building.y, event.clientX - building.x);
      building.vx = Math.cos(angle) * 190;
      building.vy = Math.sin(angle) * 190;
    }
  }
}, { passive: true });
window.addEventListener("pointerup", () => { pointer.dragging = false; });
window.addEventListener("pointerleave", () => { pointer.active = false; });
window.addEventListener("keydown", showControls);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void holdScreen(); });
window.addEventListener("resize", resize);
resize();
showControls();
requestAnimationFrame(frame);
void holdScreen();
