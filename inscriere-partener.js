/* ════════════════════════════════════════════════════════════════
   MY DARRIN — inscriere-partener.js, pasul 12-P1 (17 nov. 2026)

   Pagina /parteneri/inscriere (mydarrin-inscriere-partener.html, macheta B1.1).
   - „Ce faci?” → rol_solicitat; ?categorie=<servicii|materiale|…> (și vechiul
     ?type=) o preselectează;
   - Pasul 12-P2, macheta R1 (decizia LM, 21 nov. 2026; temporar până la B2): la
     crearea contului rămân doar tipul, prenumele și numele, telefonul, emailul,
     parola și acordul. Fără profesie, fără categorie, fără oraș: se aleg în panou.
     Din reclame rămâne un indiciu ascuns, fără întrebare pe ecran:
       ?domeniu=<slug>  → indiciu_domeniu;
       ?profesie=<slug> → profesie_slug.
     Serverul îl verifică (lib/categorii-inscriere.js): un slug necunoscut se
     ignoră fără eroare; unul valid ordonează „Ce lucrări faci” din panou;
   - „Creează cont de partener”: MDCont.inregistreaza (cont-fereastra.js, aceeași
     înregistrare Supabase ca în fereastra de cont), apoi ecranul de cod (B1.2);
   - tipul și indiciul se păstrează în sesiune și intră în ciorna activării după
     cod (MDCont.salveazaPreinscriere);
   - măsurare (masurare.js, fără date personale): partner_signup_start (prima
     atingere a formularului), partner_signup_error (doar codul erorii).
   Feedback: doar MDFeedback (câmpurile obligatorii, erorile sub câmp).
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var ROL = { servicii: 'partener_servicii', materiale: 'partener_materiale', inchirieri: 'partener_inchirieri', curier: 'partener_curier', asigurari: 'partener_asigurari' };
  var TIP_EN = { servicii: 'services', materiale: 'materials', inchirieri: 'rentals', curier: 'courier', asigurari: 'insurance' };
  var RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var q = new URLSearchParams(location.search);

  function $(id) { return document.getElementById(id); }
  function tr(ro, p) {
    if (typeof window.t === 'function') return window.t(null, ro, p);
    return p ? String(ro).replace(/\{(\w+)\}/g, function (m, k) { return p[k] != null ? p[k] : m; }) : ro;
  }
  function categorie() { var x = document.querySelector('input[name="pi-categorie"]:checked'); return x ? x.value : null; }
  // Slug-ul din reclamă, doar în forma corectă (altfel nimic); serverul îl verifică din nou.
  function slugDinAdresa(nume) {
    var s = String(q.get(nume) || '').toLowerCase().trim().slice(0, 120);
    return s && RE_SLUG.test(s) ? s : null;
  }
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

  function aplicaCategorie() {
    var c = categorie();
    // „0% comision din manoperă” doar pentru servicii și curieri (decizia LM, 16 nov. 2026).
    $('pi-nota').textContent = c === 'servicii' || c === 'curier'
      ? tr('Primești un cod pe email · 0% comision din manoperă')
      : tr('Primești un cod pe email.');
  }

  // ── Trimiterea ──────────────────────────────────────────────────────
  function codEroare(e) {
    if (!e) return 'eroare';
    if (e.cod) return String(e.cod).slice(0, 40);
    if (e.campuri && e.campuri.length) return 'camp_invalid';
    if (e.timeout || /timeout/i.test(String(e.message))) return 'timeout';
    return 'auth_eroare';
  }
  // Datele pre-înscrierii (ciorna activării, după cod): tipul și indiciul din reclamă.
  function datePreinscriere(c) {
    return {
      categorie: c, rol: ROL[c],
      indiciu_domeniu: slugDinAdresa('domeniu'),
      profesie_slug: slugDinAdresa('profesie'),
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
    'pi-prenume': 'Prenume', 'pi-nume': 'Nume',
    'pi-tel': 'Telefon', 'pi-email': 'Email', 'pi-parola': 'Parola', 'pi-gdpr': 'Acordul pentru Termeni și Politica de confidențialitate',
  };

  function porneste() {
    Object.keys(ETICHETE).forEach(function (id) { if ($(id)) $(id).setAttribute('data-eticheta', tr(ETICHETE[id])); });
    // Tipul din adresă (?categorie= / ?type=), altfel Servicii.
    var dinAdresa = String(q.get('categorie') || q.get('type') || '').toLowerCase().replace('asigurator', 'asigurari');
    var radio = document.querySelector('input[name="pi-categorie"][value="' + (ROL[dinAdresa] ? dinAdresa : 'servicii') + '"]');
    if (radio) radio.checked = true;
    $('pi-categorii').addEventListener('change', aplicaCategorie);
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
