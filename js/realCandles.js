/**
 * realCandles.js — best-effort REAL OHLC candle history for XAU/USD,
 * refreshed on its own slow cadence (independent of the live spot-price
 * tick rate) to stay well inside free-tier rate limits.
 *
 * Source priority per timeframe:
 *   1. Twelve Data time_series (if the user has saved a free API key in
 *      Settings) — native 15min/1h/4h/1day intervals, most reliable.
 *   2. Yahoo Finance's public chart endpoint for GC=F (COMEX Gold
 *      Futures) as a no-signup, no-key structure proxy for XAU/USD. This
 *      is an *unofficial, undocumented* public JSON endpoint — the same
 *      one a browser tab on finance.yahoo.com calls — so it can change or
 *      get rate-limited without notice. It is used only as a best-effort
 *      fallback, never relied on exclusively, and every candle sourced
 *      this way is labeled so in the data-quality badge.
 *   3. If neither source returns usable data for a timeframe, that
 *      timeframe is left for marketEngine.js to fill with its
 *      staleness-safe synthetic engine, clearly labeled SIMULATED.
 *
 * A failed refresh never erases previously-cached real candles for a
 * timeframe — it just tries again next cycle — so a transient network
 * blip degrades to "cached real, N minutes old" rather than to garbage.
 */
const RealCandles = (() => {
  const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 min: rate-limit-safe cadence for full history refetch
  const FETCH_TIMEOUT_MS = 8000;
  const MIN_USABLE_CANDLES = 30;
  const TF_LIST = ['15m', '1H', '4H', '1D'];

  async function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(id);
    }
  }

  /** Groups consecutive candles (e.g. 4x 1H -> 1x 4H) — standard OHLC resampling. */
  function resample(candles, groupSize) {
    const out = [];
    for (let i = 0; i + groupSize <= candles.length; i += groupSize) {
      const group = candles.slice(i, i + groupSize);
      out.push({
        t: group[0].t,
        o: group[0].o,
        c: group[group.length - 1].c,
        h: Math.max(...group.map(c => c.h)),
        l: Math.min(...group.map(c => c.l)),
      });
    }
    return out;
  }

  // ---------------- Twelve Data ----------------
  async function fetchTwelveData(interval, apiKey) {
    const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=260&timezone=UTC&apikey=${encodeURIComponent(apiKey)}`;
    const json = await fetchWithTimeout(url);
    if (json.status === 'error' || !Array.isArray(json.values)) {
      throw new Error(json.message || 'Twelve Data returned no series');
    }
    return json.values
      .map(v => ({
        t: new Date(v.datetime.replace(' ', 'T') + 'Z').getTime(),
        o: parseFloat(v.open), h: parseFloat(v.high), l: parseFloat(v.low), c: parseFloat(v.close),
      }))
      .filter(c => isFinite(c.o) && isFinite(c.c))
      .reverse(); // Twelve Data returns newest-first
  }

  async function fetchAllTwelveData(apiKey) {
    const [m15, h1, h4, d1] = await Promise.allSettled([
      fetchTwelveData('15min', apiKey),
      fetchTwelveData('1h', apiKey),
      fetchTwelveData('4h', apiKey),
      fetchTwelveData('1day', apiKey),
    ]);
    const out = {};
    [['15m', m15], ['1H', h1], ['4H', h4], ['1D', d1]].forEach(([tf, result]) => {
      if (result.status === 'fulfilled') out[tf] = result.value;
      else console.warn(`Twelve Data ${tf} fetch failed`, result.reason);
    });
    return out;
  }

  // ---------------- Yahoo Finance (no key) ----------------
  function parseYahooChart(json) {
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error('No Yahoo chart result');
    const ts = result.timestamp;
    const q = result.indicators?.quote?.[0];
    if (!ts || !q) throw new Error('Malformed Yahoo chart payload');
    const candles = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
      if (o == null || h == null || l == null || c == null) continue;
      candles.push({ t: ts[i] * 1000, o, h, l, c });
    }
    return candles;
  }

  async function fetchYahoo(interval, range) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=${interval}&range=${range}`;
    const json = await fetchWithTimeout(url);
    return parseYahooChart(json);
  }

  async function fetchAllYahoo() {
    const [m15, h1, d1] = await Promise.allSettled([
      fetchYahoo('15m', '5d'),
      fetchYahoo('60m', '1mo'),
      fetchYahoo('1d', '2y'),
    ]);
    const out = {};
    if (m15.status === 'fulfilled') out['15m'] = m15.value;
    else console.warn('Yahoo 15m fetch failed', m15.reason);

    if (h1.status === 'fulfilled') {
      out['1H'] = h1.value;
      out['4H'] = resample(h1.value, 4); // Yahoo has no native 4h interval
    } else {
      console.warn('Yahoo 60m fetch failed', h1.reason);
    }

    if (d1.status === 'fulfilled') out['1D'] = d1.value;
    else console.warn('Yahoo 1d fetch failed', d1.reason);

    return out;
  }

  function loadCache() {
    return Storage.get(Storage.KEYS.REAL_CANDLES, null);
  }

  function saveCache(cache) {
    Storage.set(Storage.KEYS.REAL_CANDLES, cache);
  }

  function isCacheStale(cache) {
    if (!cache || !cache.fetchedAt) return true;
    return Date.now() - cache.fetchedAt > REFRESH_INTERVAL_MS;
  }

  /**
   * Refreshes the real-candle cache if stale. Returns the (possibly
   * partially-updated) cache: { series: {tf: candles[]}, source: {tf: label}, fetchedAt }.
   * Never throws — network/parse failures just leave prior cache in place.
   */
  async function refresh(apiKey) {
    const cache = loadCache() || { series: {}, source: {}, fetchedAt: 0 };
    if (!isCacheStale(cache)) return cache;

    let fetched = {};

    if (apiKey) {
      try {
        fetched = await fetchAllTwelveData(apiKey);
      } catch (e) {
        console.warn('Twelve Data candle fetch failed entirely', e);
      }
    }

    const stillMissing = TF_LIST.some(tf => !fetched[tf] || fetched[tf].length < MIN_USABLE_CANDLES);
    if (stillMissing) {
      try {
        const yahoo = await fetchAllYahoo();
        TF_LIST.forEach(tf => {
          if ((!fetched[tf] || fetched[tf].length < MIN_USABLE_CANDLES) && yahoo[tf]?.length >= MIN_USABLE_CANDLES) {
            fetched[tf] = yahoo[tf];
            fetched[`${tf}__source`] = 'Yahoo Finance (GC=F futures proxy)';
          }
        });
      } catch (e) {
        console.warn('Yahoo candle fetch failed entirely', e);
      }
    }

    const nextCache = { series: { ...cache.series }, source: { ...cache.source }, fetchedAt: Date.now() };
    TF_LIST.forEach(tf => {
      if (fetched[tf] && fetched[tf].length >= MIN_USABLE_CANDLES) {
        nextCache.series[tf] = fetched[tf].slice(-260);
        nextCache.source[tf] = fetched[`${tf}__source`] || 'Twelve Data';
      }
      // else: keep whatever was already cached for this timeframe (may be
      // absent, in which case marketEngine.js falls back to synthetic).
    });

    saveCache(nextCache);
    return nextCache;
  }

  function getCached() {
    return loadCache();
  }

  return { refresh, getCached, isCacheStale, TF_LIST };
})();
