const BANKS = {
  tbank: {
    label: "Т-Банк",
    src: "./images/support_qr_tbank.png",
    alt: "QR-код Т-Банка для поддержки проекта",
  },
  sber: {
    label: "Сбер",
    src: "./images/support_qr_sber.jpg",
    alt: "QR-код Сбера для поддержки проекта",
  },
  ozon: {
    label: "Ozon Банк",
    src: "./images/support_qr_ozon.png",
    alt: "QR-код Ozon Банка для поддержки проекта",
  },
};

const options = document.getElementById("bankOptions");
const qrPlaceholder = document.getElementById("qrPlaceholder");
const qrPanel = document.getElementById("qrPanel");
const qrImage = document.getElementById("qrImage");
const qrCaption = document.getElementById("qrCaption");

options?.addEventListener("click", (event) => {
  const option = event.target.closest("[data-bank]");
  const bank = BANKS[option?.dataset.bank];
  if (!option || !bank || !options.contains(option)) return;

  for (const button of options.querySelectorAll("[data-bank]")) {
    button.setAttribute("aria-pressed", String(button === option));
  }

  qrImage.src = bank.src;
  qrImage.alt = bank.alt;
  qrCaption.textContent = bank.label;
  qrPlaceholder.classList.add("hidden");
  qrPanel.classList.remove("hidden");
});

document.getElementById("supportBackBtn")?.addEventListener("click", () => history.back());
