# GoldDesk Pro — XAU/USD Trading Desk PWA

A mobile-first, installable Progressive Web App that gives you 24/7
professional-style market analysis and Buy/Sell/Wait trade plans for
XAU/USD (Gold), written in the voice of an institutional daily desk trader.

Pure HTML + CSS + vanilla JavaScript. No build step, no framework, no
backend required to run it.

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
│   ├── indicators.js        # EMA, RSI, MACD, Stochastic, ATR, pivot S/R, FVG/order blocks
│   ├── marketEngine.js      # Multi-timeframe candle history, anchored to the live price
│   ├── priceFeed.js         # Live price fetch (Twelve Data / gold-api.com / simulated fallback)
│   ├── analysisEngine.js    # Combines candles + indicators into a full market read
│   ├── signalEngine.js      # Buy/Sell/Wait trade-plan + trader-voice narrative generator
│   ├── alerts.js            # User price alerts (CRUD + trigger checking)
│   ├── notifications.js     # Local notification wrapper
│   ├── ui.js                # DOM rendering
│   └── app.js               # Orchestration: wiring, refresh loop, event handlers
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    ├── icon-maskable-512.png
    └── apple-touch-icon.png
```

---

## 2. Deploy for free in under 5 minutes

Pick any one of these — all work with this static file structure as-is.

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

### Option C — GitHub Pages
1. Push this repo to GitHub (already done if you're reading this from the repo).
2. Go to **Settings → Pages**.
3. Under "Build and deployment", set **Source: Deploy from a branch**, branch
   = your default branch, folder = `/ (root)`.
4. Save. Your app will be live at `https://<username>.github.io/<repo>/` in ~1 minute.

> **PWA requirement:** all three options serve over HTTPS automatically,
> which is required for service workers and "Add to Home Screen" to work.
> Opening `index.html` directly via `file://` will *not* register the
> service worker or allow install — always test on the deployed HTTPS URL
> (or `localhost` during local dev).

---

## 3. Installing the PWA on your phone

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

## 4. Connecting a Real Gold Price API

By default, GoldDesk Pro fetches live XAU/USD spot price from
**[gold-api.com](https://gold-api.com)** — free, no signup, no API key, CORS-open.
If that's ever unreachable (rate limit, outage, offline), the app
automatically falls back to a clearly-labeled **SIMULATED** local price so
the UI never breaks.

For more accuracy (real historical intraday OHLC candles feeding the
technical analysis, not just the spot price), plug in a free-tier API key:

| Provider | Free tier | Notes |
|---|---|---|
| **[Twelve Data](https://twelvedata.com)** | 800 requests/day | Already wired in — paste your key in **Settings → Live Price Data Source**. Used automatically once saved. |
| **[Polygon.io](https://polygon.io)** | 5 req/min | Good historical forex/metals OHLC endpoints. |
| **[MetalpriceAPI](https://metalpriceapi.com)** | 100 req/month | Simple metals-focused REST API. |
| **[Alpha Vantage](https://www.alphavantage.co)** | 25 req/day | Use `FX_INTRADAY` / `CURRENCY_EXCHANGE_RATE` for XAU/USD. |

**To wire in a different provider:** edit `js/priceFeed.js` — add a new
`tryYourProvider()` function following the same shape as `tryTwelveData()`
(fetch → parse → return `{ price, source: 'live', provider: 'Name' }` or
`null` on failure), then add it to the priority chain in `fetchLivePrice()`.

**Why the candle history is simulated by default:** free, no-key, CORS-open
sources for *historical intraday* gold OHLC don't really exist — every
real provider gates that behind an API key. `js/marketEngine.js` documents
this tradeoff in detail and anchors its simulated candles to the real live
price on every refresh, so the moment you add a real OHLC-capable API key,
accuracy improves immediately. The indicator math itself (EMA/RSI/MACD/ATR/
support-resistance/FVG) is standard and correct regardless of data source.

---

## 5. Risk Management Model

Every trade plan is built to cut *dollar risk* without touching the entry/
stop logic that determines whether the underlying setup wins or loses —
so the win rate of the strategy itself is untouched. Two independent levers:

1. **Position sizing** (Settings → Risk Management): set your account size
   and a risk-per-trade % (0.25%–2%, default 1%). `js/signalEngine.js`
   computes a suggested position size in troy ounces from your stop
   distance — this only changes how much is at stake per trade, never the
   entry/exit rules, so it cannot move the win rate.
2. **Partial profit-taking at TP1 + breakeven stop**: every BUY/SELL plan
   now includes a "Trade Management" instruction — take 50% off at TP1 and
   move the stop to breakeven on the remainder. This only affects trades
   that have *already* reached TP1 (i.e. winners), locking in profit and
   making the TP2 runner risk-free — it doesn't change whether a trade
   reaches TP1 in the first place.

The structural stop-loss buffer beyond the nearest support/resistance
level (`SL_STRUCTURE_BUFFER` in `js/signalEngine.js`) was also tightened
from 0.3×ATR to 0.2×ATR — still comfortably beyond the identified
swing level (so it isn't clipped by normal noise), just with less
padding, shaving a bit of risk off every trade.

---

## 6. Optional: Backend for True Push Notifications

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

## 7. Style of Analysis

Every narrative, signal, and alt-scenario is generated in
`js/signalEngine.js` and `js/analysisEngine.js` — written to read like a
professional desk trader's morning note: direction, confidence, levels,
risk management, invalidation. No hype, no filler.

## Disclaimer

GoldDesk Pro provides educational market commentary and algorithmically
generated trade ideas. **It is not financial advice.** Trading leveraged
FX/metals carries a high risk of loss. Always use proper risk management.
