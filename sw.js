/* Service worker: guarda o app em cache para funcionar offline.
   Estratégia: REDE PRIMEIRO — com internet, sempre busca a versão mais nova do servidor
   (ignorando o cache HTTP do navegador); sem internet (ou rede lenta), usa a cópia guardada.
   Ao publicar mudanças, aumente VERSAO (e VERSAO_APP em app.js). */
const VERSAO = 'financas-v3';
const ARQUIVOS = [
  './', './index.html', './style.css', './app.js', './manifest.json',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
];
const ESPERA_REDE_MS = 4000;

self.addEventListener('install', e => {
  // cache: 'reload' evita pegar arquivos velhos do cache HTTP do navegador
  e.waitUntil(
    caches.open(VERSAO)
      .then(c => c.addAll(ARQUIVOS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k !== VERSAO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function comTempoLimite(promessa, ms) {
  return new Promise((ok, falha) => {
    const t = setTimeout(() => falha(new Error('tempo esgotado')), ms);
    promessa.then(v => { clearTimeout(t); ok(v); }, err => { clearTimeout(t); falha(err); });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  const daRede = fetch(req, { cache: 'no-cache' }).then(async resp => {
    if (resp && resp.ok) {
      const cache = await caches.open(VERSAO);
      await cache.put(req, resp.clone());
    }
    return resp;
  });
  e.waitUntil(daRede.catch(() => {}));

  e.respondWith(
    comTempoLimite(daRede, ESPERA_REDE_MS).catch(async () => {
      const cache = await caches.open(VERSAO);
      const guardado = await cache.match(req, { ignoreSearch: true })
        || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
      if (guardado) return guardado;
      return daRede.catch(() => new Response('', { status: 504, statusText: 'Offline' }));
    })
  );
});
