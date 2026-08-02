# GoldDesk Pro — XAU/USD Trading Desk PWA

A mobile-first, installable Progressive Web App that gives you 24/7
professional-style market analysis and Buy/Sell/Wait trade plans for
XAU/USD (Gold), written in the voice of an institutional daily desk trader.

Pure HTML + CSS + vanilla JavaScript. No build step, no framework, no
backend required to run it.

---

## v1.2.0 Changelog — Reliability & Real-Data Hardening

This release is a full audit-and-harden pass in response to three real
problems reported on the live deployment: the header showing SIMULATED too
often, dashboard fields stuck on "--", and a stop-loss that landed near
$2000 while gold traded near $4000.

**Fixed:**
- **Root cause of the bad stop-loss**: the simulated candle history was
  only ever anchored to the live price once, on first run. After real
  price drifted far from that anchor (days closed, or a genuine large
  move), old support/resistance levels went stale and fed directly into
  the stop-loss. Stop-loss is now a straight **0.5–1.5× ATR** distance —
  structure can nudge it within that band, never outside it.
- **RSI/ATR were flat averages, not textbook Wilder smoothing** — rewritten
  to the same recursive formulas TradingView/MT4 use.
- **Stochastic %D was an approximation** — rewritten to a real SMA-of-%K series.

**Added:**
- `js/realCandles.js` — real OHLC candle history (Twelve Data if keyed,
  else a free no-key Yahoo Finance fallback), so the technical analysis
  runs on real market structure whenever it's reachable, not just a
  simulated shape anchored to the live price.
- 4-tier price fallback chain with per-source retry + timeout, and a
  last-known-good price cache so one flaky source can't force SIMULATED mode.
- **Analysis Data** badge on the Dashboard: REAL / PARTIAL / SIMULATED,
  broken down per timeframe, with the age of the last real refresh.
- Skeleton loading state so first paint never shows a blank "--".
- Parallelized the price-tick and real-candle fetches (independent network
  calls, no reason to serialize them) for faster mobile refreshes.

See §3 for the full data pipeline and §4 for exactly which endpoints are
used and why.

---

## 1. File Structure

```
Gold-scalp/
├── index.html              # App shell: Dashboard / Signals / Alerts / Settings views + bottom nav
├── manifest.json           # PWA manifest ("Add to Home Screen")
├── sw.js                   # Service worker: offline app-shell caching + notification handling
├── css/
│   └── styles.css          # Dark trading-desk theme, mobile-first
├── js/
│   ├── storage.js           # localStorage wrapper (alerts, settings, cached analysis)
│   ├── sessions.js          # Asia/London/NY session clock + illustrative news calendar
│   ├── indicators.js        # EMA, Wilder RSI/ATR, MACD, Slow Stochastic, pivot S/R, FVG/order blocks
│   ├── realCandles.js       # REAL OHLC history: Twelve Data (keyed) or Yahoo Finance (no-key fallback)
│   ├── marketEngine.js      # Merges real + simulated candles per timeframe, tracks data quality
│   ├── priceFeed.js         # Live spot price: 4-tier fallback chain + last-good-price cache
│   ├── analysisEngine.js    # Combines candles + indicators into a full market read
│   ├── signalEngine.js      # Buy/Sell/Wait trade-plan (tight ATR-based SL/TP) + trader-voice narrative
│   ├── alerts.js            # User price alerts (CRUD + trigger checking)
│   ├── notifications.js     # Local notification wrapper
│   ├── ui.js                # DOM rendering (incl. data-quality badge, skeleton loading)
│   └── app.js               # Orchestration: wiring, refresh loop, event handlers
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    ├── icon-maskable-512.png
    └── apple-touch-icon.png
```

---

## 2. Deploy for free in under 5 minutes

Pick any one of these — all work with this static file structure as-is,
including as a GitHub Pages **subdirectory** deploy (`/Gold-scalp/`), since
every path in the app (manifest, service worker, scripts, icons) is
relative rather than absolute.

### Option A — Netlify (drag & drop, fastest)
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag the entire `Gold-scalp` project folder onto the page.
3. Netlify gives you a live HTTPS URL immediately (e.g. `random-name.netlify.app`).
4. (Optional) Claim/rename the site under **Site settings → Change site name**.

### Option B — Vercel
1. Install the CLI once: `npm i -g vercel`.
2. From the project folder, run: `vercel --prod`.
3. Accept the defaults (no framework/build step needed — it's static).
4. Vercel prints your live HTTPS URL.

### Option C — GitHub Pages (your current deployment)
1. Push this repo to GitHub (already done if you're reading this from the repo).
2. Go to **Settings → Pages**.
3. Under "Build and deployment", set **Source: Deploy from a branch**, pick
   the branch you want live, folder = `/ (root)`.
4. Save. Your app goes live at `https://<username>.github.io/<repo>/` in ~1 minute.
5. **Verify the subdirectory service worker registered correctly**: open the
   live URL, open DevTools → **Application → Service Workers**, and confirm
   the registered scope ends in `/<repo>/` (e.g. `/Gold-scalp/`), not `/`.
   If it's wrong, hard-refresh once (service workers can take one reload to
   pick up scope changes after an update).

> **PWA requirement:** all three options serve over HTTPS automatically,
> which is required for service workers and "Add to Home Screen" to work.
> Opening `index.html` directly via `file://` will *not* register the
> service worker or allow install — always test on the deployed HTTPS URL
> (or `localhost` during local dev).

---

## 3. The Data → Analysis Pipeline

This is the core of the reliability rewrite: two independent data sources
feed into one merged, quality-tagged candle store, which the same
indicator math always runs on.

```
┌─────────────────┐     ┌──────────────────────┐
│   priceFeed.js   │     │   realCandles.js     │
│  (spot price,    │     │  (OHLC history,      │
│   every refresh) │     │   ~every 20 min)      │
│                  │     │                       │
│ Twelve Data (key)│     │ Twelve Data (key):    │
│  → gold-api.com  │     │  native 15m/1h/4h/1d  │
│  → freeforexapi  │     │  → Yahoo Finance:     │
│  → cached price  │     │    GC=F futures proxy,│
│    (age-labeled) │     │    15m/60m/1d,        │
│  → simulated tick│     │    4H resampled from  │
│                  │     │    1H (no native 4h)  │
└────────┬─────────┘     └──────────┬───────────┘
         │                          │
         └──────────┬───────────────┘
                     ▼
           ┌───────────────────┐
           │  marketEngine.js  │  merges real candles in where available;
           │                   │  fills ONLY the missing timeframes with a
           │                   │  self-healing simulated series; nudges the
           │                   │  forming candle with each live price tick
           └─────────┬─────────┘
                     ▼
           ┌───────────────────┐
           │ analysisEngine.js │  EMA 21/50/200, Wilder RSI/ATR, MACD, Slow
           │  + indicators.js  │  Stochastic, pivot S/R, simplified FVG/OB,
           │                   │  confluence score — same math regardless
           │                   │  of where the candles came from
           └─────────┬─────────┘
                     ▼
           ┌───────────────────┐
           │  signalEngine.js  │  Buy/Sell/Wait, entry zone, SL (0.5-1.5x
           │                   │  ATR), TP1/TP2 (1.5R/2.2R), position size,
           │                   │  trade management, trader-voice narrative
           └───────────────────┘
```

**Why real candles matter for correctness, not just the price display**:
every support/resistance level, EMA, RSI, MACD, ATR, and stop-loss is
computed *from the candle history*, not from the live spot price alone. A
live spot price with a stale/simulated backdrop can still produce a
technically-wrong analysis — this is exactly the class of bug that caused
the $2000 stop-loss report. Real candles fix that at the source; the ATR-
based SL clamp in `signalEngine.js` is the second, independent layer of
defense on top.

**Data quality is never hidden.** Every analysis carries a `dataQuality`
field (`real` / `partial` / `simulated`) shown as a badge on the
Dashboard, broken down per timeframe, with the age of the last real
refresh. If it's ever `simulated`, the Signals tab prepends an explicit
warning to the narrative — the app never quietly presents a
locally-simulated read as if it were live market analysis.

**"Generate Fresh Analysis"** re-runs this entire pipeline top to bottom:
new price tick, real-candle refresh-if-stale, full indicator recompute,
new trade plan. It's the same pipeline the auto-refresh timer runs — the
button just runs it on demand and surfaces a toast/error if anything fails.

---

## 4. Exact Endpoints Used, and Why

| Endpoint | Role | Key required | Why it works well here |
|---|---|---|---|
| **[Twelve Data](https://twelvedata.com)** `/price` + `/time_series` | Spot price + real OHLC (15m/1h/4h/1day, native) | Yes (free: 800 req/day) | Most reliable and highest quality when keyed; native 4h interval means no resampling. Paste your key in **Settings → Live Price Data Source**. |
| **[gold-api.com](https://gold-api.com)** `/price/XAU` | Spot price (default, no key) | No | Free, CORS-open, purpose-built for exactly this use case. First fallback if no Twelve Data key. |
| **[freeforexapi.com](https://www.freeforexapi.com)** `/api/live?pairs=XAUUSD` | Spot price (2nd fallback) | No | Independent infrastructure from gold-api.com — the two rarely go down together, so this materially cuts joint-failure rate. |
| **[Yahoo Finance chart API](https://query1.finance.yahoo.com)** `/v8/finance/chart/GC=F` | Real OHLC history (no-key fallback) | No | The only realistic no-signup path to *real* intraday gold structure. Uses COMEX Gold Futures (GC=F) as a close proxy for XAU/USD spot — small basis difference, but the structure (trend, S/R, indicator shape) tracks spot closely. **This is an unofficial, undocumented public endpoint** (the same one a browser tab on finance.yahoo.com calls) — it can change or get rate-limited without notice, which is exactly why it's a fallback and every candle it supplies is labeled in the data-quality badge, never silently trusted as equal to a paid source. |

All four are called directly from the browser (no proxy needed) and are
CORS-open for GET requests, which is what makes them work from a static
GitHub Pages/Netlify/Vercel deploy with zero backend.

**Other free-tier options if you want to swap one in** (edit
`js/priceFeed.js` for spot price or `js/realCandles.js` for OHLC history —
same pattern: fetch → parse → return, add to the priority chain):

| Provider | Free tier | Notes |
|---|---|---|
| **[Polygon.io](https://polygon.io)** | 5 req/min | Solid historical forex/metals OHLC. |
| **[MetalpriceAPI](https://metalpriceapi.com)** | 100 req/month | Simple metals-focused REST API. |
| **[Alpha Vantage](https://www.alphavantage.co)** | 25 req/day | Use `FX_INTRADAY` / `CURRENCY_EXCHANGE_RATE` for XAU/USD. |

---

## 5. Installing the PWA on your phone

### Android (Chrome)
1. Open your deployed URL in Chrome.
2. Tap the **⋮** menu → **Add to Home screen** (or you'll see an automatic
   "Install app" banner/prompt).
3. Confirm — GoldDesk Pro now appears as an app icon on your home screen and
   launches full-screen, no browser chrome.

### iPhone (Safari)
1. Open your deployed URL in **Safari** (must be Safari, not Chrome, for iOS install).
2. Tap the **Share** icon (square with an arrow) in the bottom toolbar.
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**. GoldDesk Pro now launches from your home screen like a native app.

**iOS push notification note:** iOS supports web push for home-screen PWAs
only on iOS 16.4+, and the app must be installed to the home screen (not
just opened in Safari) before `Notification.requestPermission()` will work.
Enable notifications from **Settings** inside the app after installing.

---

## 6. Risk Management Model

Stop-loss is now always a **tight 0.5–1.5× ATR distance** from entry —
never a raw structural-level distance. A nearby support/resistance level
can nudge it within that band (so it still respects real structure), but
can no longer drag it far from price the way a stale/bad level once did.
TP1 sits at 1.5× that risk, TP2 at 2.2× — both inside the realistic
1:1.5–1:2.5 R:R range for intraday/daily trading, and both are pure
R-multiples of the risk distance, so they're immune to bad levels entirely.

Two more levers cut *dollar* risk without ever touching the entry/stop
logic that determines whether the underlying setup wins or loses — the
strategy's win rate is untouched either way:

1. **Position sizing** (Settings → Risk Management): set your account size
   and a risk-per-trade % (0.25%–2%, default 1%). Computes a suggested
   position size in troy ounces from the stop distance.
2. **Partial profit-taking at TP1 + breakeven stop**: every BUY/SELL plan
   includes a "Trade Management" instruction — take 50% off at TP1 and
   move the stop to breakeven on the remainder, so the TP2 runner risks
   nothing already banked.

---

## 7. Phone Testing Checklist

Run through this on your actual deployed URL (not `file://`) after any update:

- [ ] **Cold load**: clear site data (or use a private/incognito tab), open
      the URL — dashboard should show a brief skeleton shimmer, then real
      numbers within a few seconds. Nothing should stay stuck on "--".
- [ ] **Data quality badge**: check the Dashboard's "Analysis Data" pill.
      On a normal connection it should read REAL or PARTIAL, not SIMULATED,
      within the first refresh or two.
- [ ] **Header price tag**: should read LIVE (green dot) under normal
      connectivity. Toggle airplane mode on, wait for a refresh cycle —
      should degrade to CACHED (using the last known-good price) and then
      SIMULATED if left offline long enough, never crash or freeze the UI.
- [ ] **Add to Home Screen**: install via the steps in §5, confirm it opens
      full-screen with no browser chrome and the correct icon.
- [ ] **Offline relaunch**: after installing, enable airplane mode, force-quit
      and reopen the app — it should load instantly from cache showing the
      last analysis, clearly labeled with its data quality/age.
- [ ] **Generate Fresh Analysis**: tap it, confirm the button shows
      "Analyzing…", then all fields update and a toast confirms completion.
- [ ] **Alerts**: set a price alert above/below current price, background the
      app, wait for a refresh cycle after the level would trigger — confirm
      a local notification arrives (grant notification permission first in Settings).
- [ ] **Refresh interval**: change it in Settings, confirm the interval
      persists after a reload.
- [ ] **Long-idle regression**: leave the app installed and untouched for
      24-48h, then reopen — confirm the price/SL/analysis reflect current
      reality (this is the specific scenario that caused the $2000 stop-loss
      bug; the staleness fix + real-candle merge should make it a non-issue now).
- [ ] **Subdirectory check** (GitHub Pages only): DevTools → Application →
      Service Workers → scope ends in your repo path, not `/`.

---

## 8. Optional: Backend for True Push Notifications

As shipped, GoldDesk Pro uses **local notifications** — they fire while the
app tab or its service worker is alive, which covers the vast majority of
"app open or recently used" mobile scenarios. For notifications that
arrive even when the app has been fully closed for a long time, you need a
real **Web Push** backend (this is a browser/OS platform requirement, not a
GoldDesk Pro limitation — every PWA needs this for guaranteed background push).

Minimal recipe:
1. Generate VAPID keys: `npx web-push generate-vapid-keys`.
2. Small Node/Express server with the [`web-push`](https://www.npmjs.com/package/web-push) package:
   - Endpoint to store each client's `PushSubscription` (from
     `registration.pushManager.subscribe()`).
   - A cron job (e.g. every 3–5 minutes) that runs the same signal logic
     server-side and calls `webpush.sendNotification(subscription, payload)`
     for new signals / level breaks.
3. `sw.js` already has a working `push` event handler — no client changes needed.

Free hosting for that tiny server: Render, Railway, Fly.io, or a Vercel/Netlify
serverless function + scheduled function trigger.

---

## 9. Style of Analysis

Every narrative, signal, and alt-scenario is generated in
`js/signalEngine.js` and `js/analysisEngine.js` — written to read like a
professional desk trader's morning note: direction, confidence, levels,
risk management, invalidation. No hype, no filler.

## Disclaimer

GoldDesk Pro provides educational market commentary and algorithmically
generated trade ideas. **It is not financial advice.** Trading leveraged
FX/metals carries a high risk of loss. Always use proper risk management.
