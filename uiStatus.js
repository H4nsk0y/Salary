const TONE_CLASSES = [
  "bg-white/5", "text-slate-300", "ring-white/10", "border-white/10",
  "bg-emerald-500/10", "text-emerald-200", "ring-emerald-400/20", "border-emerald-400/20",
  "bg-rose-500/10", "text-rose-200", "ring-rose-400/20", "border-rose-400/20",
  "bg-sky-500/10", "text-sky-200", "ring-sky-400/20", "border-sky-400/20",
  "bg-amber-500/10", "text-amber-200", "ring-amber-400/20", "border-amber-400/20",
];

const TONES = {
  neutral: ["bg-white/5", "text-slate-300"],
  ok: ["bg-emerald-500/10", "text-emerald-200"],
  err: ["bg-rose-500/10", "text-rose-200"],
  busy: ["bg-sky-500/10", "text-sky-200"],
  warning: ["bg-amber-500/10", "text-amber-200"],
};

const ACCENTS = {
  ring: {
    neutral: "ring-white/10",
    ok: "ring-emerald-400/20",
    err: "ring-rose-400/20",
    busy: "ring-sky-400/20",
    warning: "ring-amber-400/20",
  },
  border: {
    neutral: "border-white/10",
    ok: "border-emerald-400/20",
    err: "border-rose-400/20",
    busy: "border-sky-400/20",
    warning: "border-amber-400/20",
  },
};

export function setUiStatus(element, text, tone = "neutral", options = {}) {
  if (!element) return;

  const normalizedTone = TONES[tone] ? tone : "neutral";
  if (options.baseClassName) element.className = options.baseClassName;
  else element.classList.remove(...TONE_CLASSES);

  element.textContent = String(text ?? "");
  element.classList.add(...TONES[normalizedTone]);

  const accentClass = ACCENTS[options.accent]?.[normalizedTone];
  if (accentClass) element.classList.add(accentClass);

  element.dataset.status = normalizedTone;
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", normalizedTone === "err" ? "assertive" : "polite");
  element.setAttribute("aria-atomic", "true");
  element.setAttribute("aria-busy", normalizedTone === "busy" ? "true" : "false");
}

