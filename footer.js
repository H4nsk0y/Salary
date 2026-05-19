const footerHtml = `
  <footer class="mt-12 text-center text-xs text-slate-400/70 border-t border-white/10 pt-6 leading-6">
    <span class="font-bold text-rose-400">ВНИМАНИЕ:</span> Проект находится в стадии разработки. Пожалуйста, уточняйте информацию.
    <br>
    <a href="support.html" class="inline-flex items-center justify-center rounded-full bg-amber-400/10 px-3 py-1 font-semibold text-amber-200 ring-1 ring-amber-300/20 transition hover:bg-amber-400/15 hover:text-amber-100">
      Поддержать автора
    </a>
  </footer>
`;

for (const target of document.querySelectorAll("[data-app-footer]")) {
  target.innerHTML = footerHtml;
}
