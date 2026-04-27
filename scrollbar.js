const SCROLLBAR_STYLE_ID = "alvisa-common-scrollbar-style";

export function injectCommonScrollbarStyles() {
  if (document.getElementById(SCROLLBAR_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = SCROLLBAR_STYLE_ID;
  style.textContent = `
    :root {
      scrollbar-color: rgba(99, 102, 241, 0.55) rgba(30, 41, 59, 0.55);
      scrollbar-width: thin;
    }

    * {
      scrollbar-color: rgba(99, 102, 241, 0.55) rgba(30, 41, 59, 0.55);
      scrollbar-width: thin;
    }

    *::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }

    *::-webkit-scrollbar-track {
      border-radius: 999px;
      background: rgba(30, 41, 59, 0.55);
    }

    *::-webkit-scrollbar-thumb {
      border: 2px solid rgba(30, 41, 59, 0.55);
      border-radius: 999px;
      background: rgba(99, 102, 241, 0.55);
    }

    *::-webkit-scrollbar-thumb:hover {
      background: rgba(99, 102, 241, 0.8);
    }
  `;

  document.head.appendChild(style);
}

injectCommonScrollbarStyles();
