/**
 * marketEngine.js — maintains the multi-timeframe OHLC candle history that
 * feeds AnalysisEngine, merging two independent sources per timeframe:
 *
 *   1. REAL candles from realCandles.js (Twelve Data key, or the no-key
 *      Yahoo/GC=F fallback), refreshed on its own ~20min cadence.
 *   2. A SIMULATED seeded random walk, used only for whichever timeframes
 *      have no real data available — anchored to the live price and
 *      self-healing if it goes stale (see isStale below), so it can never
 *      again silently drift the way it did before this fix (that bug is
 *      what produced a $2000 stop-loss next to a $4000 live price).
 *
 * Every timeframe is tagged with its own data quality ('real' | 'simulated')
 * so the UI can show an honest REAL / PARTIAL / SIMULATED badge instead of
 * pretending everything is equally trustworthy.
 */
const MarketEngine = (() => {
  const TIMEFRAMES = {
    '15m': { ms: 15 * 60 * 1000, vol: 0.00045, candles: 260 },
    '1H': { ms: 60 * 60 * 1000, vol: 0.0009, candles: 260 },
    '4H': { ms: 4 * 60 * 60 * 1000, vol: 0.0018, candles: 260 },
    '1D': { ms: 24 * 60 * 60 * 1000, vol: 0.0035, candles: 260 },
  };
  const TF_LIST = Object.keys(TIMEFRAMES);

  // Simulated-only staleness guards (see js/realCandles.js for the real-data path).
  const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours idle => resync simulated anchor
  const STALE_PRICE_DRIFT_PCT = 0.12; // 12% drift from recent simulated range => resync

  // ---------------- synthetic engine (fallback only) ----------------

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
      if (i % 18 === 0) drift = (rand() - 0.5) * vol * 1.4;
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

  function synthesizeTf(tf, livePrice, now, seedOffset) {
    const cfg = TIMEFRAMES[tf];
    let candles = generateWalk(cfg.candles, cfg.vol, seedOffset);
    candles = anchorToPrice(candles, livePrice);
    candles = stampTimes(candles, cfg.ms, now);
    return candles;
  }

  function isSyntheticStale(store, tf, livePrice, now) {
    const candles = store.series[tf];
    if (!candles || !candles.length) return true;
    if (now - store.lastUpdate > STALE_AFTER_MS) return true;

    const recent = candles.slice(-30);
    const recentHigh = Math.max(...recent.map(c => c.h));
    const recentLow = Math.min(...recent.map(c => c.l));
    const mid = (recentHigh + recentLow) / 2;
    if (mid > 0 && Math.abs(livePrice - mid) / mid > STALE_PRICE_DRIFT_PCT) return true;

    return false;
  }

  // ---------------- unified store (persisted) ----------------

  function loadStore() {
    return Storage.get(Storage.KEYS.CANDLES, null);
  }

  function saveStore(store) {
    Storage.set(Storage.KEYS.CANDLES, store);
  }

  function emptyStore() {
    return { series: {}, quality: {}, sourceLabel: {}, mergedRealFetchedAt: 0, lastUpdate: 0 };
  }

  /** Pulls in any newer real candle data from realCache, replacing the synthetic version for those timeframes. */
  function mergeRealData(store, realCache, livePrice, now) {
    if (!realCache || !realCache.fetchedAt) return store;
    if (realCache.fetchedAt <= store.mergedRealFetchedAt) return store; // already merged this batch

    TF_LIST.forEach(tf => {
      const realSeries = realCache.series[tf];
      if (realSeries && realSeries.length >= 30) {
        store.series[tf] = realSeries.map(c => ({ ...c }));
        store.quality[tf] = 'real';
        store.sourceLabel[tf] = realCache.source[tf] || 'Real data';
      }
    });
    store.mergedRealFetchedAt = realCache.fetchedAt;
    return store;
  }

  /** Fills in synthetic history for any timeframe that still has no data (or whose synthetic data went stale). */
  function fillSyntheticGaps(store, livePrice, now) {
    const seedBase = Math.floor(Math.random() * 2 ** 31);
    TF_LIST.forEach((tf, idx) => {
      const isReal = store.quality[tf] === 'real';
      if (isReal) return; // real data refreshes on its own cadence via realCandles.js
      if (!store.series[tf] || isSyntheticStale(store, tf, livePrice, now)) {
        store.series[tf] = synthesizeTf(tf, livePrice, now, seedBase + idx * 7919);
        store.quality[tf] = 'simulated';
        store.sourceLabel[tf] = 'Local simulation';
      }
    });
    return store;
  }

  /** Nudges every timeframe's forming candle with the latest live tick (real or simulated alike). */
  function applyLiveTick(store, livePrice, now) {
    TF_LIST.forEach(tf => {
      const cfg = TIMEFRAMES[tf];
      const candles = store.series[tf];
      if (!candles || !candles.length) return;
      const last = candles[candles.length - 1];
      const bucketStart = Math.floor(now / cfg.ms) * cfg.ms;

      if (bucketStart > last.t) {
        candles.push({ t: bucketStart, o: last.c, h: Math.max(last.c, livePrice), l: Math.min(last.c, livePrice), c: livePrice });
        if (candles.length > cfg.candles + 20) candles.shift();
      } else {
        last.h = Math.max(last.h, livePrice);
        last.l = Math.min(last.l, livePrice);
        last.c = livePrice;
      }
    });
    return store;
  }

  /**
   * Main entry point: refreshes real candles (rate-limit-gated internally),
   * merges them in, fills any remaining gaps synthetically, and nudges
   * every timeframe with the latest live price. Call this once per app
   * refresh cycle; safe to call as often as you like.
   */
  async function refresh(livePrice, apiKey) {
    const now = Date.now();
    let store = loadStore() || emptyStore();

    let realCache = null;
    try {
      realCache = await RealCandles.refresh(apiKey);
    } catch (e) {
      console.warn('RealCandles.refresh threw unexpectedly', e);
      realCache = RealCandles.getCached();
    }

    store = mergeRealData(store, realCache, livePrice, now);
    store = fillSyntheticGaps(store, livePrice, now);
    store = applyLiveTick(store, livePrice, now);

    store.lastLivePrice = livePrice;
    store.lastUpdate = now;
    saveStore(store);
    return store.series;
  }

  function getSeries(timeframe) {
    const store = loadStore();
    return store?.series?.[timeframe] || [];
  }

  function getAllSeries() {
    const store = loadStore();
    return store ? store.series : {};
  }

  /** { '15m': 'real'|'simulated', ..., overall: 'real'|'partial'|'simulated', realAgeMs } */
  function getDataQuality() {
    const store = loadStore();
    if (!store) return { overall: 'simulated', realAgeMs: null };

    const perTf = {};
    TF_LIST.forEach(tf => { perTf[tf] = store.quality[tf] || 'simulated'; });
    const realCount = TF_LIST.filter(tf => perTf[tf] === 'real').length;
    const overall = realCount === TF_LIST.length ? 'real' : realCount === 0 ? 'simulated' : 'partial';
    const realAgeMs = store.mergedRealFetchedAt ? Date.now() - store.mergedRealFetchedAt : null;

    return { ...perTf, overall, realAgeMs, sourceLabel: store.sourceLabel || {} };
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

  return { TIMEFRAMES, refresh, getSeries, getAllSeries, getDailyStats, getDataQuality };
})();
