// Words for credits and refills, shared by the account panel and the thread.
// A plan refills every calendar month, or every `hours` hours (the Free plan).

/** "every month", "every 5 hours", "every day"… */
export function periodWords(hours) {
  const h = Number(hours);
  if (!Number.isInteger(h) || h <= 0) return 'every month';
  if (h === 1) return 'every hour';
  if (h % 24 === 0) return h === 24 ? 'every day' : `every ${h / 24} days`;
  return `every ${h} hours`;
}

/** The label of the current allowance: "This month" or "This period". */
export function periodNoun(hours) {
  return Number(hours) > 0 ? 'This period' : 'This month';
}

/**
 * When the next refill comes: a date for monthly plans ("on 12 Nov"), a
 * countdown for hourly ones ("in 2 h 10 min").
 */
export function refillWhen(periodEnd, hours, now = Date.now()) {
  const end = new Date(periodEnd).getTime();
  if (!Number.isFinite(end)) return '';
  if (!(Number(hours) > 0)) return `on ${new Date(end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  const ms = end - now;
  if (ms <= 60_000) return 'in a minute';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  if (h && m) return `in ${h} h ${m} min`;
  if (h) return `in ${h} h`;
  return `in ${m} min`;
}
