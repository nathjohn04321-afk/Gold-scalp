/**
 * indicators.js — standard technical-analysis math over OHLC candle arrays.
 * Candle shape: { t: msEpoch, o, h, l, c }
 * All functions are pure and side-effect free.
 */
const Indicators = (() => {

  function ema(values, period) {
    if (values.length === 0) return [];
    const k = 2 / (period + 1);
    const out = [values[0]];
    for (let i = 1; i < values.length; i++) {
      out.push(values[i] * k + out[i - 1] * (1 - k));
    }
    return out;
  }

  function emaLast(values, period) {
    const series = ema(values, period);
    return series[series.length - 1];
  }

  function sma(values, period) {
    if (values.length < period) return null;
    const slice = values.slice(values.length - period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  /**
   * Wilder-smoothed RSI (the textbook definition — same recursive
   * smoothing TradingView/MT4 use), not a flat average over the last N
   * diffs. Smooths over the whole series so the average gain/loss carries
   * memory from before the visible window, matching standard platforms.
   */
  function rsi(values, period = 14) {
    if (values.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = values[i] - values[i - 1];
      if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
    if (values.length < slow + signalPeriod) return null;
    const emaFast = ema(values, fast);
    const emaSlow = ema(values, slow);
    const macdLine = values.map((_, i) => emaFast[i] - emaSlow[i]);
    const signalLine = ema(macdLine, signalPeriod);
    const last = macdLine.length - 1;
    return {
      macd: macdLine[last],
      signal: signalLine[last],
      histogram: macdLine[last] - signalLine[last],
    };
  }

  /**
   * Standard "Slow Stochastic": raw %K per bar, %K = SMA(rawK, smoothK),
   * %D = SMA(%K series, smoothD). Building full %K/%D series (not just one
   * point) so %D is a genuine moving average of %K, not an approximation.
   */
  function stochastic(candles, period = 14, smoothK = 3, smoothD = 3) {
    if (candles.length < period + smoothK + smoothD) return null;

    const rawK = [];
    for (let i = period - 1; i < candles.length; i++) {
      const slice = candles.slice(i - period + 1, i + 1);
      const highest = Math.max(...slice.map(c => c.h));
      const lowest = Math.min(...slice.map(c => c.l));
      const close = candles[i].c;
      rawK.push(highest === lowest ? 50 : ((close - lowest) / (highest - lowest)) * 100);
    }

    const slowK = [];
    for (let i = smoothK - 1; i < rawK.length; i++) {
      slowK.push(sma(rawK.slice(0, i + 1), smoothK));
    }

    const dSeries = [];
    for (let i = smoothD - 1; i < slowK.length; i++) {
      dSeries.push(sma(slowK.slice(0, i + 1), smoothD));
    }

    return { k: slowK[slowK.length - 1], d: dSeries[dSeries.length - 1] };
  }

  /**
   * Wilder-smoothed ATR (the textbook definition): first value is a simple
   * average of the first `period` true ranges, then each subsequent value
   * recursively smooths in the new true range — matching TradingView/MT4.
   */
  function atr(candles, period = 14) {
    if (candles.length < period + 1) return null;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const cur = candles[i], prev = candles[i - 1];
      trs.push(Math.max(
        cur.h - cur.l,
        Math.abs(cur.h - prev.c),
        Math.abs(cur.l - prev.c)
      ));
    }

    let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      atrVal = (atrVal * (period - 1) + trs[i]) / period;
    }
    return atrVal;
  }

  /** Simple fractal-based pivot highs/lows -> clustered into S/R levels. */
  function pivotLevels(candles, lookback = 2, maxLevels = 4) {
    const pivotHighs = [];
    const pivotLows = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
      const windowSlice = candles.slice(i - lookback, i + lookback + 1);
      const cur = candles[i];
      if (cur.h === Math.max(...windowSlice.map(c => c.h))) pivotHighs.push(cur.h);
      if (cur.l === Math.min(...windowSlice.map(c => c.l))) pivotLows.push(cur.l);
    }

    function cluster(values, price) {
      if (values.length === 0) return [];
      const tolerance = price * 0.0015; // ~15 pips on gold scale
      const sorted = [...values].sort((a, b) => a - b);
      const clusters = [];
      let bucket = [sorted[0]];
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] - bucket[bucket.length - 1] <= tolerance) {
          bucket.push(sorted[i]);
        } else {
          clusters.push(bucket);
          bucket = [sorted[i]];
        }
      }
      clusters.push(bucket);
      return clusters
        .map(b => ({ price: b.reduce((a, v) => a + v, 0) / b.length, touches: b.length }))
        .sort((a, b) => b.touches - a.touches)
        .slice(0, maxLevels)
        .map(c => c.price);
    }

    const lastPrice = candles[candles.length - 1].c;
    return {
      resistance: cluster(pivotHighs, lastPrice).filter(p => p > lastPrice).sort((a, b) => a - b),
      support: cluster(pivotLows, lastPrice).filter(p => p < lastPrice).sort((a, b) => b - a),
    };
  }

  /**
   * Simplified Fair Value Gap detection: a 3-candle imprint where candle[0]'s
   * high/low doesn't overlap candle[2]'s low/high, leaving an imbalance.
   * Simplified order block: the last down-close candle before a strong
   * up-impulse (or vice versa).
   */
  function findFvgAndOrderBlocks(candles, limit = 3) {
    const fvgs = [];
    for (let i = 2; i < candles.length; i++) {
      const a = candles[i - 2], c = candles[i];
      if (a.h < c.l) {
        fvgs.push({ type: 'bullish', top: c.l, bottom: a.h, index: i });
      } else if (a.l > c.h) {
        fvgs.push({ type: 'bearish', top: a.l, bottom: c.h, index: i });
      }
    }

    const orderBlocks = [];
    for (let i = 1; i < candles.length - 1; i++) {
      const prev = candles[i];
      const impulse = candles[i + 1];
      const impulseSize = Math.abs(impulse.c - impulse.o);
      const avgBody = (Math.abs(prev.c - prev.o) || 0.01);
      if (impulse.c > impulse.o && prev.c < prev.o && impulseSize > avgBody * 1.8) {
        orderBlocks.push({ type: 'bullish', top: prev.h, bottom: prev.l, index: i });
      } else if (impulse.c < impulse.o && prev.c > prev.o && impulseSize > avgBody * 1.8) {
        orderBlocks.push({ type: 'bearish', top: prev.h, bottom: prev.l, index: i });
      }
    }

    return {
      fvgs: fvgs.slice(-limit).reverse(),
      orderBlocks: orderBlocks.slice(-limit).reverse(),
    };
  }

  return { ema, emaLast, sma, rsi, macd, stochastic, atr, pivotLevels, findFvgAndOrderBlocks };
})();
