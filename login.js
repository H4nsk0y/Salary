import { supabase } from "./supabaseClient.js";
import "./scrollbar.js";
import {
  getSession,
  signIn,
  signUp,
  requestPasswordReset,
  updateMyPassword,
} from "./auth.js";
import { acceptDepartmentInvite, getMyProfile } from "./db.js";
import {
  buildProfileCompletionUrl,
  getMissingRequiredProfileFields,
  normalizeInternalNextUrl,
} from "./profileCompletion.js";
import { getPasswordChecks, validatePasswordPolicy } from "./passwordPolicy.js";

const REMEMBER_ME_KEY = "alvisa_remember_me";
const REMEMBERED_EMAIL_KEY = "alvisa_remembered_email";
const PENDING_INVITE_KEY = "alvisa_pending_department_invite";

const authForm = document.getElementById("authForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirmPassword");

const emailFieldWrap = document.getElementById("emailFieldWrap");
const passwordFieldWrap = document.getElementById("passwordFieldWrap");
const confirmWrap = document.getElementById("confirmWrap");
const rememberMeWrap = document.getElementById("rememberMeWrap");

const tabSignIn = document.getElementById("tabSignIn");
const tabSignUp = document.getElementById("tabSignUp");
const submitBtn = document.getElementById("submitBtn");
const togglePw = document.getElementById("togglePw");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
const backToLoginBtn = document.getElementById("backToLoginBtn");
const rememberMeCheckbox = document.getElementById("rememberMe");

const formTitle = document.getElementById("formTitle");
const formSubtitle = document.getElementById("formSubtitle");
const formFootnote = document.getElementById("formFootnote");
const pwHint = document.getElementById("pwHint");
const authPageMarker = document.getElementById("authPageMarker");
const errorBox = document.getElementById("errorBox");
const infoBox = document.getElementById("infoBox");

let mode = "signin";
let isSubmitting = false;

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

function updatePasswordRequirements() {
  const checks = getPasswordChecks(passwordInput.value);
  for (const check of checks) {
    const item = pwHint.querySelector(`[data-password-rule="${check.key}"]`);
    item?.classList.toggle("is-passed", check.passed);
  }
}

async function resolveDestinationAfterAuth(nextUrl = getNextUrl()) {
  try {
    const profile = await getMyProfile();
    const missing = getMissingRequiredProfileFields(profile);
    return missing.length ? buildProfileCompletionUrl(nextUrl, missing) : nextUrl;
  } catch {
    return nextUrl;
  }
}

function getNextUrl() {
  const url = new URL(window.location.href);
  const next = String(url.searchParams.get("next") ?? "").trim();
  return normalizeInternalNextUrl(next, "table.html");
}

function getInviteToken() {
  const url = new URL(window.location.href);
  const fromUrl = String(url.searchParams.get("invite") ?? "").trim();

  if (fromUrl) {
    localStorage.setItem(PENDING_INVITE_KEY, fromUrl);
    return fromUrl;
  }

  return String(localStorage.getItem(PENDING_INVITE_KEY) ?? "").trim();
}

function clearInviteToken() {
  localStorage.removeItem(PENDING_INVITE_KEY);
}

async function acceptPendingInvite({ allowNoSession = false } = {}) {
  const token = getInviteToken();
  if (!token) return null;

  try {
    const result = await acceptDepartmentInvite(token);
    clearInviteToken();
    return result;
  } catch (error) {
    if (allowNoSession && String(error?.message || "").includes("NO_SESSION")) {
      return null;
    }

    throw error;
  }
}

function getResetRedirectUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("mode");
  url.hash = "";
  return url.toString();
}

function setBusy(nextBusy) {
  isSubmitting = Boolean(nextBusy);

  const disabled = isSubmitting;
  submitBtn.disabled = disabled;
  emailInput.disabled = disabled || mode === "reset";
  passwordInput.disabled = disabled || mode === "forgot";
  confirmPasswordInput.disabled = disabled || !(mode === "signup" || mode === "reset");
  tabSignIn.disabled = disabled;
  tabSignUp.disabled = disabled;
  forgotPasswordBtn.disabled = disabled || !(mode === "signin" || mode === "forgot");
  backToLoginBtn.disabled = disabled || !(mode === "forgot" || mode === "reset");
  togglePw.disabled = disabled || mode === "forgot";
  rememberMeCheckbox.disabled = disabled || mode !== "signin";
}

function setTabStyles(activeTab) {
  const buttons = [
    { el: tabSignIn, active: activeTab === "signin" },
    { el: tabSignUp, active: activeTab === "signup" },
  ];

  for (const { el, active } of buttons) {
    el.classList.remove("tab-active", "bg-white/5", "text-slate-200");
    el.setAttribute("aria-selected", active ? "true" : "false");

    if (active) {
      el.classList.add("tab-active");
    } else {
      el.classList.add("bg-white/5", "text-slate-200");
    }
  }
}

function syncPasswordVisibility(forceHidden = true) {
  const visible = !forceHidden && passwordInput.type === "text";
  const nextType = visible ? "text" : "password";

  passwordInput.type = nextType;
  if (!confirmWrap.classList.contains("hidden") && !confirmPasswordInput.disabled) {
    confirmPasswordInput.type = nextType;
  } else {
    confirmPasswordInput.type = "password";
  }

  const isVisible = nextType === "text";
  togglePw.textContent = isVisible ? "Скрыть" : "Показать";
  togglePw.setAttribute("aria-pressed", isVisible ? "true" : "false");
  togglePw.setAttribute("aria-label", isVisible ? "Скрыть пароль" : "Показать пароль");
}

function resetPasswordInputs() {
  passwordInput.value = "";
  confirmPasswordInput.value = "";
  syncPasswordVisibility(true);
  updatePasswordRequirements();
}

function setConfirmVisible(visible) {
  confirmWrap.classList.toggle("hidden", !visible);
  confirmPasswordInput.disabled = !visible;

  if (!visible) {
    confirmPasswordInput.value = "";
    confirmPasswordInput.type = "password";
  }
}

function applyRememberedEmail() {
  const rememberMe = localStorage.getItem(REMEMBER_ME_KEY) === "1";
  const rememberedEmail = localStorage.getItem(REMEMBERED_EMAIL_KEY) || "";

  rememberMeCheckbox.checked = rememberMe;
  if (rememberedEmail) {
    emailInput.value = rememberedEmail;
  }
}

function persistRememberMe() {
  if (rememberMeCheckbox.checked) {
    localStorage.setItem(REMEMBER_ME_KEY, "1");
    localStorage.setItem(REMEMBERED_EMAIL_KEY, normalizeEmail(emailInput.value));
    return;
  }

  localStorage.removeItem(REMEMBER_ME_KEY);
  localStorage.removeItem(REMEMBERED_EMAIL_KEY);
}

function updateRememberMeVisibility() {
  const visible = mode === "signin";
  rememberMeWrap.classList.toggle("hidden", !visible);
}

function setMode(nextMode) {
  mode = nextMode;
  clearMessages();

  const isSignIn = mode === "signin";
  const isSignUp = mode === "signup";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";

  setTabStyles(isSignIn ? "signin" : isSignUp ? "signup" : null);

  emailFieldWrap.classList.toggle("hidden", isReset);
  passwordFieldWrap.classList.toggle("hidden", isForgot);

  setConfirmVisible(isSignUp || isReset);

  forgotPasswordBtn.classList.toggle("hidden", !isSignIn);
  backToLoginBtn.classList.toggle("hidden", !(isForgot || isReset));
  updateRememberMeVisibility();

  pwHint.classList.toggle("hidden", !(isSignUp || isReset));
  updatePasswordRequirements();

  syncPasswordVisibility(true);

  if (isSignIn) {
    formTitle.textContent = "Вход";
    formSubtitle.textContent = "Введите email и пароль.";
    formFootnote.textContent = "После входа табель будет сохраняться в аккаунте.";
    submitBtn.textContent = "Войти";
    authPageMarker.textContent = "Вход";
    passwordInput.autocomplete = "current-password";
    confirmPasswordInput.autocomplete = "new-password";
  } else if (isSignUp) {
    formTitle.textContent = "Регистрация";
    formSubtitle.textContent = "Создайте аккаунт для сохранения табеля.";
    formFootnote.textContent = "После регистрации вы сможете сохранять табель и использовать профиль.";
    submitBtn.textContent = "Зарегистрироваться";
    authPageMarker.textContent = "Регистрация";
    passwordInput.autocomplete = "new-password";
    confirmPasswordInput.autocomplete = "new-password";
  } else if (isForgot) {
    formTitle.textContent = "Сброс пароля";
    formSubtitle.textContent = "Введите email, и мы отправим ссылку для смены пароля.";
    formFootnote.textContent = "Письмо может прийти не сразу. Проверьте также папку «Спам».";
    submitBtn.textContent = "Отправить письмо";
    authPageMarker.textContent = "Сброс пароля";
    resetPasswordInputs();
  } else {
    formTitle.textContent = "Новый пароль";
    formSubtitle.textContent = "Введите новый пароль для аккаунта.";
    formFootnote.textContent = "После смены пароля вы сможете войти с новыми данными.";
    submitBtn.textContent = "Сменить пароль";
    authPageMarker.textContent = "Новый пароль";
    passwordInput.autocomplete = "new-password";
    confirmPasswordInput.autocomplete = "new-password";
  }

  setBusy(false);
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
  if (/signup is disabled/i.test(message)) {
    return "Регистрация сейчас отключена.";
  }
  if (message.includes("INVITE_NOT_FOUND")) {
    return "Приглашение не найдено. Попросите новую ссылку.";
  }
  if (message.includes("INVITE_REVOKED")) {
    return "Приглашение отозвано. Попросите новую ссылку.";
  }
  if (message.includes("INVITE_EXPIRED")) {
    return "Срок приглашения истек. Попросите новую ссылку.";
  }
  if (message.includes("INVITE_USED_UP")) {
    return "Лимит приглашения исчерпан. Попросите новую ссылку.";
  }
  if (message.includes("USER_ALREADY_IN_ANOTHER_DEPARTMENT")) {
    return "Ваш аккаунт уже состоит в другом отделе.";
  }
  if (message.includes("accept_department_invite") || message.includes("department_invites")) {
    return "В базе пока нет функции приглашений. Нужно запустить SQL из supabase-sql/006_fix_invite_permissions_and_pgcrypto.sql.";
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

  persistRememberMe();
  await signIn(email, password);
  const inviteResult = await acceptPendingInvite();
  if (inviteResult?.department_name) {
    setInfo(`Приглашение принято: ${inviteResult.department_name}.`);
  }
  window.location.href = await resolveDestinationAfterAuth();
}

async function handleSignUp() {
  const email = normalizeEmail(emailInput.value);
  const password = String(passwordInput.value ?? "");
  const confirmPassword = String(confirmPasswordInput.value ?? "");

  if (!validateEmail(email)) {
    throw new Error("Введите корректный email.");
  }
  const passwordValidation = validatePasswordPolicy(password);
  if (!passwordValidation.valid) {
    throw new Error(`Пароль пока не подходит: ${passwordValidation.missing.join(", ")}.`);
  }
  if (password !== confirmPassword) {
    throw new Error("Пароли не совпадают.");
  }

  const hadInvite = Boolean(getInviteToken());
  const signUpResult = await signUp(email, password);
  const inviteResult = await acceptPendingInvite({ allowNoSession: true });
  if (signUpResult?.session) {
    window.location.href = buildProfileCompletionUrl(getNextUrl(), [
      "display_name", "position", "gender", "branch", "employment_date", "oklad",
    ]);
    return;
  }
  passwordInput.value = "";
  confirmPasswordInput.value = "";
  setMode("signin");
  setInfo(
    inviteResult?.department_name
      ? `Аккаунт создан, приглашение принято: ${inviteResult.department_name}. Теперь можно войти.`
      : hadInvite
        ? "Аккаунт создан. Если включено подтверждение email, подтвердите почту и затем войдите. Приглашение применится после входа."
        : "Аккаунт создан. Если включено подтверждение email, подтвердите почту и затем войдите."
  );
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

  const passwordValidation = validatePasswordPolicy(password);
  if (!passwordValidation.valid) {
    throw new Error(`Пароль пока не подходит: ${passwordValidation.missing.join(", ")}.`);
  }
  if (password !== confirmPassword) {
    throw new Error("Пароли не совпадают.");
  }

  await updateMyPassword(password);
  setInfo("Пароль успешно изменён. Теперь можно войти с новым паролем.");
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

async function redirectIfAlreadyLoggedIn() {
  const url = new URL(window.location.href);
  const explicitMode = url.searchParams.get("mode");

  if (explicitMode === "reset") {
    setMode("reset");
    return true;
  }

  const session = await getSession();
  if (session) {
    await acceptPendingInvite();
    window.location.href = await resolveDestinationAfterAuth();
    return true;
  }

  return false;
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
    const makeVisible = passwordInput.type === "password";
    passwordInput.type = makeVisible ? "text" : "password";

    if (!confirmWrap.classList.contains("hidden") && !confirmPasswordInput.disabled) {
      confirmPasswordInput.type = makeVisible ? "text" : "password";
    }

    togglePw.textContent = makeVisible ? "Скрыть" : "Показать";
    togglePw.setAttribute("aria-pressed", makeVisible ? "true" : "false");
    togglePw.setAttribute("aria-label", makeVisible ? "Скрыть пароль" : "Показать пароль");
  });

  rememberMeCheckbox.addEventListener("change", () => {
    if (!rememberMeCheckbox.checked) {
      localStorage.removeItem(REMEMBER_ME_KEY);
      localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      return;
    }

    localStorage.setItem(REMEMBER_ME_KEY, "1");
    localStorage.setItem(REMEMBERED_EMAIL_KEY, normalizeEmail(emailInput.value));
  });

  emailInput.addEventListener("input", () => {
    if (rememberMeCheckbox.checked && mode === "signin") {
      localStorage.setItem(REMEMBERED_EMAIL_KEY, normalizeEmail(emailInput.value));
    }
  });
  passwordInput.addEventListener("input", updatePasswordRequirements);

  authForm.addEventListener("submit", handleSubmit);

  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      setMode("reset");
      setInfo("Ссылка подтверждена. Теперь задайте новый пароль.");
    }
  });
}

(async () => {
  try {
    bindEvents();
    applyRememberedEmail();
    const redirected = await redirectIfAlreadyLoggedIn();
    if (redirected) return;

    const url = new URL(window.location.href);
    if (url.searchParams.get("mode") === "reset") {
      setMode("reset");
      setInfo("Введите новый пароль.");
    } else if (url.searchParams.get("mode") === "signup" || getInviteToken()) {
      setMode("signup");
      if (getInviteToken()) {
        setInfo("Вы открыли регистрацию по приглашению. После регистрации или входа аккаунт будет добавлен в нужный отдел.");
      }
    } else {
      setMode("signin");
    }
  } catch (error) {
    setMode("signin");
    setError(mapAuthError(error));
  }
})();
