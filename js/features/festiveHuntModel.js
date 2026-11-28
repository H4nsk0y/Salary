export const HUNT_PAGES = ["index.html", "calculator.html", "profile.html", "table.html", "schedule.html", "checklist.html", "settings.html", "help.html"];
export const GUEST_HUNT_PAGES = ["index.html", "calculator.html", "help.html"];
export const FESTIVE_HUNT_START = Date.parse('2026-12-25T00:00:00+03:00');
export const FESTIVE_HUNT_END = Date.parse('2027-01-04T00:00:00+03:00');
export const isFestiveHuntSeason = (now = Date.now()) => now >= FESTIVE_HUNT_START && now < FESTIVE_HUNT_END;

export function hashFestiveIdentity(value) {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function createHuntState(seed, pages = HUNT_PAGES, firstPage = "") {
  let value = seed >>> 0;
  const random = () => {
    value = (value + 0x6D2B79F5) | 0;
    let n = Math.imul(value ^ (value >>> 15), 1 | value);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
  const shuffled = [...new Set(pages)];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  if (shuffled.includes(firstPage)) {
    shuffled.splice(shuffled.indexOf(firstPage), 1);
    shuffled.unshift(firstPage);
  }
  return {
    version: 1, seed: seed >>> 0, found: [],
    places: shuffled.slice(0, 3).map((page, id) => ({ id, page, side: random() < 0.5 ? "left" : "right", height: Math.floor(random() * 5) })),
  };
}

export function isValidHuntState(state, pages = HUNT_PAGES) {
  return state?.version === 1 && Number.isInteger(state.seed) && state.seed >= 0 && state.seed <= 0xffffffff &&
    Array.isArray(state.places) && state.places.length === 3 &&
    new Set(state.places.map(place => place?.page)).size === 3 &&
    state.places.every((place, index) => place?.id === index && pages.includes(place.page) &&
      ["left", "right"].includes(place.side) && Number.isInteger(place.height) && place.height >= 0 && place.height < 5) &&
    Array.isArray(state.found) && state.found.every(id => Number.isInteger(id) && id >= 0 && id < 3) &&
    new Set(state.found).size === state.found.length;
}

export const FESTIVE_GREETINGS = [
  {
    title: "Пусть зарплата радует, а отдых случается!",
    paragraphs: [
      "С Новым 2027 годом, команда АЛВИСЫ! Желаю, чтобы зарплата росла быстрее цен, премии приходили без сюрпризов, а слово «переработка» чаще встречалось в рассказах о прошлом, чем в вашем табеле.",
      "Тем, кто работает по сменам, — спокойных ночей и хороших сменщиков. Тем, кто трудится днём, — вечеров без срочных звонков. Всем без исключения — отпуска по плану, крепкого здоровья и побольше времени для близких.",
      "Пусть в наличии всегда будет запас денег, в графике — место для отдыха, а дома ждут люди, ради которых хочется поскорее закончить рабочий день!",
    ],
  },
  {
    title: "Чтобы всё работало — и никто не дёргался!",
    paragraphs: [
      "Пусть в 2027 году линии розлива идут ровно, первичное производство радует качеством, купажи получаются точно по замыслу технологов, а результаты лаборатории подтверждаются с первого раза.",
      "Технической службе и механикам — оборудования, которое вспоминает о поломках только на плановом обслуживании. Службе КИП — точных датчиков и понятных сигналов. Сисадминам — стабильной сети, надёжных резервных копий и ни одного «я ничего не нажимал» перед самым уходом домой.",
      "Пусть внепланово запускаются только хорошие новости, а аварийными бывают разве что запасы мандаринов!",
    ],
  },
  {
    title: "За людей, на которых держится завод!",
    paragraphs: [
      "ЕГАИС — документов без расхождений и спокойных сверок. Складу готовой продукции и комплектующих — понятных остатков, аккуратных отгрузок и свободного места там, где оно нужно. Бухгалтерии — сходящихся цифр и закрытия месяца без марафона до полуночи.",
      "Лаборатории, производству, технологам, цеху розлива, технической службе, КИП, IT, службе персонала, администрации и всем другим коллегам — уважения к вашему труду и людей рядом, на которых можно положиться.",
      "Завод работает не только благодаря оборудованию: за каждой бутылкой, каждой цифрой и каждой спокойной сменой стоите вы. Пусть в 2027 году у нас будет меньше авралов, больше взаимовыручки и много поводов гордиться общей работой. С праздником!",
    ],
  },
];
