const MAX_SHIFT_COMMENT_LENGTH = 300;

let activeOverlay = null;

export function normalizeShiftComments(value, length) {
  const result = new Array(length).fill("");
  if (!Array.isArray(value)) return result;

  for (let index = 0; index < length; index += 1) {
    result[index] = String(value[index] ?? "").trim().slice(0, MAX_SHIFT_COMMENT_LENGTH);
  }
  return result;
}

export function updateShiftCommentCell(cell, comment) {
  if (!(cell instanceof HTMLElement)) return;
  const text = String(comment ?? "").trim();
  cell.classList.toggle("has-shift-comment", Boolean(text));
  cell.dataset.shiftComment = text;
  cell.title = text ? `Комментарий к смене: ${text}` : "";
  cell.setAttribute(
    "aria-label",
    text ? `Есть комментарий к смене: ${text}` : "Комментария к смене нет"
  );
}

function closeDialog() {
  if (!activeOverlay) return;
  activeOverlay.remove();
  activeOverlay = null;
}

export function openShiftCommentDialog({ anchor, title, comment, editable = false, onSave } = {}) {
  closeDialog();

  const overlay = document.createElement("div");
  overlay.className = "shift-comment-overlay";

  const dialog = document.createElement("section");
  dialog.className = "shift-comment-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const heading = document.createElement("h3");
  heading.className = "shift-comment-title";
  heading.textContent = title || "Комментарий к смене";
  dialog.appendChild(heading);

  const text = String(comment ?? "").trim();
  let textarea = null;

  if (editable) {
    textarea = document.createElement("textarea");
    textarea.className = "shift-comment-input";
    textarea.maxLength = MAX_SHIFT_COMMENT_LENGTH;
    textarea.rows = 4;
    textarea.placeholder = "Например: выйти с 11:00 до 20:00";
    textarea.value = text;
    dialog.appendChild(textarea);

    const counter = document.createElement("div");
    counter.className = "shift-comment-counter";
    const updateCounter = () => { counter.textContent = `${textarea.value.length}/${MAX_SHIFT_COMMENT_LENGTH}`; };
    textarea.addEventListener("input", updateCounter);
    updateCounter();
    dialog.appendChild(counter);
  } else {
    const message = document.createElement("p");
    message.className = "shift-comment-message";
    message.textContent = text || "Комментарий не указан.";
    dialog.appendChild(message);
  }

  const actions = document.createElement("div");
  actions.className = "shift-comment-actions";

  if (editable && text) {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "shift-comment-button shift-comment-button-danger";
    removeButton.textContent = "Удалить";
    removeButton.addEventListener("click", () => {
      onSave?.("");
      closeDialog();
    });
    actions.appendChild(removeButton);
  }

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "shift-comment-button shift-comment-button-secondary";
  cancelButton.textContent = editable ? "Отмена" : "Закрыть";
  cancelButton.addEventListener("click", closeDialog);
  actions.appendChild(cancelButton);

  if (editable) {
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "shift-comment-button shift-comment-button-primary";
    saveButton.textContent = "Сохранить";
    saveButton.addEventListener("click", () => {
      onSave?.(String(textarea?.value ?? "").trim().slice(0, MAX_SHIFT_COMMENT_LENGTH));
      closeDialog();
    });
    actions.appendChild(saveButton);
  }

  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  activeOverlay = overlay;

  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) closeDialog();
  });
  dialog.addEventListener("pointerdown", (event) => event.stopPropagation());

  const anchorRect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : null;
  if (anchorRect && window.innerWidth > 700) {
    const width = 340;
    const left = Math.min(window.innerWidth - width - 16, Math.max(16, anchorRect.right + 10));
    const top = Math.min(window.innerHeight - 250, Math.max(16, anchorRect.top));
    dialog.style.left = `${left}px`;
    dialog.style.top = `${top}px`;
  }

  const handleKey = (event) => {
    if (event.key === "Escape") closeDialog();
    if (event.key === "Enter" && editable && (event.ctrlKey || event.metaKey)) {
      onSave?.(String(textarea?.value ?? "").trim().slice(0, MAX_SHIFT_COMMENT_LENGTH));
      closeDialog();
    }
  };
  overlay.addEventListener("keydown", handleKey);
  requestAnimationFrame(() => (textarea || cancelButton).focus());
}
