// Cloudflare Pages Function — backs the app's window.storage calls with a real
// Cloudflare KV namespace, since window.storage only exists inside Claude.ai's
// own artifact preview and does not exist at all on Cloudflare (or anywhere
// else outside claude.ai). Without this file, every single storage.get/set/
// delete call in index.html was failing every time it ran — that is the real
// reason test series, folders, directory, etc. were "disappearing": there was
// no backend for them to be saved to at all, on any connection speed.
//
// SETUP (one-time, in the Cloudflare dashboard):
//   1. Workers & Pages -> your Pages project -> Settings -> Functions
//      -> KV namespace bindings -> Add binding
//   2. Variable name:  STORAGE_KV
//   3. KV namespace:   create a new one (e.g. "abhyaas-manch-storage")
//   4. Save, then redeploy (or it applies on the next deploy).
//
// This file must sit at:  functions/api/storage.js
// (same repo/folder you deploy index.html from — Cloudflare Pages auto-detects
// anything under a top-level "functions" folder as an API route.)

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json' },
  });
}

function fullKey(key, sharedParam) {
  const isShared = sharedParam === 'true' || sharedParam === true;
  return (isShared ? 'shared:' : 'user:') + key;
}

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.STORAGE_KV;

  if (!kv) {
    return json(
      { error: 'STORAGE_KV binding not configured. See setup steps in functions/api/storage.js' },
      500
    );
  }

  const url = new URL(request.url);
  const method = request.method;

  try {
    if (method === 'GET') {
      if (url.searchParams.get('list')) {
        const prefix = url.searchParams.get('prefix') || '';
        const sharedParam = url.searchParams.get('shared');
        const isShared = sharedParam === 'true';
        const fullPrefix = (isShared ? 'shared:' : 'user:') + prefix;
        const listRes = await kv.list({ prefix: fullPrefix });
        const keys = listRes.keys.map((k) => k.name.replace(/^shared:|^user:/, ''));
        return json({ keys, prefix, shared: isShared });
      }

      const key = url.searchParams.get('key');
      const sharedParam = url.searchParams.get('shared');
      if (!key) return json({ error: 'key is required' }, 400);

      const value = await kv.get(fullKey(key, sharedParam));
      if (value === null) return json(null);
      return json({ key, value, shared: sharedParam === 'true' });
    }

    if (method === 'POST' || method === 'PUT') {
      const body = await request.json();
      const { key, value, shared } = body || {};
      if (!key) return json({ error: 'key is required' }, 400);

      await kv.put(fullKey(key, shared), typeof value === 'string' ? value : JSON.stringify(value));
      return json({ key, value, shared: !!shared });
    }

    if (method === 'DELETE') {
      const key = url.searchParams.get('key');
      const sharedParam = url.searchParams.get('shared');
      if (!key) return json({ error: 'key is required' }, 400);

      await kv.delete(fullKey(key, sharedParam));
      return json({ key, deleted: true, shared: sharedParam === 'true' });
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
