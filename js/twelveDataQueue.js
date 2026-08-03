/**
 * twelveDataQueue.js — serializes every Twelve Data API call app-wide.
 *
 * Twelve Data's free ("Basic") plan rejects concurrent/parallel requests —
 * firing multiple calls at once (e.g. the 4 timeframe candle fetches in
 * realCandles.js, or a candle fetch overlapping the price-tick fetch in
 * priceFeed.js) intermittently comes back with a rate-limit/parallel-
 * request error even when well under the daily quota. Routing every
 * Twelve Data call through this single queue guarantees only one is ever
 * in flight, with a small gap after each, regardless of which module
 * (priceFeed.js, realCandles.js) or which concurrent code path
 * (app.js's Promise.all of price + candle refresh) triggered it.
 */
const TwelveDataQueue = (() => {
  const MIN_GAP_MS = 350; // stays comfortably under free-tier per-minute credit limits
  let chain = Promise.resolve();

  function run(taskFn) {
    const result = chain.then(async () => {
      const value = await taskFn();
      await new Promise(resolve => setTimeout(resolve, MIN_GAP_MS));
      return value;
    });
    // Keep the queue moving even if a task throws — store a caught copy so
    // one failed call doesn't wedge every call queued behind it, while the
    // real result/rejection still propagates to whoever called run().
    chain = result.catch(() => {});
    return result;
  }

  return { run };
})();
