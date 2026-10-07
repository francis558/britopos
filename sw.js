/* ============================================================
   SERVICE WORKER — POS Pro
   Estrategia:
   - Core (HTML, manifest, icon): cache-first
   - CDN (FontAwesome, JsBarcode, ZXing): stale-while-revalidate
   - Navegación: fallback a index.html si offline
   ============================================================ */

const CACHE_VERSION = 'pos-pro-v1.0.0';

// Recursos base (locales)
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',    // ← NUEVO
  './icon-512.png'
];

// Recursos CDN (se cachean al primer uso)
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js',
  'https://unpkg.com/@zxing/library@0.20.0/umd/index.min.js'
];

// ==================== INSTALL ====================
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);

      // 1) Cachear lo esencial
      try {
        await cache.addAll(CORE_ASSETS);
        console.log('[SW] Core assets cacheados');
      } catch (e) {
        console.warn('[SW] Error cacheando core:', e);
      }

      // 2) Intentar cachear CDN (si hay internet)
      await Promise.allSettled(
        CDN_ASSETS.map(async (url) => {
          try {
            const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
            if (res && (res.ok || res.type === 'opaque')) {
              await cache.put(url, res.clone());
              console.log('[SW] Cacheado:', url);
            }
          } catch (e) {
            console.warn('[SW] No se pudo cachear (offline?):', url);
          }
        })
      );

      await self.skipWaiting();
    })()
  );
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION)
          .map((k) => {
            console.log('[SW] Borrando caché antigua:', k);
            return caches.delete(k);
          })
      );
      await self.clients.claim();
    })()
  );
});

// ==================== FETCH ====================
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo GET
  if (req.method !== 'GET') return;

  // Ignorar esquemas no-http
  if (!req.url.startsWith('http')) return;

  // Ignorar extensiones del navegador
  if (req.url.startsWith('chrome-extension://')) return;

  const url = new URL(req.url);
  const isCDN =
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('unpkg.com');

  // ----- Estrategia para CDN: stale-while-revalidate -----
  if (isCDN) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) {
              const clone = res.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
            }
            return res;
          })
          .catch(() => cached);

        return cached || fetchPromise;
      })
    );
    return;
  }

  // ----- Estrategia para el resto: cache-first con fallback -----
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          // Cachear respuestas válidas del mismo origen
          if (res && res.ok && url.origin === self.location.origin) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          // Fallback para navegación offline
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Recurso no disponible offline', {
            status: 503,
            statusText: 'Offline',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
    })
  );
});

// ==================== MENSAJES ====================
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('[SW] POS Pro Service Worker cargado. Versión:', CACHE_VERSION);
