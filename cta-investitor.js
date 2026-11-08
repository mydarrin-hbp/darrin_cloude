/* ════════════════════════════════════════════════════════════════
   MY DARRIN — cta-investitor.js, pasul 11-R3h (decizia LM, 3 nov. 2026)

   Pagina Investitori „după parcurs” (varianta B). Un singur loc pentru:
     - butonul principal (hero, banda de contact, bara fixă de pe telefon:
       [data-cta-investitor]), după starea contului;
     - „Parcursul tău de investitor” (7 segmente, [data-inv-parcurs]);
     - insigna „Runda curentă: …” (doar cu o rundă publică);
     - meniul de secțiuni (fix sub antet, secțiunea curentă marcată);
     - „Panoul meu” (#panou) doar pentru rolul `investor`;
     - ancorele vechi: #ghid-investitor → #cum-functioneaza, #kpis → #panou
       (investitor) sau #cum-functioneaza;
     - elementele .reveal din ecran devin vizibile imediat (la încărcare,
       după un salt la ancoră, la hashchange) — fără ecran gol.

   Logica modulului Investitori NU se schimbă: starea se citește din ce
   există (sesiunea, profiles.roles din /api/cont/profil, GET
   /api/investitori/kyc, GET /api/investitori/portofoliu doar pentru rolul
   `investor`, /api/public/runda-curenta), iar acțiunile folosesc funcțiile
   existente: MYD_INVESTITOR.deschideRuta / start și openRunda.

     stare        text                                   acțiune
     vizitator    Devino investitor →                    fereastra de cont pe pagină; după cont /
                                                         cod / login, revenirea în ruta de investitor
                                                         (myd_revenire_dupa_login → ?ruta=investitor)
     fara_dosar   Începe dosarul →                       deschideRuta(…), pasul 1
     ciorna       Continuă dosarul (pasul N) →           deschideRuta(…), la pasul N salvat pe server
     respins      Corectează dosarul →                   deschideRuta(…, pasul de corectat); motivul sub buton
     verificare   Dosarul tău e în verificare            #panou
     runda        Intră în rundă →                       openRunda; cu dosarul în verificare, nota de sub buton
     panou        Mergi la panoul tău →                  #panou
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MYD_CTA_INVESTITOR) return;

  var RUTA = '/mydarrin-investitori.html?ruta=investitor';
  var CHEIE_REVENIRE = 'myd_revenire_dupa_login';
  var TEXT = {
    vizitator: 'Devino investitor',
    fara_dosar: 'Începe dosarul',
    ciorna: 'Continuă dosarul (pasul {n})',
    respins: 'Corectează dosarul',
    verificare: 'Dosarul tău e în verificare',
    runda: 'Intră în rundă',
    panou: 'Mergi la panoul tău',
  };
  var FARA_SAGEATA = { verificare: true };
  // Segmentele parcursului; primele 5 sunt pașii ferestrei (investitori-ruta.js).
  var SEGMENTE = ['date', 'identitate', 'risc', 'fiscal', 'trimitere', 'verificare', 'subscriere'];
  // Pasul de corectat la un dosar respins, după ce lipsește (lib/investitori-kyc.js, cerinteLipsa).
  var PAS_LIPSA = {
    date_personale: 1, data_nasterii: 1, cetatenie: 1, adresa_domiciliu: 1, id_fiscal: 1, cont_bancar: 1,
    tip_document: 2, document_fata: 2, document_verso: 2, act_serie_numar: 2, act_valabil_pana: 2,
    mifid: 3, pep: 3, sanctiuni: 3, rezidenta_fiscala: 4,
  };

  function tr(ro, p) {
    var s = typeof window.t === 'function' ? window.t(null, ro, p) : ro;
    return p ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return p[k] != null ? p[k] : m; }) : s;
  }
  function en() { return !!(window.MYD_I18N && window.MYD_I18N.lang && window.MYD_I18N.lang !== 'ro'); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function asteapta(cond, ms) {
    return new Promise(function (ok) {
      var pana = Date.now() + ms;
      (function v() { if (cond()) return ok(true); if (Date.now() > pana) return ok(false); setTimeout(v, 80); })();
    });
  }
  function cuTermen(p, ms, rezerva) {
    return Promise.race([p, new Promise(function (ok) { setTimeout(function () { ok(rezerva); }, ms); })]);
  }
  function json(url, token) {
    var h = { Accept: 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    return fetch(url, { headers: h, cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  // ── Citirea stării (fără endpoint nou) ───────────────────────────────
  var promRunda = json('/api/public/runda-curenta').then(function (j) { return (j && j.runda) || null; });

  function sesiune() {
    return asteapta(function () { return !!window.supabaseClient; }, 4000).then(function (gata) {
      if (!gata) return null;
      return window.supabaseClient.auth.getSession().then(function (r) { return (r && r.data && r.data.session) || null; });
    }).catch(function () { return null; });
  }
  function profil(token) {
    if (window.MYD_CONT && typeof window.MYD_CONT.profil === 'function') {
      return window.MYD_CONT.profil().then(function (p) { return p || json('/api/cont/profil', token); }).catch(function () { return json('/api/cont/profil', token); });
    }
    return json('/api/cont/profil', token);
  }

  function calculeaza(c) {
    var kyc = c.kyc, investitor = c.investitor, runda = c.runda;
    var st = kyc && kyc.status;
    if (st === 'respins') {
      var pas = 1;
      (c.lipsa || []).some(function (k) { if (PAS_LIPSA[k]) { pas = PAS_LIPSA[k]; return true; } return false; });
      return { stare: 'respins', pas: pas };
    }
    // Ciorna are întâietate și cu rolul `investor`: un dosar respins, apoi salvat din
    // nou, redevine ciornă, iar rolul rămâne pe cont.
    if (st === 'ciorna') return { stare: 'ciorna', pas: Math.min(Math.max(Number(kyc.pas_curent) || 1, 1), 5) };
    if (investitor && runda) return { stare: 'runda', inVerificare: st === 'in_verificare' };
    if (st === 'in_verificare') return { stare: 'verificare' };
    if (investitor) return { stare: 'panou' };
    return { stare: 'fara_dosar' };
  }

  // Faza 1 (rapidă): sesiunea. Faza 2: profilul, dosarul, runda, subscrierile.
  var promSesiune = null;
  function citesteStarea(laProvizoriu) {
    return promSesiune.then(function (s) {
      if (!s) return promRunda.then(function (runda) { return { stare: 'vizitator', runda: runda }; });
      laProvizoriu();
      var tok = s.access_token;
      return Promise.all([profil(tok), json('/api/investitori/kyc', tok), promRunda]).then(function (r) {
        var p = r[0] || {};
        var investitor = Array.isArray(p.roles) && p.roles.indexOf('investor') !== -1;
        var c = { kyc: r[1] && r[1].kyc, lipsa: (r[1] && r[1].lipsa) || [], investitor: investitor, runda: r[2] };
        var rez = calculeaza(c);
        rez.cont = true; rez.kyc = c.kyc; rez.investitor = investitor; rez.runda = c.runda;
        if (!investitor) return rez;
        return json('/api/investitori/portofoliu', tok).then(function (pf) {
          rez.subscrieri = (pf && Array.isArray(pf.subscrieri)) ? pf.subscrieri.length : 0;
          return rez;
        });
      });
    });
  }

  // ── Butonul principal ───────────────────────────────────────────────
  function deschideFereastraCont(btn) {
    try { sessionStorage.setItem(CHEIE_REVENIRE, RUTA); } catch (e) {}
    function cuMDCont() {
      window.MDCont.deschide({ tab: 'login', mesaj: tr('Intră în cont sau creează-ți unul; după aceea continui dosarul de investitor.') });
    }
    if (window.MDCont) { cuMDCont(); return; }
    if (!document.querySelector('script[src$="cont-fereastra.js"]')) {
      var s = document.createElement('script'); s.src = '/cont-fereastra.js'; document.head.appendChild(s);
    }
    asteapta(function () { return !!window.MDCont; }, 5000).then(function (ok) { if (ok) cuMDCont(); });
  }
  function laPanou() {
    var p = document.getElementById('panou');
    if (!p || p.hidden) return;
    try { history.replaceState(null, '', '#panou'); } catch (e) {}
    p.scrollIntoView({ behavior: reduceMiscarea() ? 'auto' : 'smooth', block: 'start' });
    arataReveal();
  }
  function cuInvestitor(fn) {
    if (window.MYD_INVESTITOR) { fn(window.MYD_INVESTITOR); return; }
    asteapta(function () { return !!window.MYD_INVESTITOR; }, 5000).then(function (ok) { if (ok) fn(window.MYD_INVESTITOR); });
  }
  function actiune(r, btn) {
    switch (r.stare) {
      case 'vizitator': deschideFereastraCont(btn); break;
      // Fără pas explicit: ruta se deschide la pasul salvat pe server (pas_curent, citit
      // proaspăt) — același N ca în text, chiar dacă între timp s-au salvat pași noi.
      case 'fara_dosar': case 'ciorna': cuInvestitor(function (m) { m.deschideRuta(btn); }); break;
      case 'respins': cuInvestitor(function (m) { m.deschideRuta(btn, r.pas); }); break;
      case 'runda': if (typeof window.openRunda === 'function') window.openRunda(btn); break;
      case 'verificare': case 'panou': laPanou(); break;
      // provizoriu (sesiune, starea încă se citește): logica existentă alege ruta sau subscrierea
      default: cuInvestitor(function (m) { m.start(btn); });
    }
  }

  var stareCurenta = null;
  function aplicaButoane(r) {
    stareCurenta = r;
    $all('[data-cta-investitor]').forEach(function (b) {
      var text = r.stare === 'provizoriu' ? tr(TEXT.vizitator) : tr(TEXT[r.stare], { n: r.pas });
      var t = b.querySelector('[data-cta-text]');
      if (t) t.textContent = text; else b.textContent = text;
      var sag = b.querySelector('[data-cta-sageata]');
      if (sag) sag.textContent = FARA_SAGEATA[r.stare] ? '' : '→';
      b.setAttribute('data-cta-stare', r.stare);
    });
    var nota = '';
    if (r.stare === 'respins' && r.kyc) {
      var motiv = en() ? (r.kyc.motiv_respingere_en || r.kyc.motiv_respingere) : r.kyc.motiv_respingere;
      nota = tr('Dosarul nu a fost aprobat.') + (motiv ? ' ' + tr('Motiv:') + ' ' + motiv : '');
    } else if (r.stare === 'runda' && r.inVerificare) {
      nota = tr('Subscrierea se aprobă după verificarea identității.');
    }
    $all('[data-cta-nota]').forEach(function (n) { n.textContent = nota; n.hidden = !nota; });
  }
  function leagaButoane() {
    $all('[data-cta-investitor]').forEach(function (b) {
      if (b.getAttribute('data-cta-legat')) return;
      b.setAttribute('data-cta-legat', '1');
      b.addEventListener('click', function (e) {
        e.preventDefault();
        if (stareCurenta) { actiune(stareCurenta, b); return; }
        // Încă nu se știe dacă există sesiune (verificare locală): fără sesiune,
        // fereastra de cont pe pagină — niciodată plecarea la index.html.
        (promSesiune || Promise.resolve(null)).then(function (ses) { actiune(stareCurenta || { stare: ses ? 'provizoriu' : 'vizitator' }, b); });
      });
    });
  }

  // ── Parcursul de investitor (7 segmente) ─────────────────────────────
  function aplicaParcurs(r) {
    var lista = document.querySelector('[data-inv-parcurs]');
    if (!lista) return;
    var stari = {}; // segment → 'facut' | 'curent' | 'respins'
    var eticheta = {}; // segment → textul de stare
    var curent = null;
    if (r.cont) {
      var st = r.kyc && r.kyc.status;
      if (!r.kyc) curent = 'date';
      else if (st === 'ciorna') {
        for (var i = 0; i < r.pas - 1; i++) stari[SEGMENTE[i]] = 'facut';
        curent = SEGMENTE[r.pas - 1];
      } else {
        SEGMENTE.slice(0, 5).forEach(function (s) { stari[s] = 'facut'; });
        if (st === 'in_verificare') { curent = 'verificare'; eticheta.verificare = 'în curs'; }
        else if (st === 'respins') { stari.verificare = 'respins'; curent = 'verificare'; eticheta.verificare = 'respinsă'; }
        else if (st === 'aprobat') { stari.verificare = 'facut'; eticheta.verificare = 'aprobată'; }
      }
      if (r.subscrieri > 0) stari.subscriere = 'facut';
      else if (st === 'aprobat' && !curent) curent = 'subscriere';
    }
    lista.setAttribute('data-inv-parcurs', r.cont ? 'cont' : 'vizitator');
    $all('[data-inv-segment]').forEach(function (li) {
      var s = li.getAttribute('data-inv-segment');
      var clasa = stari[s] || (s === curent ? 'curent' : '');
      if (s === curent && stari[s] !== 'respins') clasa = 'curent';
      li.className = 'inv-seg' + (clasa ? ' inv-seg-' + clasa : '') + (s === curent ? ' inv-seg-aici' : '');
      if (s === curent) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      var et = li.querySelector('[data-inv-seg-stare]');
      if (et) {
        var t = s === curent ? tr('aici ai rămas') : '';
        if (eticheta[s]) t = tr(eticheta[s]) + (s === curent ? ' · ' + tr('aici ai rămas') : '');
        et.textContent = t;
        et.hidden = !t;
      }
    });
  }

  // ── Runda: insigna din hero ──────────────────────────────────────────
  function aplicaInsigna(runda) {
    var ins = document.getElementById('inv-insigna-runda');
    if (!ins) return;
    var nume = runda ? (en() ? (runda.denumire_en || runda.denumire_ro) : (runda.denumire_ro || runda.denumire_en)) : '';
    var loc = ins.querySelector('[data-inv-runda-nume]');
    if (loc) loc.textContent = nume || '';
    ins.hidden = !nume;
  }

  // ── „Panoul meu” și meniul de secțiuni ───────────────────────────────
  function aplicaPanou(investitor) {
    var p = document.getElementById('panou');
    if (p) p.hidden = !investitor;
    $all('.inv-sectiuni [data-doar-investitor]').forEach(function (a) { a.hidden = !investitor; });
  }
  function meniuSectiuni() {
    var nav = document.querySelector('.inv-sectiuni');
    if (!nav) return;
    var hdr = document.getElementById('hdr');
    // Meniul stă sub antet cât antetul e fix; dacă antetul nu e fix, sus de tot.
    var ultima = -1;
    function inaltime() {
      var h = 0;
      if (hdr) { var cs = getComputedStyle(hdr); if (cs.position === 'sticky' || cs.position === 'fixed') h = Math.max(0, Math.round(hdr.getBoundingClientRect().bottom)); }
      if (h !== ultima) { ultima = h; document.documentElement.style.setProperty('--inv-antet-h', h + 'px'); }
      // Marginea de derulare a secțiunilor: antetul fix + meniul de secțiuni.
      var fix = hdr && /sticky|fixed/.test(getComputedStyle(hdr).position) ? Math.round(hdr.getBoundingClientRect().height) : 0;
      document.documentElement.style.setProperty('--inv-sus-h', (fix + Math.round(nav.getBoundingClientRect().height) + 8) + 'px');
    }
    inaltime();
    window.addEventListener('resize', inaltime);
    var linkuri = $all('.inv-sectiuni a[href^="#"]');
    function marcheaza() {
      var prag = Math.max(0, nav.getBoundingClientRect().bottom) + 24;
      var activ = null;
      linkuri.forEach(function (a) {
        var s = document.getElementById(a.getAttribute('href').slice(1));
        if (s && !s.hidden && s.getBoundingClientRect().top <= prag) activ = a;
      });
      linkuri.forEach(function (a) {
        if (a === activ) { a.classList.add('activ'); a.setAttribute('aria-current', 'location'); }
        else { a.classList.remove('activ'); a.removeAttribute('aria-current'); }
      });
      if (activ && activ.scrollIntoView && nav.scrollWidth > nav.clientWidth) {
        var r = activ.getBoundingClientRect(), rn = nav.getBoundingClientRect();
        if (r.left < rn.left || r.right > rn.right) nav.scrollLeft += r.left - rn.left - 16;
      }
    }
    window.addEventListener('scroll', function () { inaltime(); marcheaza(); }, { passive: true });
    marcheaza();
  }

  // ── Fără ecran gol: .reveal vizibile imediat ─────────────────────────
  function reduceMiscarea() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function arataReveal() {
    var vh = window.innerHeight || 800;
    $all('.reveal:not(.visible)').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (reduceMiscarea() || (r.bottom > -40 && r.top < vh + 40)) el.classList.add('visible');
    });
  }

  // ── Ancorele vechi ──────────────────────────────────────────────────
  var promInvestitor = null;
  function mergiLa(id) {
    var el = document.getElementById(id);
    if (!el) return;
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
    el.scrollIntoView({ block: 'start' });
    arataReveal();
  }
  function ancore() {
    var h = (location.hash || '').slice(1);
    if (h === 'ghid-investitor') { mergiLa('cum-functioneaza'); return; }
    if (h === 'kpis' || h === 'panou') {
      // #panou există doar pentru rolul `investor`; altfel, ghidul.
      (promInvestitor || Promise.resolve(false)).then(function (da) {
        if (da) { aplicaPanou(true); mergiLa('panou'); } else if (h === 'kpis' || document.getElementById('panou').hidden) mergiLa('cum-functioneaza');
      });
      return;
    }
    setTimeout(arataReveal, 0);
  }

  function porneste() {
    leagaButoane();
    meniuSectiuni();
    urmaresteFerestre();
    arataReveal();
    window.addEventListener('hashchange', ancore);
    window.addEventListener('load', arataReveal);
    $all('[data-cta-investitor]').forEach(function (b) { if (!b.getAttribute('data-cta-stare')) b.setAttribute('data-cta-stare', 'incarca'); });
    promSesiune = sesiune();
    var stare = citesteStarea(function () { aplicaButoane({ stare: 'provizoriu' }); });
    promInvestitor = stare.then(function (r) { return !!(r && r.investitor); }).catch(function () { return false; });
    ancore();
    promRunda.then(aplicaInsigna);
    // Fără răspuns: vizitatorul (sau, cu sesiune, butonul provizoriu) rămâne utilizabil.
    cuTermen(stare, 12000, null).then(function (r) {
      if (!r) { if (!stareCurenta) aplicaButoane({ stare: 'vizitator' }); return; }
      aplicaButoane(r);
      aplicaParcurs(r);
      aplicaPanou(!!r.investitor);
    }).catch(function () { if (!stareCurenta) aplicaButoane({ stare: 'vizitator' }); });
  }

  // Când fereastra rutei (#mi-fond) sau a subscrierii se închide, starea se recitește
  // (pasul salvat, dosarul trimis), ca textul butonului să rămână adevărat.
  var deschisaInainte = false, cronometru = null;
  function urmaresteFerestre() {
    if (typeof MutationObserver !== 'function') return;
    new MutationObserver(function () {
      var m = document.getElementById('modal-runda');
      var acum = !!document.getElementById('mi-fond') || !!(m && m.style.display === 'block');
      if (deschisaInainte && !acum) {
        clearTimeout(cronometru);
        cronometru = setTimeout(reincarca, 300);
      }
      deschisaInainte = acum;
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  }
  function reincarca() {
    if (window.MYD_CONT && typeof window.MYD_CONT.reincarca === 'function') { try { window.MYD_CONT.reincarca(); } catch (e) {} }
    citesteStarea(function () {}).then(function (r) {
      if (!r) return;
      aplicaButoane(r); aplicaParcurs(r); aplicaPanou(!!r.investitor);
    }).catch(function () {});
  }

  window.MYD_CTA_INVESTITOR = { reincarca: reincarca, calculeaza: calculeaza, TEXT: TEXT, stare: function () { return stareCurenta; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', porneste);
  else porneste();
})();
