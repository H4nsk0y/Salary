export function initializeProfileOvertimeBar() {
  const bar = document.getElementById("overtimeBarFill");
  if (!bar) return;

  const updateColor = () => {
    if (!bar.style.width) return;
    const percent = Number.parseFloat(bar.style.width) || 0;
    const hue = percent <= 50
      ? 120 - (percent / 50) * 60
      : 60 - ((percent - 50) / 50) * 60;
    bar.style.backgroundColor = `hsl(${hue}, 90%, 60%)`;
  };

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.attributeName === "style")) updateColor();
  });
  observer.observe(bar, { attributes: true, attributeFilter: ["style"] });
  updateColor();
}

initializeProfileOvertimeBar();
