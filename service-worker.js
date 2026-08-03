const CACHE_NAME = "registrepro-cache-v110";
const PAGE = "./index.html";
const ASSETS = [PAGE, "./manifest.json", "./icon-192.png", "./icon-512.png"];

// Combien de temps on accepte d'attendre le réseau avant d'ouvrir le tiroir.
// Assez pour une 4G correcte, assez court pour ne jamais bloquer un commerçant
// qui ouvre son registre trente fois par jour.
const DELAI_RESEAU = 3000;

/* ════════════════════════════════════════════════════════════════
   POURQUOI CE FICHIER A ÉTÉ REFAIT (v107)

   L'ancienne version lisait TOUJOURS la copie gardée sur le téléphone,
   sans jamais vérifier s'il en existait une plus récente en ligne.
   L'application installée restait donc bloquée sur du vieux code,
   pendant que le même lien ouvert dans Chrome affichait la version à jour.
   Des corrections livrées n'arrivaient jamais jusqu'à l'appareil.

   Trois défauts corrigés ici :
   1. On demande d'abord la version en ligne — mais on ne l'attend que 3 s.
      Réseau lent ou coupé : la copie s'ouvre aussitôt, aucune attente.
   2. La copie se refaisait à partir du cache du navigateur, donc parfois
      à partir d'un fichier déjà périmé. On force un vrai téléchargement.
   3. Les appels au serveur de données passaient par ici, et en cas de
      coupure recevaient la page d'accueil à la place de leur réponse.
      On ne s'occupe désormais que des fichiers de l'application.
════════════════════════════════════════════════════════════════ */

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Un par un, et non addAll : si un seul fichier manque, l'installation
      // entière échouerait et l'application resterait sur l'ancienne version.
      Promise.all(
        ASSETS.map((url) =>
          fetch(new Request(url, { cache: "reload" }))
            .then((res) => (res && res.ok ? cache.put(url, res) : null))
            .catch(() => null)
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// La page de l'application, quelle que soit la façon dont on l'ouvre.
// L'application installée démarre sur ".../index.html", Chrome sur ".../".
// Les deux doivent recevoir exactement le même fichier — c'est leur
// différence qui faisait diverger les deux versions.
function estLaPage(request) {
  if (request.mode === "navigate") return true;
  const chemin = new URL(request.url).pathname;
  return chemin.endsWith("/") || chemin.endsWith("/index.html");
}

async function servirLaPage(event) {
  const cache = await caches.open(CACHE_NAME);

  // Vrai téléchargement, sans passer par le cache du navigateur.
  const enLigne = fetch(new Request(PAGE, { cache: "reload" })).then((res) => {
    if (res && res.ok) cache.put(PAGE, res.clone());
    return res;
  });

  // On garde le service worker en vie le temps que la copie se mette à jour,
  // même si on a déjà répondu avec l'ancienne.
  event.waitUntil(enLigne.catch(() => null));

  const chrono = new Promise((resolve) => setTimeout(() => resolve(null), DELAI_RESEAU));
  const premier = await Promise.race([enLigne.catch(() => null), chrono]);
  if (premier && premier.ok) return premier;

  const copie = await cache.match(PAGE);
  if (copie) return copie;

  // Ni réseau rapide, ni copie : c'est la toute première ouverture,
  // on attend le réseau jusqu'au bout plutôt que d'afficher une page vide.
  try {
    const tardif = await enLigne;
    if (tardif && tardif.ok) return tardif;
  } catch (e) {}
  return new Response("", { status: 504, statusText: "hors ligne" });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Tout ce qui ne vient pas de l'application — au premier rang le serveur de
  // données — passe directement au réseau, sans jamais recevoir la page
  // d'accueil en guise de réponse.
  if (new URL(req.url).origin !== self.location.origin) return;

  if (estLaPage(req)) {
    event.respondWith(servirLaPage(event));
    return;
  }

  event.respondWith(caches.match(req).then((copie) => copie || fetch(req)));
});
