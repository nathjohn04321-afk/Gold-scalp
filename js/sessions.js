/**
 * sessions.js — trading session clock + a lightweight, illustrative
 * high-impact news heatmap.
 *
 * NOTE on news events: there is no free, no-key economic calendar API with
 * a permissive CORS policy suitable for a pure client-side PWA. Rather than
 * silently show nothing, this module ships a small recurring-event
 * heuristic (NFP = first Friday of month, CPI ~ mid-month) purely as an
 * illustrative placeholder. For production accuracy, wire in a real
 * calendar (see README → "Connecting a Real Gold Price API / News Feed").
 */
const Sessions = (() => {
  // UTC hour ranges. London/NY overlap (13:00-16:00 UTC) is the highest
  // liquidity window for XAU/USD and is called out separately.
  const RANGES = {
    asia: [0, 8],
    london: [8, 16],
    newyork: [13, 21],
  };

  function inRange(hour, [start, end]) {
    return hour >= start && hour < end;
  }

  function getCurrentSession(now = new Date()) {
    const h = now.getUTCHours();
    const asia = inRange(h, RANGES.asia);
    const london = inRange(h, RANGES.london);
    const ny = inRange(h, RANGES.newyork);

    if (london && ny) return { key: 'overlap', label: 'London/NY Overlap' };
    if (london) return { key: 'london', label: 'London Session' };
    if (ny) return { key: 'newyork', label: 'New York Session' };
    if (asia) return { key: 'asia', label: 'Asia Session' };
    return { key: 'quiet', label: 'Quiet Hours' };
  }

  function firstFridayOfMonth(year, month) {
    const d = new Date(Date.UTC(year, month, 1));
    const dow = d.getUTCDay(); // 0 = Sun
    const offset = (5 - dow + 7) % 7; // days until Friday
    d.setUTCDate(1 + offset);
    return d;
  }

  function getUpcomingHighImpactEvents(now = new Date()) {
    const events = [];
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();

    // Non-Farm Payrolls — first Friday of the month, 12:30 UTC
    const nfp = firstFridayOfMonth(year, month);
    nfp.setUTCHours(12, 30, 0, 0);
    events.push({ name: 'US Non-Farm Payrolls (NFP)', time: nfp, impact: 'high' });

    const nfpNext = firstFridayOfMonth(year, month + 1);
    nfpNext.setUTCHours(12, 30, 0, 0);
    events.push({ name: 'US Non-Farm Payrolls (NFP)', time: nfpNext, impact: 'high' });

    // US CPI — illustrative mid-month placeholder, 12:30 UTC
    const cpi = new Date(Date.UTC(year, month, 13, 12, 30, 0));
    events.push({ name: 'US CPI (illustrative date)', time: cpi, impact: 'high' });

    const windowMs = 48 * 60 * 60 * 1000;
    return events
      .filter(e => e.time > now && (e.time - now) <= windowMs)
      .sort((a, b) => a.time - b.time);
  }

  return { getCurrentSession, getUpcomingHighImpactEvents };
})();
