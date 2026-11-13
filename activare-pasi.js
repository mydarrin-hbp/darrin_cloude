/* ════════════════════════════════════════════════════════════════
   MY DARRIN — activare-pasi.js (MYD_ACTIVARE)
   Pasul 11-R3, corecție (decizia LM, 2 nov. 2026)

   Activarea contului de partener, pe pași, într-o pagină albă care acoperă
   dashboard-ul: un singur pas o dată, cu formularul lui direct pe pagină.
     1 Firma · 2 Cont bancar · 3 Profesii (curier: zonele de livrare) ·
     4 Dotări (servicii: utilaje; curier: vehiculul; asigurări: polițele;
       materiale / închirieri: catalogul) · 5 Documente · 6 Contract
   Sus: „Activează contul”, „Pasul N din 6”, bara de progres și numele
   pașilor (pe telefon doar „N / 6” și bara). Jos: „← Înapoi” și
   „Salvează și continuă →” (pe telefon „Continuă →”).

   „Continuă” salvează pasul pe server, prin endpoint-urile existente
   (wizard-companie, conturi-bancare, wizard-nace, zona-curier,
   wizard-utilaje, tipuri-polita, documente, contract-*), și trece mai
   departe doar dacă datele sunt valide; erorile apar sub câmp (MDFeedback).
   Rolul de partener se acordă tot doar la salvarea pasului „Firma”, cu
   verificarea ANAF.

   Salvare automată: ce se scrie într-un pas încă nesalvat se păstrează pe
   server, ca ciornă (/api/partener/activare-ciorna), la ~2,5 s după ultima
   modificare și la ieșirea din câmp; fără IBAN, coduri sau fișiere. La
   revenire, de pe orice dispozitiv, fluxul se deschide la pasul la care a
   rămas, cu ciorna completată. Fără tabelul ciornei (migrarea
   2026-11-02_activare_ciorna.sql neaplicată), salvarea automată se oprește
   în tăcere. Ciorna e doar un ajutor: nu acordă nimic.

   Folosit de cont-dashboard.js (MYD_PAZA.verifica):
     MYD_ACTIVARE.deschide(profil, optiuni, { pas })
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MYD_ACTIVARE) return;

  var LOGO = '/assets/pitch-deck/v1/logo-mydarrin-homebestpal.webp';
  var PASI = ['firma', 'cont_bancar', 'profesii', 'dotari', 'documente', 'contract'];
  var NUME_SCURT = { firma: 'Firma', cont_bancar: 'Cont bancar', profesii: 'Profesii', dotari: 'Dotări', documente: 'Documente', contract: 'Contract' };
  var TITLU = {
    firma: 'Firma',
    cont_bancar: 'Contul bancar',
    profesii: { implicit: 'Profesii și servicii', curier: 'Zonele de livrare' },
    dotari: { servicii: 'Dotări și utilaje', curier: 'Vehiculul de livrare', asigurari: 'Polițele oferite', materiale: 'Catalogul de produse', inchirieri: 'Catalogul de echipamente' },
    documente: 'Documente',
    contract: 'Contractul',
  };
  var SUB = {
    firma: 'Introdu CUI-ul; restul datelor vin de la ANAF.',
    cont_bancar: 'Contul în care primești plățile. IBAN-ul se păstrează criptat.',
    profesii: { implicit: 'Alege codul NACE principal al activității tale și, dacă e cazul, coduri secundare.', curier: 'Zonele în care livrezi și raza de livrare.' },
    dotari: {
      servicii: 'Sculele și utilajele cu care lucrezi.',
      curier: 'Vehiculul cu care livrezi.',
      asigurari: 'Tipurile de poliță pe care le oferi, cu limita de acoperire și discountul.',
      materiale: 'Produsele pe care le vinzi. Le adaugi din catalog, manual sau prin import CSV.',
      inchirieri: 'Echipamentele pe care le închiriezi, cu tarifele lor. Le adaugi din catalog.',
    },
    documente: 'Încarcă documentele firmei. Le verifică echipa My Darrin.',
    contract: 'Contractul-cadru, semnat cu un cod trimis pe email.',
  };
  var DOCUMENTE = {
    ci: 'CI / pașaport administrator', certificat: 'Certificat de înregistrare firmă', cui: 'CUI / certificat fiscal',
    licenta: 'Atestat / autorizație (ex. ISCIR, ASF)', licenta_arr: 'Licență ARR (curier)',
    cazier_judiciar: 'Cazier judiciar', asigurare: 'Poliță de asigurare RC',
  };
  var VEHICULE = ['Bicicletă / trotinetă electrică', 'Motocicletă / scuter', 'Autoturism', 'Autoutilitară'];

  function tr(ro, p) {
    if (typeof window.t === 'function') return window.t(null, ro, p);
    return p ? String(ro).replace(/\{(\w+)\}/g, function (m, k) { return p[k] != null ? p[k] : m; }) : ro;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function dupaTip(v, tip) { return typeof v === 'string' ? v : (v[tip] || v.implicit || ''); }
  function en() { return !!(window.MYD_I18N && window.MYD_I18N.lang && window.MYD_I18N.lang !== 'ro'); }

  // ── Stil: alb, curat, aceleași culori ca restul platformei ──
  function stil() {
    if ($('mya-stil')) return;
    var s = document.createElement('style');
    s.id = 'mya-stil';
    s.textContent =
      '#myd-activare-pagina{position:fixed;inset:0;z-index:9400;background:#fff;color:#1A2332;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;font-family:inherit;-webkit-text-size-adjust:100%}' +
      '#myd-activare-pagina *{box-sizing:border-box}' +
      '#myd-activare-pagina [hidden]{display:none!important}' +
      // Paginile dashboard au stiluri globale (validare :invalid / :valid, radio de 44 px):
      // aici chenarul e cel al formularului, iar roșul vine doar de la erorile MDFeedback.
      '#myd-activare-pagina .mya-in:not([aria-invalid="true"]){border-color:#D5DFE8!important;box-shadow:none!important;background-color:#fff!important}' +
      '#myd-activare-pagina .mya-in:not([aria-invalid="true"]):focus{border-color:#003366!important;box-shadow:0 0 0 3px rgba(0,51,102,.12)!important}' +
      '#myd-activare-pagina input[type=radio],#myd-activare-pagina input[type=checkbox]{width:18px!important;height:18px!important;min-width:0!important;min-height:0!important;padding:0!important}' +
      '.mya-antet{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 24px;border-bottom:1px solid #EEF2F6;background:#fff}' +
      '.mya-logo{display:block;height:40px;width:auto}' +
      '.mya-cont{display:flex;align-items:center;gap:14px;min-width:0;font-size:14px}' +
      '.mya-cont-txt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mya-cont-txt b{font-weight:700}.mya-cont-txt span{color:#5A6B7D}' +
      // Pasul 11-R3e: „Înapoi la site” (sesiunea rămâne) și „Deconectare”, discret, cu confirmare.
      '.mya-actiuni{display:flex;align-items:center;gap:6px;flex-shrink:0;position:relative}' +
      '.mya-site{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1px solid #D5DFE8;border-radius:10px;color:#003366;font-weight:700;font-size:14px;text-decoration:none;white-space:nowrap}' +
      '.mya-site:hover{background:#F4F7F9}' +
      '.mya-deconectare{border:0;background:none;color:#5A6B7D;font-size:13px;text-decoration:underline;cursor:pointer;font-family:inherit;min-height:44px;padding:0 6px;white-space:nowrap}' +
      '.mya-deconectare:hover{color:#C0392B}' +
      '.mya-meniu-btn{display:none;border:1px solid #D5DFE8;background:#fff;border-radius:10px;min-width:44px;min-height:44px;cursor:pointer;font-size:20px;line-height:1;color:#003366;font-family:inherit}' +
      '.mya-meniu{position:absolute;right:0;top:calc(100% + 6px);background:#fff;border:1px solid #D5DFE8;border-radius:12px;box-shadow:0 8px 24px rgba(0,30,60,.12);padding:4px;z-index:2;min-width:160px}' +
      '.mya-meniu .mya-deconectare{display:block;width:100%;text-align:left;text-decoration:none;color:#C0392B;font-weight:700;font-size:14px;padding:0 12px}' +
      '.mya-continut{max-width:640px;margin:0 auto;padding:32px 24px 40px}' +
      '.mya-cap{display:flex;align-items:baseline;justify-content:space-between;gap:12px}' +
      '.mya-cap h1{margin:0;font-size:26px;font-weight:800;line-height:1.2}' +
      '.mya-nr{font-size:14px;color:#5A6B7D;white-space:nowrap}' +
      '.mya-bara{height:4px;border-radius:4px;background:#EEF2F6;margin:14px 0 12px;overflow:hidden}.mya-bara i{display:block;height:100%;background:#FF8C00;border-radius:4px}' +
      '.mya-pasi{display:flex;justify-content:space-between;gap:8px;margin:0 0 28px;padding:0;list-style:none;flex-wrap:wrap}' +
      '.mya-pasi button{display:inline-flex;align-items:center;gap:6px;border:0;background:none;padding:6px 0;font-size:13px;color:#5A6B7D;font-family:inherit;cursor:default;min-height:32px}' +
      '.mya-pasi button[data-deschis]{cursor:pointer}.mya-pasi button[data-deschis]:hover span{text-decoration:underline}' +
      '.mya-pasi b{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;border:1.5px solid #B9C7D6;font-size:11px;font-weight:700;color:#5A6B7D;flex:0 0 auto}' +
      '.mya-pasi .curent{color:#1A2332;font-weight:700}.mya-pasi .curent b{background:#FF8C00;border-color:#FF8C00;color:#fff}' +
      '.mya-pasi .facut b{background:#1A7A3A;border-color:#1A7A3A;color:#fff}' +
      '.mya-pas h2{margin:0 0 4px;font-size:20px;font-weight:800}' +
      '.mya-sub{margin:0 0 20px;font-size:14.5px;color:#5A6B7D;line-height:1.5}' +
      '.mya-camp{margin:0 0 16px}.mya-camp label,.mya-eticheta{display:block;font-size:13.5px;font-weight:700;color:#2D3B4E;margin:0 0 6px}' +
      '.mya-in{display:block;width:100%;min-height:48px;border:1px solid #D5DFE8;border-radius:10px;padding:10px 14px;font-size:15px;font-family:inherit;color:#1A2332;background:#fff}' +
      '.mya-in:focus{outline:none;border-color:#003366;box-shadow:0 0 0 3px rgba(0,51,102,.12)}' +
      'select.mya-in{appearance:auto}' +
      '.mya-rand{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}' +
      '.mya-cu-buton{display:flex;gap:10px}.mya-cu-buton .mya-in{flex:1;min-width:0}' +
      '.mya-btn2{flex:0 0 auto;min-height:48px;border:1.5px solid #003366;border-radius:10px;background:#fff;color:#003366;font-weight:700;font-size:14.5px;padding:0 18px;cursor:pointer;font-family:inherit}' +
      '.mya-btn2:hover{background:#EBF4FB}' +
      '.mya-stare{font-size:13px;margin:6px 0 0;line-height:1.45}.mya-stare.ok{color:#1A7A3A}.mya-stare.err{color:#C0392B}.mya-stare.info{color:#5A6B7D}' +
      '.mya-bifa{display:flex;align-items:flex-start;gap:10px;font-size:14px;color:#2D3B4E;margin:0 0 16px;cursor:pointer;line-height:1.45}' +
      '.mya-bifa input{width:18px;height:18px;margin:2px 0 0;flex:0 0 auto;accent-color:#FF8C00}' +
      '.mya-nota{border:1px solid #D5DFE8;border-radius:10px;padding:12px 14px;font-size:14px;color:#2D3B4E;background:#F8FAFC;margin:0 0 16px;line-height:1.5}' +
      '.mya-lista{list-style:none;margin:0 0 16px;padding:0;border:1px solid #EEF2F6;border-radius:10px}' +
      '.mya-lista li{display:flex;justify-content:space-between;gap:10px;padding:10px 14px;border-top:1px solid #EEF2F6;font-size:14px}.mya-lista li:first-child{border-top:0}' +
      '.mya-lista small{color:#5A6B7D;white-space:nowrap}' +
      '.mya-nace{max-height:300px;overflow-y:auto;border:1px solid #D5DFE8;border-radius:10px;margin:8px 0 6px}' +
      '.mya-nace label{display:flex;align-items:center;gap:10px;padding:10px 12px;border-top:1px solid #EEF2F6;font-size:14px;cursor:pointer;min-height:44px}.mya-nace label:first-child{border-top:0}' +
      '.mya-nace input{width:18px;height:18px;flex:0 0 auto;accent-color:#FF8C00;margin:0}.mya-nace code{font-size:12.5px;color:#5A6B7D}' +
      '.mya-contract{max-height:280px;overflow:auto;border:1px solid #D5DFE8;border-radius:10px;padding:14px;font-size:13.5px;line-height:1.6;margin:0 0 16px}' +
      '.mya-subsol{display:flex;align-items:center;gap:16px;border-top:1px solid #EEF2F6;margin-top:24px;padding-top:20px}' +
      '.mya-inapoi{border:0;background:none;color:#2D3B4E;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;min-height:48px;padding:0 4px;white-space:nowrap}' +
      '.mya-auto{flex:1;text-align:center;font-size:13px;color:#5A6B7D;min-width:0}' +
      '.mya-continua{min-height:52px;border:0;border-radius:12px;background:#FF8C00;color:#fff;font-weight:800;font-size:16px;padding:0 26px;cursor:pointer;font-family:inherit;white-space:nowrap}' +
      '.mya-continua:hover{background:#E67E00}.mya-continua[disabled]{opacity:.9;cursor:default}' +
      '.mya-scurt{display:none}' +
      '@media (max-width:600px){' +
        '.mya-antet{padding:12px 16px}.mya-logo{height:34px}.mya-cont-txt{display:none}' +
        '.mya-actiuni>.mya-deconectare{display:none}.mya-meniu-btn{display:inline-block}' +
        '.mya-continut{padding:20px 16px 28px}.mya-cap h1{font-size:23px}' +
        '.mya-pasi{display:none}.mya-bara{margin-bottom:18px}' +
        '.mya-lung{display:none}.mya-scurt{display:inline}' +
        '.mya-rand{grid-template-columns:minmax(0,1fr)}.mya-cu-buton{flex-direction:column}' +
        '.mya-subsol{flex-wrap:wrap;gap:10px}.mya-auto{order:-1;flex:1 0 100%}' +
        '.mya-continua{flex:1}' +
      '}';
    (document.head || document.documentElement).appendChild(s);
  }

  // ── Starea ──
  var st = {
    profil: null, opt: {}, act: null, pas: 1, ciorna: { pas_curent: 1, date: {} },
    ciornaActiva: true, ceas: null, salvatLa: null, pasCurent: null, formularGata: false,
  };

  function antetAuth() {
    return window.supabaseClient.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      return s ? { Authorization: 'Bearer ' + s.access_token } : {};
    });
  }
  function cerere(url, o) {
    o = o || {};
    return antetAuth().then(function (h) {
      o.headers = Object.assign({}, h, o.headers || {});
      return window.MDFeedback.cerere(url, o);
    });
  }
  function citeste(url) { return cerere(url).catch(function () { return null; }); }

  function stare(cheie) { var x = st.act && st.act.pasi[PASI.indexOf(cheie)]; return x ? x.stare : 'de_completat'; }
  function facut(cheie) { var s = stare(cheie); return s === 'completat' || s === 'in_verificare'; }
  function deschis(n) { return n === 1 || facut('firma'); }
  function primulNefacut() {
    for (var i = 0; i < PASI.length; i++) if (!facut(PASI[i]) && stare(PASI[i]) !== 'dupa_verificare') return i + 1;
    return 6;
  }

  function reincarcaProfil() {
    return cerere('/api/cont/profil', { cache: 'no-store' }).then(function (p) {
      st.profil = p; st.act = p.activare; window.__MYD_PROFIL = p; return p;
    });
  }

  // ── Ciorna: salvare automată ──
  function valoriPas(radacina) {
    var o = {};
    Array.prototype.forEach.call(radacina.querySelectorAll('[data-ciorna]'), function (el) {
      var k = el.getAttribute('data-ciorna');
      if (el.type === 'checkbox') o[k] = el.checked;
      else if (el.type === 'radio') { if (el.checked) o[k] = el.value; }
      else o[k] = el.value;
    });
    if (st.pasCurent && st.pasCurent.ciornaExtra) Object.assign(o, st.pasCurent.ciornaExtra());
    return o;
  }
  function aplicaCiorna(radacina, date) {
    if (!date) return;
    Array.prototype.forEach.call(radacina.querySelectorAll('[data-ciorna]'), function (el) {
      var k = el.getAttribute('data-ciorna');
      if (!(k in date)) return;
      if (el.type === 'checkbox') el.checked = !!date[k];
      else if (el.type === 'radio') el.checked = date[k] === el.value;
      else el.value = date[k];
    });
  }
  function arataSalvat() {
    var z = $('mya-auto');
    if (!z || !st.salvatLa) return;
    var ora = new Date(st.salvatLa).toLocaleTimeString(en() ? 'en-GB' : 'ro-RO', { hour: '2-digit', minute: '2-digit' });
    z.textContent = tr('Salvat automat · {ora}', { ora: ora });
  }
  // doarPozitia: doar pasul curent (după schimbarea pasului), fără să citească
  // formularul, care încă nu are ciorna aplicată.
  function salveazaCiorna(doarPozitia) {
    clearTimeout(st.ceas);
    if (!st.ciornaActiva) return Promise.resolve();
    var corp = $('mya-corp');
    var cheie = PASI[st.pas - 1];
    if (corp && !doarPozitia && st.formularGata) st.ciorna.date[cheie] = valoriPas(corp);
    st.ciorna.pas_curent = st.pas;
    return cerere('/api/partener/activare-ciorna', { method: 'PUT', body: { pas_curent: st.pas, date: st.ciorna.date } })
      .then(function (j) { st.salvatLa = j.actualizat_la || new Date().toISOString(); arataSalvat(); })
      .catch(function (e) {
        // Fără tabelul ciornei (migrarea neaplicată) sau fără rol: salvarea automată se oprește.
        if (e && (e.status === 503 || e.status === 403 || e.cod === 'CIORNA_INDISPONIBILA')) st.ciornaActiva = false;
      });
  }
  // Câmpurile pasului curent, reținute local (fără cerere).
  function retineFormular() {
    var corp = $('mya-corp');
    if (corp && st.formularGata) st.ciorna.date[PASI[st.pas - 1]] = valoriPas(corp);
  }
  function programeaza(ms) { clearTimeout(st.ceas); st.ceas = setTimeout(function () { salveazaCiorna(false); }, ms); }
  function uitaCiornaPas(cheie) { delete st.ciorna.date[cheie]; }

  // ── Pașii ──
  function camp(id, eticheta, interior) {
    return '<div class="mya-camp"><label for="' + id + '">' + esc(tr(eticheta)) + '</label>' + interior + '</div>';
  }
  function intrare(id, nume, extra) {
    return '<input class="mya-in" id="' + id + '" name="' + nume + '" data-ciorna="' + nume + '"' + (extra || '') + '>';
  }
  function asiguraScript(src, gata) {
    if (gata()) return Promise.resolve();
    if (!document.querySelector('script[src$="' + src + '"]')) {
      var s = document.createElement('script'); s.src = '/' + src; document.head.appendChild(s);
    }
    return new Promise(function (ok) { var n = 0; (function v() { if (gata() || ++n > 60) return ok(); setTimeout(v, 80); })(); });
  }
  function regiuni(sel, valoare) {
    var tara = (st.profil && st.profil.tara) || 'RO';
    return fetch('/api/public/geo-regiuni?tara=' + encodeURIComponent(tara)).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var l = (j && j.regiuni) || [];
      sel.innerHTML = '<option value="">' + esc(tr('Alege județul')) + '</option>' + l.map(function (r) { return '<option value="' + esc(r.cod) + '">' + esc(r.denumire) + '</option>'; }).join('');
      if (valoare) sel.value = valoare;
    }).catch(function () { sel.innerHTML = '<option value="">' + esc(tr('Lista județelor nu e disponibilă acum')) + '</option>'; });
  }
  function eroareCamp(el, text) { var e = new Error(text); e.campuri = [{ camp: el, mesaj: text }]; return e; }

  var PAS = {};

  PAS.firma = function (corp) {
    corp.innerHTML =
      camp('mya-forma', 'Forma juridică', '<select class="mya-in" id="mya-forma" name="tip_entitate_legala" data-ciorna="tip_entitate_legala" required data-eticheta="' + esc(tr('Forma juridică')) + '"><option value="">' + esc(tr('Alege forma juridică')) + '</option></select>') +
      '<div class="mya-camp" id="mya-locala-wrap" hidden><label for="mya-locala">' + esc(tr('Forma juridică din țara firmei')) + '</label>' + intrare('mya-locala', 'forma_juridica_locala', ' maxlength="60" placeholder="GmbH, Ltd, EOOD"') + '</div>' +
      '<div class="mya-camp"><label for="mya-cui">CUI</label><div class="mya-cu-buton">' + intrare('mya-cui', 'cui', ' required maxlength="20" autocomplete="off" data-eticheta="CUI"') +
        '<button type="button" class="mya-btn2" id="mya-anaf">' + esc(tr('Caută la ANAF')) + '</button></div><div class="mya-stare" id="mya-anaf-stare" role="status"></div></div>' +
      camp('mya-firma', 'Denumirea', intrare('mya-firma', 'nume_firma', ' required maxlength="200" data-eticheta="' + esc(tr('Denumirea')) + '"')) +
      '<div class="mya-rand">' + camp('mya-reg', 'Nr. Reg. Com.', intrare('mya-reg', 'nr_reg_com', ' maxlength="40"')) +
        camp('mya-judet', 'Județul', '<select class="mya-in" id="mya-judet" name="regiune_cod" data-ciorna="regiune_cod"><option value="">…</option></select>') + '</div>' +
      camp('mya-sediu', 'Sediul social', intrare('mya-sediu', 'adresa_sediu_social', ' maxlength="300"')) +
      '<label class="mya-bifa" id="mya-trez-wrap" hidden><input type="checkbox" id="mya-trez" name="is_treasury_account" data-ciorna="is_treasury_account"><span>' + esc(tr('Contul bancar al instituției e un cont de trezorerie')) + '</span></label>';
    var forma = $('mya-forma');
    function arataLocala() {
      var straina = window.MDFormeJuridice && window.MDFormeJuridice.esteStraina(forma.value);
      $('mya-locala-wrap').hidden = !straina;
      $('mya-trez-wrap').hidden = forma.value !== 'institutie_publica';
    }
    forma.addEventListener('change', arataLocala);
    $('mya-anaf').onclick = function () { cautaAnaf(); };

    function cautaAnaf() {
      var cui = $('mya-cui').value.trim();
      var z = $('mya-anaf-stare');
      if (!cui) { z.className = 'mya-stare err'; z.textContent = tr('Scrie CUI-ul firmei.'); return; }
      z.className = 'mya-stare info'; z.textContent = tr('Se caută la ANAF…');
      fetch('/api/public/cui-lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tara: (st.profil && st.profil.tara) || 'RO', cui: cui }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.ok && d.cod === 'firma_inactiva') { z.className = 'mya-stare err'; z.textContent = (en() && d.motiv_en) || d.motiv; return; }
          if (d.ok && d.denumire) {
            z.className = 'mya-stare ok'; z.textContent = '✓ ' + tr('Firmă activă, găsită la ANAF');
            [['mya-firma', d.denumire], ['mya-reg', d.nr_reg_com], ['mya-sediu', d.adresa]].forEach(function (x) { var el = $(x[0]); if (x[1] && !el.value.trim()) el.value = x[1]; });
            programeaza(300);
            return;
          }
          z.className = 'mya-stare info';
          z.textContent = d.cod && d.motiv ? ((en() && d.motiv_en) || d.motiv) : tr('Nu am găsit date la ANAF. Completează manual.');
        })
        .catch(function () { z.className = 'mya-stare info'; z.textContent = tr('Căutarea la ANAF nu e disponibilă acum. Completează manual.'); });
    }

    var gata = asiguraScript('forme-juridice-public.js', function () { return !!window.MDFormeJuridice; }).then(function () {
      if (window.MDFormeJuridice) window.MDFormeJuridice.completeazaSelect(forma);
      return facut('firma') ? citeste('/api/partener/wizard-companie') : null;
    }).then(function (j) {
      var p = j && j.partner;
      if (p) {
        if (window.MDFormeJuridice) window.MDFormeJuridice.completeazaSelect(forma, p.tip_entitate_legala);
        [['mya-cui', p.cui], ['mya-firma', p.nume_firma], ['mya-reg', p.nr_reg_com], ['mya-sediu', p.adresa_sediu_social], ['mya-locala', p.forma_juridica_locala]].forEach(function (x) { if (x[1]) $(x[0]).value = x[1]; });
        $('mya-trez').checked = !!p.is_treasury_account;
      }
      return regiuni($('mya-judet'), p && p.regiune_cod);
    });
    return {
      gata: gata.then(arataLocala),
      dupaCiorna: arataLocala,
      salveaza: function () {
        var body = {
          partner_type: st.act.tip,
          tip_entitate_legala: forma.value,
          cui: $('mya-cui').value.trim(),
          nume_firma: $('mya-firma').value.trim(),
          nr_reg_com: $('mya-reg').value.trim(),
          adresa_sediu_social: $('mya-sediu').value.trim(),
          regiune_cod: $('mya-judet').value || null,
          is_treasury_account: forma.value === 'institutie_publica' && $('mya-trez').checked,
        };
        if (window.MDFormeJuridice && window.MDFormeJuridice.esteStraina(body.tip_entitate_legala)) {
          body.forma_juridica_locala = $('mya-locala').value.trim();
          if (!body.forma_juridica_locala) throw eroareCamp($('mya-locala'), tr('Scrie forma juridică din țara firmei (de exemplu GmbH, Ltd, EOOD).'));
        }
        return cerere('/api/partener/wizard-companie', { method: 'POST', body: body });
      },
    };
  };

  PAS.cont_bancar = function (corp) {
    var numeFirma = (st.profil && st.profil.partener && st.profil.partener.nume_firma) || '';
    corp.innerHTML =
      '<div id="mya-conturi"></div>' +
      camp('mya-titular', 'Titularul contului', intrare('mya-titular', 'nume_titular', ' maxlength="200"')) +
      camp('mya-iban', 'IBAN', '<input class="mya-in" id="mya-iban" name="iban" maxlength="40" autocomplete="off" style="font-family:monospace">') +
      '<div class="mya-rand">' + camp('mya-banca', 'Banca', intrare('mya-banca', 'banca', ' maxlength="120"')) +
        camp('mya-moneda', 'Moneda', '<select class="mya-in" id="mya-moneda" name="moneda" data-ciorna="moneda"><option>RON</option><option>EUR</option><option>MDL</option><option>BGN</option><option>GBP</option></select>') + '</div>' +
      '<p class="mya-stare info">' + esc(tr('IBAN-ul nu se păstrează în ciornă; îl scrii din nou dacă reîncarci pagina înainte de salvare.')) + '</p>';
    $('mya-titular').value = numeFirma;
    var conturi = [];
    var gata = citeste('/api/partener/conturi-bancare').then(function (j) {
      conturi = (j && j.conturi) || [];
      if (conturi.length) {
        $('mya-conturi').innerHTML = '<div class="mya-nota">' + esc(tr('Cont salvat:')) + ' ' + conturi.map(function (c) { return esc((c.iban_mascat || '') + ' · ' + (c.banca || '')); }).join(', ') +
          '<br><span class="mya-stare info">' + esc(tr('Poți continua sau poți adăuga alt cont mai jos.')) + '</span></div>';
      }
    });
    return {
      gata: gata,
      salveaza: function () {
        var iban = $('mya-iban').value.replace(/\s+/g, '').toUpperCase();
        var titular = $('mya-titular').value.trim(), banca = $('mya-banca').value.trim();
        if (!iban && conturi.length) return Promise.resolve();
        var lipsa = [];
        if (!titular) lipsa.push({ camp: $('mya-titular'), mesaj: tr('Scrie titularul contului.') });
        if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{8,30}$/.test(iban)) lipsa.push({ camp: $('mya-iban'), mesaj: tr('IBAN-ul nu e valid. Exemplu: RO49AAAA1B31007593840000') });
        if (!banca) lipsa.push({ camp: $('mya-banca'), mesaj: tr('Scrie banca.') });
        if (lipsa.length) { var e = new Error(tr('Verifică câmpurile marcate.')); e.campuri = lipsa; throw e; }
        return cerere('/api/partener/conturi-bancare', { method: 'POST', body: { nume_titular: titular, iban: iban, banca: banca, moneda: $('mya-moneda').value } });
      },
    };
  };

  PAS.profesii = function (corp) {
    if (st.act.tip === 'curier') return pasZoneCurier(corp);
    corp.innerHTML =
      '<div class="mya-camp"><label for="mya-nace-caut">' + esc(tr('Caută activitatea')) + '</label>' +
      '<input class="mya-in" id="mya-nace-caut" placeholder="' + esc(tr('De exemplu: instalații, construcții, comerț')) + '" autocomplete="off"></div>' +
      '<div class="mya-eticheta" id="mya-nace-titlu">' + esc(tr('Cod principal (unul) și coduri secundare (cel mult 15)')) + '</div>' +
      '<div class="mya-nace" id="mya-nace" role="group" aria-labelledby="mya-nace-titlu"><div style="padding:12px;color:#5A6B7D">' + esc(tr('Se încarcă lista…')) + '</div></div>' +
      '<div class="mya-stare info" id="mya-nace-ales"></div>';
    var toate = [], principal = null, secundare = [];
    function deseneaza() {
      var q = $('mya-nace-caut').value.trim().toLowerCase();
      var lista = toate.filter(function (c) { return !q || c.cod.indexOf(q) === 0 || String(c.denumire || '').toLowerCase().indexOf(q) !== -1 || c.cod === principal || secundare.indexOf(c.cod) !== -1; }).slice(0, 80);
      $('mya-nace').innerHTML = lista.map(function (c) {
        return '<label><input type="radio" name="mya-principal" value="' + esc(c.cod) + '"' + (c.cod === principal ? ' checked' : '') + ' aria-label="' + esc(tr('Principal')) + ' ' + esc(c.cod) + '">' +
          '<input type="checkbox" value="' + esc(c.cod) + '"' + (secundare.indexOf(c.cod) !== -1 ? ' checked' : '') + (c.cod === principal ? ' disabled' : '') + ' aria-label="' + esc(tr('Secundar')) + ' ' + esc(c.cod) + '">' +
          '<span><code>' + esc(c.cod) + '</code> ' + esc(c.denumire || '') + '</span></label>';
      }).join('') || '<div style="padding:12px;color:#5A6B7D">' + esc(tr('Nicio activitate găsită.')) + '</div>';
      $('mya-nace-ales').textContent = principal ? tr('Principal: {cod} · secundare: {n}', { cod: principal, n: secundare.length }) : tr('Alege codul principal (cercul) și, opțional, coduri secundare (bifele).');
    }
    corp.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'mya-principal') { principal = t.value; secundare = secundare.filter(function (c) { return c !== principal; }); }
      else if (t.type === 'checkbox' && t.closest('#mya-nace')) {
        if (t.checked && secundare.length >= 15) { t.checked = false; return; }
        secundare = t.checked ? secundare.concat(t.value) : secundare.filter(function (c) { return c !== t.value; });
      }
      deseneaza();
    });
    var gata = Promise.all([
      fetch('/api/public/nace-lista?lang=' + (en() ? 'en' : 'ro')).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      citeste('/api/partener/wizard-nace?lang=' + (en() ? 'en' : 'ro')),
    ]).then(function (r) {
      toate = (r[0] && r[0].clase) || [];
      var c = (r[1] && r[1].coduri) || [];
      if (c.length) {
        principal = (c.find(function (x) { return x.principal; }) || c[0]).cod_nace;
        secundare = c.filter(function (x) { return x.cod_nace !== principal; }).map(function (x) { return x.cod_nace; });
      }
      $('mya-nace-caut').addEventListener('input', deseneaza);
      deseneaza();
    });
    return {
      gata: gata,
      ciornaExtra: function () { return { principal: principal, secundare: secundare }; },
      dupaCiorna: function (d) { if (d && d.principal) { principal = d.principal; secundare = d.secundare || []; deseneaza(); } },
      salveaza: function () {
        if (!principal) throw eroareCamp($('mya-nace-caut'), tr('Alege codul NACE principal.'));
        return cerere('/api/partener/wizard-nace', { method: 'POST', body: { principal: principal, secundare: secundare } });
      },
    };
  };

  function pasZoneCurier(corp) {
    corp.innerHTML = '<div id="mya-zone"></div>' +
      '<div class="mya-rand">' + camp('mya-z-judet', 'Județul', '<select class="mya-in" id="mya-z-judet" name="regiune_cod" data-ciorna="regiune_cod"><option value="">…</option></select>') +
        camp('mya-z-raza', 'Raza de livrare (km)', intrare('mya-z-raza', 'raza_livrare_km', ' type="number" min="1" max="200" inputmode="numeric"')) + '</div>' +
      camp('mya-z-loc', 'Localitatea (opțional)', intrare('mya-z-loc', 'localitate', ' maxlength="120"'));
    var zone = [];
    var gata = Promise.all([citeste('/api/partener/zona-curier'), regiuni($('mya-z-judet'))]).then(function (r) {
      zone = (r[0] && r[0].zone) || [];
      if (zone.length) $('mya-zone').innerHTML = '<ul class="mya-lista">' + zone.map(function (z) { return '<li><span>' + esc([z.regiune_cod, z.localitate].filter(Boolean).join(' · ') || z.tara_cod) + '</span><small>' + esc(z.raza_livrare_km ? z.raza_livrare_km + ' km' : '') + '</small></li>'; }).join('') + '</ul>';
    });
    return {
      gata: gata,
      salveaza: function () {
        var reg = $('mya-z-judet').value, raza = Number($('mya-z-raza').value);
        if (!reg && zone.length) return Promise.resolve();
        if (!reg) throw eroareCamp($('mya-z-judet'), tr('Alege județul în care livrezi.'));
        if (!(raza >= 1 && raza <= 200)) throw eroareCamp($('mya-z-raza'), tr('Scrie raza de livrare, între 1 și 200 km.'));
        return cerere('/api/partener/zona-curier', { method: 'POST', body: { tara_cod: (st.profil && st.profil.tara) || 'RO', regiune_cod: reg, localitate: $('mya-z-loc').value.trim() || null, raza_livrare_km: raza } });
      },
    };
  }

  PAS.dotari = function (corp) {
    var tip = st.act.tip;
    if (tip === 'materiale' || tip === 'inchirieri') return pasCatalog(corp, tip);
    if (tip === 'asigurari') return pasPolite(corp);
    var curier = tip === 'curier';
    corp.innerHTML = '<div id="mya-utilaje"></div>' +
      '<div class="mya-rand">' +
        (curier
          ? camp('mya-u-den', 'Tipul vehiculului', '<select class="mya-in" id="mya-u-den" name="denumire" data-ciorna="denumire"><option value="">' + esc(tr('Alege vehiculul')) + '</option>' + VEHICULE.map(function (v) { return '<option value="' + esc(v) + '">' + esc(tr(v)) + '</option>'; }).join('') + '</select>')
          : camp('mya-u-den', 'Utilajul sau scula', intrare('mya-u-den', 'denumire', ' maxlength="120" placeholder="' + esc(tr('De exemplu: aparat de sudură PPR')) + '"'))) +
        camp('mya-u-cant', 'Cantitatea', intrare('mya-u-cant', 'cantitate', ' type="number" min="1" max="999" inputmode="numeric" value="1"')) +
      '</div>' +
      (curier ? '' : '<p class="mya-stare info">' + esc(tr('Echipa și certificările (de exemplu ISCIR) le poți adăuga și mai târziu, din „Completare profil partener”.')) + ' <a href="/mydarrin-devino-partener-wizard.html?pas=5" style="color:#003366;font-weight:700">' + esc(tr('Deschide')) + '</a></p>');
    var existente = [];
    var gata = citeste('/api/partener/wizard-utilaje').then(function (j) {
      existente = (j && j.utilaje) || [];
      if (existente.length) $('mya-utilaje').innerHTML = '<ul class="mya-lista">' + existente.map(function (u) { return '<li><span>' + esc(u.denumire) + '</span><small>× ' + esc(u.cantitate || 1) + '</small></li>'; }).join('') + '</ul>';
    });
    return {
      gata: gata,
      salveaza: function () {
        var den = $('mya-u-den').value.trim(), cant = Number($('mya-u-cant').value) || 1;
        if (!den && existente.length) return Promise.resolve();
        if (!den) throw eroareCamp($('mya-u-den'), curier ? tr('Alege vehiculul cu care livrezi.') : tr('Scrie cel puțin un utilaj sau o sculă.'));
        return cerere('/api/partener/wizard-utilaje', { method: 'POST', body: { utilaje: [{ denumire: den, cantitate: cant, tip: curier ? 'vehicul' : undefined }] } });
      },
    };
  };

  function pasPolite(corp) {
    corp.innerHTML = '<div id="mya-polite"></div>' +
      camp('mya-p-tip', 'Tipul poliței', intrare('mya-p-tip', 'tip_polita', ' maxlength="200" placeholder="' + esc(tr('De exemplu: garanție lucrare')) + '"')) +
      '<div class="mya-rand">' + camp('mya-p-lim', 'Limita de acoperire (EUR)', intrare('mya-p-lim', 'limita_acoperire_eur', ' type="number" min="0" inputmode="decimal"')) +
        camp('mya-p-com', 'Discount (%)', intrare('mya-p-com', 'comision_pct', ' type="number" min="0" max="100" step="0.5" inputmode="decimal"')) + '</div>';
    var existente = [];
    var gata = citeste('/api/partener/tipuri-polita').then(function (j) {
      existente = (j && j.tipuri) || [];
      if (existente.length) $('mya-polite').innerHTML = '<ul class="mya-lista">' + existente.map(function (t) { return '<li><span>' + esc(t.tip_polita) + '</span><small>' + esc(t.limita_acoperire_eur ? t.limita_acoperire_eur + ' EUR' : '') + '</small></li>'; }).join('') + '</ul>';
    });
    return {
      gata: gata,
      salveaza: function () {
        var tip = $('mya-p-tip').value.trim();
        if (!tip && existente.length) return Promise.resolve();
        if (!tip) throw eroareCamp($('mya-p-tip'), tr('Scrie cel puțin un tip de poliță.'));
        var body = { tip_polita: tip };
        if ($('mya-p-lim').value) body.limita_acoperire_eur = Number($('mya-p-lim').value);
        if ($('mya-p-com').value) body.comision_pct = Number($('mya-p-com').value);
        return cerere('/api/partener/tipuri-polita', { method: 'POST', body: body });
      },
    };
  }

  function pasCatalog(corp, tip) {
    var panou = tip === 'materiale' ? 'produse' : 'echipamente';
    corp.innerHTML = '<div class="mya-nota" id="mya-catalog-stare">' + esc(facut('dotari') ? tr('Catalogul are deja produse. Poți continua.') : tr('Catalogul e încă gol. Adaugă cel puțin un produs, apoi revino aici.')) + '</div>' +
      '<button type="button" class="mya-btn2" id="mya-catalog">' + esc(tr('Deschide catalogul')) + '</button>';
    $('mya-catalog').onclick = function () { inchide(); var a = st.opt.actiuni || {}; if (typeof a.panou === 'function') a.panou(panou); };
    return {
      gata: Promise.resolve(),
      salveaza: function () {
        return reincarcaProfil().then(function () {
          if (!facut('dotari')) throw eroareCamp($('mya-catalog'), tr('Adaugă cel puțin un produs în catalog.'));
        });
      },
    };
  }

  PAS.documente = function (corp) {
    var tip = st.act.tip;
    var recomandat = { curier: ['ci', 'licenta_arr', 'asigurare'], asigurari: ['ci', 'certificat', 'licenta'], servicii: ['ci', 'certificat', 'licenta'] }[tip] || ['ci', 'certificat', 'cui'];
    corp.innerHTML = '<div id="mya-docs"></div>' +
      '<p class="mya-stare info" style="margin:0 0 14px">' + esc(tr('Recomandat pentru tipul tău:')) + ' ' + recomandat.map(function (k) { return esc(tr(DOCUMENTE[k])); }).join(', ') + '.</p>' +
      camp('mya-d-tip', 'Tipul documentului', '<select class="mya-in" id="mya-d-tip" name="tip_document" data-ciorna="tip_document">' + Object.keys(DOCUMENTE).map(function (k) { return '<option value="' + k + '">' + esc(tr(DOCUMENTE[k])) + '</option>'; }).join('') + '</select>') +
      camp('mya-d-fis', 'Fișierul (PDF, JPG sau PNG, cel mult 10 MB)', '<input class="mya-in" id="mya-d-fis" type="file" accept=".pdf,.jpg,.jpeg,.png">') +
      '<button type="button" class="mya-btn2" id="mya-d-incarca">' + esc(tr('Încarcă documentul')) + '</button><div id="mya-d-msg"></div>';
    var documente = [];
    function lista() {
      return citeste('/api/partener/cont').then(function (j) {
        documente = (j && j.documente) || [];
        $('mya-docs').innerHTML = documente.length ? '<ul class="mya-lista">' + documente.map(function (d) {
          return '<li><span>' + esc(tr(DOCUMENTE[d.tip_document] || d.tip_document)) + '</span><small>' + esc(d.status === 'pending' ? tr('În verificare') : d.status === 'approved' || d.status === 'aprobat' ? tr('Aprobat') : tr(d.status || '')) + '</small></li>';
        }).join('') + '</ul>' : '';
      });
    }
    $('mya-d-incarca').onclick = function () {
      var btn = this;
      window.MDFeedback.salveaza(btn, $('mya-d-msg'), function () {
        var f = $('mya-d-fis').files[0];
        var EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
        if (!f) throw eroareCamp($('mya-d-fis'), tr('Alege fișierul.'));
        if (!EXT[f.type]) throw eroareCamp($('mya-d-fis'), tr('Acceptăm doar PDF, JPG sau PNG.'));
        if (f.size > 10 * 1024 * 1024) throw eroareCamp($('mya-d-fis'), tr('Fișierul depășește 10 MB.'));
        var tipDoc = $('mya-d-tip').value;
        return window.supabaseClient.auth.getSession().then(function (r) {
          var uid = r && r.data && r.data.session && r.data.session.user && r.data.session.user.id;
          if (!uid) throw new Error(tr('Sesiunea a expirat. Autentifică-te din nou.'));
          var cale = uid + '/doc-' + tipDoc + '-' + Date.now() + '.' + EXT[f.type];
          return window.supabaseClient.storage.from('partner-certificari').upload(cale, f, { contentType: f.type, upsert: false }).then(function (u) {
            if (u.error) throw new Error(tr('Încărcarea fișierului a eșuat. Încearcă din nou.'));
            return cerere('/api/partener/documente', { method: 'POST', body: { tip_document: tipDoc, document_path: cale } });
          });
        }).then(function () { $('mya-d-fis').value = ''; return lista().then(function () { return tr('Document încărcat. Îl verifică echipa My Darrin.'); }); });
      }, { form: corp, textSalveaza: tr('Se încarcă…'), textOk: tr('✓ Încărcat') });
    };
    return {
      gata: lista(),
      salveaza: function () {
        if (!documente.length) throw eroareCamp($('mya-d-fis'), tr('Încarcă cel puțin un document.'));
        return Promise.resolve();
      },
    };
  };

  PAS.contract = function (corp) {
    var s = stare('contract');
    if (s === 'completat') {
      corp.innerHTML = '<div class="mya-nota">✓ ' + esc(tr('Contractul e semnat.')) + '</div>';
      return { gata: Promise.resolve(), final: true, salveaza: function () { return Promise.resolve(); } };
    }
    if (s === 'dupa_verificare') {
      corp.innerHTML = '<div class="mya-nota">' + esc(tr('Contractul se semnează după verificarea firmei de către echipa My Darrin (cel mult 48 de ore). Te anunțăm prin email; revii aici pentru semnare.')) + '</div>';
      return { gata: Promise.resolve(), final: true, salveaza: function () { return Promise.resolve(); } };
    }
    corp.innerHTML = '<div class="mya-contract" id="mya-ct-text" lang="ro">' + esc(tr('Se încarcă…')) + '</div>' +
      '<button type="button" class="mya-btn2" id="mya-ct-trimite">' + esc(tr('Trimite codul pe email')) + '</button><div id="mya-ct-msg"></div>' +
      '<div class="mya-camp" style="margin-top:16px"><label for="mya-ct-cod">' + esc(tr('Codul din email')) + '</label>' +
      '<input class="mya-in" id="mya-ct-cod" name="cod" inputmode="numeric" maxlength="6" autocomplete="one-time-code" style="max-width:200px;font-family:monospace"></div>';
    var gata = citeste('/api/partener/contract').then(function (j) {
      // HTML-ul contractului e generat de server (lib/contract-partener.js), din datele contului.
      $('mya-ct-text').innerHTML = j ? '<strong>' + esc(j.numar || '') + '</strong> · ' + esc(j.titlu || '') + '<div style="margin-top:8px">' + (j.html || '') + '</div>' : esc(tr('Nu am putut încărca contractul.'));
    });
    $('mya-ct-trimite').onclick = function () {
      window.MDFeedback.salveaza(this, $('mya-ct-msg'), function () {
        return cerere('/api/partener/contract-trimite-otp', { method: 'POST', body: {} }).then(function (j) { return j && j.deja_semnat ? tr('Contractul e deja semnat.') : tr('Ți-am trimis codul pe email.'); });
      }, { textSalveaza: tr('Se trimite…'), textOk: tr('✓ Trimis') });
    };
    return {
      gata: gata, final: true, eticheta: 'Semnează contractul',
      salveaza: function () {
        var cod = $('mya-ct-cod').value.replace(/\D/g, '');
        if (!/^[0-9]{6}$/.test(cod)) throw eroareCamp($('mya-ct-cod'), tr('Codul are 6 cifre. Îl găsești în emailul primit.'));
        return cerere('/api/partener/contract-confirma-otp', { method: 'POST', body: { cod: cod } });
      },
    };
  };

  // ── Pagina ──
  function antetHtml() {
    var p = st.profil || {};
    var dr = window.MYD_DESTINATIE_ROL;
    var d = dr && dr.definitie(st.act.rol);
    var nume = (p.partener && p.partener.nume_firma) || p.nume || String(p.email || '').split('@')[0];
    return '<header class="mya-antet"><img class="mya-logo" src="' + LOGO + '" alt="My Darrin · Home Best Pal" width="120" height="40">' +
      '<div class="mya-cont"><div class="mya-cont-txt"><b>' + esc(nume) + '</b> <span>· ' + esc(tr(d ? d.titlu : '')) + '</span></div>' +
      '<div class="mya-actiuni">' +
        '<a class="mya-site" id="mya-site" href="/">' + esc(tr('Înapoi la site')) + '</a>' +
        '<button type="button" class="mya-deconectare" id="mya-deconectare">' + esc(tr('Deconectare')) + '</button>' +
        '<button type="button" class="mya-meniu-btn" id="mya-meniu-btn" aria-haspopup="true" aria-expanded="false" aria-controls="mya-meniu" aria-label="' + esc(tr('Mai multe')) + '">⋯</button>' +
        '<div class="mya-meniu" id="mya-meniu" hidden><button type="button" class="mya-deconectare" id="mya-deconectare-meniu">' + esc(tr('Deconectare')) + '</button></div>' +
      '</div></div></header>';
  }

  // „Înapoi la site”: ciorna se salvează (cel mult 3 s), apoi pagina principală.
  // Sesiunea rămâne: la revenire, dashboard-ul deschide activarea la pasul rămas.
  function inapoiLaSite(e) {
    if (e) e.preventDefault();
    var pleaca = function () { window.location.href = '/'; };
    Promise.race([salveazaCiorna(false), new Promise(function (ok) { setTimeout(ok, 3000); })]).then(pleaca, pleaca);
  }
  // „Deconectare”: doar după confirmare (MDFeedback.confirma), cu ciorna salvată.
  function deconectare() {
    $('mya-meniu').hidden = true;
    $('mya-meniu-btn').setAttribute('aria-expanded', 'false');
    var intreaba = window.MDFeedback && window.MDFeedback.confirma
      ? window.MDFeedback.confirma(tr('Te deconectezi? Ce ai completat e salvat; data viitoare intri cu emailul și parola.'), { textOk: tr('Deconectează-mă'), textAnulare: tr('Rămân conectat') })
      : Promise.resolve(false);
    intreaba.then(function (da) {
      if (!da) return;
      Promise.race([salveazaCiorna(false), new Promise(function (ok) { setTimeout(ok, 3000); })])
        .then(function () { window.MyDarrinAuth.performLogout(); });
    });
  }
  function leagaAntet() {
    $('mya-site').onclick = inapoiLaSite;
    $('mya-deconectare').onclick = deconectare;
    $('mya-deconectare-meniu').onclick = deconectare;
    $('mya-meniu-btn').onclick = function (e) {
      e.stopPropagation();
      var m = $('mya-meniu');
      m.hidden = !m.hidden;
      this.setAttribute('aria-expanded', String(!m.hidden));
      if (!m.hidden) $('mya-deconectare-meniu').focus();
    };
    // Meniul mic (telefon) se închide la un clic în afara lui; ascultătorul se pune o singură dată.
    var rad = $('myd-activare-pagina');
    if (rad.__myaMeniu) return;
    rad.__myaMeniu = true;
    rad.addEventListener('click', function (e) {
      var m = $('mya-meniu');
      if (m && !m.hidden && !e.target.closest('.mya-actiuni')) { m.hidden = true; $('mya-meniu-btn').setAttribute('aria-expanded', 'false'); }
    });
  }

  function randeaza() {
    var rad = $('myd-activare-pagina');
    var cheie = PASI[st.pas - 1];
    var tip = st.act.tip;
    var facute = PASI.filter(facut).length;
    rad.innerHTML = antetHtml() +
      '<main class="mya-continut">' +
        '<div class="mya-cap"><h1 id="mya-titlu">' + esc(tr('Activează contul')) + '</h1>' +
        '<span class="mya-nr"><span class="mya-lung">' + esc(tr('Pasul {n} din {total}', { n: st.pas, total: 6 })) + '</span><span class="mya-scurt">' + st.pas + ' / 6</span></span></div>' +
        '<div class="mya-bara" role="progressbar" aria-valuemin="0" aria-valuemax="6" aria-valuenow="' + facute + '" aria-label="' + esc(tr('Progresul activării')) + '"><i style="width:' + Math.round(st.pas / 6 * 100) + '%"></i></div>' +
        '<ol class="mya-pasi">' + PASI.map(function (k, i) {
          var n = i + 1, cls = n === st.pas ? 'curent' : facut(k) ? 'facut' : '';
          var poate = n !== st.pas && deschis(n) && (facut(k) || n < st.pas);
          return '<li><button type="button" class="' + cls + '"' + (poate ? ' data-deschis data-pas="' + n + '"' : ' tabindex="-1"') + (n === st.pas ? ' aria-current="step"' : '') + '><b>' + (facut(k) && n !== st.pas ? '✓' : n) + '</b><span>' + esc(tr(NUME_SCURT[k])) + '</span></button></li>';
        }).join('') + '</ol>' +
        '<section class="mya-pas" aria-labelledby="mya-pas-titlu"><h2 id="mya-pas-titlu">' + esc(tr(dupaTip(TITLU[cheie], tip))) + '</h2>' +
        '<p class="mya-sub">' + esc(tr(dupaTip(SUB[cheie], tip))) + '</p>' +
        '<form id="mya-corp" novalidate></form><div id="mya-msg"></div></section>' +
        '<div class="mya-subsol">' +
          (st.pas > 1 ? '<button type="button" class="mya-inapoi" id="mya-inapoi">← ' + esc(tr('Înapoi')) + '</button>' : '') +
          '<span class="mya-auto" id="mya-auto" aria-live="polite"></span>' +
          '<button type="button" class="mya-continua" id="mya-continua"></button>' +
        '</div>' +
      '</main>';
    var corp = $('mya-corp');
    st.formularGata = false;
    st.pasCurent = PAS[cheie](corp);
    var pc = st.pasCurent;
    var bt = $('mya-continua');
    if (pc.final && (stare('contract') === 'dupa_verificare' || stare('contract') === 'completat')) bt.textContent = tr('Mergi la dashboard') + ' →';
    else if (pc.eticheta) bt.textContent = tr(pc.eticheta);
    else bt.innerHTML = '<span class="mya-lung">' + esc(tr('Salvează și continuă')) + ' →</span><span class="mya-scurt">' + esc(tr('Continuă')) + ' →</span>';
    // Ciorna pasului (valori încă nesalvate), după ce s-au încărcat datele salvate.
    Promise.resolve(pc.gata).then(function () {
      var d = st.ciorna.date[cheie];
      if (d) { aplicaCiorna(corp, d); if (pc.dupaCiorna) pc.dupaCiorna(d); }
      st.formularGata = true;
      arataSalvat();
    });
    corp.addEventListener('input', function () { programeaza(2500); });
    corp.addEventListener('change', function () { programeaza(400); });
    corp.addEventListener('focusout', function () { programeaza(400); });
    corp.addEventListener('submit', function (e) { e.preventDefault(); continua(); });
    bt.onclick = continua;
    if ($('mya-inapoi')) $('mya-inapoi').onclick = function () { retineFormular(); mergiLa(st.pas - 1); };
    leagaAntet();
    Array.prototype.forEach.call(rad.querySelectorAll('.mya-pasi [data-deschis]'), function (b) {
      b.onclick = function () { retineFormular(); mergiLa(Number(b.getAttribute('data-pas'))); };
    });
    rad.scrollTop = 0;
    var primul = corp.querySelector('input:not([type=hidden]),select');
    if (primul && window.innerWidth > 600) { try { primul.focus({ preventScroll: true }); } catch (e) {} }
  }

  function mergiLa(n) {
    if (n < 1 || n > 6 || !deschis(n)) return;
    // Ciorna pasului părăsit e deja reținută; o singură salvare, cu poziția nouă.
    clearTimeout(st.ceas);
    st.pas = n; randeaza(); salveazaCiorna(true);
  }

  function continua() {
    var btn = $('mya-continua');
    var cheie = PASI[st.pas - 1];
    var pc = st.pasCurent;
    if (pc.final && (stare('contract') === 'dupa_verificare' || stare('contract') === 'completat')) { termina(); return; }
    clearTimeout(st.ceas);
    window.MDFeedback.salveaza(btn, $('mya-msg'), function () {
      return Promise.resolve().then(function () { return pc.salveaza(); }).then(function () {
        uitaCiornaPas(cheie);
        return reincarcaProfil();
      }).then(function () { return tr('Pasul a fost salvat.'); });
    }, { form: $('mya-corp'), textSalveaza: tr('Se salvează…'), textOk: tr('✓ Salvat') }).then(function (r) {
      if (!r || !r.ok) return;
      masoaraPas(cheie);
      if (cheie === 'contract') { termina(); return; }
      setTimeout(function () { st.pas = Math.min(6, st.pas + 1); randeaza(); salveazaCiorna(true); }, 500);
    });
  }

  // Pasul 11-A1: pasul salvat (și activarea completă), în pâlnia de măsurare.
  // Fără date personale: doar numele pasului și tipul de partener.
  function masoaraPas(cheie) {
    var M = window.MYD_MASURARE;
    if (!M) return;
    var tip = M.tip(st.act && st.act.tip) || undefined;
    M.eveniment('partner_step_completed', { step: M.pas(cheie), partner_type: tip });
    if (st.act && st.act.complet && !st.activareMasurata) {
      st.activareMasurata = true;
      M.eveniment('partner_activation_completed', { partner_type: tip });
    }
  }

  // Activarea s-a încheiat (sau așteaptă verificarea): dashboard-ul.
  function termina() {
    if (st.act && st.act.complet !== false && stare('contract') === 'completat') {
      cerere('/api/partener/activare-ciorna', { method: 'DELETE' }).catch(function () {});
    }
    inchide();
    try { sessionStorage.setItem('myd_activare_inchisa', '1'); } catch (e) {}
    location.reload();
  }

  function inchide() {
    var rad = $('myd-activare-pagina');
    if (rad) rad.remove();
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  /**
   * Deschide fluxul de activare peste dashboard.
   * @param {object} profil  /api/cont/profil (cu activare)
   * @param {object} optiuni cele din MYD_PAZA.verifica (actiuni.panou etc.)
   * @param {{pas?: number}} [cum]
   */
  function deschide(profil, optiuni, cum) {
    if (!profil || !profil.activare) return null;
    stil();
    st.profil = profil; st.act = profil.activare; st.opt = optiuni || {};
    var rad = $('myd-activare-pagina');
    if (!rad) {
      rad = document.createElement('div');
      rad.id = 'myd-activare-pagina';
      rad.setAttribute('role', 'region');
      rad.setAttribute('aria-label', tr('Activează contul'));
      document.body.appendChild(rad);
    }
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    rad.innerHTML = antetHtml() + '<main class="mya-continut"><p class="mya-sub">' + esc(tr('Se încarcă…')) + '</p></main>';
    leagaAntet();
    return cerere('/api/partener/activare-ciorna').then(function (j) {
      if (j && j.ciorna) st.ciorna = { pas_curent: j.ciorna.pas_curent, date: j.ciorna.date || {} };
      if (j && j.ciorna) st.salvatLa = j.ciorna.actualizat_la;
    }).catch(function (e) { if (e && (e.status === 503 || e.cod === 'CIORNA_INDISPONIBILA')) st.ciornaActiva = false; }).then(function () {
      var ceruta = cum && cum.pas;
      var dinCiorna = st.ciorna && st.ciorna.pas_curent;
      var pas = ceruta || dinCiorna || primulNefacut();
      st.pas = deschis(pas) ? pas : 1;
      randeaza();
      return rad;
    });
  }

  window.MYD_ACTIVARE = { deschide: deschide, inchide: inchide, PASI: PASI };
})();
