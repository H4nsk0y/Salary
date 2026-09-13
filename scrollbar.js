const SCROLLBAR_STYLE_ID = "alvisa-common-scrollbar-style";

export function injectCommonScrollbarStyles() {
  if (document.getElementById(SCROLLBAR_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = SCROLLBAR_STYLE_ID;
  style.textContent = `
    :root {
      scrollbar-color: #7a1638 #111519;
      scrollbar-width: thin;
    }

    * {
      scrollbar-color: #7a1638 #111519;
      scrollbar-width: thin;
    }

    *::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }

    *::-webkit-scrollbar-track {
      border-radius: 5px;
      background: #111519;
    }

    *::-webkit-scrollbar-thumb {
      border: 2px solid #111519;
      border-radius: 5px;
      background: #7a1638;
    }

    *::-webkit-scrollbar-thumb:hover {
      background: #a62a52;
    }
  `;

  document.head.appendChild(style);
}

injectCommonScrollbarStyles();
