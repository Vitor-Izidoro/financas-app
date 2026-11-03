/* Service worker: guarda o app em cache para funcionar offline.
   Estratégia: responde do cache e atualiza em segundo plano (a versão nova aparece na próxima abertura).
   Ao publicar mudanças, aumente VERSAO. */
const VERSAO = 'financas-v2';
const ARQUIVOS = [
  './', './index.html', './style.css', './app.js', './manifest.json',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k !== VERSAO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSAO).then(async cache => {
      const emCache = await cache.match(req, { ignoreSearch: true });
      const daRede = fetch(req).then(resp => {
        if (resp && resp.ok) cache.put(req, resp.clone());
        return resp;
      }).catch(() => null);
      if (emCache) { e.waitUntil(daRede); return emCache; }
      const resp = await daRede;
      if (resp) return resp;
      if (req.mode === 'navigate') return cache.match('./index.html');
      return new Response('', { status: 504, statusText: 'Offline' });
    })
  );
});
