/**
 * ui.js — pure(ish) DOM rendering + navigation. No network/business logic
 * lives here; app.js calls these render functions with data it has already
 * computed via AnalysisEngine / SignalEngine / Alerts.
 */
const UI = (() => {

  let toastTimer = null;

  function showToast(message, ms = 2600) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });
  }

  function fmt(n) { return (n === null || n === undefined || isNaN(n)) ? '--' : `$${Number(n).toFixed(2)}`; }

  function setConnStatus(source) {
    const dot = document.getElementById('connDot');
    const tag = document.getElementById('dataSourceTag');
    dot.classList.remove('online', 'offline', 'simulated');
    if (source === 'live') {
      dot.classList.add('online');
      tag.textContent = 'LIVE';
      tag.classList.add('live');
    } else {
      dot.classList.add('simulated');
      tag.textContent = 'SIMULATED';
      tag.classList.remove('live');
    }
  }

  function setSessionBadge(session) {
    document.getElementById('sessionBadge').textContent = session.label;
  }

  function renderPrice({ price, prevPrice, dailyOpen }) {
    document.getElementById('livePrice').textContent = price.toFixed(2);
    const change = prevPrice ? price - prevPrice : 0;
    const basisOpen = dailyOpen || prevPrice || price;
    const pctFromOpen = basisOpen ? ((price - basisOpen) / basisOpen) * 100 : 0;

    const chgEl = document.getElementById('priceChange');
    const pctEl = document.getElementById('priceChangePct');
    const cls = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
    const pctCls = pctFromOpen > 0 ? 'up' : pctFromOpen < 0 ? 'down' : 'flat';

    chgEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}`;
    chgEl.className = `chg ${cls}`;
    pctEl.textContent = `${pctFromOpen >= 0 ? '+' : ''}${pctFromOpen.toFixed(2)}% today`;
    pctEl.className = `chg ${pctCls}`;

    document.getElementById('lastUpdated').textContent = `updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  function trendClass(key) { return `trend-pill trend-${key}`; }

  function renderDashboard(analysis) {
    if (!analysis) return;
    const { dailyStats, atr, trendStatus, mtf, levels, ma, osc, obFvg, confluenceScore, newsEvents } = analysis;

    document.getElementById('sessHigh').textContent = fmt(dailyStats.high);
    document.getElementById('sessLow').textContent = fmt(dailyStats.low);
    document.getElementById('dailyOpen').textContent = fmt(dailyStats.open);
    document.getElementById('atrValue').textContent = fmt(atr);

    const trendPill = document.getElementById('trendStatus');
    trendPill.textContent = trendStatus.label;
    trendPill.className = trendClass(trendStatus.key);

    const tfOrder = ['15m', '1H', '4H', '1D'];
    const rows = tfOrder.map(tf => {
      const s = mtf[tf];
      const biasCls = s.bias === 'bull' ? 'bias-bull' : s.bias === 'bear' ? 'bias-bear' : 'bias-neutral';
      const biasLabel = s.bias === 'bull' ? 'Bullish' : s.bias === 'bear' ? 'Bearish' : 'Neutral';
      return `<tr><td>${AnalysisEngine.TF_LABELS[tf]}</td><td>${s.label}</td><td class="${biasCls}">${biasLabel}</td></tr>`;
    }).join('');
    document.getElementById('mtfBody').innerHTML = rows;

    const levelRows = [];
    levels.resistance.forEach(p => levelRows.push(
      `<div class="level-row"><span class="lvl-tag resistance">RES</span><span class="lvl-price">${fmt(p)}</span></div>`
    ));
    levels.support.forEach(p => levelRows.push(
      `<div class="level-row"><span class="lvl-tag support">SUP</span><span class="lvl-price">${fmt(p)}</span></div>`
    ));
    document.getElementById('keyLevels').innerHTML = levelRows.length ? levelRows.join('') :
      '<div class="level-row placeholder">No clear pivot levels detected yet.</div>';

    document.getElementById('maAlignment').textContent = ma.text;

    document.getElementById('rsiValue').textContent = osc.rsiVal !== null ? osc.rsiVal.toFixed(0) : '--';
    document.getElementById('macdValue').textContent = osc.macdVal ? (osc.macdVal.histogram >= 0 ? 'Bull ▲' : 'Bear ▼') : '--';
    document.getElementById('stochValue').textContent = osc.stochVal ? `${osc.stochVal.k.toFixed(0)}/${osc.stochVal.d.toFixed(0)}` : '--';

    const obRows = [];
    obFvg.fvgs.forEach(f => obRows.push(
      `<div class="level-row"><span class="lvl-tag ${f.type === 'bullish' ? 'support' : 'resistance'}">FVG</span><span>${f.type} gap ${fmt(f.bottom)} – ${fmt(f.top)}</span></div>`
    ));
    obFvg.orderBlocks.forEach(o => obRows.push(
      `<div class="level-row"><span class="lvl-tag ${o.type === 'bullish' ? 'support' : 'resistance'}">OB</span><span>${o.type} block ${fmt(o.bottom)} – ${fmt(o.top)}</span></div>`
    ));
    document.getElementById('obFvg').innerHTML = obRows.length ? obRows.join('') : 'No fresh order blocks or FVGs in range on the 4H.';

    document.getElementById('confluenceBar').style.width = `${(confluenceScore / 10) * 100}%`;
    document.getElementById('confluenceScore').textContent = `${confluenceScore.toFixed(1)} / 10`;

    const newsEl = document.getElementById('newsWarning');
    if (newsEvents.length) {
      newsEl.innerHTML = newsEvents.map(e =>
        `<div>⚠ <strong>${e.name}</strong> — ${e.time.toUTCString().slice(0, 22)} UTC</div>`
      ).join('');
    } else {
      newsEl.textContent = 'No scheduled high-impact events in the next 48h (illustrative calendar — see Settings/README to connect a real one).';
    }
  }

  function renderSignal(signal) {
    if (!signal) return;
    const dirEl = document.getElementById('signalDirection');
    dirEl.textContent = signal.direction;
    dirEl.className = `signal-direction ${signal.direction.toLowerCase()}`;
    document.getElementById('signalConfidence').textContent = `Confidence ${signal.confidence}/10`;
    document.getElementById('signalNarrative').textContent = signal.narrative;
    document.getElementById('altScenario').textContent = signal.altScenario;

    const p = signal.plan;
    document.getElementById('planEntry').textContent = p.entry ? `${fmt(p.entry[0])} – ${fmt(p.entry[1])}` : '--';
    document.getElementById('planSL').textContent = fmt(p.sl);
    document.getElementById('planTP1').textContent = fmt(p.tp1);
    document.getElementById('planTP2').textContent = fmt(p.tp2);
    document.getElementById('planRR').textContent = p.rr ? `1 : ${p.rr.toFixed(2)}` : '--';
    document.getElementById('planInvalid').textContent = fmt(p.invalidation);
  }

  function renderSignalHistory() {
    const history = Storage.get(Storage.KEYS.SIGNAL_HISTORY, []);
    const el = document.getElementById('signalHistory');
    if (!history.length) {
      el.innerHTML = '<div class="level-row placeholder">No signals generated yet this session.</div>';
      return;
    }
    el.innerHTML = history.map(h => `
      <div class="hist-item">
        <div class="hist-top">
          <span class="${h.direction === 'BUY' ? 'bias-bull' : h.direction === 'SELL' ? 'bias-bear' : 'bias-neutral'}">${h.direction}</span>
          <span>${fmt(h.price)}</span>
        </div>
        <div class="hist-meta">${new Date(h.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} — confidence ${h.confidence}/10</div>
      </div>
    `).join('');
  }

  function renderAlerts() {
    const active = Alerts.getActive();
    const activeEl = document.getElementById('activeAlerts');
    activeEl.innerHTML = active.length ? active.map(a => `
      <div class="alert-item" data-id="${a.id}">
        <div class="alert-info">
          <span>${a.direction === 'above' ? 'Above' : 'Below'} ${fmt(a.price)}</span>
          ${a.note ? `<span class="alert-note">${a.note}</span>` : ''}
        </div>
        <button class="remove-alert" data-remove="${a.id}" aria-label="Remove alert">✕</button>
      </div>
    `).join('') : '<div class="level-row placeholder">No active alerts.</div>';

    const triggered = Alerts.getTriggered();
    const trigEl = document.getElementById('triggeredAlerts');
    trigEl.innerHTML = triggered.length ? triggered.map(a => `
      <div class="alert-item triggered">
        <div class="alert-info">
          <span>${a.direction === 'above' ? 'Above' : 'Below'} ${fmt(a.price)} → hit ${fmt(a.triggeredPrice)}</span>
          <span class="alert-note">${new Date(a.triggeredAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
        </div>
      </div>
    `).join('') : '<div class="level-row placeholder">No alerts triggered yet.</div>';
  }

  function renderSettings() {
    const perm = Notifications.permission();
    const btn = document.getElementById('notifPermBtn');
    const hint = document.getElementById('notifStatusHint');
    if (perm === 'granted') {
      btn.textContent = 'Enabled';
      btn.disabled = true;
      hint.textContent = 'Status: granted — you will receive local alerts while the app/service worker is active.';
    } else if (perm === 'denied') {
      btn.textContent = 'Blocked';
      btn.disabled = true;
      hint.textContent = 'Status: blocked in browser settings. Re-enable via site settings to receive alerts.';
    } else if (perm === 'unsupported') {
      btn.textContent = 'Unsupported';
      btn.disabled = true;
      hint.textContent = 'This browser does not support the Notifications API.';
    } else {
      btn.textContent = 'Enable';
      btn.disabled = false;
      hint.textContent = 'Status: not requested.';
    }

    const apiKey = Storage.get(Storage.KEYS.API_KEY, '');
    document.getElementById('apiKeyInput').value = apiKey;
    document.getElementById('sourceStatus').textContent = apiKey ? 'Twelve Data (key saved)' : 'gold-api.com (free, no key)';

    const lastAnalysis = Storage.get(Storage.KEYS.LAST_ANALYSIS, null);
    document.getElementById('cacheStatus').textContent = lastAnalysis
      ? new Date(lastAnalysis.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      : 'None yet';
  }

  return {
    showToast, switchView, setConnStatus, setSessionBadge, renderPrice,
    renderDashboard, renderSignal, renderSignalHistory, renderAlerts, renderSettings,
  };
})();
