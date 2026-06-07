// ============================================================
//  Anestesia Vet – Service Worker  v1.0
//  Estrategia: Cache-first para assets, Network-first para datos
// ============================================================

const CACHE_NAME = 'anestesia-vet-v1';
const CACHE_STATIC = 'anestesia-vet-static-v1';

// Assets que se cachean en la instalación
const STATIC_ASSETS = [
  './',
  './index.html',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
];

// ---- INSTALACIÓN: pre-cachear assets estáticos ----
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      // Cachear uno por uno para no fallar todo si uno falla
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] No se pudo cachear:', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ---- ACTIVACIÓN: limpiar caches viejos ----
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ---- FETCH: estrategia híbrida ----
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase / Google APIs → siempre red (no cachear datos)
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('google') ||
    url.hostname.includes('script.google.com')
  ) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Si falla, no hay respuesta de fallback para API calls
        return new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Assets estáticos → Cache-first, luego red
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // Solo cachear respuestas válidas
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_STATIC).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // Fallback: si es una navegación, devolver index.html cacheado
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ---- SYNC EN BACKGROUND: sincronizar fichas pendientes ----
self.addEventListener('sync', event => {
  if (event.tag === 'sync-fichas') {
    event.waitUntil(syncFichasPendientes());
  }
});

async function syncFichasPendientes() {
  // Notificar a los clientes que intenten sincronizar
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_PENDING' });
  });
}

// ---- MENSAJES desde la app ----
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
