import { validDate } from './budgetModel.js?v=20261123-2';

export function paymentCountdown(date, now = Date.now()) {
  if (!validDate(date) || !Number.isFinite(now)) return null;
  const target = Date.parse(`${date}T13:00:00+03:00`);
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  const days = Math.floor(seconds / 86400);
  const two = value => String(value).padStart(2, '0');
  const clock = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60].map(two).join(':');
  return { text: `(${days ? days + ' д ' : ''}${clock})`, target, elapsed: now >= target };
}
