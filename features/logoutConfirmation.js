export function bindLogoutConfirmation({ button, confirmDialog, signOut, redirect }) {
  button?.addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "Выйти из аккаунта?",
      message: "Текущая сессия на этом устройстве будет завершена.",
      confirmText: "Выйти",
      cancelText: "Остаться",
      tone: "danger",
    });
    if (!confirmed) return;

    try {
      await signOut();
    } finally {
      redirect();
    }
  });
}
