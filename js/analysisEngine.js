/**
 * analysisEngine.js — turns raw candle series into the structured market
 * read a desk trader would open their morning with: MTF structure, key
 * levels, MA alignment, oscillators, order blocks/FVGs, and a confluence
 * score. signalEngine.js consumes this output to build the trade plan.
 */
const AnalysisEngine = (() => {

  const TF_WEIGHTS = { '15m': 0.5, '1H': 1, '4H': 1.5, '1D': 2 };
  const TF_LABELS = { '15m': '15m', '1H': '1H', '4H': '4H', '1D': 'D' };

  function closes(candles) { return candles.map(c => c.c); }

  /** Fractal swing highs/lows -> simple HH/HL, LH/LL, or range read. */
  function structureForTf(candles) {
    const lookback = 2;
    const swingHighs = [];
    const swingLows = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
      const w = candles.slice(i - lookback, i + lookback + 1);
      const cur = candles[i];
      if (cur.h === Math.max(...w.map(c => c.h))) swingHighs.push(cur.h);
      if (cur.l === Math.min(...w.map(c => c.l))) swingLows.push(cur.l);
    }
    const lastHighs = swingHighs.slice(-3);
    const lastLows = swingLows.slice(-3);

    const highsRising = lastHighs.length >= 2 && lastHighs[lastHighs.length - 1] > lastHighs[lastHighs.length - 2];
    const lowsRising = lastLows.length >= 2 && lastLows[lastLows.length - 1] > lastLows[lastLows.length - 2];
    const highsFalling = lastHighs.length >= 2 && lastHighs[lastHighs.length - 1] < lastHighs[lastHighs.length - 2];
    const lowsFalling = lastLows.length >= 2 && lastLows[lastLows.length - 1] < lastLows[lastLows.length - 2];

    if (highsRising && lowsRising) return { bias: 'bull', label: 'Higher Highs / Higher Lows' };
    if (highsFalling && lowsFalling) return { bias: 'bear', label: 'Lower Highs / Lower Lows' };
    return { bias: 'neutral', label: 'Range-bound / Consolidation' };
  }

  function maAlignment(candles) {
    const c = closes(candles);
    const ema21 = Indicators.emaLast(c, 21);
    const ema50 = Indicators.emaLast(c, 50);
    const ema200 = Indicators.emaLast(c, 200);
    const price = c[c.length - 1];

    let stack, text;
    if (price > ema21 && ema21 > ema50 && ema50 > ema200) {
      stack = 'bull';
      text = `Bullish stack — price ($${price.toFixed(2)}) trading above EMA21 ($${ema21.toFixed(2)}) > EMA50 ($${ema50.toFixed(2)}) > EMA200 ($${ema200.toFixed(2)}). Trend structure intact, dips favor buyers.`;
    } else if (price < ema21 && ema21 < ema50 && ema50 < ema200) {
      stack = 'bear';
      text = `Bearish stack — price ($${price.toFixed(2)}) trading below EMA21 ($${ema21.toFixed(2)}) < EMA50 ($${ema50.toFixed(2)}) < EMA200 ($${ema200.toFixed(2)}). Trend structure intact, rallies favor sellers.`;
    } else {
      stack = 'neutral';
      text = `EMAs compressed / interwoven (21: $${ema21.toFixed(2)}, 50: $${ema50.toFixed(2)}, 200: $${ema200.toFixed(2)}) — no clean directional stack, treat as range conditions until resolved.`;
    }
    return { stack, text, ema21, ema50, ema200, price };
  }

  function oscillatorsRead(candles) {
    const c = closes(candles);
    const rsiVal = Indicators.rsi(c, 14);
    const macdVal = Indicators.macd(c);
    const stochVal = Indicators.stochastic(candles, 14, 3);

    let rsiText = 'RSI --';
    if (rsiVal !== null) {
      if (rsiVal >= 70) rsiText = `RSI ${rsiVal.toFixed(0)} — overbought, momentum stretched`;
      else if (rsiVal <= 30) rsiText = `RSI ${rsiVal.toFixed(0)} — oversold, momentum stretched`;
      else rsiText = `RSI ${rsiVal.toFixed(0)} — neutral zone`;
    }

    let macdText = 'MACD --';
    if (macdVal) {
      const dir = macdVal.histogram >= 0 ? 'bullish' : 'bearish';
      macdText = `MACD ${dir} (hist ${macdVal.histogram.toFixed(2)})`;
    }

    let stochText = 'Stoch --';
    if (stochVal) {
      const cross = stochVal.k > stochVal.d ? 'K>D bullish cross' : 'K<D bearish cross';
      stochText = `%K ${stochVal.k.toFixed(0)} / %D ${stochVal.d.toFixed(0)} — ${cross}`;
    }

    return { rsiVal, macdVal, stochVal, rsiText, macdText, stochText };
  }

  /**
   * Returns a *signed* bias score (-10 bearish .. +10 bullish) built from
   * how many independent factors agree. The UI's "Confluence Score" is the
   * absolute value (0-10 = conviction strength); the sign drives direction.
   */
  function computeBiasScore({ tfBiasScore, maStack, osc, priceNearLevel, obAligned }) {
    let score = 0;

    score += tfBiasScore > 1 ? 3 : tfBiasScore < -1 ? -3 : tfBiasScore * 1.2;
    score += maStack === 'bull' ? 2 : maStack === 'bear' ? -2 : 0;

    if (osc.macdVal) score += osc.macdVal.histogram >= 0 ? 1 : -1;
    if (osc.rsiVal !== null) {
      if (osc.rsiVal > 50 && osc.rsiVal < 70) score += 1;
      else if (osc.rsiVal < 50 && osc.rsiVal > 30) score -= 1;
      else if (osc.rsiVal >= 70) score += 0.5; // still bullish momentum, though stretched
      else if (osc.rsiVal <= 30) score -= 0.5;
    }
    if (priceNearLevel) score += Math.sign(score) * 1 || 1;
    if (obAligned) score *= 1.15; // structure confluence amplifies existing conviction

    return Math.max(-10, Math.min(10, Math.round(score * 10) / 10));
  }

  function trendStatusFromScore(score) {
    // score: weighted sum of per-TF bias (-2..+2 roughly per TF weight)
    if (score >= 3) return { key: 'strong-bull', label: 'STRONG BULL' };
    if (score >= 1) return { key: 'bull', label: 'BULL' };
    if (score <= -3) return { key: 'strong-bear', label: 'STRONG BEAR' };
    if (score <= -1) return { key: 'bear', label: 'BEAR' };
    return { key: 'range', label: 'RANGE' };
  }

  function runAnalysis() {
    const allSeries = MarketEngine.getAllSeries();
    if (!allSeries['1H'] || !allSeries['1H'].length) return null;

    const mtf = {};
    let tfBiasScore = 0;
    ['15m', '1H', '4H', '1D'].forEach(tf => {
      const s = structureForTf(allSeries[tf]);
      mtf[tf] = s;
      tfBiasScore += (s.bias === 'bull' ? 1 : s.bias === 'bear' ? -1 : 0) * TF_WEIGHTS[tf];
    });

    const primaryCandles = allSeries['1H'];
    const price = primaryCandles[primaryCandles.length - 1].c;

    const ma = maAlignment(allSeries['4H']);
    const osc = oscillatorsRead(primaryCandles);
    const atrVal = Indicators.atr(primaryCandles, 14);
    const levels = Indicators.pivotLevels(allSeries['4H'], 2, 4);
    const obFvg = Indicators.findFvgAndOrderBlocks(allSeries['4H'], 3);

    const nearestRes = levels.resistance[0];
    const nearestSup = levels.support[0];
    const proximityThreshold = atrVal ? atrVal * 0.6 : price * 0.001;
    const priceNearLevel = (nearestRes && Math.abs(nearestRes - price) <= proximityThreshold) ||
      (nearestSup && Math.abs(price - nearestSup) <= proximityThreshold);

    const obAligned = obFvg.orderBlocks.length > 0 || obFvg.fvgs.length > 0;

    const biasScore = computeBiasScore({ tfBiasScore, maStack: ma.stack, osc, priceNearLevel, obAligned });
    const confluenceScore = Math.round(Math.min(10, Math.abs(biasScore)) * 10) / 10;
    const biasDirection = biasScore > 0.5 ? 'bull' : biasScore < -0.5 ? 'bear' : 'neutral';
    const trendStatus = trendStatusFromScore(tfBiasScore);
    const dailyStats = MarketEngine.getDailyStats();
    const session = Sessions.getCurrentSession();
    const newsEvents = Sessions.getUpcomingHighImpactEvents();

    const analysis = {
      timestamp: Date.now(),
      price,
      atr: atrVal,
      dailyStats,
      mtf,
      tfBiasScore,
      trendStatus,
      ma,
      osc,
      levels,
      obFvg,
      biasScore,
      confluenceScore,
      biasDirection,
      priceNearLevel,
      session,
      newsEvents,
    };

    Storage.set(Storage.KEYS.LAST_ANALYSIS, analysis);
    return analysis;
  }

  return { runAnalysis, TF_LABELS };
})();
