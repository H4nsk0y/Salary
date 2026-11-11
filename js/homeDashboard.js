import { getSession } from "./auth.js";
import { getYearReviewAvailability } from "./yearReviewAvailability.js";

function initializeRevealAnimations() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver((entries) => {
    const entering = entries.filter((entry) => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top ||
        a.boundingClientRect.left - b.boundingClientRect.left);

    entering.forEach(({ target }, index) => {
      target.style.setProperty("--reveal-delay", `${Math.min(index, 3) * 65}ms`);
      target.classList.replace("is-pending", "is-visible");
      observer.unobserve(target);
    });
  }, { threshold: 0.08 });

  document.querySelectorAll(".reveal").forEach((element) => {
    element.classList.add("is-pending");
    observer.observe(element);
  });
}

async function showYearReview() {
  const link = document.getElementById("yearReviewLink");
  if (!link) return;
  const session = await getSession();
  if (!session) return;
  const availability = getYearReviewAvailability(new Date());
  if (!availability.visible) return;
  link.href = `year-review.html?year=${availability.year}`;
  link.hidden = false;
}

initializeRevealAnimations();
showYearReview().catch(() => undefined);
