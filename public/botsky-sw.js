// BOT SKY: logo solo para notificaciones push.
// No cambia el icono de la aplicacion, el manifest ni la logica de pedidos.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = String(payload.title || 'BOT SKY');
  const opts = {
    body: String(payload.body || 'Tenés una notificación nueva.'),
    icon: '/botsky-ia-notification-192.png',
    badge: '/botsky-notification-badge.png',
    tag: String(payload.tag || 'botsky'),
    renotify: true,
    data: { url: String(payload.url || '/') },
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/', self.location.origin);
    if (target.origin !== self.location.origin) return;
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if (new URL(client.url).origin === target.origin) {
        await client.navigate(target.href);
        return client.focus();
      }
    }
    return clients.openWindow(target.href);
  })());
});
