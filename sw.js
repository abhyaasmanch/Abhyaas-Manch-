/* Abhyaas Manch service worker
   - Makes the site installable (Add to Home Screen / PWA install prompt)
   - Handles push events so admin broadcasts show up as real notifications
     in the phone's system notification bar (not inside the app)

   NOTE: if you already had a sw.js with caching logic, merge that in below —
   this version focuses only on install-ability + push, since the original
   file wasn't provided to me for merging. */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Just pass requests straight through to the network — no offline caching here.
self.addEventListener('fetch', (event) => {});

self.addEventListener('push', (event) => {
  let data = {};
  try{ data = event.data ? event.data.json() : {}; }
  catch(e){ data = { title: 'Abhyaas Manch', body: event.data ? event.data.text() : '' }; }

  // Only one notification should ever sit in the tray at a time. Using the
  // same tag for every notice means a new push replaces the old one instead
  // of stacking, and an "action: close" push (sent when admin deletes the
  // notice) removes it entirely.
  if(data.action === 'close'){
    event.waitUntil(
      self.registration.getNotifications({ tag: 'am-notice' }).then(list => {
        list.forEach(n => n.close());
      })
    );
    return;
  }

  const title = data.title || 'Abhyaas Manch';
  const options = {
    body: data.body || '',
    tag: 'am-notice',
    renotify: true,
    icon: '/apple-touch-icon.png',
    badge: '/favicon-32.png',
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
