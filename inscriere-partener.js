/* ════════════════════════════════════════════════════════════════
   MY DARRIN — inscriere-partener.js, pasul 12-P1 (17 nov. 2026)

   Pagina /parteneri/inscriere (mydarrin-inscriere-partener.html, macheta B1.1).
   - „Ce faci?” → rol_solicitat; ?categorie=<servicii|materiale|…> o preselectează;
   - Profesia, doar la Servicii: /api/public/profesii (competente_esco), preselectată
     din ?profesie=<slug> (reclame: /parteneri/inscriere?profesie=instalator&lang=ro);
   - „Creează cont de partener”: MDCont.inregistreaza (cont-fereastra.js, aceeași
     înregistrare Supabase ca în fereastra de cont), apoi ecranul de cod (B1.2);
   - categoria, profesia și orașul se păstrează în sesiune și intră în ciorna
     activării după cod (MDCont.salveazaPreinscriere);
   - măsurare (masurare.js, fără date personale): partner_signup_start (prima
     atingere a formularului), partner_signup_error (doar codul erorii).
   Feedback: doar MDFeedback (câmpurile obligatorii, erorile sub câmp).
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var ROL = { servicii: 'partener_servicii', materiale: 'partener_materiale', inchirieri: 'partener_inchirieri', curier: 'partener_curier', asigurari: 'partener_asigurari' };
  var TIP_EN = { servicii: 'services', materiale: 'materials', inchirieri: 'rentals', curier: 'courier', asigurari: 'insurance' };
  var q = new URLSearchParams(location.search);
  var profesii = [];
  var dinReclama = false;

  function $(id) { return document.getElementById(id); }
  function tr(ro, p) {
    if (typeof window.t === 'function') return window.t(null, ro, p);
    return p ? String(ro).replace(/\{(\w+)\}/g, function (m, k) { return p[k] != null ? p[k] : m; }) : ro;
  }
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

  // ── Categoria și profesia ───────────────────────────────────────────
  // Fără lista de profesii (API indisponibil sau listă goală): câmpul nu apare și nu
  // e obligatoriu; profesia se alege la pasul „Profesii” al activării.
  var faraProfesii = false;
  function aplicaCategorie() {
    var c = categorie();
    var servicii = c === 'servicii' && !faraProfesii;
    $('pi-profesie-camp').hidden = !servicii;
    // Câmpul ascuns nu e obligatoriu (MDFeedback verifică doar ce se vede).
    if (servicii) $('pi-profesie').setAttribute('required', ''); else $('pi-profesie').removeAttribute('required');
    // „0% comision din manoperă” doar pentru servicii și curieri (decizia LM, 16 nov. 2026).
    $('pi-nota').textContent = c === 'servicii' || c === 'curier'
      ? tr('Primești un cod pe email · 0% comision din manoperă')
      : tr('Primești un cod pe email.');
  }

  function incarcaProfesii() {
    return fetch('/api/public/profesii?lang=' + limba())
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        profesii = (j && j.profesii) || [];
        if (!profesii.length) throw new Error('fără profesii');
        var sel = $('pi-profesie');
        var dorit = String(q.get('profesie') || '').toLowerCase();
        sel.innerHTML = '<option value="">' + tr('Alege profesia') + '</option>' + profesii.map(function (p) {
          return '<option value="' + p.slug + '">' + String(p.denumire).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }) + '</option>';
        }).join('');
        if (dorit && profesii.some(function (p) { return p.slug === dorit; })) {
          sel.value = dorit;
          dinReclama = true;
        }
        $('pi-profesie-ajutor').hidden = !dinReclama;
      })
      .catch(function () {
        // Fără lista de profesii, înscrierea merge mai departe (profesia o alegi la activare).
        faraProfesii = true;
        aplicaCategorie();
      });
  }

  // ── Trimiterea ──────────────────────────────────────────────────────
  function codEroare(e) {
    if (!e) return 'eroare';
    if (e.cod) return String(e.cod).slice(0, 40);
    if (e.campuri && e.campuri.length) return 'camp_invalid';
    if (e.timeout || /timeout/i.test(String(e.message))) return 'timeout';
    return 'auth_eroare';
  }
  function trimite(ev) {
    if (ev) ev.preventDefault();
    var btn = $('pi-trimite');
    var c = categorie();
    // Etichetele pentru mesajele MDFeedback, acum (dicționarele limbii sunt sigur încărcate).
    Object.keys(ETICHETE).forEach(function (id) { if ($(id)) $(id).setAttribute('data-eticheta', tr(ETICHETE[id])); });
    window.MDFeedback.salveaza(btn, $('pi-msg'), function () {
      return asteapta(function () { return !!(window.MDCont && window.MDCont.inregistreaza); }, 8000).then(function (gata) {
        if (!gata) throw new Error(tr('Pagina nu s-a încărcat complet. Reîncarcă pagina și încearcă din nou.'));
        var p = profesii.filter(function (x) { return x.slug === $('pi-profesie').value; })[0] || null;
        // Datele pre-înscrierii: în ciorna activării, după cod (cont-fereastra.js).
        var date = {
          categorie: c, rol: ROL[c], oras: $('pi-oras').value.trim().slice(0, 80),
          profesie_slug: c === 'servicii' && p ? p.slug : null,
          profesie_cod: c === 'servicii' && p ? p.cod : null,
          profesie_ro: c === 'servicii' && p ? p.denumire_ro : null,
          nace: c === 'servicii' && p ? p.nace : null,
          creat_la: new Date().toISOString(),
        };
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
    'pi-profesie': 'Profesia', 'pi-oras': 'Orașul în care lucrezi', 'pi-prenume': 'Prenume', 'pi-nume': 'Nume',
    'pi-tel': 'Telefon', 'pi-email': 'Email', 'pi-parola': 'Parola', 'pi-gdpr': 'Acordul pentru Termeni și Politica de confidențialitate',
  };

  function porneste() {
    Object.keys(ETICHETE).forEach(function (id) { if ($(id)) $(id).setAttribute('data-eticheta', tr(ETICHETE[id])); });
    // Categoria din adresă (?categorie= / ?type=), altfel Servicii.
    var dinAdresa = String(q.get('categorie') || q.get('type') || '').toLowerCase().replace('asigurator', 'asigurari');
    var radio = document.querySelector('input[name="pi-categorie"][value="' + (ROL[dinAdresa] ? dinAdresa : 'servicii') + '"]');
    if (radio) radio.checked = true;
    aplicaCategorie();
    $('pi-categorii').addEventListener('change', aplicaCategorie);
    incarcaProfesii();

    // Selectorul de limbă, același ca pe paginile de cont (cont-dashboard.js).
    var zona = $('pi-limba');
    if (zona && window.MYD_PAZA && window.MYD_PAZA.selectorLimbaHtml) {
      zona.innerHTML = window.MYD_PAZA.selectorLimbaHtml();
      window.MYD_PAZA.leagaSelectorLimba(zona);
    }

    $('pi-intra').addEventListener('click', function () {
      asteapta(function () { return !!window.MDCont; }, 8000).then(function (gata) { if (gata) window.MDCont.deschide({ tab: 'login' }); });
    });

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
