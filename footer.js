const FOOTER_STYLE_ID = "alvisa-common-footer-style";

function injectFooterStyles() {
  if (document.getElementById(FOOTER_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = FOOTER_STYLE_ID;
  style.textContent = `
    [data-app-footer] {
      width: 100%;
    }

    .app-footer {
      width: min(1440px, calc(100% - 32px));
      margin: 56px auto 0;
      padding: 22px 0 calc(22px + env(safe-area-inset-bottom, 0px));
      border-top: 1px solid rgba(241, 238, 232, 0.13);
      color: #858b90;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    .app-footer-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }

    .app-footer-note {
      margin: 0;
      font-size: 0.72rem;
      line-height: 1.55;
    }

    .app-footer-support {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 8px;
      color: #c6a15b;
      font-size: 0.75rem;
      font-weight: 700;
      text-decoration: none;
      transition: color 180ms ease;
    }

    .app-footer-support svg {
      transition: transform 180ms ease;
    }

    .app-footer-support:hover {
      color: #e0c27f;
    }

    .app-footer-support:hover svg {
      transform: translateX(3px);
    }

    .auth-page > [data-app-footer] .app-footer {
      width: min(1180px, calc(100% - 40px));
      margin-top: 0;
    }

    @media (max-width: 640px) {
      .app-footer {
        width: calc(100% - 28px);
        margin-top: 40px;
        padding-top: 18px;
      }

      .app-footer-inner {
        align-items: flex-start;
        flex-direction: column;
        gap: 10px;
      }

      .auth-page > [data-app-footer] .app-footer {
        width: calc(100% - 28px);
        margin-top: 0;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .app-footer-support,
      .app-footer-support svg {
        transition: none;
      }
    }
  `;

  document.head.appendChild(style);
}

function createFooter() {
  const footer = document.createElement("footer");
  footer.className = "app-footer";

  const inner = document.createElement("div");
  inner.className = "app-footer-inner";

  const note = document.createElement("p");
  note.className = "app-footer-note";
  note.textContent = "Проект находится в стадии разработки. Пожалуйста, уточняйте важную информацию.";

  const support = document.createElement("a");
  support.className = "app-footer-support";
  support.href = "support.html";
  support.innerHTML = `
    <span>Поддержать проект</span>
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 12h14"></path>
      <path d="m13 6 6 6-6 6"></path>
    </svg>
  `;

  inner.append(note, support);
  footer.appendChild(inner);
  return footer;
}

function renderFooters() {
  injectFooterStyles();

  let targets = Array.from(document.querySelectorAll("[data-app-footer]"));
  if (!targets.length) {
    const target = document.createElement("div");
    target.dataset.appFooter = "";
    document.body.appendChild(target);
    targets = [target];
  }

  for (const target of targets) {
    if (target.dataset.footerReady === "true") continue;
    if (!target.closest(".auth-page") && target.parentElement !== document.body) {
      document.body.appendChild(target);
    }
    target.replaceChildren(createFooter());
    target.dataset.footerReady = "true";
  }
}

renderFooters();
