export const FORCE_YEAR_REVIEW_PREVIEW = false;

export function getYearReviewAvailability(date = new Date(), forcePreview = FORCE_YEAR_REVIEW_PREVIEW) {
  const month = date.getMonth();
  const day = date.getDate();
  const inDecemberWindow = month === 11 && day >= 25;
  const inJanuaryWindow = month === 0 && day <= 3;
  const visible = Boolean(forcePreview || inDecemberWindow || inJanuaryWindow);
  const year = forcePreview
    ? date.getFullYear()
    : inJanuaryWindow
      ? date.getFullYear() - 1
      : date.getFullYear();
  return { visible, year, preview: Boolean(forcePreview) };
}
