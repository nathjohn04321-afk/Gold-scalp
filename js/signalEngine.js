/**
 * signalEngine.js — converts an AnalysisEngine read into a concrete trade
 * plan (direction, entry zone, SL, TP1/TP2, R:R, invalidation, alt
 * scenario) written in the voice of a professional institutional gold
 * trader: concise, probability-based, risk-first, no hype.
 */
const SignalEngine = (() => {

  const MIN_CONFLUENCE_TO_ACT = 2.5; // confluenceScore (0-10) below this => WAIT
  const SL_STRUCTURE_BUFFER = 0.2; // xATR beyond the structural level — tighter than before to cap risk per trade
  const DEFAULT_RISK_PCT = 1; // % of account risked per trade if the user hasn't set one
  const PARTIAL_AT_TP1_PCT = 50; // % of position closed at TP1; remainder rides risk-free to TP2
  // Hard safety net: a stop-loss derived from a support/resistance level
  // should never be allowed to sit further than this many ATRs from price
  // — e.g. a stale/bad level (see marketEngine.js staleness fix) can never
  // again produce a wildly-detached stop like $2000 next to a $4000 price.
  const MAX_SL_ATR_MULT = 4;

  /** Clamps a raw SL so its distance from price never exceeds MAX_SL_ATR_MULT x ATR. */
  function capStopDistance(price, rawSl, atr, isLong) {
    const maxDistance = atr * MAX_SL_ATR_MULT;
    const distance = Math.abs(price - rawSl);
    if (distance <= maxDistance) return rawSl;
    return isLong ? price - maxDistance : price + maxDistance;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function fmt(n) { return n === null || n === undefined || isNaN(n) ? '--' : `$${round2(n).toFixed(2)}`; }

  function getRiskSettings() {
    const settings = Storage.get(Storage.KEYS.SETTINGS, {});
    return {
      accountSize: settings.accountSize || null,
      riskPct: settings.riskPct || DEFAULT_RISK_PCT,
    };
  }

  /**
   * Position sizing is how you lower dollar risk WITHOUT touching the
   * entry/stop logic that determines whether a trade wins or loses — the
   * setup's win rate is untouched, only how much is riskable per trade.
   */
  function sizePosition(entryPrice, slPrice) {
    const { accountSize, riskPct } = getRiskSettings();
    const stopDistance = Math.abs(entryPrice - slPrice);
    if (!accountSize || stopDistance <= 0) return null;
    const riskAmount = accountSize * (riskPct / 100);
    const sizeOz = riskAmount / stopDistance;
    return { riskAmount, sizeOz, riskPct, accountSize };
  }

  function buildTradePlan(analysis) {
    const { price, atr, biasDirection, confluenceScore, levels } = analysis;
    const a = atr || price * 0.001;

    if (confluenceScore < MIN_CONFLUENCE_TO_ACT || biasDirection === 'neutral') {
      return {
        direction: 'WAIT', entry: null, sl: null, tp1: null, tp2: null, rr: null,
        invalidation: null, sizing: null, management: null,
      };
    }

    if (biasDirection === 'bull') {
      const entryLow = price - a * 0.25;
      const entryHigh = price + a * 0.1;
      const rawSl = (levels.support[0] ?? price - a * 1.4) - a * SL_STRUCTURE_BUFFER;
      const sl = capStopDistance(price, rawSl, a, true);
      const risk = price - sl;
      const tp1 = price + risk * 1.5;
      const tp2 = levels.resistance[0] ? Math.max(levels.resistance[0], price + risk * 2.2) : price + risk * 2.5;
      const rr = (tp1 - price) / risk;
      return {
        direction: 'BUY',
        entry: [entryLow, entryHigh],
        sl, tp1, tp2,
        rr,
        invalidation: sl,
        sizing: sizePosition(price, sl),
        management: `At TP1, take ${PARTIAL_AT_TP1_PCT}% off and move stop to breakeven ($${price.toFixed(2)}) on the remainder — the runner to TP2 then risks nothing already banked.`,
      };
    }

    // bear
    const entryLow = price - a * 0.1;
    const entryHigh = price + a * 0.25;
    const rawSl = (levels.resistance[0] ?? price + a * 1.4) + a * SL_STRUCTURE_BUFFER;
    const sl = capStopDistance(price, rawSl, a, false);
    const risk = sl - price;
    const tp1 = price - risk * 1.5;
    const tp2 = levels.support[0] ? Math.min(levels.support[0], price - risk * 2.2) : price - risk * 2.5;
    const rr = (price - tp1) / risk;
    return {
      direction: 'SELL',
      entry: [entryHigh, entryLow],
      sl, tp1, tp2,
      rr,
      invalidation: sl,
      sizing: sizePosition(price, sl),
      management: `At TP1, take ${PARTIAL_AT_TP1_PCT}% off and move stop to breakeven ($${price.toFixed(2)}) on the remainder — the runner to TP2 then risks nothing already banked.`,
    };
  }

  function buildNarrative(analysis, plan) {
    const { price, trendStatus, ma, osc, session, confluenceScore, biasDirection } = analysis;
    const dirWord = plan.direction; // gate narrative off the same threshold the trade plan used
    const sessionLabel = session.label;

    const lines = [];

    if (dirWord === 'WAIT') {
      lines.push(
        `Gold is trading at ${fmt(price)} into the ${sessionLabel.toLowerCase()}, and the setup does not clear our bar to act. ` +
        `Structure is ${trendStatus.label.toLowerCase()} with confluence at ${confluenceScore.toFixed(1)}/10 — below our threshold for a directional call.`
      );
      lines.push(
        `${ma.text} ${osc.rsiText}. ${osc.macdText}. Best approach here is patience: let price come to a level with confirmation rather than chasing chop.`
      );
    } else {
      const biasWord = biasDirection === 'bull' ? 'long' : 'short';
      lines.push(
        `${dirWord} bias on XAU/USD at ${fmt(price)} — ${trendStatus.label.toLowerCase()} conditions into the ${sessionLabel.toLowerCase()}, ` +
        `confluence ${confluenceScore.toFixed(1)}/10 in favor of the ${biasWord}.`
      );
      lines.push(`${ma.text}`);
      lines.push(`${osc.rsiText}. ${osc.macdText}. ${osc.stochText}.`);
      lines.push(
        biasDirection === 'bull'
          ? `Plan is to buy the dip into the entry zone rather than chase strength — risk is defined below the recent swing low structure.`
          : `Plan is to sell the rip into the entry zone rather than chase weakness — risk is defined above the recent swing high structure.`
      );
      if (plan.management) lines.push(plan.management);
      if (plan.sizing) {
        lines.push(
          `Sizing: risking ${plan.sizing.riskPct}% of a $${plan.sizing.accountSize.toLocaleString()} account ` +
          `(~$${plan.sizing.riskAmount.toFixed(2)}) works out to roughly ${plan.sizing.sizeOz.toFixed(3)} oz at this stop distance.`
        );
      }
    }

    return lines.join('\n\n');
  }

  function buildAltScenario(analysis, plan) {
    const { levels, price } = analysis;
    if (plan.direction === 'WAIT') {
      return `If price breaks and holds above ${fmt(levels.resistance[0])} with momentum, reassess for longs. ` +
        `If it breaks and holds below ${fmt(levels.support[0])}, reassess for shorts.`;
    }
    if (plan.direction === 'BUY') {
      return `If price fails to hold ${fmt(plan.invalidation)} on a closing basis, the bullish thesis is invalidated — stand aside and ` +
        `look for confirmation of a shift toward ${fmt(levels.support[1] ?? plan.sl - (analysis.atr || 5))} before considering shorts.`;
    }
    return `If price reclaims ${fmt(plan.invalidation)} on a closing basis, the bearish thesis is invalidated — stand aside and ` +
      `look for confirmation of a shift toward ${fmt(levels.resistance[1] ?? plan.sl + (analysis.atr || 5))} before considering longs.`;
  }

  function generateSignal(analysis) {
    const plan = buildTradePlan(analysis);
    const narrative = buildNarrative(analysis, plan);
    const altScenario = buildAltScenario(analysis, plan);
    const confidence = Math.round(Math.min(10, Math.max(1, analysis.confluenceScore)));

    const signal = {
      timestamp: Date.now(),
      price: analysis.price,
      direction: plan.direction,
      confidence,
      narrative,
      altScenario,
      plan,
    };

    Storage.set(Storage.KEYS.LAST_SIGNAL, signal);
    const history = Storage.get(Storage.KEYS.SIGNAL_HISTORY, []);
    history.unshift({
      timestamp: signal.timestamp,
      price: signal.price,
      direction: signal.direction,
      confidence: signal.confidence,
    });
    Storage.set(Storage.KEYS.SIGNAL_HISTORY, history.slice(0, 30));

    return signal;
  }

  return { generateSignal, fmt };
})();
