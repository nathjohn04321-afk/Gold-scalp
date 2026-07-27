/**
 * marketEngine.js — maintains a persistent, multi-timeframe OHLC candle
 * history for XAU/USD, anchored to the live price feed.
 *
 * IMPORTANT / TRANSPARENCY NOTE:
 * Free, no-API-key, CORS-open sources for *historical intraday* gold OHLC
 * data are essentially nonexistent. To keep the dashboard fully functional
 * offline and without any signup, GoldDesk Pro synthesizes a statistically
 * plausible candle history (seeded random walk with regime drift) and then
 * anchors it to whatever the live price feed reports right now. Every
 * refresh cycle nudges the series using the *real* live price, so once a
 * real API key is configured (see README), accuracy improves immediately —
 * the structure/indicator math itself (EMA/RSI/MACD/ATR/S-R/FVG) is
 * standard and correct regardless of the data source.
 */
const MarketEngine = (() => {
  const TIMEFRAMES = {
    '15m': { ms: 15 * 60 * 1000, vol: 0.00045, candles: 260 },
    '1H': { ms: 60 * 60 * 1000, vol: 0.0009, candles: 260 },
    '4H': { ms: 4 * 60 * 60 * 1000, vol: 0.0018, candles: 260 },
    '1D': { ms: 24 * 60 * 60 * 1000, vol: 0.0035, candles: 260 },
  };

  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateWalk(count, vol, seed) {
    const rand = mulberry32(seed);
    let price = 1.0;
    let drift = 0;
    const candles = [];
    for (let i = 0; i < count; i++) {
      if (i % 18 === 0) {
        // occasional regime shift so MTF structure looks like real trend/range cycles
        drift = (rand() - 0.5) * vol * 1.4;
      }
      const open = price;
      const noise = (rand() - 0.5) * vol * 2;
      const close = Math.max(0.001, open * (1 + drift + noise));
      const wickUp = Math.abs(rand()) * vol * 0.8;
      const wickDown = Math.abs(rand()) * vol * 0.8;
      const high = Math.max(open, close) * (1 + wickUp);
      const low = Math.min(open, close) * (1 - wickDown);
      candles.push({ t: 0, o: open, h: high, l: low, c: close });
      price = close;
    }
    return candles;
  }

  function stampTimes(candles, periodMs, anchorTime) {
    const n = candles.length;
    const startTime = anchorTime - (n - 1) * periodMs;
    return candles.map((c, i) => ({ ...c, t: startTime + i * periodMs }));
  }

  function anchorToPrice(candles, targetPrice) {
    const lastClose = candles[candles.length - 1].c;
    const factor = targetPrice / lastClose;
    return candles.map(c => ({
      t: c.t, o: c.o * factor, h: c.h * factor, l: c.l * factor, c: c.c * factor,
    }));
  }

  function loadAll() {
    return Storage.get(Storage.KEYS.CANDLES, null);
  }

  function saveAll(data) {
    Storage.set(Storage.KEYS.CANDLES, data);
  }

  function seedIfNeeded(livePrice) {
    let store = loadAll();
    if (store && store.series) return store;

    const seed = Math.floor(Math.random() * 2 ** 31);
    const now = Date.now();
    const series = {};
    Object.entries(TIMEFRAMES).forEach(([tf, cfg], idx) => {
      let candles = generateWalk(cfg.candles, cfg.vol, seed + idx * 7919);
      candles = anchorToPrice(candles, livePrice);
      candles = stampTimes(candles, cfg.ms, now);
      series[tf] = candles;
    });
    store = { seed, series, lastLivePrice: livePrice, lastUpdate: now };
    saveAll(store);
    return store;
  }

  /** Push a new live price tick into every timeframe's forming candle. */
  function updateWithLivePrice(livePrice) {
    const store = seedIfNeeded(livePrice);
    const now = Date.now();

    Object.entries(TIMEFRAMES).forEach(([tf, cfg]) => {
      const candles = store.series[tf];
      const last = candles[candles.length - 1];
      const bucketStart = Math.floor(now / cfg.ms) * cfg.ms;

      if (bucketStart > last.t) {
        // roll into a new candle
        candles.push({ t: bucketStart, o: last.c, h: Math.max(last.c, livePrice), l: Math.min(last.c, livePrice), c: livePrice });
        if (candles.length > cfg.candles + 20) candles.shift();
      } else {
        last.h = Math.max(last.h, livePrice);
        last.l = Math.min(last.l, livePrice);
        last.c = livePrice;
      }
    });

    store.lastLivePrice = livePrice;
    store.lastUpdate = now;
    saveAll(store);
    return store.series;
  }

  function getSeries(timeframe) {
    const store = loadAll();
    if (!store) return [];
    return store.series[timeframe] || [];
  }

  function getAllSeries() {
    const store = loadAll();
    return store ? store.series : {};
  }

  /** Session/day boundaries derived from the 15m series (UTC calendar day). */
  function getDailyStats() {
    const candles = getSeries('15m');
    if (!candles.length) return { open: null, high: null, low: null };
    const now = new Date();
    const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const todays = candles.filter(c => c.t >= dayStart);
    const relevant = todays.length ? todays : candles.slice(-96);
    return {
      open: relevant[0].o,
      high: Math.max(...relevant.map(c => c.h)),
      low: Math.min(...relevant.map(c => c.l)),
    };
  }

  return { TIMEFRAMES, updateWithLivePrice, getSeries, getAllSeries, getDailyStats };
})();
