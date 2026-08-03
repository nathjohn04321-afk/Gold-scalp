/**
 * priceFeed.js — fetches the live XAU/USD spot price with a 4-deep
 * fallback chain and a timed retry, so a single flaky source can't force
 * the whole app into SIMULATED mode.
 *
 * Priority:
 *   1. Twelve Data (if the user has pasted a free API key in Settings) —
 *      real quote endpoint, most accurate, highest rate limit.
 *   2. gold-api.com — free, no API key, no signup, CORS-open XAU spot price.
 *   3. freeforexapi.com — free, no key, CORS-open XAUUSD pair; independent
 *      infrastructure from gold-api.com, so the two rarely fail together.
 *   4. Last known-good REAL price from localStorage, if it's not too old —
 *      shown as "cached, age-labeled" rather than jumping straight to a
 *      simulated number just because one refresh cycle had a network blip.
 *   5. Local simulated random-walk continuation — only when there is no
 *      usable real price at all (first run with no connectivity, or the
 *      cache is too old to trust). Always clearly labeled in the UI.
 *
 * Each network source gets one retry (short backoff) before moving to the
 * next source, and every request has a hard timeout so a hung request
 * can't stall the whole refresh cycle.
 *
 * See README.md → "Connecting a Real Gold Price API" to add more sources.
 */
const PriceFeed = (() => {
  const FALLBACK_SEED_PRICE = 2400;
  const FETCH_TIMEOUT_MS = 5000;
  const RETRY_DELAY_MS = 500;
  const MAX_CACHE_AGE_MS = 10 * 60 * 1000; // 10 min — beyond this, prefer simulated over a very stale "real" number

  const GOLD_API_URL = 'https://api.gold-api.com/price/XAU';
  const FREE_FOREX_API_URL = 'https://www.freeforexapi.com/api/live?pairs=XAUUSD';

  function twelveDataUrl(apiKey) {
    return `https://api.twelvedata.com/price?symbol=${encodeURIComponent('XAU/USD')}&apikey=${encodeURIComponent(apiKey)}`;
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

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

  /** Runs an async fetch-and-parse function once, retries once on failure, then gives up. */
  async function withRetry(fn) {
    try {
      return await fn();
    } catch (e) {
      await sleep(RETRY_DELAY_MS);
      try {
        return await fn();
      } catch (e2) {
        return null;
      }
    }
  }

  async function tryTwelveData() {
    const apiKey = Storage.get(Storage.KEYS.API_KEY, '');
    if (!apiKey) return null;
    // Routed through TwelveDataQueue so this never overlaps a concurrent
    // Twelve Data candle-history fetch in realCandles.js — the free plan
    // rejects parallel requests (see js/twelveDataQueue.js).
    return TwelveDataQueue.run(() => withRetry(async () => {
      const json = await fetchWithTimeout(twelveDataUrl(apiKey));
      const price = parseFloat(json.price);
      if (!isFinite(price) || price <= 0) throw new Error('Bad Twelve Data payload');
      return { price, source: 'live', provider: 'Twelve Data' };
    }));
  }

  async function tryGoldApi() {
    return withRetry(async () => {
      const json = await fetchWithTimeout(GOLD_API_URL);
      const price = parseFloat(json.price);
      if (!isFinite(price) || price <= 0) throw new Error('Bad gold-api.com payload');
      return { price, source: 'live', provider: 'gold-api.com' };
    });
  }

  async function tryFreeForexApi() {
    return withRetry(async () => {
      const json = await fetchWithTimeout(FREE_FOREX_API_URL);
      const rate = json?.rates?.XAUUSD?.rate;
      const price = parseFloat(rate);
      if (!isFinite(price) || price <= 0) throw new Error('Bad freeforexapi.com payload');
      return { price, source: 'live', provider: 'freeforexapi.com' };
    });
  }

  function getLastGoodPrice() {
    return Storage.get(Storage.KEYS.LAST_GOOD_PRICE, null);
  }

  function saveLastGoodPrice(price, provider) {
    Storage.set(Storage.KEYS.LAST_GOOD_PRICE, { price, provider, at: Date.now() });
  }

  function tryCachedPrice() {
    const cached = getLastGoodPrice();
    if (!cached) return null;
    const ageMs = Date.now() - cached.at;
    if (ageMs > MAX_CACHE_AGE_MS) return null;
    return { price: cached.price, source: 'cached', provider: cached.provider, ageMs };
  }

  function simulatedTick() {
    const cached = getLastGoodPrice();
    const store = Storage.get(Storage.KEYS.CANDLES, null);
    const last = cached?.price || store?.lastLivePrice || FALLBACK_SEED_PRICE;
    const stepPct = (Math.random() - 0.5) * 0.0012; // ~+/-0.06% per tick
    const price = Math.max(1, last * (1 + stepPct));
    return { price, source: 'simulated', provider: 'Local simulation' };
  }

  async function fetchLivePrice() {
    const viaTwelveData = await tryTwelveData();
    if (viaTwelveData) { saveLastGoodPrice(viaTwelveData.price, viaTwelveData.provider); return viaTwelveData; }

    const viaGoldApi = await tryGoldApi();
    if (viaGoldApi) { saveLastGoodPrice(viaGoldApi.price, viaGoldApi.provider); return viaGoldApi; }

    const viaFreeForex = await tryFreeForexApi();
    if (viaFreeForex) { saveLastGoodPrice(viaFreeForex.price, viaFreeForex.provider); return viaFreeForex; }

    const viaCache = tryCachedPrice();
    if (viaCache) return viaCache;

    return simulatedTick();
  }

  return { fetchLivePrice };
})();
