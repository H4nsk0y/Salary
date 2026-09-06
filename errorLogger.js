import { supabase } from "./supabaseClient.js";
import { classifyClientError } from "./clientErrorInsights.js";

const MAX_REPORTS_PER_SESSION = 3;
const seen = new Set();
let reportsSent = 0;
let lastAction = null;

const IGNORED_PATTERNS = [
  /abort(error|ed)?/i,
  /failed to fetch/i,
  /network(error| request)?/i,
  /load failed/i,
  /timeout|timed out/i,
  /ERR_(INTERNET_DISCONNECTED|NETWORK_CHANGED|CONNECTION|NAME_NOT_RESOLVED)/i,
  /fetch.*(supabase|api)/i,
  /NO_SESSION/i,
];

function cleanText(value, maxLength = 700) {
  return String(value || "")
    .replace(/https?:\/\/[^\s)]+/gi, "[url]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .slice(0, maxLength);
}

function normalizeError(reason) {
  if (reason instanceof Error) {
    return {
      name: cleanText(reason.name, 80),
      message: cleanText(reason.message),
      stack: cleanText(reason.stack, 1800),
    };
  }

  return { name: "Error", message: cleanText(reason), stack: "" };
}

function shouldIgnore(error) {
  if (!navigator.onLine) return true;
  const combined = `${error.name} ${error.message} ${error.stack}`;
  return IGNORED_PATTERNS.some((pattern) => pattern.test(combined));
}

async function report(kind, reason, context = {}) {
  if (reportsSent >= MAX_REPORTS_PER_SESSION) return;

  const error = normalizeError(reason);
  if (!error.message || shouldIgnore(error)) return;

  const signature = `${kind}:${error.name}:${error.message.slice(0, 180)}`;
  if (seen.has(signature)) return;
  seen.add(signature);
  reportsSent += 1;

  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session?.user?.id) return;

    const insight = classifyClientError({ kind, message: error.message, stack: error.stack });
    await supabase.rpc("report_client_error", {
      p_kind: cleanText(kind, 40),
      p_message: error.message,
      p_stack: error.stack || null,
      p_page: location.pathname.slice(0, 300),
      p_context: {
        source: cleanText(context.source, 240),
        line: Number(context.line) || null,
        column: Number(context.column) || null,
        userAgent: cleanText(navigator.userAgent, 300),
        code: insight.code,
        lastAction,
      },
    });
  } catch {
    // Diagnostics must never create a second user-facing failure.
  }
}

export function installErrorLogger() {
  const rememberAction = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const identity = target.id
      ? `#${target.id}`
      : target.getAttribute("name")
        ? `${target.tagName.toLowerCase()}[name=${target.getAttribute("name")}]`
        : target.getAttribute("aria-label")
          ? `${target.tagName.toLowerCase()}[aria-label=${target.getAttribute("aria-label")}]`
          : target.tagName.toLowerCase();
    lastAction = {
      type: event.type,
      target: cleanText(identity, 160),
      at: new Date().toISOString(),
    };
  };
  document.addEventListener("click", rememberAction, true);
  document.addEventListener("change", rememberAction, true);

  window.addEventListener("error", (event) => {
    void report("window_error", event.error || event.message, {
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    void report("unhandled_rejection", event.reason);
  });
}
