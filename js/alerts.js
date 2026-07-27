/**
 * alerts.js — user-defined price alerts (level + direction), persisted in
 * localStorage, checked against every live price tick.
 */
const Alerts = (() => {

  function getActive() {
    return Storage.get(Storage.KEYS.ALERTS, []);
  }

  function getTriggered() {
    return Storage.get(Storage.KEYS.TRIGGERED, []);
  }

  function add({ price, direction, note }) {
    const alerts = getActive();
    alerts.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      price,
      direction, // 'above' | 'below'
      note: note || '',
      createdAt: Date.now(),
    });
    Storage.set(Storage.KEYS.ALERTS, alerts);
    return alerts;
  }

  function remove(id) {
    const alerts = getActive().filter(a => a.id !== id);
    Storage.set(Storage.KEYS.ALERTS, alerts);
    return alerts;
  }

  /** Checks live price against active alerts; fires callback per newly-triggered alert. */
  function checkPrice(livePrice, onTrigger) {
    const alerts = getActive();
    if (!alerts.length) return;

    const stillActive = [];
    const triggeredLog = getTriggered();
    let changed = false;

    alerts.forEach(alert => {
      const hit = alert.direction === 'above' ? livePrice >= alert.price : livePrice <= alert.price;
      if (hit) {
        changed = true;
        triggeredLog.unshift({ ...alert, triggeredAt: Date.now(), triggeredPrice: livePrice });
        if (typeof onTrigger === 'function') onTrigger(alert, livePrice);
      } else {
        stillActive.push(alert);
      }
    });

    if (changed) {
      Storage.set(Storage.KEYS.ALERTS, stillActive);
      Storage.set(Storage.KEYS.TRIGGERED, triggeredLog.slice(0, 30));
    }
  }

  return { getActive, getTriggered, add, remove, checkPrice };
})();
