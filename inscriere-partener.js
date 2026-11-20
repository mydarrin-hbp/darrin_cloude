/* ════════════════════════════════════════════════════════════════
   MY DARRIN — inscriere-partener.js, pasul 12-P1 (17 nov. 2026)

   Pagina /parteneri/inscriere (mydarrin-inscriere-partener.html, macheta B1.1).
   - „Ce faci?” → rol_solicitat; ?categorie=<servicii|materiale|…> o preselectează;
   - Pasul 12-P2 (20 nov. 2026, temporar până la macheta B2): la Servicii, Materiale
     și Închirieri, „Categoria principală” din arborele unic (/api/public/categorii,
     tabelul categorii), în locul profesiei. Lista se schimbă cu tipul; ultima opțiune
     e „Altceva”, cu un text opțional (cel mult 80), ca nimeni să nu fie blocat.
     La Curier și Asigurări câmpul nu apare. Reclamele:
       ?domeniu=<slug>  — preselectează categoria;
       ?profesie=<slug> — indiciu: se salvează (profesie_slug) și preselectează
                          categoria legată de profesie (același NACE), dacă există.
     Fără listă (API indisponibil): rămâne doar textul opțional, contul se creează.
     Profesia, competențele, serviciile și zona se aleg în panou, după cont;
   - „Creează cont de partener”: MDCont.inregistreaza (cont-fereastra.js, aceeași
     înregistrare Supabase ca în fereastra de cont), apoi ecranul de cod (B1.2);
   - tipul, categoria și orașul se păstrează în sesiune și intră în ciorna
     activării după cod (MDCont.salveazaPreinscriere); serverul le verifică
     (api/partener/activare-ciorna.js → lib/categorii-inscriere.js);
   - măsurare (masurare.js, fără date personale): partner_signup_start (prima
     atingere a formularului), partner_signup_error (doar codul erorii).
   Feedback: doar MDFeedback (câmpurile obligatorii, erorile sub câmp).
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var ROL = { servicii: 'partener_servicii', materiale: 'partener_materiale', inchirieri: 'partener_inchirieri', curier: 'partener_curier', asigurari: 'partener_asigurari' };
  var TIP_EN = { servicii: 'services', materiale: 'materials', inchirieri: 'rentals', curier: 'courier', asigurari: 'insurance' };
  var CU_CATEGORIE = { servicii: true, materiale: true, inchirieri: true };
  var ALTCEVA = 'altceva';
  var q = new URLSearchParams(location.search);
  var DOMENIU = String(q.get('domeniu') || '').toLowerCase().trim();
  var PROFESIE = String(q.get('profesie') || '').toLowerCase().trim();
  // Listele încărcate, pe tip: { categorii, profesie } sau { eroare: true }.
  var liste = {};
  var alesDeUtilizator = false;
  var profesieIndiciu = null;

  function $(id) { return document.getElementById(id); }
  function tr(ro, p) {
    if (typeof window.t === 'function') return window.t(null, ro, p);
    return p ? String(ro).replace(/\{(\w+)\}/g, function (m, k) { return p[k] != null ? p[k] : m; }) : ro;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function limba() { return window.MYD_I18N && window.MYD_I18N.lang === 'ro' ? 'ro' : 'en'; }
  function categorie() { var x = document.querySelector('input[name="pi-categorie"]:checked'); return x ? x.value : null; }
  function asteapta(cond, ms) {
    return new Promise(function (ok) {
      var pana = Date.now() + ms;
      (function v() { if (cond()) return ok(true); if (Date.now() > pana) return ok(false); setTimeout(v, 50); })();
    });
  }
  function masoara(nume, p) {
    var M = window.MYD_MASURARE;
    if (M && typeof M.eveniment === 'function') M.eveniment(nume, p || {});
  }

  // ── Tipul și categoria principală ───────────────────────────────────
  function faraLista(tip) { var L = liste[tip]; return !!(L && (L.eroare || !L.categorii.length)); }

  function aplicaCategorie() {
    var c = categorie();
    var cuCat = !!CU_CATEGORIE[c];
    var sel = $('pi-domeniu');
    var listaVizibila = cuCat && !faraLista(c);
    $('pi-domeniu-camp').hidden = !listaVizibila;
    // Câmpul ascuns nu e obligatoriu (MDFeedback verifică doar ce se vede).
    if (listaVizibila) sel.setAttribute('required', ''); else sel.removeAttribute('required');
    // „Altceva”: textul opțional; fără listă, singura variantă (nimeni nu e blocat).
    $('pi-altceva-camp').hidden = !(cuCat && (faraLista(c) || sel.value === ALTCEVA));
    // „0% comision din manoperă” doar pentru servicii și curieri (decizia LM, 16 nov. 2026).
    $('pi-nota').textContent = c === 'servicii' || c === 'curier'
      ? tr('Primești un cod pe email · 0% comision din manoperă')
      : tr('Primești un cod pe email.');
    if (cuCat && !liste[c]) incarcaCategorii(c);
  }

  function incarcaCategorii(tip) {
    liste[tip] = { incarcare: true, categorii: [] };
    deseneaza(tip);
    var url = '/api/public/categorii?tip=' + tip + '&lang=' + limba() + (tip === 'servicii' && PROFESIE ? '&profesie=' + encodeURIComponent(PROFESIE.slice(0, 60)) : '');
    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.ok || !Array.isArray(j.categorii)) throw new Error('fără listă');
        liste[tip] = { categorii: j.categorii, profesie: j.profesie || null };
        if (j.profesie && j.profesie.slug) profesieIndiciu = j.profesie.slug;
      })
      .catch(function () { liste[tip] = { eroare: true, categorii: [] }; })
      .then(function () { if (categorie() === tip) { deseneaza(tip); aplicaCategorie(); } });
  }

  // Opțiunile listei pentru tipul ales; preselecția din reclamă, cât timp utilizatorul nu a ales altceva.
  function deseneaza(tip) {
    var sel = $('pi-domeniu');
    var L = liste[tip] || { categorii: [] };
    var anterior = sel.value;
    sel.innerHTML = '<option value="">' + esc(L.incarcare ? tr('Se încarcă…') : tr('Alege categoria')) + '</option>' +
      L.categorii.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.denumire) + '</option>'; }).join('') +
      (L.incarcare ? '' : '<option value="' + ALTCEVA + '">' + esc(tr('Altceva')) + '</option>');
    var dinReclama = null;
    if (DOMENIU) dinReclama = L.categorii.filter(function (c) { return c.slug === DOMENIU; })[0] || null;
    if (!dinReclama && tip === 'servicii' && L.profesie && L.profesie.categorie_id) {
      dinReclama = L.categorii.filter(function (c) { return c.id === L.profesie.categorie_id; })[0] || null;
    }
    if (alesDeUtilizator && anterior && (anterior === ALTCEVA || L.categorii.some(function (c) { return c.id === anterior; }))) sel.value = anterior;
    else if (!alesDeUtilizator && dinReclama) sel.value = dinReclama.id;
    else sel.value = '';
    $('pi-domeniu-reclama').hidden = !(dinReclama && sel.value === dinReclama.id && !alesDeUtilizator);
  }

  // ── Trimiterea ──────────────────────────────────────────────────────
  function codEroare(e) {
    if (!e) return 'eroare';
    if (e.cod) return String(e.cod).slice(0, 40);
    if (e.campuri && e.campuri.length) return 'camp_invalid';
    if (e.timeout || /timeout/i.test(String(e.message))) return 'timeout';
    return 'auth_eroare';
  }
  function eroareCamp(el, mesaj) {
    var e = new Error(mesaj);
    e.campuri = [{ camp: el, mesaj: mesaj }];
    return e;
  }
  // Datele pre-înscrierii (ciorna activării, după cod). Serverul le verifică din nou.
  function datePreinscriere(c) {
    var cuCat = !!CU_CATEGORIE[c];
    var v = $('pi-domeniu').value;
    var L = liste[c] || { categorii: [] };
    var cat = cuCat ? (L.categorii.filter(function (x) { return x.id === v; })[0] || null) : null;
    var altceva = cuCat && !cat && (v === ALTCEVA || faraLista(c));
    if (cuCat && !cat && !altceva) throw eroareCamp($('pi-domeniu'), tr('Alege categoria principală din listă sau „Altceva”.'));
    return {
      categorie: c, rol: ROL[c], oras: $('pi-oras').value.trim().slice(0, 80),
      categorie_id: cat ? cat.id : null,
      categorie_slug: cat ? cat.slug : null,
      categorie_denumire: cat ? cat.denumire : null,
      categorie_altceva: altceva,
      categorie_text: altceva ? ($('pi-altceva').value.trim().slice(0, 80) || null) : null,
      profesie_slug: profesieIndiciu,
      creat_la: new Date().toISOString(),
    };
  }
  function trimite(ev) {
    if (ev) ev.preventDefault();
    var btn = $('pi-trimite');
    var c = categorie();
    // Etichetele pentru mesajele MDFeedback, acum (dicționarele limbii sunt sigur încărcate).
    Object.keys(ETICHETE).forEach(function (id) { if ($(id)) $(id).setAttribute('data-eticheta', tr(ETICHETE[id])); });
    window.MDFeedback.salveaza(btn, $('pi-msg'), function () {
      var date = datePreinscriere(c);
      return asteapta(function () { return !!(window.MDCont && window.MDCont.inregistreaza); }, 8000).then(function (gata) {
        if (!gata) throw new Error(tr('Pagina nu s-a încărcat complet. Reîncarcă pagina și încearcă din nou.'));
        try { sessionStorage.setItem(window.MDCont.CHEIE_PREINSCRIERE, JSON.stringify(date)); } catch (e) {}
        return window.MDCont.inregistreaza(
          { email: $('pi-email'), tel: $('pi-tel'), parola: $('pi-parola'), gdpr: $('pi-gdpr') },
          { prenume: $('pi-prenume').value, nume: $('pi-nume').value, rol: ROL[c] },
          { recuperare: $('pi-recuperare') }
        );
      });
    }, { form: $('pi-form'), textSalveaza: tr('Se creează contul…'), textOk: tr('✓ Trimis') }).then(function (r) {
      if (r && !r.ok && !r.ignorat) masoara('partner_signup_error', { partner_type: TIP_EN[c], error_code: codEroare(r.eroare) });
    });
  }

  // Etichetele câmpurilor pentru mesajele MDFeedback, în limba paginii.
  var ETICHETE = {
    'pi-domeniu': 'Categoria principală', 'pi-oras': 'Orașul în care lucrezi', 'pi-prenume': 'Prenume', 'pi-nume': 'Nume',
    'pi-tel': 'Telefon', 'pi-email': 'Email', 'pi-parola': 'Parola', 'pi-gdpr': 'Acordul pentru Termeni și Politica de confidențialitate',
  };

  function porneste() {
    Object.keys(ETICHETE).forEach(function (id) { if ($(id)) $(id).setAttribute('data-eticheta', tr(ETICHETE[id])); });
    // Categoria din adresă (?categorie= / ?type=), altfel Servicii.
    var dinAdresa = String(q.get('categorie') || q.get('type') || '').toLowerCase().replace('asigurator', 'asigurari');
    var radio = document.querySelector('input[name="pi-categorie"][value="' + (ROL[dinAdresa] ? dinAdresa : 'servicii') + '"]');
    if (radio) radio.checked = true;
    $('pi-categorii').addEventListener('change', function () { deseneaza(categorie()); aplicaCategorie(); });
    $('pi-domeniu').addEventListener('change', function () {
      alesDeUtilizator = true;
      $('pi-domeniu-reclama').hidden = true;
      aplicaCategorie();
    });
    aplicaCategorie();

    // Selectorul de limbă, același ca pe paginile de cont (cont-dashboard.js).
    var zona = $('pi-limba');
    if (zona && window.MYD_PAZA && window.MYD_PAZA.selectorLimbaHtml) {
      zona.innerHTML = window.MYD_PAZA.selectorLimbaHtml();
      window.MYD_PAZA.leagaSelectorLimba(zona);
    }

    // Logarea: linkul din antet și rândul „Ai deja cont? Intră în cont” (pasul 12-P1b).
    // După autentificare, destinația o decide serverul (destinatie-rol): panoul partenerului.
    var intra = function () {
      asteapta(function () { return !!window.MDCont; }, 8000).then(function (gata) { if (gata) window.MDCont.deschide({ tab: 'login' }); });
    };
    $('pi-intra').addEventListener('click', intra);
    $('pi-intra-jos').addEventListener('click', intra);

    var pornit = false;
    $('pi-form').addEventListener('focusin', function () {
      if (pornit) return;
      pornit = true;
      masoara('partner_signup_start', { partner_type: TIP_EN[categorie()] });
    });
    $('pi-form').addEventListener('submit', trimite);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', porneste);
  else porneste();
})();
