var CACHE = "mirage-v2";
var FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Только свои файлы: запросы цен (CoinGecko/Binance) всегда идут напрямую в сеть
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      var net = fetch(e.request).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});

// Системные уведомления: клик открывает приложение
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(function (l) {
    return l.length ? l[0].focus() : self.clients.openWindow("./");
  }));
});

// Задел под настоящий серверный push (когда появится бэкенд)
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data.json(); } catch (x) {}
  e.waitUntil(self.registration.showNotification(d.title || "Mirage", { body: d.body || "", icon: "icon-192.png" }));
});
