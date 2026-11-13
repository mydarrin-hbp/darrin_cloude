// cos-indicator.js
// Coșul site-ului, în antet (8 oct. 2026; pasul 11-C1, 3 nov. 2026).
//
// Un singur coș, pe server: /api/client/cos-multi (cos_multi_itemi), pentru
// contul conectat sau, pentru vizitator, prin tokenul `myd_guest_token`
// (localStorage). Acest fișier:
//   - pune iconița de coș în antet pe paginile care nu o au în marcaj
//     (înaintea butonului de cont sau la capătul rândului din <header>);
//     clicul duce la coș (mydarrin-cos.html), de unde se continuă la checkout;
//   - afișează numărul real de produse pe elementele `data-cos-numar`
//     (ascuns la 0);
//   - MDCos.adauga(configurare) — adaugă pe server (materialele direct, cu
//     cantitatea 1) și arată confirmarea cu MDFeedback.toast + „Vezi coșul”;
//   - la conectare, coșul de vizitator trece pe cont (POST { preia_sesiune }).
// Textele trec prin window.t (RO / EN, i18n/en.json → _texte).
(function () {
  'use strict';
  if (window.MDCos && window.MDCos.adauga) return;

  var PAGINA_COS = 'mydarrin-cos.html';
  var API = '/api/client/cos-multi';

  function tr(ro, param) {
    if (typeof window.t === 'function') return window.t(null, ro, param);
    return param ? String(ro).replace(/\{(\w+)\}/g, function (m, x) { return param[x] != null ? param[x] : m; }) : ro;
  }

  function tokenVizitator(creeaza) {
    try {
      var t = localStorage.getItem('myd_guest_token');
      if (!t && creeaza) {
        t = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
        localStorage.setItem('myd_guest_token', t);
      }
      return t;
    } catch (e) { return null; }
  }

  function sesiune() {
    // account-system.js creează clientul Supabase asincron; îi lăsăm o secundă.
    return new Promise(function (resolve) {
      var incercari = 0;
      (function asteapta() {
        if (window.supabaseClient && window.supabaseClient.auth) {
          window.supabaseClient.auth.getSession()
            .then(function (r) { resolve((r && r.data && r.data.session) || null); })
            .catch(function () { resolve(null); });
        } else if (incercari++ < 10) setTimeout(asteapta, 100);
        else resolve(null);
      })();
    });
  }

  // { headers, qs, token } pentru cererile spre coș (cont sau vizitator).
  function identitate(creeazaToken) {
    return sesiune().then(function (s) {
      if (s && s.access_token) return { headers: { Authorization: 'Bearer ' + s.access_token }, qs: '', cont: true };
      var t = tokenVizitator(creeazaToken);
      return { headers: {}, qs: t ? '?sesiune_token=' + encodeURIComponent(t) : null, token: t, cont: false };
    });
  }

  function afiseaza(n) {
    document.querySelectorAll('[data-cos-numar]').forEach(function (el) {
      el.textContent = n > 99 ? '99+' : String(n);
      el.style.display = n > 0 ? '' : 'none';
    });
    document.querySelectorAll('[data-cos-link]').forEach(function (a) {
      a.setAttribute('aria-label', n > 0 ? tr('Coșul tău: {n} produse', { n: n }) : tr('Coșul tău e gol'));
      a.setAttribute('title', tr('Coșul tău'));
    });
  }

  // ── Iconița din antet ────────────────────────────────────────────────
  function stil() {
    if (document.getElementById('mdcos-stil')) return;
    var s = document.createElement('style');
    s.id = 'mdcos-stil';
    s.textContent = '.mdcos-link{position:relative;display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;'
      + 'flex:none;border-radius:12px;color:inherit;text-decoration:none;transition:background .15s}'
      + '.mdcos-link:hover{background:rgba(0,51,102,.08)}.mdcos-link:focus-visible{outline:2px solid #FF8C00;outline-offset:2px}'
      + '.mdcos-link svg{width:21px;height:21px}'
      + '.mdcos-numar{position:absolute;top:1px;right:0;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#FF8C00;'
      + 'color:#fff;font-size:10px;font-weight:800;line-height:18px;text-align:center;box-sizing:border-box}';
    (document.head || document.documentElement).appendChild(s);
  }

  var SVG_COS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>';

  function butonCont(h) {
    var b = document.getElementById('header-account-btn');
    if (b && h.contains(b)) return b;
    return h.querySelector('button[onclick="toggleAuthModal()"]');
  }

  function puneInAntet() {
    if (document.querySelector('[data-cos-link]')) return;
    var h = document.querySelector('header');
    if (!h) return;
    stil();
    var a = document.createElement('a');
    a.href = PAGINA_COS;
    a.className = 'mdcos-link';
    a.setAttribute('data-cos-link', '');
    a.innerHTML = SVG_COS + '<span class="mdcos-numar" data-cos-numar style="display:none">0</span>';
    if (antetInchis(h)) a.style.color = '#fff';
    var reper = h.querySelector('[data-cos-loc]') || butonCont(h);
    if (reper) { reper.parentNode.insertBefore(a, reper); return; }
    // Rândul antetului (primul element flex cu cel puțin două elemente):
    // dacă ultimul lui element e grupul de acțiuni din dreapta, iconița intră
    // prima în grup; altfel stă înaintea ultimului element, împinsă la dreapta.
    var rand = randAntet(h);
    var ultim = rand.lastElementChild;
    if (ultim && ultim.children.length > 1 && getComputedStyle(ultim).display.indexOf('flex') !== -1) {
      ultim.insertBefore(a, ultim.firstChild);
    } else if (ultim && rand.children.length >= 2) {
      a.style.marginLeft = 'auto';
      rand.insertBefore(a, ultim);
    } else rand.appendChild(a);
  }

  function randAntet(h) {
    var coada = [h];
    while (coada.length) {
      var e = coada.shift();
      if (e.children.length >= 2 && getComputedStyle(e).display.indexOf('flex') !== -1) return e;
      for (var i = 0; i < e.children.length; i++) coada.push(e.children[i]);
    }
    return h;
  }

  // Antet închis la culoare (fundal cu luminanță mică) → iconița albă.
  function antetInchis(h) {
    var e = h;
    while (e && e.nodeType === 1) {
      var c = getComputedStyle(e).backgroundColor.match(/[\d.]+/g);
      if (c && (c.length < 4 || Number(c[3]) > 0.5)) return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) < 110;
      e = e.parentElement;
    }
    return false;
  }

  function actualizeaza() {
    return identitate(false).then(function (id) {
      if (!id.qs && !id.cont) { afiseaza(0); return 0; }
      return fetch(API + (id.cont ? '' : id.qs), { headers: id.headers })
        .then(function (r) { return r.json(); })
        .then(function (d) { var n = d && d.ok ? (d.itemi || []).length : 0; afiseaza(n); return n; })
        .catch(function () { afiseaza(0); return 0; });
    });
  }

  // ── Adăugarea în coș ─────────────────────────────────────────────────
  function incarcaFeedback() {
    if (window.MDFeedback) return Promise.resolve(window.MDFeedback);
    return new Promise(function (ok) {
      var s = document.createElement('script');
      s.src = '/ui-feedback.js';
      s.onload = function () { ok(window.MDFeedback || null); };
      s.onerror = function () { ok(null); };
      document.head.appendChild(s);
    });
  }

  function limbaEn() { return !!(window.MYD_I18N && window.MYD_I18N.lang && window.MYD_I18N.lang !== 'ro'); }
  function mesajEroare(d) {
    if (d && d.mesaj && typeof d.mesaj === 'object') return limbaEn() ? (d.mesaj.en || d.mesaj.ro) : d.mesaj.ro;
    if (d && d.error) return limbaEn() && d.error_en ? d.error_en : d.error;
    return tr('Nu am putut adăuga în coș. Încearcă din nou.');
  }

  // Trimite configurarea în coș. Întoarce { ok, item } sau { ok:false, raspuns }.
  // optiuni.tacut: fără toast (pagina își arată singură rezultatul).
  function adauga(configurare, optiuni) {
    optiuni = optiuni || {};
    return identitate(true).then(function (id) {
      var corp = { configurare: configurare };
      if (!id.cont) corp.sesiune_token = id.token;
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timp = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
      return fetch(API, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, id.headers),
        body: JSON.stringify(corp),
        signal: ctrl ? ctrl.signal : undefined,
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, d: d }; });
      }, function () { return { status: 0, d: { error: 'Nu am putut adăuga în coș: conexiunea a eșuat. Verifică internetul și încearcă din nou.', error_en: 'We could not add it to the basket: the connection failed. Check your internet connection and try again.' } }; })
        .then(function (x) {
          if (timp) clearTimeout(timp);
          var reusit = x.status === 200 && x.d && x.d.ok;
          if (reusit) actualizeaza();
          // Pasul 11-A1: doar tipul și slug-ul articolului, fără date personale.
          if (reusit && window.MYD_MASURARE) {
            window.MYD_MASURARE.eveniment('add_to_cart', { item_type: { serviciu: 'service', material: 'material', inchiriere: 'rental' }[configurare && configurare.tip] || 'other', item_slug: configurare && configurare.slug });
          }
          if (optiuni.tacut) return reusit ? { ok: true, item: x.d.item } : { ok: false, raspuns: x.d, status: x.status };
          return incarcaFeedback().then(function (F) {
            if (F) {
              if (reusit) F.toast('succes', tr('„{p}” a fost adăugat în coș.', { p: (x.d.item.configurare || {}).titlu || '' }), { actiune: { text: tr('Vezi coșul'), href: PAGINA_COS } });
              else F.toast('eroare', mesajEroare(x.d), optiuni.reincearca ? { reincearca: optiuni.reincearca } : {});
            }
            return reusit ? { ok: true, item: x.d.item } : { ok: false, raspuns: x.d, status: x.status };
          });
        });
    });
  }

  // ── Coșul de vizitator trece pe cont, după login sau creare de cont ──
  var preluareInCurs = false;
  function preiaCosVizitator(s) {
    var token = tokenVizitator(false);
    if (!token || !s || !s.access_token || preluareInCurs) return Promise.resolve(0);
    preluareInCurs = true;
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token },
      body: JSON.stringify({ preia_sesiune: token }),
    }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) { try { localStorage.removeItem('myd_guest_token'); } catch (e) { /* fără stocare */ } }
        return d && d.ok ? d.mutate : 0;
      })
      .catch(function () { return 0; })
      .then(function (n) { preluareInCurs = false; actualizeaza(); return n; });
  }

  function ascultaConectarea() {
    var incercari = 0;
    (function asteapta() {
      var c = window.supabaseClient;
      if (c && c.auth && typeof c.auth.onAuthStateChange === 'function') {
        c.auth.onAuthStateChange(function (ev, s) {
          if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION') { if (s) preiaCosVizitator(s); }
          if (ev === 'SIGNED_OUT') actualizeaza();
        });
        return;
      }
      if (incercari++ < 20) setTimeout(asteapta, 150);
    })();
  }

  window.MDCos = { actualizeaza: actualizeaza, adauga: adauga, preiaCosVizitator: preiaCosVizitator, identitate: identitate, PAGINA_COS: PAGINA_COS };

  function porneste() {
    puneInAntet();
    afiseaza(0);
    actualizeaza();
    ascultaConectarea();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', porneste);
  else porneste();
})();
