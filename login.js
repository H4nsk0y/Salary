// =========================
// FILE: /login.js
// =========================
import { supabase } from "./supabaseClient.js";
import {
  getSession,
  signIn,
  signUp,
  requestPasswordReset,
  updateMyPassword,
} from "./auth.js";

const MIN_PASSWORD_LENGTH = 10;
const PASSWORD_REGEX =
  /^(?=.*[a-zа-яё])(?=.*[A-ZА-ЯЁ])(?=.*\d)(?=.*[^A-Za-zА-Яа-яЁё0-9]).{10,}$/;

const authForm = document.getElementById("authForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirmPassword");
const confirmWrap = document.getElementById("confirmWrap");

const tabSignIn = document.getElementById("tabSignIn");
const tabSignUp = document.getElementById("tabSignUp");
const submitBtn = document.getElementById("submitBtn");
const togglePw = document.getElementById("togglePw");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
const backToLoginBtn = document.getElementById("backToLoginBtn");

const formTitle = document.getElementById("formTitle");
const formSubtitle = document.getElementById("formSubtitle");
const pwHint = document.getElementById("pwHint");
const errorBox = document.getElementById("errorBox");
const infoBox = document.getElementById("infoBox");

let mode = "signin";
let isSubmitting = false;
let recoverySessionSeen = false;

function setError(message) {
  const text = String(message ?? "").trim();
  if (!text) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    errorBox.classList.remove("shake");
    return;
  }

  errorBox.textContent = text;
  errorBox.classList.remove("hidden");
  errorBox.classList.remove("shake");
  errorBox.offsetWidth;
  errorBox.classList.add("shake");
}

function setInfo(message) {
  const text = String(message ?? "").trim();
  if (!text) {
    infoBox.classList.add("hidden");
    infoBox.textContent = "";
    return;
  }

  infoBox.textContent = text;
  infoBox.classList.remove("hidden");
}

function clearMessages() {
  setError("");
  setInfo("");
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return PASSWORD_REGEX.test(String(password ?? ""));
}

function setBusy(nextBusy) {
  isSubmitting = Boolean(nextBusy);

  submitBtn.disabled = isSubmitting;
  emailInput.disabled = isSubmitting;
  passwordInput.disabled = isSubmitting;
  confirmPasswordInput.disabled = isSubmitting;
  tabSignIn.disabled = isSubmitting;
  tabSignUp.disabled = isSubmitting;
  forgotPasswordBtn.disabled = isSubmitting;
  backToLoginBtn.disabled = isSubmitting;
  togglePw.disabled = isSubmitting;
}

function setTabStyles(activeTab) {
  const activeClasses = ["tab-active"];
  const inactiveClasses = ["bg-white/5", "text-slate-200"];

  tabSignIn.classList.remove(...activeClasses, ...inactiveClasses);
  tabSignUp.classList.remove(...activeClasses, ...inactiveClasses);

  if (activeTab === "signin") {
    tabSignIn.classList.add("tab-active");
    tabSignUp.classList.add("bg-white/5", "text-slate-200");
  } else if (activeTab === "signup") {
    tabSignUp.classList.add("tab-active");
    tabSignIn.classList.add("bg-white/5", "text-slate-200");
  } else {
    tabSignIn.classList.add("bg-white/5", "text-slate-200");
    tabSignUp.classList.add("bg-white/5", "text-slate-200");
  }
}

function resetPasswordInputs() {
  passwordInput.value = "";
  confirmPasswordInput.value = "";
}

function setMode(nextMode) {
  mode = nextMode;
  clearMessages();

  const isSignIn = mode === "signin";
  const isSignUp = mode === "signup";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";

  setTabStyles(isSignIn ? "signin" : isSignUp ? "signup" : null);

  emailInput.parentElement.classList.toggle("hidden", isReset);
  passwordInput.closest("div").parentElement.classList.toggle("hidden", isForgot);
  confirmWrap.classList.toggle("hidden", !(isSignUp || isReset));

  forgotPasswordBtn.classList.toggle("hidden", !(isSignIn || isForgot));
  backToLoginBtn.classList.toggle("hidden", !(isForgot || isReset));

  togglePw.textContent = "Показать";
  passwordInput.type = "password";
  confirmPasswordInput.type = "password";

  if (isSignIn) {
    formTitle.textContent = "Вход";
    formSubtitle.textContent = "Введите email и пароль.";
    submitBtn.textContent = "Войти";
    pwHint.classList.remove("hidden");
    passwordInput.autocomplete = "current-password";
    confirmPasswordInput.autocomplete = "new-password";
    return;
  }

  if (isSignUp) {
    formTitle.textContent = "Регистрация";
    formSubtitle.textContent = "Создайте аккаунт для сохранения табеля.";
    submitBtn.textContent = "Зарегистрироваться";
    pwHint.classList.remove("hidden");
    passwordInput.autocomplete = "new-password";
    confirmPasswordInput.autocomplete = "new-password";
    return;
  }

  if (isForgot) {
    formTitle.textContent = "Сброс пароля";
    formSubtitle.textContent = "Введите email, и мы отправим ссылку для смены пароля.";
    submitBtn.textContent = "Отправить письмо";
    pwHint.classList.add("hidden");
    resetPasswordInputs();
    return;
  }

  formTitle.textContent = "Новый пароль";
  formSubtitle.textContent = "Введите новый пароль для аккаунта.";
  submitBtn.textContent = "Сменить пароль";
  pwHint.classList.remove("hidden");
  passwordInput.autocomplete = "new-password";
  confirmPasswordInput.autocomplete = "new-password";
}

function getResetRedirectUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("mode");
  url.hash = "";
  return url.toString();
}

function getNextUrl() {
  const url = new URL(window.location.href);
  const next = String(url.searchParams.get("next") ?? "").trim();
  return next || "table.html";
}

async function redirectIfAlreadyLoggedIn() {
  const url = new URL(window.location.href);
  const explicitMode = url.searchParams.get("mode");

  if (explicitMode === "reset") {
    setMode("reset");
    return;
  }

  const session = await getSession();
  if (session) {
    window.location.href = getNextUrl();
  }
}

function mapAuthError(error) {
  const message = String(error?.message ?? "").trim();

  if (/invalid login credentials/i.test(message)) {
    return "Неверный email или пароль.";
  }
  if (/email not confirmed/i.test(message)) {
    return "Подтвердите email перед входом.";
  }
  if (/user already registered/i.test(message)) {
    return "Такой email уже зарегистрирован.";
  }
  if (/password should be at least/i.test(message)) {
    return "Пароль слишком короткий.";
  }
  if (/same password/i.test(message)) {
    return "Новый пароль должен отличаться от старого.";
  }

  return message || "Произошла ошибка.";
}

async function handleSignIn() {
  const email = normalizeEmail(emailInput.value);
  const password = String(passwordInput.value ?? "");

  if (!validateEmail(email)) {
    throw new Error("Введите корректный email.");
  }
  if (!password) {
    throw new Error("Введите пароль.");
  }

  await signIn(email, password);
  window.location.href = getNextUrl();
}

async function handleSignUp() {
  const email = normalizeEmail(emailInput.value);
  const password = String(passwordInput.value ?? "");
  const confirmPassword = String(confirmPasswordInput.value ?? "");

  if (!validateEmail(email)) {
    throw new Error("Введите корректный email.");
  }
  if (!validatePassword(password)) {
    throw new Error("Пароль не соответствует требованиям.");
  }
  if (password !== confirmPassword) {
    throw new Error("Пароли не совпадают.");
  }

  await signUp(email, password);
  setInfo("Аккаунт создан. Если у вас включено подтверждение email, подтвердите почту и затем войдите.");
  setMode("signin");
  passwordInput.value = "";
  confirmPasswordInput.value = "";
}

async function handleForgotPassword() {
  const email = normalizeEmail(emailInput.value);

  if (!validateEmail(email)) {
    throw new Error("Введите корректный email.");
  }

  await requestPasswordReset(email, getResetRedirectUrl());
  setInfo("Письмо для сброса пароля отправлено. Проверьте почту.");
}

async function handleResetPassword() {
  const password = String(passwordInput.value ?? "");
  const confirmPassword = String(confirmPasswordInput.value ?? "");

  if (!validatePassword(password)) {
    throw new Error("Пароль не соответствует требованиям.");
  }
  if (password !== confirmPassword) {
    throw new Error("Пароли не совпадают.");
  }

  await updateMyPassword(password);
  setInfo("Пароль успешно изменён. Теперь можно войти с новым паролем.");
  recoverySessionSeen = false;
  resetPasswordInputs();
  setMode("signin");
}

async function handleSubmit(event) {
  event.preventDefault();
  if (isSubmitting) return;

  clearMessages();
  setBusy(true);

  try {
    if (mode === "signin") {
      await handleSignIn();
    } else if (mode === "signup") {
      await handleSignUp();
    } else if (mode === "forgot") {
      await handleForgotPassword();
    } else if (mode === "reset") {
      await handleResetPassword();
    }
  } catch (error) {
    setError(mapAuthError(error));
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  tabSignIn.addEventListener("click", () => {
    resetPasswordInputs();
    setMode("signin");
  });

  tabSignUp.addEventListener("click", () => {
    resetPasswordInputs();
    setMode("signup");
  });

  forgotPasswordBtn.addEventListener("click", () => {
    resetPasswordInputs();
    setMode("forgot");
  });

  backToLoginBtn.addEventListener("click", () => {
    resetPasswordInputs();
    setMode("signin");
  });

  togglePw.addEventListener("click", () => {
    const nextType = passwordInput.type === "password" ? "text" : "password";
    passwordInput.type = nextType;
    if (!confirmWrap.classList.contains("hidden")) {
      confirmPasswordInput.type = nextType;
    }
    togglePw.textContent = nextType === "password" ? "Показать" : "Скрыть";
  });

  authForm.addEventListener("submit", handleSubmit);

  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      recoverySessionSeen = true;
      setMode("reset");
      setInfo("Ссылка подтверждена. Теперь задайте новый пароль.");
    }
  });
}

(async () => {
  try {
    bindEvents();
    await redirectIfAlreadyLoggedIn();

    const url = new URL(window.location.href);
    if (url.searchParams.get("mode") === "reset") {
      setMode("reset");
      setInfo("Введите новый пароль.");
    } else {
      setMode("signin");
    }
  } catch (error) {
    setError(mapAuthError(error));
  }
})();