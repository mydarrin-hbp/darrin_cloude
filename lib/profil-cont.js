/* lib/profil-cont.js — pasul 11-I3 (16 nov. 2026)

   Profilul contului (/api/cont/profil), o singură cerere pe pagină.
   Scripturile paginii (cont-dashboard.js, ui-comun.js, cta-partener.js,
   cta-investitor.js) îl cereau fiecare separat: 3–4 cereri identice la
   deschiderea unei pagini de cont. Acum trec toate prin window.MYD_PROFIL:
     cere(token)        — aceeași cerere cât e în curs și rezultatul ei încă 10 s;
     cere(token, true)  — cere din nou (după o salvare);
     devreme()          — cererea pornită la încărcare cu tokenul din cookie
                          (vezi mai jos) sau null;
     salveazaLimba(l)   — limba aleasă din selector ('ro' / 'en') se salvează
                          pe cont (PATCH /api/cont/profil, profiles.limba), cu
                          keepalive: cererea se termină și după reîncărcarea
                          paginii în noua limbă. Fără sesiune: nimic.
   fiecare apelant primește o copie a corpului ({ status, ok, corp }).

   Pornirea devreme: scriptul e clasic și se încarcă înaintea clientului
   Supabase (modul, încărcat la sfârșitul paginii). Dacă sesiunea salvată în
   cookie (lib/supabaseClient.js: sb-<ref>-auth-token.0, .1, …) are un
   access_token încă valabil, cererea pleacă imediat, fără să aștepte clientul.
   Accesul îl decide tot serverul (requireAuth); un token expirat nu se
   folosește aici — clientul Supabase îl reîmprospătează, apoi cererea se face
   cu tokenul nou. Tokenul nu se scrie nicăieri.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MYD_PROFIL) return;

  var VALABIL_MS = 10000;
  var cache = null;

  function copie(r) {
    return { status: r.status, ok: r.ok, corp: r.corp == null ? r.corp : JSON.parse(JSON.stringify(r.corp)) };
  }

  function cere(token, reincarca) {
    var c = cache;
    if (!reincarca && c && c.token === token && (c.inCurs || Date.now() - c.la < VALABIL_MS)) return c.p.then(copie);
    var nou = { token: token, inCurs: true, la: 0 };
    nou.p = fetch('/api/cont/profil', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (corp) { return { status: res.status, ok: res.ok, corp: corp }; });
      });
    cache = nou;
    nou.p.then(function () { nou.inCurs = false; nou.la = Date.now(); }, function () { if (cache === nou) cache = null; });
    return nou.p.then(copie);
  }

  // access_token-ul din cookie-ul sesiunii, dacă mai e valabil cel puțin 30 s.
  function tokenDinCookie() {
    try {
      var toate = document.cookie || '';
      var m = toate.match(/(?:^|;\s*)(sb-[a-z0-9]+-auth-token)\.0=/);
      if (!m) return null;
      var nume = m[1], brut = '';
      for (var i = 0; i < 50; i++) {
        var b = toate.match(new RegExp('(?:^|;\\s*)' + nume.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '\\.' + i + '=([^;]*)'));
        if (!b) break;
        brut += b[1];
      }
      var s = JSON.parse(decodeURIComponent(brut));
      var token = s && s.access_token;
      if (typeof token !== 'string') return null;
      var exp = Number(s.expires_at) * 1000;
      if (!exp || exp - Date.now() < 30000) return null;
      return token;
    } catch (e) {
      return null;
    }
  }

  var t = tokenDinCookie();
  if (t) cere(t).catch(function () {});

  // Tokenul sesiunii: din clientul Supabase, dacă e încărcat (reîmprospătat),
  // altfel din cookie (încă valabil).
  function tokenSesiune() {
    var c = window.supabaseClient;
    if (c && c.auth && typeof c.auth.getSession === 'function') {
      return c.auth.getSession().then(function (r) { var s = r && r.data && r.data.session; return (s && s.access_token) || tokenDinCookie(); }).catch(tokenDinCookie);
    }
    return Promise.resolve(tokenDinCookie());
  }
  function salveazaLimba(limba) {
    if (limba !== 'ro' && limba !== 'en') return Promise.resolve(false);
    return tokenSesiune().then(function (token) {
      if (!token) return false;
      try {
        fetch('/api/cont/profil', {
          method: 'PATCH', keepalive: true, cache: 'no-store',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ limba: limba }),
        }).catch(function () {});
      } catch (e) { return false; }
      cache = null; // profilul de după schimbare se cere din nou
      return true;
    }).catch(function () { return false; });
  }

  window.MYD_PROFIL = {
    cere: cere,
    devreme: function () { return t ? cere(t) : null; },
    salveazaLimba: salveazaLimba,
  };
})();
