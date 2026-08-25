import { submitProjectIdea } from "./db.js";

const STYLE_ID = "alvisa-idea-dialog-style";
const TELEGRAM_URL = "https://t.me/Hanskoy";
let dialogState = null;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .idea-dialog-overlay{position:fixed;inset:0;z-index:320;display:grid;place-items:center;padding:18px;background:rgba(5,6,7,.86);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
    .idea-dialog-overlay[hidden]{display:none!important}.idea-dialog{width:min(560px,100%);max-height:calc(100dvh - 36px);overflow:auto;border:1px solid rgba(241,238,232,.15);border-radius:9px;background:#15191d;color:#f1eee8;box-shadow:0 30px 100px rgba(0,0,0,.58);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
    .idea-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:22px;border-bottom:1px solid rgba(241,238,232,.12)}.idea-dialog-kicker{margin:0 0 7px;color:#d5ba83;font-size:.68rem;font-weight:800;text-transform:uppercase}.idea-dialog-title{margin:0;font-family:Anticva,Georgia,serif;font-size:1.8rem;font-weight:400;letter-spacing:0}.idea-dialog-close{width:34px;height:34px;border:1px solid rgba(241,238,232,.12);border-radius:6px;background:transparent;color:#92999f;font-size:1.15rem}.idea-dialog-close:hover{background:rgba(241,238,232,.06);color:#f1eee8}
    .idea-dialog-body{padding:22px}.idea-dialog-copy{margin:0;color:#959ca2;font-size:.79rem;line-height:1.55}.idea-dialog-choices{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}.idea-choice{min-height:94px;border:1px solid rgba(241,238,232,.12);border-radius:7px;padding:15px;background:#101417;color:#d4d7d9;text-align:left;text-decoration:none}.idea-choice:hover{border-color:rgba(198,161,91,.36);background:#171b1f}.idea-choice strong{display:block;font-size:.82rem}.idea-choice span{display:block;margin-top:6px;color:#858c92;font-size:.7rem;line-height:1.45}
    .idea-site-form{display:grid;gap:12px;margin-top:18px}.idea-site-form[hidden]{display:none!important}.idea-textarea{width:100%;min-height:150px;resize:vertical;border:1px solid rgba(241,238,232,.14);border-radius:7px;outline:none;padding:13px;background:#0b0f12;color:#f1eee8;font:inherit;font-size:.8rem;line-height:1.5}.idea-textarea:focus{border-color:rgba(110,168,232,.6);box-shadow:0 0 0 3px rgba(110,168,232,.09)}.idea-form-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.idea-counter,.idea-message{color:#7f878d;font-size:.7rem}.idea-message.is-error{color:#e4a4b7}.idea-message.is-success{color:#a9c9b7}.idea-submit{min-height:42px;border:1px solid rgba(198,161,91,.4);border-radius:6px;padding:0 16px;background:rgba(198,161,91,.12);color:#ead3a5;font-size:.76rem;font-weight:800}.idea-submit:hover{background:rgba(198,161,91,.19)}.idea-submit:disabled{cursor:wait;opacity:.55}
    @media(max-width:520px){.idea-dialog-body,.idea-dialog-head{padding:18px}.idea-dialog-choices{grid-template-columns:1fr}.idea-form-row{align-items:stretch;flex-direction:column}.idea-submit{width:100%}}
  `;
  document.head.append(style);
}

function createDialog() {
  injectStyles();
  const overlay = document.createElement("div");
  overlay.className = "idea-dialog-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="idea-dialog" role="dialog" aria-modal="true" aria-labelledby="ideaDialogTitle">
      <header class="idea-dialog-head"><div><p class="idea-dialog-kicker">Обратная связь</p><h2 id="ideaDialogTitle" class="idea-dialog-title">Предложить идею</h2></div><button class="idea-dialog-close" type="button" aria-label="Закрыть">×</button></header>
      <div class="idea-dialog-body">
        <p class="idea-dialog-copy">Выберите удобный способ. Идея через сайт сохранится в системе и не потеряется среди сообщений.</p>
        <div class="idea-dialog-choices">
          <button class="idea-choice idea-choice-site" type="button"><strong>Через сайт</strong><span>Напишите предложение здесь. Оно появится в списке идей владельца.</span></button>
          <a class="idea-choice" href="${TELEGRAM_URL}" target="_blank" rel="noopener noreferrer"><strong>В Telegram</strong><span>Откроется привычный личный чат с автором проекта.</span></a>
        </div>
        <form class="idea-site-form" hidden>
          <textarea class="idea-textarea" minlength="10" maxlength="2000" placeholder="Опишите, что стоит добавить или изменить" aria-label="Текст идеи"></textarea>
          <div class="idea-form-row"><span class="idea-counter">0 / 2000</span><button class="idea-submit" type="submit">Отправить идею</button></div>
          <div class="idea-message" role="status" aria-live="polite"></div>
        </form>
      </div>
    </section>`;

  const close = () => {
    overlay.hidden = true;
    document.body.style.overflow = dialogState?.previousOverflow ?? "";
  };
  const form = overlay.querySelector(".idea-site-form");
  const textarea = overlay.querySelector(".idea-textarea");
  const counter = overlay.querySelector(".idea-counter");
  const message = overlay.querySelector(".idea-message");
  const submit = overlay.querySelector(".idea-submit");

  overlay.querySelector(".idea-dialog-close").addEventListener("click", close);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  overlay.querySelector(".idea-choice-site").addEventListener("click", () => {
    form.hidden = false;
    textarea.focus();
  });
  textarea.addEventListener("input", () => { counter.textContent = `${textarea.value.length} / 2000`; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = textarea.value.trim();
    message.className = "idea-message";
    if (value.length < 10) {
      message.textContent = "Опишите идею хотя бы в десяти символах.";
      message.classList.add("is-error");
      return;
    }
    submit.disabled = true;
    message.textContent = "Отправляю…";
    try {
      await submitProjectIdea(value);
      textarea.value = "";
      counter.textContent = "0 / 2000";
      message.textContent = "Идея отправлена. Спасибо!";
      message.classList.add("is-success");
    } catch (error) {
      const raw = String(error?.message ?? error ?? "");
      message.textContent = /submit_project_idea|PGRST202/i.test(raw)
        ? "Форма еще не подключена к базе данных. Попробуйте Telegram или сообщите владельцу."
        : /IDEA_RATE_LIMIT/i.test(raw)
          ? "Сегодня отправлено слишком много идей. Попробуйте завтра."
          : "Не удалось отправить идею. Проверьте соединение и авторизацию.";
      message.classList.add("is-error");
    } finally {
      submit.disabled = false;
    }
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !overlay.hidden) close(); });
  document.body.append(overlay);
  dialogState = { overlay, form, textarea, message, close, previousOverflow: "" };
  return dialogState;
}

export function openIdeaDialog({ prefill = "", openSiteForm = false } = {}) {
  const state = dialogState ?? createDialog();
  state.previousOverflow = document.body.style.overflow;
  state.overlay.hidden = false;
  document.body.style.overflow = "hidden";
  state.message.textContent = "";
  state.message.className = "idea-message";
  if (prefill) state.textarea.value = String(prefill).slice(0, 2000);
  state.form.hidden = !openSiteForm;
  state.overlay.querySelector(".idea-counter").textContent = `${state.textarea.value.length} / 2000`;
  if (openSiteForm) state.textarea.focus();
  else state.overlay.querySelector(".idea-choice-site").focus();
}

document.querySelectorAll("[data-open-idea-dialog]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    openIdeaDialog();
  });
});
