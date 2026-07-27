// functions/api/send-notification.js
//
// Sends a real push notification (shows in the phone's system notification
// bar, not inside the app) to every device that has subscribed. Subscriptions
// are collected client-side in index.html (setupPushNotifications) and stored
// under the shared key "push-subs" via the same /api/storage endpoint the
// rest of the app already uses — that's why this function calls /api/storage
// over HTTP instead of touching KV directly: it works no matter what your KV
// binding is named.
//
// ---------------------------------------------------------------------------
// ONE-TIME SETUP REQUIRED:
//
// 1) Install the web-push library in your project (next to package.json):
//      npm install web-push
//
// 2) In Cloudflare Pages → your project → Settings → Environment variables,
//    add these three (Production, and Preview if you use it):
//      VAPID_PUBLIC_KEY  = BJq93VjSTUjF_tzbiDRACC1JicxhT0CUe9EA1kEvCQmpqFAd4Fdrq8h6QzKCOYlnt0vL0cGEuhTX8NFKSOu_n5U
//      VAPID_PRIVATE_KEY = jNMHYqDEA5TH5L0hE8jcZPJFN0Crcse7HzyX6ECIrW0
//      VAPID_SUBJECT     = mailto:youremail@example.com   (any contact email)
//
//    These two keys are a matched pair I generated for you — the public one
//    is already wired into index.html's PUSH_PUBLIC_KEY constant, so it will
//    work as-is. If you'd rather generate your own pair (recommended once
//    you're comfortable with the setup), run `npx web-push generate-vapid-keys`
//    and then update BOTH the env vars here AND the PUSH_PUBLIC_KEY constant
//    near the bottom of index.html to match — they must be the same pair.
//
// 3) Redeploy. Existing logged-in students will pick up a subscription the
//    next time they open the app (it happens automatically in the background).
// ---------------------------------------------------------------------------

import webpush from 'web-push';

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid JSON body' }, 400); }

  const { title, message, action, mobile } = body || {};
  if (action !== 'close' && (!title || !message)) {
    return json({ ok: false, error: 'title and message are required' }, 400);
  }

  const origin = new URL(request.url).origin;

  // Fetch subscriptions via the app's own storage endpoint.
  let subs = [];
  try {
    const subsRes = await fetch(`${origin}/api/storage?key=push-subs&shared=true`);
    if (subsRes.ok) {
      const data = await subsRes.json();
      if (data && data.value) subs = JSON.parse(data.value);
    }
  } catch (e) { /* leave subs empty */ }

  if (!Array.isArray(subs)) subs = [];

  // If a mobile number is given, only push to that one student's device(s)
  // instead of broadcasting to everyone. Devices are tagged with the mobile
  // number of whoever was logged in when they subscribed (see
  // setupPushNotifications in index.html) — older subscriptions saved before
  // that tagging existed won't have a mobile and won't match a targeted send.
  const targetSubs = mobile ? subs.filter(s => s.mobile === mobile) : subs;

  if (targetSubs.length === 0) {
    return json({
      ok: true,
      sent: 0,
      note: mobile
        ? 'This student has no subscribed device yet (they need to open the app and allow notifications at least once).'
        : 'No subscribed devices yet.'
    });
  }

  const vapidPublic = env.VAPID_PUBLIC_KEY;
  const vapidPrivate = env.VAPID_PRIVATE_KEY;
  const vapidSubject = env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!vapidPublic || !vapidPrivate) {
    return json({ ok: false, error: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set in your Cloudflare Pages environment variables — see the setup comment at the top of this file.' }, 500);
  }
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const payload = JSON.stringify(
    action === 'close' ? { action: 'close' } : { title, body: message, url: '/' }
  );

  let sent = 0, failed = 0;
  const deadEndpoints = new Set();
  await Promise.all(targetSubs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (err) {
      failed++;
      // 404/410 = the subscription is dead (uninstalled, permissions revoked, etc.) — drop it.
      // Anything else might be a transient network error, so keep it and retry next time.
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        deadEndpoints.add(sub.endpoint);
      }
    }
  }));
  const stillValid = subs.filter(s => !deadEndpoints.has(s.endpoint));

  // Prune dead subscriptions so the list doesn't grow forever.
  if (stillValid.length !== subs.length) {
    try {
      await fetch(`${origin}/api/storage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'push-subs', value: JSON.stringify(stillValid), shared: true })
      });
    } catch (e) { /* non-fatal */ }
  }

  return json({ ok: true, sent, failed });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json' } });
}
