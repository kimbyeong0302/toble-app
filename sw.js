// 토블 서비스 워커 — 오프라인에서도 앱이 열리도록 핵심 파일을 캐시합니다.
// 버전을 올리면(예: v2, v3) 이전 캐시를 지우고 새 파일로 교체됩니다.
const CACHE_NAME = 'toble-cache-v81';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 전략: 캐시 우선, 없으면 네트워크로 가져와서 캐시에 저장 (지도 타일처럼 외부 리소스는 그대로 통과)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // 외부 리소스는 서비스워커가 손대지 않음
  if (url.pathname.endsWith('/admin.html')) return; // 관리자 페이지는 항상 최신 버전을 네트워크에서 받아온다

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => cached);
    })
  );
});
