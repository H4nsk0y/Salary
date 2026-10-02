(() => {
  const loader = document.getElementById("alvisaPageLoader");
  if (!loader) return;

  loader.innerHTML = `
    <div class="alvisa-page-loader-inner">
      <img class="alvisa-page-loader-icon" src="./images/app-icon-512.png" alt="" />
      <div class="alvisa-page-loader-title">ALVISA SALARY</div>
      <div class="alvisa-page-loader-status" data-loader-status>Загружаем данные…</div>
      <div class="alvisa-page-loader-progress">
        <div class="alvisa-page-loader-track" role="progressbar" aria-label="Загрузка данных" aria-valuemin="0" aria-valuemax="100" aria-valuenow="8">
          <span class="alvisa-page-loader-bar"></span>
        </div>
        <span class="alvisa-page-loader-percent" data-loader-percent>8%</span>
      </div>
      <button class="alvisa-page-loader-retry" type="button">Обновить страницу</button>
    </div>`;

  loader.querySelector(".alvisa-page-loader-retry")?.addEventListener("click", () => location.reload());

  try {
    const hasSession = Object.keys(localStorage).some((key) => /^sb-.+-auth-token$/.test(key));
    if (!hasSession) return;
    document.documentElement.classList.add("alvisa-loader-primed");
    window.__alvisaLoaderSafetyTimer = setTimeout(() => {
      if (!document.body.contains(loader) || loader.classList.contains("is-leaving")) return;
      loader.classList.add("is-slow");
      const status = loader.querySelector("[data-loader-status]");
      if (status) status.textContent = "Не удалось запустить страницу. Проверьте VPN и обновите её.";
    }, 20000);
  } catch {
    // Private browsing may deny localStorage access; the regular loader can still activate later.
  }
})();
