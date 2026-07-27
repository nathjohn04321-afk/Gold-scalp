/**
 * notifications.js — local notification wrapper.
 *
 * HONEST SCOPE NOTE: This is a pure client-side PWA with no backend, so it
 * can only show *local* notifications while the browser/service worker is
 * alive (tab open, or recently backgrounded on platforms that keep the SW
 * warm). True "push while fully closed" notifications require a server
 * that holds a Web Push subscription and calls the Push API with VAPID
 * keys — see README.md → "Optional Backend for True Push Notifications"
 * for a minimal Node/Express + web-push recipe.
 */
const Notifications = (() => {

  function isSupported() {
    return 'Notification' in window;
  }

  function permission() {
    return isSupported() ? Notification.permission : 'unsupported';
  }

  async function requestPermission() {
    if (!isSupported()) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    try {
      return await Notification.requestPermission();
    } catch (e) {
      return 'denied';
    }
  }

  async function notify(title, options = {}) {
    if (!isSupported() || Notification.permission !== 'granted') return false;
    const opts = {
      body: options.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: options.tag || 'golddesk',
      renotify: !!options.tag,
      data: options.data || {},
    };
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, opts);
      } else {
        new Notification(title, opts);
      }
      return true;
    } catch (e) {
      console.warn('Notification failed', e);
      return false;
    }
  }

  return { isSupported, permission, requestPermission, notify };
})();
