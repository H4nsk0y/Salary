export function installDoubleRightClickFullscreen(showControls, button) {
  let lastClickAt = 0;
  window.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showControls();
    const now = performance.now();
    const isDoubleRightClick = now - lastClickAt <= 450;
    lastClickAt = isDoubleRightClick ? 0 : now;
    if (isDoubleRightClick && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        button.title = "Не удалось выйти из полноэкранного режима.";
      });
    }
  });
}
