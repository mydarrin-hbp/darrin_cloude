/* ════════════════════════════════════════════════════════════════
   MY DARRIN — panou-investitor.js, pasul 11-I1 (8 nov. 2026)

   Panoul investitorului (mydarrin-panou-investitor.html). Accesul îl decide
   serverul: fără sesiune → fereastra de cont, cu revenire aici; fără rolul
   `investor` → pagina Investitori. Nimic nu se cere înainte de verificare.

   Datele vin doar din API: /api/investitori/portofoliu, kyc, exit, istoric și
   indicatori. Calculele (lock-up, acțiuni vandabile) sunt pe server.
   Feedback-ul la acțiuni: MDFeedback.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var PANOURI = ['prezentare', 'participatii', 'subscrieri', 'exit', 'istoric', 'indicatori', 'datele-mele'];
  var ZILE_ALERTA = 60;
  var STARI_SUB = { aprobat: 'Aprobată', in_asteptare: 'În așteptare', respins: 'Respinsă' };
  var STARI_EXIT = { in_procesare: 'În procesare', aprobat: 'Aprobată', respins: 'Respinsă', platit: 'Plătită', finalizat: 'Finalizată', anulat: 'Anulată' };
  var TIP_ACT = { ci: 'Carte de identitate', pasaport: 'Pașaport', permis_sedere: 'Permis de ședere' };
  var stare = { portofoliu: null };

  function tr(ro, p) {
    if (typeof window.t === 'function') return window.t(null, ro, p);
    return p ? String(ro).replace(/\{(\w+)\}/g, function (m, k) { return p[k] != null ? p[k] : m; }) : ro;
  }
  function en() { return !!(window.MYD_I18N && window.MYD_I18N.lang && window.MYD_I18N.lang !== 'ro'); }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function local() { return en() ? 'en-GB' : 'ro-RO'; }
  function numar(v) { return v == null || isNaN(v) ? '—' : Number(v).toLocaleString(local(), { maximumFractionDigits: 2 }); }
  function suma(v, m) { return v == null || isNaN(v) ? '—' : numar(v) + (m ? ' ' + m : ''); }
  function dataOra(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString(local(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Bucharest' });
  }
  function dataZi(s) {
    if (!s) return '—';
    var p = String(s).slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString(local(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  function numeRunda(r) { return r ? (en() ? (r.denumire_en || r.denumire_ro) : (r.denumire_ro || r.denumire_en)) : '—'; }

  function token() {
    return window.supabaseClient.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      if (!s) throw new Error(tr('Sesiunea a expirat. Autentifică-te din nou.'));
      return s.access_token;
    });
  }
  function api(url, optiuni) {
    return token().then(function (t) {
      var o = Object.assign({ cache: 'no-store' }, optiuni || {});
      o.headers = Object.assign({ Authorization: 'Bearer ' + t }, o.headers || {});
      return window.MDFeedback.cerere(url, o);
    });
  }

  // ── Navigarea între secțiuni ─────────────────────────────────────────
  function arataPanou(id, faraHash) {
    if (PANOURI.indexOf(id) === -1) id = PANOURI[0];
    PANOURI.forEach(function (p) { $(p).hidden = p !== id; });
    Array.prototype.forEach.call(document.querySelectorAll('.pi-nav button'), function (b) {
      if (b.getAttribute('data-pi-panou') === id) {
        b.setAttribute('aria-current', 'page');
        var nav = b.parentNode;
        if (nav.scrollWidth > nav.clientWidth) nav.scrollLeft = b.offsetLeft - 16;
      } else b.removeAttribute('aria-current');
    });
    if (!faraHash) { try { history.replaceState(null, '', '#' + id); } catch (e) {} }
  }

  // ── Prezentare ───────────────────────────────────────────────────────
  function banda(cls, text, link, eticheta) {
    return '<div class="pi-banda ' + cls + '" role="status">' + esc(text) + (link ? '<a href="' + esc(link) + '">' + esc(eticheta) + '</a>' : '') + '</div>';
  }
  function bandaDosar(kyc) {
    var el = $('pi-stare-dosar');
    var st = kyc && kyc.status;
    if (st === 'aprobat') el.innerHTML = banda('pi-banda-ok', tr('Identitatea ta a fost verificată. Subscrierile tale pot fi aprobate.'));
    else if (st === 'in_verificare') el.innerHTML = banda('pi-banda-info', tr('Verificarea identității tale e în curs. Te anunțăm prin email.'));
    else if (st === 'respins') {
      var motiv = en() ? (kyc.motiv_respingere_en || kyc.motiv_respingere) : kyc.motiv_respingere;
      el.innerHTML = banda('pi-banda-rosu', tr('Verificarea identității nu a fost aprobată.') + (motiv ? ' ' + tr('Motiv:') + ' ' + motiv : ''), '/mydarrin-investitori.html', tr('Corectează și retrimite'));
    } else el.innerHTML = banda('pi-banda-info', tr('Dosarul tău nu e trimis încă.'), '/mydarrin-investitori.html', tr('Continuă dosarul'));
  }
  // Zile până la expirarea actului, față de ziua de azi în România.
  function zilePanaLa(s) {
    var p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    var azi = Date.UTC(+p.year, +p.month - 1, +p.day);
    var d = String(s).slice(0, 10).split('-').map(Number);
    return Math.round((Date.UTC(d[0], d[1] - 1, d[2]) - azi) / 86400000);
  }
  function alertaAct(kyc) {
    var el = $('pi-alerta-act');
    el.innerHTML = '';
    if (!kyc || !kyc.act_valabil_pana) return;
    var zile = zilePanaLa(kyc.act_valabil_pana);
    if (zile > ZILE_ALERTA) return;
    if (zile >= 0) el.innerHTML = banda('pi-banda-galben', tr('Actul tău de identitate expiră pe {data}.', { data: dataZi(kyc.act_valabil_pana) }), '/mydarrin-contact.html', tr('Contactează-ne'));
    else el.innerHTML = banda('pi-banda-rosu', tr('Actul tău de identitate a expirat; încarcă unul nou.'), '/mydarrin-contact.html', tr('Contactează-ne'));
  }
  function monedaPortofoliu(j) {
    if (j.runda && j.runda.moneda) return j.runda.moneda;
    var cu = (j.subscrieri || []).filter(function (x) { return x.runda && x.runda.moneda; })[0];
    return cu ? cu.runda.moneda : '';
  }
  function prezentare(j) {
    var m = monedaPortofoliu(j);
    $('pi-kpi-suma').textContent = j.valoare_investita > 0 ? suma(j.valoare_investita, m) : '—';
    $('pi-kpi-actiuni').textContent = numar(j.actiuni);
    $('pi-kpi-pct').textContent = numar(j.pct_companie);
    $('pi-kpi-asteptare').textContent = j.in_asteptare > 0 ? suma(j.in_asteptare, m) : '—';
    $('pi-kpi-runda').textContent = j.runda ? numeRunda(j.runda) : tr('Nicio rundă deschisă');
    $('pi-kpi-pret').textContent = j.runda ? tr('Preț / acțiune: {pret}', { pret: suma(j.runda.pret_actiune, j.runda.moneda) }) : '—';
  }

  // ── Participații pe runde ────────────────────────────────────────────
  function participatii(j) {
    var aprobate = (j.subscrieri || []).filter(function (x) { return x.status === 'aprobat'; });
    var el = $('pi-participatii');
    if (!aprobate.length) { el.innerHTML = '<div class="pi-card"><p class="pi-mic">' + esc(tr('Nicio participație aprobată încă.')) + '</p></div>'; return; }
    var pe = {}, ordine = [];
    aprobate.forEach(function (x) { var k = numeRunda(x.runda); if (!pe[k]) { pe[k] = []; ordine.push(k); } pe[k].push(x); });
    el.innerHTML = ordine.map(function (nume) {
      return '<article class="pi-card"><h3 translate="no">' + esc(nume) + '</h3>' + pe[nume].map(function (x) {
        var vinde = x.aprobat_la ? (x.sfarsit_lock_up ? dataOra(x.sfarsit_lock_up) : tr('Fără lock-up')) : '—';
        return '<div class="pi-rand" data-pi-participatie="' + esc(x.id) + '"><dl class="pi-date">' +
          '<div><dt>' + esc(tr('Instrument')) + '</dt><dd translate="no">' + esc(x.instrument || '—') + '</dd></div>' +
          '<div><dt>' + esc(tr('Acțiuni')) + '</dt><dd>' + numar(x.actiuni) + '</dd></div>' +
          '<div><dt>' + esc(tr('Suma investită')) + '</dt><dd>' + suma(x.valoare_investita, x.runda && x.runda.moneda) + '</dd></div>' +
          '<div><dt>' + esc(tr('Aprobată la')) + '</dt><dd>' + esc(dataOra(x.aprobat_la)) + '</dd></div>' +
          '<div><dt>' + esc(tr('Se pot vinde din')) + '</dt><dd data-pi-lockup>' + esc(vinde) + '</dd></div></dl></div>';
      }).join('') + '</article>';
    }).join('');
  }

  // ── Subscrieri ───────────────────────────────────────────────────────
  function subscrieri(j) {
    var l = j.subscrieri || [];
    $('pi-subscrieri').innerHTML = l.length ? l.map(function (x) {
      return '<tr><td translate="no">' + esc(numeRunda(x.runda)) + '</td><td>' + suma(x.valoare_investita, x.runda && x.runda.moneda) + '</td><td>' + numar(x.actiuni) + '</td><td>' + esc(tr(STARI_SUB[x.status] || x.status || '—')) + '</td></tr>';
    }).join('') : '<tr><td colspan="4">' + esc(tr('Nicio subscriere încă.')) + '</td></tr>';
  }

  // ── Exit ─────────────────────────────────────────────────────────────
  function exitDate(j) {
    var ex = j.exit || {};
    var vandabile = Number(ex.actiuni_vandabile_acum) || 0;
    $('pi-vandabile').textContent = numar(vandabile);
    var f = $('pi-exit-form');
    f.hidden = !(ex.buyback_disponibil && vandabile > 0);
    $('pi-exit-n').max = String(vandabile);
    var det = '';
    if (!ex.buyback_disponibil) det = tr('Buy-back-ul nu e configurat pentru rundele tale.');
    else {
      det = tr('Discount la buy-back: {d}%.', { d: numar(ex.discount_buyback_pct) });
      if (ex.lock_up_luni != null) det += ' ' + tr('Lock-up: {n} luni de la aprobare.', { n: ex.lock_up_luni });
    }
    $('pi-exit-detalii').textContent = det;
  }
  function listaExit(cereri, moneda) {
    var el = $('pi-exit-lista');
    if (!cereri.length) { el.innerHTML = '<p class="pi-mic">' + esc(tr('Nicio cerere de exit încă.')) + '</p>'; return; }
    el.innerHTML = cereri.map(function (c) {
      return '<div class="pi-rand pi-exit-rand" data-pi-cerere="' + esc(c.id) + '"><div>' +
        '<div class="pi-ist-titlu">' + esc(tr('{n} acțiuni', { n: numar(c.numar_actiuni) })) + '</div>' +
        '<div class="pi-ist-data">' + esc(dataOra(c.creat_la)) + (c.suma_calculata != null ? ' · ' + esc(suma(c.suma_calculata, moneda)) : '') + '</div></div>' +
        '<div><span class="pi-eticheta">' + esc(tr(STARI_EXIT[c.status] || c.status || '—')) + '</span></div>' +
        (c.status === 'in_procesare' ? '<button type="button" class="pi-btn pi-btn-2" data-pi-anuleaza="' + esc(c.id) + '" data-pi-n="' + esc(c.numar_actiuni) + '">' + esc(tr('Anulează cererea')) + '</button>' : '') +
        '</div>';
    }).join('');
  }

  // ── Istoric ──────────────────────────────────────────────────────────
  function istoric(ev) {
    var el = $('pi-istoric');
    if (!ev.length) { el.innerHTML = '<li class="pi-mic">' + esc(tr('Niciun eveniment încă.')) + '</li>'; return; }
    el.innerHTML = ev.map(function (e) {
      var det = [];
      if (e.runda) det.push(numeRunda(e.runda));
      if (e.valoare_investita != null) det.push(suma(e.valoare_investita, e.moneda));
      if (e.numar_actiuni != null) det.push(tr('{n} acțiuni', { n: numar(e.numar_actiuni) }));
      var motiv = e.motiv ? tr('Motiv:') + ' ' + (en() ? e.motiv.en : e.motiv.ro) : '';
      return '<li data-pi-eveniment="' + esc(e.tip) + '"><div class="pi-ist-data">' + esc(dataOra(e.data)) + '</div>' +
        '<div class="pi-ist-titlu">' + esc(en() ? e.titlu.en : e.titlu.ro) + '</div>' +
        (det.length ? '<div class="pi-ist-det" translate="no">' + esc(det.join(' · ')) + '</div>' : '') +
        (motiv ? '<div class="pi-ist-det">' + esc(motiv) + '</div>' : '') + '</li>';
    }).join('');
  }

  // ── Indicatorii platformei: doar cu verificarea aprobată ─────────────
  function indicatori() {
    var el = $('pi-indicatori');
    return token().then(function (t) {
      return fetch('/api/investitori/indicatori', { headers: { Authorization: 'Bearer ' + t }, cache: 'no-store' });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; });
    }).catch(function () { return { r: null, j: {} }; }).then(function (x) {
      if (!x.r || !x.r.ok || !x.j.indicatori) {
        var mesaj = x.r && x.r.status === 403
          ? tr('Indicatorii financiari sunt disponibili după aprobarea verificării identității tale.')
          : tr('Indicatorii nu sunt disponibili acum.');
        el.innerHTML = '<p class="pi-mic" id="pi-indicatori-mesaj">' + esc(mesaj) + '</p>';
        return;
      }
      var k = x.j.indicatori, m = x.j.moneda || '';
      var c = [
        ['Comenzi finalizate', numar(k.comenzi_total)],
        ['Comenzi finalizate luna aceasta', numar(k.comenzi_luna)],
        ['Parteneri cu comenzi', numar(k.parteneri_activi)],
        ['Valoarea comenzilor finalizate', suma(k.gmv_total, m)],
        ['Venitul platformei', suma(k.revenue_total, m)],
        ['Venitul platformei luna aceasta', suma(k.revenue_luna, m)],
      ];
      if (k.take_rate_pct != null) c.push(['Comisionul mediu', numar(k.take_rate_pct) + '%']);
      el.innerHTML = '<div class="pi-ind" id="pi-indicatori-grila">' + c.map(function (i) {
        return '<div><div class="pi-kpi-et">' + esc(tr(i[0])) + '</div><div class="pi-ind-val">' + esc(i[1]) + '</div></div>';
      }).join('') + '</div>';
    });
  }

  // ── Datele mele: doar afișare, mascată ───────────────────────────────
  function numeTara(cod) {
    if (!cod) return '—';
    try { return new Intl.DisplayNames([en() ? 'en' : 'ro'], { type: 'region' }).of(cod) || cod; } catch (e) { return cod; }
  }
  function adresa(a) {
    if (!a || typeof a !== 'object') return '—';
    return [a.strada, a.localitate, a.judet, a.cod_postal, a.tara ? numeTara(a.tara) : null].filter(Boolean).join(', ') || '—';
  }
  function dateMele(kyc) {
    var k = kyc || {};
    var c = [
      ['IBAN', k.iban_mascat || '—', 1],
      ['Adresa de domiciliu', adresa(k.adresa_domiciliu), 1],
      ['Rezidență fiscală', numeTara(k.rezidenta_fiscala_tara), 1],
      ['Tipul documentului', k.tip_document ? tr(TIP_ACT[k.tip_document] || k.tip_document) : '—', 0],
      ['Actul e valabil până la', dataZi(k.act_valabil_pana), 0],
    ];
    $('pi-datele').innerHTML = c.map(function (x) {
      return '<div><dt>' + esc(tr(x[0])) + '</dt><dd' + (x[2] ? ' translate="no"' : '') + '>' + esc(x[1]) + '</dd></div>';
    }).join('');
  }

  // ── Încărcarea datelor ───────────────────────────────────────────────
  function incarcaExit() {
    return Promise.all([api('/api/investitori/portofoliu'), api('/api/investitori/exit'), api('/api/investitori/istoric')]).then(function (r) {
      stare.portofoliu = r[0];
      prezentare(r[0]); participatii(r[0]); exitDate(r[0]);
      listaExit(r[1].cereri || [], monedaPortofoliu(r[0]));
      istoric(r[2].evenimente || []);
    });
  }
  function incarca() {
    var z = $('pi-eroare');
    z.hidden = true;
    return Promise.all([
      api('/api/investitori/portofoliu'), api('/api/investitori/kyc'), api('/api/investitori/exit'), api('/api/investitori/istoric'),
    ]).then(function (r) {
      stare.portofoliu = r[0];
      prezentare(r[0]); participatii(r[0]); subscrieri(r[0]); exitDate(r[0]);
      listaExit(r[2].cereri || [], monedaPortofoliu(r[0]));
      istoric(r[3].evenimente || []);
      bandaDosar(r[1].kyc); alertaAct(r[1].kyc); dateMele(r[1].kyc);
      $('pi-app').setAttribute('data-pi-gata', '1');
      return indicatori();
    }).catch(function (e) {
      $('pi-eroare-text').textContent = (e && e.message) || tr('Nu am putut încărca panoul.');
      z.hidden = false;
    });
  }

  // ── Acțiuni ──────────────────────────────────────────────────────────
  function trimiteExit(e) {
    e.preventDefault();
    var form = $('pi-exit-form');
    var btn = $('pi-exit-trimite');
    var msg = $('pi-exit-msg');
    window.MDFeedback.salveaza(btn, msg, function () {
      var n = Number($('pi-exit-n').value);
      var max = Number($('pi-exit-n').max) || 0;
      if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(tr('Scrie un număr întreg de acțiuni, între 1 și {n}.', { n: max }));
      return api('/api/investitori/exit', { method: 'POST', body: { tip: 'buyback', numar_actiuni: n } })
        .then(function () { return tr('Cererea de buy-back a fost înregistrată. Echipa te contactează.'); });
    }, { form: form, textSalveaza: tr('Se trimite…'), textOk: tr('✓ Trimis') }).then(function (r) {
      if (r && r.ok) { $('pi-exit-n').value = ''; return incarcaExit().catch(function () {}); }
    });
  }
  function anuleaza(btn) {
    var id = btn.getAttribute('data-pi-anuleaza');
    window.MDFeedback.confirma(tr('Anulezi cererea de exit pentru {n} acțiuni?', { n: numar(btn.getAttribute('data-pi-n')) }), { textOk: tr('Anulează cererea'), textAnulare: tr('Renunță'), periculos: true }).then(function (da) {
      if (!da) return null;
      return window.MDFeedback.salveaza(btn, $('pi-exit-msg'), function () {
        return api('/api/investitori/exit', { method: 'PATCH', body: { id: id, actiune: 'anuleaza' } })
          .then(function () { return tr('Cererea a fost anulată.'); });
      }, { textSalveaza: tr('Se anulează…'), textOk: tr('✓ Anulat') });
    }).then(function (r) {
      if (r && r.ok) return incarcaExit().catch(function () {});
    });
  }

  function leaga() {
    Array.prototype.forEach.call(document.querySelectorAll('.pi-nav button'), function (b) {
      b.addEventListener('click', function () { arataPanou(b.getAttribute('data-pi-panou')); });
    });
    $('pi-exit-form').addEventListener('submit', trimiteExit);
    $('pi-exit-lista').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-pi-anuleaza]');
      if (b) anuleaza(b);
    });
    $('pi-reincearca').addEventListener('click', incarca);
    window.addEventListener('hashchange', function () { arataPanou((location.hash || '').slice(1), true); });
  }

  function areSesiune() {
    if (!window.supabaseClient) return Promise.resolve(false);
    return window.supabaseClient.auth.getSession().then(function (r) { return !!(r && r.data && r.data.session); }).catch(function () { return false; });
  }

  function porneste() {
    window.MYD_PAZA.verifica({ container: 'myd-cont-antet', public: true }).then(function (r) {
      var p = r && r.profil;
      if (!p) {
        return areSesiune().then(function (are) {
          if (!are) { window.MYD_PAZA.laLogin(); return; }
          $('pi-acces-eroare').hidden = false;
        });
      }
      if (!Array.isArray(p.roles) || p.roles.indexOf('investor') === -1) {
        location.replace('/mydarrin-investitori.html#cum-functioneaza');
        return;
      }
      $('pi-app').hidden = false;
      leaga();
      arataPanou((location.hash || '').slice(1), true);
      try { if (window.lucide) window.lucide.createIcons(); } catch (e) {}
      return incarca();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', porneste);
  else porneste();
})();
