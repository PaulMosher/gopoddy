/* =======================================================================
   Go Poddy — Lead Capture : service worker

   Purpose: the app must open when the convention centre wifi dies.
   It caches its own eight files on install and serves them from cache
   thereafter, so launching from the home-screen icon never touches
   the network.

   Scope note: this file is served from /leads/, so its reach is limited
   to /leads/. It can never intercept a request for the marketing site
   at the root of gopoddy.com. That is deliberate and it is the reason
   the app lives in a subfolder.

   Lead data is NOT here. Leads live in IndexedDB, which this worker
   never touches. Clearing a cache cannot lose a lead.
   ======================================================================= */
"use strict";

/* Bump this string to force every phone to re-download the shell on its
   next launch. Nothing else needs changing to ship an update. */
const CACHE = "gpleads-shell-v1.1-2026-08-12";

/* Relative paths, so the folder can be renamed or hosted elsewhere
   without editing this list. "./" is the app itself. */
const SHELL = [
  "./",
  "index.html",
  "manifest.json",
  "logo.png",
  "mark-white.png",
  "icon-192.png",
  "icon-512.png",
  "icon-512-maskable.png"
];

/* ---------------- install: pull the shell down ------------------------- */
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      /* Individually, not addAll — addAll rejects the whole batch if any
         single file 404s, which would leave the app with no offline
         capability at all because one icon was misnamed. */
      .then(cache => Promise.all(
        SHELL.map(url =>
          cache.add(new Request(url, {cache: "reload"}))
            .catch(err => { console.warn("[sw] could not cache", url, err); })
        )
      ))
      .then(() => self.skipWaiting())
  );
});

/* ---------------- activate: drop older shells ------------------------- */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith("gpleads-shell-") && k !== CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------------- fetch: cache first, refresh quietly ------------------
   Cache first, because at a booth a fast reliable launch matters more
   than being one version current. A background refresh means a pushed
   fix lands on the launch after next, not never.
   ---------------------------------------------------------------------- */
self.addEventListener("fetch", event => {
  const req = event.request;

  /* Leave everything that isn't a plain same-origin GET alone. */
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  /* Only our own folder. Anything else on gopoddy.com goes straight
     to the network as if this worker did not exist. */
  const scope = new URL("./", self.location.href).pathname;
  if (url.pathname.indexOf(scope) !== 0) return;

  event.respondWith(
    caches.match(req, {ignoreSearch: true}).then(hit => {
      const fresh = fetch(req).then(res => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      });

      if (hit) {
        /* Serve the cached copy now; let the refresh finish on its own.
           The catch keeps an offline failure from surfacing as an error. */
        fresh.catch(() => {});
        return hit;
      }

      /* Nothing cached. Try the network; if that fails and this was a
         page load, fall back to the app shell so the icon still opens. */
      return fresh.catch(() => {
        if (req.mode === "navigate") return caches.match("index.html");
        return new Response("", {status: 504, statusText: "Offline"});
      });
    })
  );
});
