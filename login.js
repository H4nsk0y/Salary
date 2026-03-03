import { signIn, signUp, getSession } from "./auth.js";

document.body.classList.add("is-loaded");

const qs = new URLSearchParams(location.search);
const nextUrl = qs.get("next") || "table.html";

const tabSignIn = document.getElementById("tabSignIn");
const tabSignUp = document.getElementById("tabSignUp");

const form = document.getElementById("authForm");
const submitBtn = document.getElementById("submitBtn");

const emailEl = document.getElementById("email");
const pwEl = document.getElementById("password");
const confirmWrap = document.getElementById("confirmWrap");
const confirmEl = document.getElementById("confirmPassword");

const togglePw = document.getElementById("togglePw");

const errorBox = document.getElementById("errorBox");
const infoBox = document.getElementById("infoBox");

let mode = "signin"; // "signin" | "signup"

function setError(msg) {
  if (!msg) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    errorBox.classList.remove("shake");
    return;
  }
  errorBox.classList.remove("hidden");
  errorBox.textContent = msg;
  errorBox.classList.remove("shake");
  // eslint-disable-next-line no-unused-expressions
  errorBox.offsetWidth;
  errorBox.classList.add("shake");
}

function setInfo(msg) {
  if (!msg) {
    infoBox.classList.add("hidden");
    infoBox.textContent = "";
    return;
  }
  infoBox.classList.remove("hidden");
  infoBox.textContent = msg;
}

function isStrongPassword(pw) {
  const s = String(pw ?? "");
  if (s.length < 10) return false;
  if (!/[a-z]/.test(s)) return false;
  if (!/[A-Z]/.test(s)) return false;
  if (!/[0-9]/.test(s)) return false;
  if (!/[^A-Za-z0-9]/.test(s)) return false;
  return true;
}

function setMode(nextMode) {
  mode = nextMode;
  setError(null);
  setInfo(null);

  if (mode === "signin") {
    tabSignIn.classList.add("tab-active");
    tabSignUp.classList.remove("tab-active");
    confirmWrap.classList.add("hidden");
    submitBtn.textContent = "Войти";
    pwEl.autocomplete = "current-password";
  } else {
    tabSignUp.classList.add("tab-active");
    tabSignIn.classList.remove("tab-active");
    confirmWrap.classList.remove("hidden");
    submitBtn.textContent = "Создать аккаунт";
    pwEl.autocomplete = "new-password";
  }
}

togglePw.addEventListener("click", () => {
  const isHidden = pwEl.type === "password";
  pwEl.type = isHidden ? "text" : "password";
  togglePw.textContent = isHidden ? "Скрыть" : "Показать";
});

tabSignIn.addEventListener("click", () => setMode("signin"));
tabSignUp.addEventListener("click", () => setMode("signup"));

async function redirectIfAuthed() {
  const session = await getSession();
  if (session) location.href = nextUrl;
}

function normalizeEmail(v) {
  return String(v ?? "").trim();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setError(null);
  setInfo(null);

  const email = normalizeEmail(emailEl.value);
  const password = String(pwEl.value ?? "");

  if (!email) return setError("Введите email.");
  if (!password) return setError("Введите пароль.");

  if (mode === "signup") {
    const confirm = String(confirmEl.value ?? "");
    if (password !== confirm) return setError("Пароли не совпадают.");
    if (!isStrongPassword(password)) {
      return setError("Пароль слабый: минимум 10 символов, верх/низ, цифра и символ.");
    }
  }

  submitBtn.disabled = true;
  submitBtn.classList.add("opacity-70", "cursor-not-allowed");

  try {
    if (mode === "signin") {
      await signIn(email, password);
      location.href = nextUrl;
      return;
    }

    const data = await signUp(email, password);

    // Если в проекте включено подтверждение email — сессии может не быть
    if (!data.session) {
      setInfo("Аккаунт создан. Проверьте почту и подтвердите email, затем войдите.");
      setMode("signin");
      return;
    }

    location.href = nextUrl;
  } catch (err) {
    const msg = err?.message || "Ошибка авторизации.";
    setError(msg);
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove("opacity-70", "cursor-not-allowed");
  }
});

setMode("signin");
redirectIfAuthed();
