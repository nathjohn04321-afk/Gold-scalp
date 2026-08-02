/**
 * app.js — orchestrator. Wires up navigation, the refresh loop, forms, and
 * ties PriceFeed -> MarketEngine -> AnalysisEngine -> SignalEngine -> UI
 * together. Business logic itself lives in the dedicated modules.
 */
(() => {
  let refreshTimer = null;
  let prevPrice = null;
  let lastSignalDirection = null;
  let lastKnownLevels = { support: [], resistance: [] };

  function getRefreshInterval() {
    const settings = Storage.get(Storage.KEYS.SETTINGS, {});
    return settings.refreshInterval || 180000;
  }

  function setRefreshInterval(ms) {
    const settings = Storage.get(Storage.KEYS.SETTINGS, {});
    settings.refreshInterval = ms;
    Storage.set(Storage.KEYS.SETTINGS, settings);
    restartRefreshLoop();
  }

  async function checkLevelBreaks(price) {
    const broken = [];
    lastKnownLevels.resistance.forEach(lvl => { if (price > lvl) broken.push({ type: 'resistance', level: lvl }); });
    lastKnownLevels.support.forEach(lvl => { if (price < lvl) broken.push({ type: 'support', level: lvl }); });
    for (const b of broken) {
      await Notifications.notify('GoldDesk Pro — Key Level Break', {
        body: `Price broke ${b.type === 'resistance' ? 'above resistance' : 'below support'} at $${b.level.toFixed(2)}. Current: $${price.toFixed(2)}.`,
        tag: `level-${b.type}-${b.level.toFixed(0)}`,
      });
    }
  }

  async function refreshCycle({ silent = false } = {}) {
    try {
      const apiKey = Storage.get(Storage.KEYS.API_KEY, '');

      // Price tick and real-candle history are independent network calls —
      // run them concurrently rather than back-to-back so a slow source on
      // one side doesn't add to the other's latency on mobile connections.
      const [tick] = await Promise.all([
        PriceFeed.fetchLivePrice(),
        RealCandles.refresh(apiKey).catch(e => console.warn('Pre-warm real-candle fetch failed', e)),
      ]);
      UI.setConnStatus(tick.source);

      await MarketEngine.refresh(tick.price, apiKey);

      const session = Sessions.getCurrentSession();
      UI.setSessionBadge(session);

      UI.renderPrice({ price: tick.price, prevPrice, dailyOpen: MarketEngine.getDailyStats().open });

      Alerts.checkPrice(tick.price, async (alert, hitPrice) => {
        UI.showToast(`Alert: price ${alert.direction} ${alert.price.toFixed(2)} (now $${hitPrice.toFixed(2)})`);
        await Notifications.notify('GoldDesk Pro — Price Alert', {
          body: `XAU/USD ${alert.direction === 'above' ? 'rose above' : 'fell below'} $${alert.price.toFixed(2)}. ${alert.note || ''}`.trim(),
          tag: `price-alert-${alert.id}`,
        });
        UI.renderAlerts();
      });

      await checkLevelBreaks(tick.price);

      const analysis = AnalysisEngine.runAnalysis();
      if (analysis) {
        UI.renderDashboard(analysis);
        lastKnownLevels = analysis.levels;

        const signal = SignalEngine.generateSignal(analysis);
        UI.renderSignal(signal);
        UI.renderSignalHistory();

        if (!silent && signal.direction !== 'WAIT' && signal.direction !== lastSignalDirection) {
          await Notifications.notify('GoldDesk Pro — New Signal', {
            body: `${signal.direction} bias at $${signal.price.toFixed(2)} — confidence ${signal.confidence}/10.`,
            tag: 'new-signal',
          });
        }
        lastSignalDirection = signal.direction;
      }

      prevPrice = tick.price;
      UI.renderSettings();
    } catch (e) {
      console.error('Refresh cycle failed', e);
      if (!silent) UI.showToast('Refresh failed — showing last known data.');
    }
  }

  function restartRefreshLoop() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => refreshCycle({ silent: true }), getRefreshInterval());
  }

  function loadCachedStateOffline() {
    const analysis = Storage.get(Storage.KEYS.LAST_ANALYSIS, null);
    const signal = Storage.get(Storage.KEYS.LAST_SIGNAL, null);
    if (analysis) {
      UI.renderDashboard(analysis);
      lastKnownLevels = analysis.levels;
      prevPrice = analysis.price;
      UI.renderPrice({ price: analysis.price, prevPrice: analysis.price, dailyOpen: analysis.dailyStats.open });
    }
    if (signal) {
      UI.renderSignal(signal);
      lastSignalDirection = signal.direction;
    }
    UI.renderSignalHistory();
    UI.renderAlerts();
    UI.renderSettings();
  }

  function wireNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => UI.switchView(btn.dataset.view));
    });
  }

  function wireGenerateButton() {
    const btn = document.getElementById('generateBtn');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '⏳ Analyzing…';
      await refreshCycle({ silent: false });
      btn.disabled = false;
      btn.textContent = '⚡ Generate Fresh Analysis';
      UI.showToast('Fresh analysis generated.');
    });
  }

  function wireAlertForm() {
    const form = document.getElementById('alertForm');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const price = parseFloat(document.getElementById('alertPrice').value);
      const direction = document.getElementById('alertDirection').value;
      const note = document.getElementById('alertNote').value.trim();
      if (!isFinite(price) || price <= 0) {
        UI.showToast('Enter a valid price level.');
        return;
      }
      Alerts.add({ price, direction, note });
      form.reset();
      UI.renderAlerts();
      UI.showToast('Alert added.');
    });

    document.getElementById('activeAlerts').addEventListener('click', (e) => {
      const id = e.target?.dataset?.remove;
      if (!id) return;
      Alerts.remove(id);
      UI.renderAlerts();
    });
  }

  function wireSettings() {
    document.getElementById('notifPermBtn').addEventListener('click', async () => {
      const result = await Notifications.requestPermission();
      UI.renderSettings();
      if (result === 'granted') {
        UI.showToast('Notifications enabled.');
        await Notifications.notify('GoldDesk Pro', { body: 'Notifications are now enabled. You will be alerted on new signals, key level breaks, and price alerts.' });
      } else if (result === 'denied') {
        UI.showToast('Notifications blocked.');
      }
    });

    document.getElementById('refreshInterval').addEventListener('change', (e) => {
      setRefreshInterval(parseInt(e.target.value, 10));
      UI.showToast('Refresh interval updated.');
    });

    document.getElementById('saveRiskBtn').addEventListener('click', () => {
      const settings = Storage.get(Storage.KEYS.SETTINGS, {});
      const accountSize = parseFloat(document.getElementById('accountSizeInput').value);
      settings.accountSize = isFinite(accountSize) && accountSize > 0 ? accountSize : null;
      settings.riskPct = parseFloat(document.getElementById('riskPctInput').value);
      Storage.set(Storage.KEYS.SETTINGS, settings);
      UI.showToast('Risk settings saved.');
    });

    document.getElementById('saveApiKeyBtn').addEventListener('click', () => {
      const val = document.getElementById('apiKeyInput').value.trim();
      Storage.set(Storage.KEYS.API_KEY, val);
      UI.renderSettings();
      UI.showToast(val ? 'API key saved.' : 'API key cleared.');
    });

    document.getElementById('clearDataBtn').addEventListener('click', () => {
      if (confirm('Clear all local GoldDesk Pro data (alerts, cached analysis, settings)? This cannot be undone.')) {
        Storage.clearAll();
        location.reload();
      }
    });
  }

  function restoreSettingsToForm() {
    const settings = Storage.get(Storage.KEYS.SETTINGS, {});
    if (settings.refreshInterval) {
      document.getElementById('refreshInterval').value = String(settings.refreshInterval);
    }
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (e) {
      console.warn('Service worker registration failed', e);
    }
  }

  function init() {
    wireNav();
    wireGenerateButton();
    wireAlertForm();
    wireSettings();
    restoreSettingsToForm();
    registerServiceWorker();

    const hadCache = !!Storage.get(Storage.KEYS.LAST_ANALYSIS, null);
    if (!hadCache) UI.setLoading(true);

    loadCachedStateOffline();
    refreshCycle({ silent: true }).finally(() => UI.setLoading(false));
    restartRefreshLoop();

    setInterval(() => UI.setSessionBadge(Sessions.getCurrentSession()), 60000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
