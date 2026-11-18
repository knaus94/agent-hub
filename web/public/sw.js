// Shows the hub's notifications and opens their chat when one is tapped. It does nothing else, no cache and no
// fetch handling, so the app always loads as the hub serves it.
const LEADS = { done: 'Агент закончил', failed: 'Ход завершился с ошибкой', ask: 'Ждёт ответа' };

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Every push shows a notification, even one that cannot be read: a browser may end a subscription that pushes
// silently.
self.addEventListener('push', (event) => {
   let message = {};
   try {
      message = event.data ? event.data.json() : {};
   } catch {
      message = {};
   }
   const lead = LEADS[message.kind] ?? 'Новое в чате';
   const body = message.kind === 'ask' && message.text ? `${lead}: ${message.text}` : lead;
   event.waitUntil(
      self.registration.showNotification(message.title || 'Agent Hub', {
         body,
         tag: message.sessionId,
         icon: '/icon-192.png',
         data: { sessionId: message.sessionId },
      }),
   );
});

self.addEventListener('notificationclick', (event) => {
   event.notification.close();
   const sessionId = event.notification.data?.sessionId;
   const hash = sessionId ? `#/s/${encodeURIComponent(sessionId)}` : '#/';
   event.waitUntil(
      (async () => {
         const [open] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
         if (!open) return self.clients.openWindow(`/${hash}`);
         open.postMessage({ type: 'open', hash });
         return open.focus();
      })(),
   );
});
