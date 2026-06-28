var CACHE_NAME = "clickcidade-20260628-ux-operacao-r3";
var APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/styles.css?v=20260628-ux-operacao-r3",
  "./assets/runtime-config.js?v=20260628-ux-operacao-r3",
  "./assets/app.js?v=20260628-ux-operacao-r3",
  "./assets/clickcidade-logo.png",
  "./assets/clickcidade-mobile-logo.png",
  "./assets/clickcidade-app-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== CACHE_NAME;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") { return; }
  var requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) { return; }

  event.respondWith(
    fetch(event.request).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, copy);
        });
      }
      return response;
    }).catch(function () {
      return caches.match(event.request).then(function (cached) {
        if (cached) { return cached; }
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
        throw new Error("Recurso indisponível sem conexão.");
      });
    })
  );
});
