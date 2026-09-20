import { supabase } from "./supabaseClient.js";

let cachedSession = null;
let sessionResolved = false;
let sessionPromise = null;

function rememberSession(session) {
  cachedSession = session ?? null;
  sessionResolved = true;
  sessionPromise = Promise.resolve(cachedSession);
  return cachedSession;
}

supabase.auth.onAuthStateChange((_event, session) => {
  rememberSession(session);
});

export function getSession({ fresh = false } = {}) {
  if (fresh) {
    sessionResolved = false;
    sessionPromise = null;
  }

  if (sessionResolved) return Promise.resolve(cachedSession);
  if (!sessionPromise) {
    sessionPromise = supabase.auth.getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        return rememberSession(data.session);
      })
      .catch((error) => {
        sessionPromise = null;
        throw error;
      });
  }

  return sessionPromise;
}

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("NO_SESSION");
  return session;
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (data.session) rememberSession(data.session);
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  rememberSession(data.session);
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  rememberSession(null);
}

export async function verifyCurrentPassword(password) {
  const session = await requireSession();
  const email = String(session?.user?.email ?? "").trim();

  if (!email) {
    throw new Error("Не удалось определить email текущего пользователя.");
  }

  const pwd = String(password ?? "");
  if (!pwd) return false;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: pwd,
  });

  return !error;
}

export async function requestPasswordReset(email, redirectTo) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("Введите email.");
  }

  const options = {};
  if (redirectTo) {
    options.redirectTo = redirectTo;
  }

  const { error } = await supabase.auth.resetPasswordForEmail(
    normalizedEmail,
    options
  );

  if (error) throw error;
}

export async function updateMyPassword(newPassword) {
  const password = String(newPassword ?? "");
  if (!password) {
    throw new Error("Введите новый пароль.");
  }

  const { data, error } = await supabase.auth.updateUser({
    password,
  });

  if (error) throw error;
  return data;
}
