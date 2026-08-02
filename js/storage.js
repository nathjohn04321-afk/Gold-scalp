/**
 * storage.js — thin localStorage wrapper.
 * All GoldDesk Pro persistence (alerts, cached analysis, settings, candle
 * history) goes through this one module so key names stay in one place.
 */
const Storage = (() => {
  const KEYS = {
    ALERTS: 'gdp_alerts',
    TRIGGERED: 'gdp_triggered_alerts',
    LAST_ANALYSIS: 'gdp_last_analysis',
    LAST_SIGNAL: 'gdp_last_signal',
    SIGNAL_HISTORY: 'gdp_signal_history',
    CANDLES: 'gdp_candles',
    REAL_CANDLES: 'gdp_real_candles',
    LAST_GOOD_PRICE: 'gdp_last_good_price',
    SETTINGS: 'gdp_settings',
    API_KEY: 'gdp_api_key_twelvedata',
  };

  function get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('Storage write failed', key, e);
      return false;
    }
  }

  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* noop */ }
  }

  function clearAll() {
    Object.values(KEYS).forEach(remove);
  }

  return { KEYS, get, set, remove, clearAll };
})();
