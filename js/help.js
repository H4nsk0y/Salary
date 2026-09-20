const searchInput = document.getElementById("helpSearch");
const searchStatus = document.getElementById("helpSearchStatus");
const emptyState = document.getElementById("searchEmpty");
const topicSections = [...document.querySelectorAll("[data-help-topic]")];
const faqItems = [...document.querySelectorAll("[data-faq-item]")];

function normalizeSearch(value) {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .trim();
}

function filterHelp() {
  const query = normalizeSearch(searchInput?.value);
  if (!query) {
    topicSections.forEach((section) => { section.hidden = false; });
    faqItems.forEach((item) => { item.hidden = false; });
    if (emptyState) emptyState.hidden = true;
    if (searchStatus) searchStatus.textContent = "Поиск работает по всем разделам и вопросам";
    return;
  }

  let visibleSections = 0;
  topicSections.forEach((section) => {
    if (section.id === "faq") return;
    const matches = normalizeSearch(section.textContent).includes(query);
    section.hidden = !matches;
    if (matches) visibleSections += 1;
  });

  let visibleFaq = 0;
  faqItems.forEach((item) => {
    const matches = normalizeSearch(item.textContent).includes(query);
    item.hidden = !matches;
    if (matches) visibleFaq += 1;
  });

  const faqSection = document.getElementById("faq");
  if (faqSection) faqSection.hidden = visibleFaq === 0;
  const total = visibleSections + visibleFaq;
  if (emptyState) emptyState.hidden = total > 0;
  if (searchStatus) {
    searchStatus.textContent = total > 0
      ? `Найдено подходящих разделов и ответов: ${total}`
      : "Попробуйте изменить запрос";
  }
}

searchInput?.addEventListener("input", filterHelp);
