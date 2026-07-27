/**
 * priceFeed.js — fetches the live XAU/USD spot price.
 *
 * Source priority:
 *   1. Twelve Data (if the user has pasted a free API key in Settings) —
 *      real quote endpoint, most accurate.
 *   2. gold-api.com — free, no API key, no signup, CORS-open public
 *      endpoint for XAU spot price. Good default for "works immediately".
 *   3. Local simulated random-walk continuation — used only if both network
 *      sources fail (offline, rate-limited, CORS change upstream) so the
 *      app never shows a dead screen. Always clearly labeled in the UI.
 *
 * See README.md → "Connecting a Real Gold Price API" to swap in
 * Polygon.io, metals-api.com, goldapi.io, or Alpha Vantage instead.
 */
const PriceFeed = (() => {
  const FALLBACK_SEED_PRICE = 2400;
  const GOLD_API_URL = 'https://api.gold-api.com/price/XAU';

  function twelveDataUrl(apiKey) {
    return `https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${encodeURIComponent(apiKey)}`;
  }

  async function fetchWithTimeout(url, ms = 8000) {
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

  async function tryTwelveData() {
    const apiKey = Storage.get(Storage.KEYS.API_KEY, '');
    if (!apiKey) return null;
    try {
      const json = await fetchWithTimeout(twelveDataUrl(apiKey));
      const price = parseFloat(json.price);
      if (!isFinite(price) || price <= 0) return null;
      return { price, source: 'live', provider: 'Twelve Data' };
    } catch (e) {
      console.warn('Twelve Data fetch failed', e);
      return null;
    }
  }

  async function tryGoldApi() {
    try {
      const json = await fetchWithTimeout(GOLD_API_URL);
      const price = parseFloat(json.price);
      if (!isFinite(price) || price <= 0) return null;
      return { price, source: 'live', provider: 'gold-api.com' };
    } catch (e) {
      console.warn('gold-api.com fetch failed', e);
      return null;
    }
  }

  function simulatedTick() {
    const store = Storage.get(Storage.KEYS.CANDLES, null);
    const last = store?.lastLivePrice || FALLBACK_SEED_PRICE;
    const stepPct = (Math.random() - 0.5) * 0.0012; // ~+/-0.06% per tick
    const price = Math.max(1, last * (1 + stepPct));
    return { price, source: 'simulated', provider: 'Local simulation' };
  }

  async function fetchLivePrice() {
    const viaTwelveData = await tryTwelveData();
    if (viaTwelveData) return viaTwelveData;

    const viaGoldApi = await tryGoldApi();
    if (viaGoldApi) return viaGoldApi;

    return simulatedTick();
  }

  return { fetchLivePrice };
})();
