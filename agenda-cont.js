/* ════════════════════════════════════════════════════════════════
   MY DARRIN — agenda-cont.js (MYD_AGENDA), pasul 11-P3a (26 oct. 2026)

   Agenda contului: adresele (prestare / livrare, facturare sau ambele) și
   profilurile de facturare (persoană fizică sau firmă). Aceeași componentă
   și același API (/api/cont/agenda) în toate dashboard-urile și în checkout /
   coș, deci o modificare făcută într-un loc apare imediat și în celălalt
   (și în celelalte file deschise, prin localStorage `myd_agenda_v1`).

   Utilizare:
     MYD_AGENDA.monteaza(container)              secțiunea „Adrese și facturare” (dashboard)
     MYD_AGENDA.deschidePanou({ deschide })      aceeași secțiune într-o fereastră
                                                 (focus gestionat, Esc închide);
                                                 deschide: 'adresa_noua' | 'profil_nou'
     const s = MYD_AGENDA.selector(container, { prestare, facturare, adaugaAlta, laSchimbare })
       s.stare()    → { adresa_prestare_id, adresa_prestare, prestare_noua,
                        profil_facturare_id, profil, adresa_facturare_id, facturare_noua,
                        are_agenda }
       s.valideaza() → true / false (marchează alegerea lipsă)
     MYD_AGENDA.incarca(fortat) → Promise<{ adrese, profiluri, firma_partener } | null>
     MYD_AGENDA.abonare(fn)      fn(agenda) la fiecare schimbare

   Feedback la salvare, confirmarea ștergerii și erorile pe câmpuri: MDFeedback
   (ui-feedback.js). Textele trec prin window.t (RO / EN, i18n/en.json).
   CNP-ul nu ajunge niciodată în pagină: doar cnp_furnizat și cnp_ultimele3.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MYD_AGENDA) return;

  var API = '/api/cont/agenda';
  var CHEIE_SEMNAL = 'myd_agenda_v1';
  var TARI = [['RO', 'România'], ['MD', 'Moldova'], ['BG', 'Bulgaria'], ['DE', 'Germania'], ['FR', 'Franța']];
  var FOLOSIRI = [['ambele', 'Prestare și facturare'], ['prestare', 'Prestare / livrare'], ['facturare', 'Facturare']];

  function tr(ro, param) {
    if (typeof window.t === 'function') return window.t(null, ro, param);
    return param ? String(ro).replace(/\{(\w+)\}/g, function (m, x) { return param[x] != null ? param[x] : m; }) : ro;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function el(tag, attrs, copii) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (copii || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  var poatePrestare = function (a) { return a.folosire === 'prestare' || a.folosire === 'ambele'; };
  var poateFacturare = function (a) { return a.folosire === 'facturare' || a.folosire === 'ambele'; };
  function textAdresa(a) { return a ? [a.strada, a.localitate, a.judet, a.cod_postal, a.tara].filter(Boolean).join(', ') : ''; }
  function numeAdresa(a) { return (a.eticheta ? a.eticheta + ' — ' : '') + textAdresa(a); }
  function numeProfil(p) {
    return (p.eticheta ? p.eticheta + ' — ' : '') + (p.tip === 'pj' ? (p.denumire + (p.cui ? ' · ' + p.cui : '')) : [p.nume, p.prenume].filter(Boolean).join(' '));
  }

  // ── Stilul (o singură dată), în culorile dashboard-urilor ─────────────
  function stil() {
    if (document.getElementById('mya-stil')) return;
    var css = [
      '.mya{font-family:inherit;color:#1A2332;font-size:13px;display:flex;flex-direction:column;gap:14px;min-width:0}',
      '.mya *{box-sizing:border-box}',
      '.mya-titlu{font-size:16px;font-weight:800;color:#003366;margin:0}',
      '.mya-card{background:#fff;border:1px solid #D5DFE8;border-radius:16px;overflow:hidden;min-width:0}',
      '.mya-hdr{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid #EEF2F7}',
      '.mya-hdr strong{font-size:13.5px;color:#1A2332}',
      '.mya-corp{padding:12px 16px;display:flex;flex-direction:column;gap:10px}',
      '.mya-rand{border:1px solid #EEF2F7;border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.mya-rand-sus{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap}',
      '.mya-nume{font-weight:700;color:#003366;overflow-wrap:anywhere}',
      '.mya-det{color:#5A6B7D;font-size:12.5px;line-height:1.45;overflow-wrap:anywhere}',
      '.mya-insigne{display:flex;gap:6px;flex-wrap:wrap}',
      '.mya-insigna{font-size:10.5px;font-weight:700;border-radius:99px;padding:2px 9px;background:#E6F6F5;color:#0B7A76;white-space:nowrap}',
      '.mya-avert{font-size:12px;color:#C0392B;background:#FDECEA;border-radius:8px;padding:6px 10px}',
      '.mya-act{display:flex;gap:6px;flex-wrap:wrap}',
      '.mya-btn{border:1.5px solid #C5D2E0;background:#fff;color:#003366;border-radius:9px;padding:6px 11px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;min-height:34px}',
      '.mya-btn:hover{border-color:#003366}',
      '.mya-btn.mya-p{background:#003366;border-color:#003366;color:#fff}',
      '.mya-btn.mya-r{color:#C0392B;border-color:#F0C4BF}',
      '.mya-btn:focus-visible,.mya-in:focus-visible{outline:2px solid #0E9E99;outline-offset:1px}',
      '.mya-gol{color:#8C9BAD;font-size:12.5px;padding:4px 0}',
      '.mya-form{border:1.5px solid #D5DFE8;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;background:#F7F9FC}',
      '.mya-grila{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}',
      '.mya-camp{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.mya-et{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8C9BAD}',
      '.mya-in{width:100%;border:1.5px solid #D5DFE8;border-radius:10px;padding:8px 10px;font-size:13px;font-family:inherit;background:#fff;color:#1A2332;min-height:38px}',
      '.mya-bifa{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#5A6B7D;cursor:pointer}',
      '.mya-radio{display:flex;gap:8px;flex-wrap:wrap}',
      '.mya-radio label{display:flex;align-items:center;gap:6px;border:1.5px solid #D5DFE8;border-radius:10px;padding:7px 11px;background:#fff;cursor:pointer;font-weight:600;color:#003366}',
      '.mya-stare{font-size:11.5px}',
      '.mya-sel{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.mya-sel-rand{display:flex;gap:8px;align-items:stretch;min-width:0}',
      '.mya-sel-rand select{flex:1 1 auto;min-width:0}',
      '.mya-fundal{position:fixed;inset:0;z-index:100000;background:rgba(15,25,35,.6);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow:auto}',
      '.mya-fereastra{background:#F7F9FC;border-radius:16px;width:100%;max-width:760px;padding:16px;box-shadow:0 16px 48px rgba(0,0,0,.35);margin:auto 0}',
      '.mya-fereastra-hdr{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}',
    ].join('\n');
    document.head.appendChild(el('style', { id: 'mya-stil', text: css }));
  }

  // ── Datele: un singur depozit pentru toată pagina ──────────────────────
  var stare = { date: null, incarcare: null, ascultatori: [] };

  // Clientul Supabase apare după account-system.js: așteptăm cel mult 5 s.
  function asteaptaClient() {
    return new Promise(function (ok) {
      var n = 0;
      (function verifica() {
        var c = window.supabaseClient;
        if (c && c.auth && c.auth.getSession) return ok(c);
        if (++n > 50) return ok(null);
        setTimeout(verifica, 100);
      })();
    });
  }
  async function token() {
    var c = await asteaptaClient();
    if (!c) return null;
    return c.auth.getSession().then(function (r) { return (r && r.data && r.data.session && r.data.session.access_token) || null; }).catch(function () { return null; });
  }
  async function cerere(metoda, corp) {
    var tok = await token();
    if (!tok) { var e = new Error(tr('Intră în cont ca să-ți gestionezi adresele.')); e.campuri = []; throw e; }
    return window.MDFeedback.cerere(API, { method: metoda, headers: { Authorization: 'Bearer ' + tok }, body: corp || undefined });
  }
  function notifica(semnal) {
    stare.ascultatori.slice().forEach(function (fn) { try { fn(stare.date); } catch (e) { console.warn('[agenda]', e); } });
    if (semnal) { try { localStorage.setItem(CHEIE_SEMNAL, String(Date.now())); } catch (e) {} }
  }
  function incarca(fortat) {
    if (stare.incarcare && !fortat) return stare.incarcare;
    stare.incarcare = (async function () {
      var tok = await token();
      if (!tok) { stare.date = null; notifica(false); return null; }
      try {
        var j = await window.MDFeedback.cerere(API, { headers: { Authorization: 'Bearer ' + tok } });
        stare.date = { adrese: j.adrese || [], profiluri: j.profiluri || [], firma_partener: j.firma_partener || null };
      } catch (e) {
        console.warn('[agenda] încărcare', e && e.message);
        if (!stare.date) stare.date = null;
      }
      notifica(false);
      return stare.date;
    })();
    return stare.incarcare;
  }
  // Răspunsul unei acțiuni conține agenda actualizată.
  function aplicaRaspuns(j) {
    stare.date = { adrese: j.adrese || [], profiluri: j.profiluri || [], firma_partener: stare.date ? stare.date.firma_partener : null };
    notifica(true);
  }
  function abonare(fn) {
    stare.ascultatori.push(fn);
    return function () { stare.ascultatori = stare.ascultatori.filter(function (x) { return x !== fn; }); };
  }
  // Altă filă a schimbat agenda (de exemplu dashboard-ul, cu checkout-ul deschis).
  window.addEventListener('storage', function (ev) { if (ev.key === CHEIE_SEMNAL) incarca(true); });

  // ── Câmpurile formularelor ─────────────────────────────────────────────
  function camp(eticheta, input, extra) {
    var id = 'mya-' + Math.random().toString(36).slice(2, 9);
    input.id = id;
    var c = el('div', { class: 'mya-camp' }, [el('label', { class: 'mya-et', for: id, text: eticheta }), input]);
    if (extra) c.appendChild(extra);
    return c;
  }
  function intrare(nume, valoare, atr) {
    return el('input', Object.assign({ class: 'mya-in', name: nume, type: 'text', value: valoare == null ? '' : valoare, autocomplete: 'off' }, atr || {}));
  }
  function lista(nume, optiuni, valoare) {
    var s = el('select', { class: 'mya-in', name: nume });
    optiuni.forEach(function (o) { s.appendChild(el('option', { value: o[0], text: o[1], selected: String(o[0]) === String(valoare) })); });
    return s;
  }
  function campuriAdresa(prefix, a) {
    a = a || {};
    return [
      camp(tr('Strada și numărul'), intrare(prefix + 'strada', a.strada, { autocomplete: 'street-address' })),
      el('div', { class: 'mya-grila' }, [
        camp(tr('Localitatea'), intrare(prefix + 'localitate', a.localitate, { autocomplete: 'address-level2' })),
        camp(tr('Județul'), intrare(prefix + 'judet', a.judet, { autocomplete: 'address-level1' })),
        camp(tr('Cod poștal (opțional)'), intrare(prefix + 'cod_postal', a.cod_postal, { autocomplete: 'postal-code' })),
        camp(tr('Țara'), lista(prefix + 'tara', TARI.map(function (t) { return [t[0], tr(t[1])]; }), a.tara || 'RO')),
      ]),
    ];
  }
  function valoriAdresa(form, prefix) {
    var v = function (n) { var x = form.querySelector('[name="' + prefix + n + '"]'); return x ? x.value.trim() : ''; };
    return { strada: v('strada'), localitate: v('localitate'), judet: v('judet'), cod_postal: v('cod_postal'), tara: v('tara') || 'RO' };
  }

  // ── Secțiunea de gestionare ─────────────────────────────────────────────
  function monteaza(container, optiuni) {
    if (!container) return null;
    optiuni = optiuni || {};
    stil();
    var idTitlu = 'mya-t-' + Math.random().toString(36).slice(2, 8);
    var radacina = el('section', { class: 'mya', 'aria-labelledby': idTitlu });
    var titlu = el('h2', { class: 'mya-titlu', id: idTitlu, text: tr('Adrese și facturare') });
    var zona = el('div', { role: 'status', 'aria-live': 'polite' });
    var cardA = el('div', { class: 'mya-card' });
    var cardP = el('div', { class: 'mya-card' });
    if (!optiuni.faraTitlu) radacina.appendChild(titlu);
    radacina.appendChild(zona);
    radacina.appendChild(cardA);
    radacina.appendChild(cardP);
    container.innerHTML = '';
    container.appendChild(radacina);

    var formular = null; // { tip:'adresa'|'profil', id }

    function deseneaza() {
      var d = stare.date;
      cardA.innerHTML = '';
      cardP.innerHTML = '';
      if (!d) {
        cardA.appendChild(el('div', { class: 'mya-corp' }, [el('div', { class: 'mya-gol', text: tr('Intră în cont ca să-ți gestionezi adresele.') })]));
        cardP.style.display = 'none';
        return;
      }
      cardP.style.display = '';
      deseneazaAdrese(d);
      deseneazaProfiluri(d);
    }

    function antet(card, text, eticheta, laClic, dezactivat, dataMya) {
      var b = el('button', { type: 'button', class: 'mya-btn mya-p', text: eticheta, onclick: laClic, disabled: dezactivat, 'data-mya': dataMya });
      card.appendChild(el('div', { class: 'mya-hdr' }, [el('strong', { text: text }), b]));
      return b;
    }

    function deseneazaAdrese(d) {
      var plin = d.adrese.length >= 10;
      antet(cardA, tr('Adresele mele'), tr('Adaugă adresă'), function () { formular = { tip: 'adresa', id: null }; deseneaza(); focusForm(); }, plin, 'adauga-adresa');
      var corp = el('div', { class: 'mya-corp' });
      cardA.appendChild(corp);
      if (plin) corp.appendChild(el('div', { class: 'mya-det', text: tr('Ai atins limita de 10 adrese.') }));
      if (formular && formular.tip === 'adresa' && !formular.id) corp.appendChild(formAdresa(null));
      if (!d.adrese.length && !(formular && formular.tip === 'adresa')) corp.appendChild(el('div', { class: 'mya-gol', text: tr('Nu ai încă nicio adresă salvată.') }));
      d.adrese.forEach(function (a) {
        if (formular && formular.tip === 'adresa' && formular.id === a.id) { corp.appendChild(formAdresa(a)); return; }
        var insigne = el('div', { class: 'mya-insigne' });
        if (a.implicita_prestare) insigne.appendChild(el('span', { class: 'mya-insigna', text: tr('Implicită pentru prestare') }));
        if (a.implicita_facturare) insigne.appendChild(el('span', { class: 'mya-insigna', text: tr('Implicită pentru facturare') }));
        var act = el('div', { class: 'mya-act' });
        act.appendChild(el('button', { type: 'button', class: 'mya-btn', text: tr('Editează'), 'data-mya': 'editeaza', onclick: function () { formular = { tip: 'adresa', id: a.id }; deseneaza(); focusForm(); } }));
        if (poatePrestare(a) && !a.implicita_prestare) act.appendChild(butonImplicit('adresa_prestare', a.id, tr('Implicită pentru prestare')));
        if (poateFacturare(a) && !a.implicita_facturare) act.appendChild(butonImplicit('adresa_facturare', a.id, tr('Implicită pentru facturare')));
        act.appendChild(el('button', { type: 'button', class: 'mya-btn mya-r', text: tr('Șterge'), 'data-mya': 'sterge', onclick: function (ev) { sterge('adresa', a, ev.currentTarget); } }));
        var folosire = (FOLOSIRI.filter(function (f) { return f[0] === a.folosire; })[0] || [0, a.folosire])[1];
        corp.appendChild(el('div', { class: 'mya-rand', 'data-adresa-id': a.id }, [
          el('div', { class: 'mya-rand-sus' }, [el('div', { class: 'mya-nume', text: a.eticheta || tr(folosire) }), insigne]),
          el('div', { class: 'mya-det', text: textAdresa(a) }),
          el('div', { class: 'mya-det', text: tr('Folosire: {f}', { f: tr(folosire) }) + (a.instructiuni_acces ? ' · ' + a.instructiuni_acces : '') }),
          act,
        ]));
      });
    }

    function deseneazaProfiluri(d) {
      var plin = d.profiluri.length >= 5;
      antet(cardP, tr('Profilurile de facturare'), tr('Adaugă profil'), function () { formular = { tip: 'profil', id: null }; deseneaza(); focusForm(); }, plin, 'adauga-profil-agenda');
      var corp = el('div', { class: 'mya-corp' });
      cardP.appendChild(corp);
      if (plin) corp.appendChild(el('div', { class: 'mya-det', text: tr('Ai atins limita de 5 profiluri de facturare.') }));
      if (formular && formular.tip === 'profil' && !formular.id) corp.appendChild(formProfil(null, d));
      if (!d.profiluri.length && !(formular && formular.tip === 'profil')) corp.appendChild(el('div', { class: 'mya-gol', text: tr('Nu ai încă niciun profil de facturare.') }));
      d.profiluri.forEach(function (p) {
        if (formular && formular.tip === 'profil' && formular.id === p.id) { corp.appendChild(formProfil(p, d)); return; }
        var adresa = d.adrese.filter(function (a) { return a.id === p.adresa_facturare_id; })[0];
        var insigne = el('div', { class: 'mya-insigne' });
        if (p.implicit) insigne.appendChild(el('span', { class: 'mya-insigna', text: tr('Implicit') }));
        var detalii = p.tip === 'pj'
          ? [tr('Firmă'), 'CUI ' + p.cui, p.nr_reg_com, p.sursa === 'anaf' ? tr('verificată la ANAF') : null].filter(Boolean).join(' · ')
          : [tr('Persoană fizică'), p.cnp_furnizat ? 'CNP •••••••••' + (p.cnp_ultimele3 || '') : tr('fără CNP')].join(' · ');
        var act = el('div', { class: 'mya-act' });
        act.appendChild(el('button', { type: 'button', class: 'mya-btn', text: tr('Editează'), 'data-mya': 'editeaza', onclick: function () { formular = { tip: 'profil', id: p.id }; deseneaza(); focusForm(); } }));
        if (!p.implicit) act.appendChild(butonImplicit('profil', p.id, tr('Setează ca implicit')));
        act.appendChild(el('button', { type: 'button', class: 'mya-btn mya-r', text: tr('Șterge'), 'data-mya': 'sterge', onclick: function (ev) { sterge('profil', p, ev.currentTarget); } }));
        var rand = el('div', { class: 'mya-rand', 'data-profil-id': p.id }, [
          el('div', { class: 'mya-rand-sus' }, [el('div', { class: 'mya-nume', text: numeProfil(p) }), insigne]),
          el('div', { class: 'mya-det', text: detalii }),
        ]);
        if (adresa) rand.appendChild(el('div', { class: 'mya-det', text: tr('Adresa de facturare: {a}', { a: textAdresa(adresa) }) }));
        else if (p.tip === 'pj') rand.appendChild(el('div', { class: 'mya-avert', text: tr('Profilul nu mai are adresă de facturare. Editează-l și alege alta.') }));
        else rand.appendChild(el('div', { class: 'mya-det', text: tr('Adresa de facturare: aceeași cu adresa lucrării.') }));
        rand.appendChild(act);
        corp.appendChild(rand);
      });
    }

    function focusForm() {
      var f = radacina.querySelector('.mya-form input, .mya-form select');
      if (f) { try { f.focus({ preventScroll: false }); } catch (e) { f.focus(); } }
    }
    function inchideForm() { formular = null; deseneaza(); }

    function butonImplicit(tip, id, text) {
      return el('button', { type: 'button', class: 'mya-btn', text: text, 'data-mya': 'implicit-' + tip, onclick: function (ev) {
        var b = ev.currentTarget;
        window.MDFeedback.salveaza(b, zona, async function () {
          aplicaRaspuns(await cerere('POST', { actiune: 'seteaza_implicit', tip: tip, id: id }));
          return tr('Setat ca implicit.');
        });
      } });
    }

    async function sterge(tip, x, b) {
      var text = tip === 'adresa'
        ? tr('Ștergi adresa „{n}”? Comenzile deja plasate nu se schimbă.', { n: numeAdresa(x) })
        : tr('Ștergi profilul de facturare „{n}”? Comenzile deja plasate nu se schimbă.', { n: numeProfil(x) });
      if (!(await window.MDFeedback.confirma(text, { textOk: tr('Șterge'), periculos: true }))) return;
      window.MDFeedback.salveaza(b, zona, async function () {
        var j = await cerere('POST', { actiune: tip === 'adresa' ? 'adresa_sterge' : 'profil_sterge', id: x.id });
        if (formular && formular.id === x.id) formular = null;
        aplicaRaspuns(j);
        if (j.profiluri_fara_adresa && j.profiluri_fara_adresa.length) return tr('Adresa a fost ștearsă. Profilurile care o foloseau nu mai au adresă: alege alta pentru ele.');
        return tip === 'adresa' ? tr('Adresa a fost ștearsă.') : tr('Profilul a fost șters.');
      }, { textSalveaza: 'Se șterge…', textOk: '✓ Șters' });
    }

    function butoaneForm(laSalvare) {
      var salv = el('button', { type: 'submit', class: 'mya-btn mya-p', text: tr('Salvează') });
      var anul = el('button', { type: 'button', class: 'mya-btn', text: tr('Anulează'), onclick: inchideForm });
      return { rand: el('div', { class: 'mya-act' }, [salv, anul]), salv: salv, laSalvare: laSalvare };
    }

    function formAdresa(a) {
      var f = el('form', { class: 'mya-form', novalidate: true, 'data-mya-form': 'adresa' });
      f.appendChild(el('div', { class: 'mya-grila' }, [
        camp(tr('Eticheta (opțional)'), intrare('eticheta', a && a.eticheta, { placeholder: tr('ex. Acasă, Birou'), maxlength: '60' })),
        camp(tr('Folosire'), lista('folosire', FOLOSIRI.map(function (x) { return [x[0], tr(x[1])]; }), a ? a.folosire : 'ambele')),
      ]));
      campuriAdresa('', a).forEach(function (c) { f.appendChild(c); });
      var instr = camp(tr('Instrucțiuni acces (opțional)'), intrare('instructiuni_acces', a && a.instructiuni_acces, { placeholder: tr('Ex: Interfon 45, cod poartă 1234...'), maxlength: '300' }));
      f.appendChild(instr);
      var folosire = f.querySelector('[name="folosire"]');
      var actualizeaza = function () { instr.style.display = folosire.value === 'facturare' ? 'none' : ''; };
      folosire.addEventListener('change', actualizeaza);
      actualizeaza();
      var bt = butoaneForm();
      f.appendChild(bt.rand);
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var corp = Object.assign({ actiune: 'adresa_salveaza', id: a ? a.id : undefined, eticheta: f.querySelector('[name="eticheta"]').value.trim(), folosire: folosire.value,
          instructiuni_acces: f.querySelector('[name="instructiuni_acces"]').value.trim() }, valoriAdresa(f, ''));
        window.MDFeedback.salveaza(bt.salv, zona, async function () {
          var j = await cerere('POST', corp);
          formular = null;
          aplicaRaspuns(j);
          return tr('Adresa a fost salvată.');
        }, { form: f });
      });
      return f;
    }

    function formProfil(p, d) {
      var f = el('form', { class: 'mya-form', novalidate: true, 'data-mya-form': 'profil' });
      var tip = p ? p.tip : 'pf';
      var radio = el('div', { class: 'mya-radio', role: 'radiogroup', 'aria-label': tr('Tipul profilului') });
      var nr = Math.random().toString(36).slice(2, 7);
      [['pf', 'Persoană fizică'], ['pj', 'Firmă']].forEach(function (o) {
        radio.appendChild(el('label', {}, [el('input', { type: 'radio', name: 'tip', value: o[0], checked: tip === o[0], id: 'mya-tip-' + o[0] + '-' + nr }), tr(o[1])]));
      });
      f.appendChild(radio);
      f.appendChild(camp(tr('Eticheta (opțional)'), intrare('eticheta', p && p.eticheta, { maxlength: '60' })));

      var pf = el('div', { class: 'mya-grila', 'data-mya-grup': 'pf' }, [
        camp(tr('Prenume'), intrare('prenume', p && p.prenume, { autocomplete: 'given-name' })),
        camp(tr('Nume'), intrare('nume', p && p.nume, { autocomplete: 'family-name' })),
        camp(tr('CNP (opțional)'), intrare('cnp', '', { inputmode: 'numeric', maxlength: '13', placeholder: p && p.cnp_furnizat ? '•••••••••' + (p.cnp_ultimele3 || '') : '' }),
          el('div', { class: 'mya-det', text: p && p.cnp_furnizat ? tr('Lasă gol ca să-l păstrezi pe cel salvat.') : tr('Îl trecem pe factură doar dacă îl completezi.') })),
      ]);
      var stergeCnp = p && p.cnp_furnizat ? el('label', { class: 'mya-bifa', 'data-mya-grup': 'pf' }, [el('input', { type: 'checkbox', name: 'sterge_cnp' }), tr('Șterge CNP-ul salvat')]) : null;
      var stareAnaf = el('div', { class: 'mya-stare', 'aria-live': 'polite' });
      var cauta = el('button', { type: 'button', class: 'mya-btn', text: tr('Caută la ANAF') });
      var pj = el('div', { 'data-mya-grup': 'pj', style: 'display:flex;flex-direction:column;gap:10px' }, [
        el('div', { class: 'mya-grila' }, [
          camp(tr('CUI'), intrare('cui', p && p.cui, { placeholder: 'RO12345678' }), el('div', { class: 'mya-act' }, [cauta])),
          camp(tr('Denumirea firmei'), intrare('denumire', p && p.denumire, { autocomplete: 'organization' })),
          camp(tr('Nr. Reg. Com.'), intrare('nr_reg_com', p && p.nr_reg_com, { placeholder: 'J12/3456/2020' })),
        ]),
        stareAnaf,
      ]);
      if (d.firma_partener) {
        pj.insertBefore(el('div', { class: 'mya-act' }, [el('button', { type: 'button', class: 'mya-btn', text: tr('Folosește datele firmei mele'), 'data-mya': 'firma-mea', onclick: function () {
          var fp = d.firma_partener;
          f.querySelector('[name="cui"]').value = fp.cui || '';
          f.querySelector('[name="denumire"]').value = fp.denumire || '';
          f.querySelector('[name="nr_reg_com"]').value = fp.nr_reg_com || '';
          if (fp.sediu) { alegere.value = 'nou'; actualizeaza(); f.querySelector('[name="adresa_noua.strada"]').value = fp.sediu; }
          stareAnaf.style.color = '#0E9E99';
          stareAnaf.textContent = tr('Datele firmei tale au fost completate. Verifică-le înainte să salvezi.');
        } })]), pj.firstChild);
      }
      f.appendChild(pf);
      if (stergeCnp) f.appendChild(stergeCnp);
      f.appendChild(pj);

      // Adresa de facturare: din agendă, una nouă sau (PF) cea a lucrării.
      var optAdrese = d.adrese.filter(poateFacturare).map(function (a) { return [a.id, numeAdresa(a)]; });
      var alegere = lista('adresa_facturare_id', [['', tr('Aceeași cu adresa lucrării')]].concat(optAdrese, [['nou', tr('＋ Adresă nouă')]]),
        p ? (p.adresa_facturare_id || '') : (optAdrese.length ? optAdrese[0][0] : ''));
      f.appendChild(camp(tr('Adresa de facturare'), alegere));
      var adresaNoua = el('div', { 'data-mya-grup': 'adresa_noua', style: 'display:flex;flex-direction:column;gap:10px' }, campuriAdresa('adresa_noua.', null));
      f.appendChild(adresaNoua);

      function tipAles() { var r = f.querySelector('input[name="tip"]:checked'); return r ? r.value : 'pf'; }
      function actualizeaza() {
        var t = tipAles();
        pf.style.display = t === 'pf' ? '' : 'none';
        if (stergeCnp) stergeCnp.style.display = t === 'pf' ? '' : 'none';
        pj.style.display = t === 'pj' ? '' : 'none';
        var faraAdresa = alegere.querySelector('option[value=""]');
        faraAdresa.disabled = faraAdresa.hidden = t === 'pj';
        if (t === 'pj' && alegere.value === '') alegere.value = optAdrese.length ? optAdrese[0][0] : 'nou';
        adresaNoua.style.display = alegere.value === 'nou' ? '' : 'none';
      }
      Array.prototype.forEach.call(f.querySelectorAll('input[name="tip"]'), function (r) { r.addEventListener('change', actualizeaza); });
      alegere.addEventListener('change', actualizeaza);
      actualizeaza();

      cauta.addEventListener('click', async function () {
        var cui = f.querySelector('[name="cui"]').value.trim();
        if (!cui) { window.MDFeedback.aplicaErori(f, [{ camp: 'cui', mesaj: tr('Completează CUI-ul firmei.') }]); return; }
        var tara = alegere.value === 'nou' ? (f.querySelector('[name="adresa_noua.tara"]').value || 'RO') : ((d.adrese.filter(function (a) { return a.id === alegere.value; })[0] || {}).tara || 'RO');
        cauta.disabled = true;
        stareAnaf.style.color = '#5A6B7D';
        stareAnaf.textContent = tr('Se caută…');
        try {
          var r = await fetch('/api/public/cui-lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tara: tara, cui: cui }) });
          var j = await r.json();
          var en = window.MDFeedback.limba() === 'en';
          if (j.ok && j.cod === 'firma_inactiva') {
            stareAnaf.style.color = '#C0392B';
            stareAnaf.textContent = (en && j.motiv_en) || j.motiv;
          } else if (j.ok && j.denumire) {
            f.querySelector('[name="denumire"]').value = j.denumire;
            if (j.nr_reg_com) f.querySelector('[name="nr_reg_com"]').value = j.nr_reg_com;
            alegere.value = 'nou';
            actualizeaza();
            var s = j.sediu || { strada: j.adresa };
            ['strada', 'localitate', 'judet', 'cod_postal'].forEach(function (k) { if (s[k]) f.querySelector('[name="adresa_noua.' + k + '"]').value = s[k]; });
            f.querySelector('[name="adresa_noua.tara"]').value = tara;
            stareAnaf.style.color = '#0E9E99';
            stareAnaf.textContent = tr('Date preluate din registru. Verifică-le înainte să continui.');
          } else {
            stareAnaf.style.color = '#8C9BAD';
            stareAnaf.textContent = j.cod && j.motiv ? ((en && j.motiv_en) || j.motiv) : tr('Nu am găsit date. Completează manual.');
          }
        } catch (e) {
          stareAnaf.style.color = '#8C9BAD';
          stareAnaf.textContent = tr('Verificarea nu e disponibilă acum. Completează manual.');
        } finally { cauta.disabled = false; }
      });

      var bt = butoaneForm();
      f.appendChild(bt.rand);
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var v = function (n) { var x = f.querySelector('[name="' + n + '"]'); return x ? x.value.trim() : ''; };
        var t = tipAles();
        var corp = { actiune: 'profil_salveaza', id: p ? p.id : undefined, tip: t, eticheta: v('eticheta') };
        if (t === 'pf') {
          corp.prenume = v('prenume'); corp.nume = v('nume'); corp.cnp = v('cnp').replace(/\s+/g, '');
          var sc = f.querySelector('[name="sterge_cnp"]');
          if (sc && sc.checked) corp.sterge_cnp = true;
        } else {
          corp.cui = v('cui'); corp.denumire = v('denumire'); corp.nr_reg_com = v('nr_reg_com');
        }
        if (alegere.value === 'nou') corp.adresa_noua = valoriAdresa(f, 'adresa_noua.');
        else corp.adresa_facturare_id = alegere.value || null;
        window.MDFeedback.salveaza(bt.salv, zona, async function () {
          var j = await cerere('POST', corp);
          formular = null;
          aplicaRaspuns(j);
          return tr('Profilul de facturare a fost salvat.');
        }, { form: f });
      });
      return f;
    }

    var dezabonare = abonare(function () { if (document.contains(radacina)) deseneaza(); else dezabonare(); });
    if (optiuni.deschide === 'adresa_noua') formular = { tip: 'adresa', id: null };
    if (optiuni.deschide === 'profil_nou') formular = { tip: 'profil', id: null };
    deseneaza();
    incarca(false).then(function () { if (optiuni.deschide) focusForm(); });
    return { radacina: radacina, deseneaza: deseneaza };
  }

  // ── Panoul (fereastra) din checkout și coș ──────────────────────────────
  function deschidePanou(optiuni) {
    optiuni = optiuni || {};
    stil();
    var anterior = document.activeElement;
    var idT = 'mya-p-' + Date.now().toString(36);
    var inchide = el('button', { type: 'button', class: 'mya-btn', text: tr('Închide'), 'data-mya': 'inchide' });
    var corp = el('div');
    var fereastra = el('div', { class: 'mya-fereastra', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': idT }, [
      el('div', { class: 'mya-fereastra-hdr' }, [el('h2', { class: 'mya-titlu', id: idT, text: tr('Adrese și facturare') }), inchide]),
      corp,
    ]);
    var fundal = el('div', { class: 'mya-fundal', 'data-mya-panou': '1' }, [fereastra]);
    function focusabile() {
      return Array.prototype.filter.call(fereastra.querySelectorAll('button,select,input,textarea,a[href],[tabindex]:not([tabindex="-1"])'),
        function (x) { return !x.disabled && x.offsetParent !== null; });
    }
    function tasta(ev) {
      if (ev.defaultPrevented || document.querySelector('.md-confirma-fundal')) return;
      if (ev.key === 'Escape') { ev.preventDefault(); gata(); }
      else if (ev.key === 'Tab') {
        var f = focusabile();
        if (!f.length) return;
        var prim = f[0], ultim = f[f.length - 1];
        if (ev.shiftKey && (document.activeElement === prim || !fereastra.contains(document.activeElement))) { ev.preventDefault(); ultim.focus(); }
        else if (!ev.shiftKey && (document.activeElement === ultim || !fereastra.contains(document.activeElement))) { ev.preventDefault(); prim.focus(); }
      }
    }
    function gata() {
      document.removeEventListener('keydown', tasta);
      if (fundal.parentNode) fundal.parentNode.removeChild(fundal);
      document.body.style.overflow = overflowInitial;
      try { if (anterior && anterior.focus && document.contains(anterior)) anterior.focus(); } catch (e) {}
      if (typeof optiuni.laInchidere === 'function') optiuni.laInchidere();
    }
    inchide.addEventListener('click', gata);
    fundal.addEventListener('mousedown', function (ev) { if (ev.target === fundal) gata(); });
    var overflowInitial = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.appendChild(fundal);
    document.addEventListener('keydown', tasta);
    monteaza(corp, { faraTitlu: true, deschide: optiuni.deschide });
    if (!optiuni.deschide) inchide.focus();
    return { inchide: gata, element: fundal };
  }

  // ── Alegerea din checkout și coș ────────────────────────────────────────
  // optiuni: { prestare, facturare, adaugaAlta (opțiunea „Adaugă alta” → formularul paginii), laSchimbare(stare) }
  function selector(container, optiuni) {
    optiuni = optiuni || {};
    stil();
    var ales = { prestare: undefined, profil: undefined, facturare: undefined };
    var pierdut = { prestare: false, profil: false, facturare: false };
    var radacina = el('div', { class: 'mya', 'data-mya-selector': '1' });
    container.innerHTML = '';
    container.appendChild(radacina);
    var NOU = 'nou';
    var LUCRARE = 'lucrare';

    function bloc(eticheta, select, nume) {
      var b = el('button', { type: 'button', class: 'mya-btn', text: tr('Gestionează'), 'data-mya': 'gestioneaza-' + nume, 'aria-haspopup': 'dialog', onclick: function () { deschidePanou(); } });
      var id = 'mya-s-' + nume + '-' + Math.random().toString(36).slice(2, 6);
      select.id = id;
      select.setAttribute('data-mya-alege', nume);
      return el('div', { class: 'mya-sel' }, [el('label', { class: 'mya-et', for: id, text: eticheta }), el('div', { class: 'mya-sel-rand' }, [select, b])]);
    }
    function optiune(v, t, sel) { return el('option', { value: v, text: t, selected: sel }); }
    // Selecția: păstrată după reîmprospătare; ștearsă → golită, cu mesaj.
    function pastreaza(cheie, lista, implicit) {
      var v = ales[cheie];
      if (v === undefined) return implicit;
      // Gol = încă nimic ales (de ex. lista era goală): se ia cel implicit, dacă a apărut
      // unul; rămâne gol doar când elementul ales a fost șters (mesajul „alege alta”).
      if (v === '') return pierdut[cheie] ? '' : implicit;
      if (v === NOU || v === LUCRARE) return v;
      if (lista.some(function (x) { return x.id === v; })) return v;
      pierdut[cheie] = true;
      return '';
    }

    function deseneaza() {
      var d = stare.date;
      radacina.innerHTML = '';
      var areAgenda = !!(d && (d.adrese.length || d.profiluri.length));
      radacina.style.display = d ? '' : 'none';
      if (!d) return raporteaza();
      if (optiuni.prestare) {
        var adrP = d.adrese.filter(poatePrestare);
        var implP = (adrP.filter(function (a) { return a.implicita_prestare; })[0] || adrP[0] || {}).id || (optiuni.adaugaAlta ? NOU : '');
        ales.prestare = pastreaza('prestare', adrP, implP);
        var sP = el('select', { class: 'mya-in', name: 'adresa_prestare_id' });
        sP.appendChild(optiune('', tr('Alege adresa lucrării'), ales.prestare === ''));
        adrP.forEach(function (a) { sP.appendChild(optiune(a.id, numeAdresa(a), a.id === ales.prestare)); });
        if (optiuni.adaugaAlta) sP.appendChild(optiune(NOU, tr('＋ Adaugă alta (completez mai jos)'), ales.prestare === NOU));
        sP.addEventListener('change', function () { ales.prestare = sP.value; pierdut.prestare = false; raporteaza(); });
        radacina.appendChild(bloc(tr('Adresa lucrării'), sP, 'prestare'));
        if (pierdut.prestare) radacina.appendChild(el('div', { class: 'mya-avert', text: tr('Adresa aleasă a fost ștearsă. Alege alta.') }));
      }
      if (optiuni.facturare) {
        var prof = d.profiluri;
        var implF = (prof.filter(function (p) { return p.implicit; })[0] || prof[0] || {}).id || (optiuni.adaugaAlta ? NOU : '');
        ales.profil = pastreaza('profil', prof, implF);
        var sF = el('select', { class: 'mya-in', name: 'profil_facturare_id' });
        sF.appendChild(optiune('', tr('Alege profilul de facturare'), ales.profil === ''));
        prof.forEach(function (p) { sF.appendChild(optiune(p.id, numeProfil(p), p.id === ales.profil)); });
        if (optiuni.adaugaAlta) sF.appendChild(optiune(NOU, tr('＋ Adaugă alt profil (completez mai jos)'), ales.profil === NOU));
        sF.addEventListener('change', function () { ales.profil = sF.value; ales.facturare = undefined; pierdut.profil = false; deseneaza(); });
        radacina.appendChild(bloc(tr('Profilul de facturare'), sF, 'profil'));
        if (pierdut.profil) radacina.appendChild(el('div', { class: 'mya-avert', text: tr('Profilul ales a fost șters. Alege altul.') }));
        if (!prof.length && !optiuni.adaugaAlta) {
          radacina.appendChild(el('div', { class: 'mya-act' }, [el('button', { type: 'button', class: 'mya-btn mya-p', text: tr('Adaugă profil de facturare'), 'data-mya': 'adauga-profil',
            onclick: function () { deschidePanou({ deschide: 'profil_nou' }); } })]));
        }
        var profil = prof.filter(function (p) { return p.id === ales.profil; })[0];
        if (profil) {
          var adrF = d.adrese.filter(poateFacturare);
          var implA = profil.adresa_facturare_id || (profil.tip === 'pf' ? LUCRARE : ((adrF.filter(function (a) { return a.implicita_facturare; })[0] || {}).id || ''));
          ales.facturare = pastreaza('facturare', adrF, implA);
          if (profil.tip === 'pj' && ales.facturare === LUCRARE) ales.facturare = '';
          var sA = el('select', { class: 'mya-in', name: 'adresa_facturare_id' });
          sA.appendChild(optiune('', tr('Alege adresa de facturare'), ales.facturare === ''));
          if (profil.tip === 'pf') sA.appendChild(optiune(LUCRARE, tr('Aceeași cu adresa lucrării'), ales.facturare === LUCRARE));
          adrF.forEach(function (a) { sA.appendChild(optiune(a.id, numeAdresa(a), a.id === ales.facturare)); });
          sA.addEventListener('change', function () { ales.facturare = sA.value; pierdut.facturare = false; raporteaza(); });
          radacina.appendChild(bloc(tr('Adresa de facturare'), sA, 'facturare'));
          if (pierdut.facturare || (profil.tip === 'pj' && !ales.facturare)) {
            radacina.appendChild(el('div', { class: 'mya-avert', text: tr('Alege adresa de facturare a profilului.') }));
          }
        }
      }
      if (!areAgenda && !optiuni.adaugaAlta && !optiuni.facturare) radacina.style.display = 'none';
      raporteaza();
    }

    function stareCurenta() {
      var d = stare.date || { adrese: [], profiluri: [] };
      var idOk = function (v) { return v && v !== NOU && v !== LUCRARE ? v : null; };
      var aP = d.adrese.filter(function (a) { return a.id === ales.prestare; })[0] || null;
      var pr = d.profiluri.filter(function (p) { return p.id === ales.profil; })[0] || null;
      return {
        are_agenda: !!stare.date,
        adresa_prestare_id: optiuni.prestare ? idOk(ales.prestare) : null,
        adresa_prestare: aP,
        prestare_noua: !!optiuni.prestare && (!stare.date || ales.prestare === NOU),
        profil_facturare_id: optiuni.facturare ? idOk(ales.profil) : null,
        profil: pr,
        // „lucrare” = PF facturat la adresa lucrării, chiar dacă profilul are altă adresă.
        adresa_facturare_id: pr ? (ales.facturare === LUCRARE ? 'lucrare' : idOk(ales.facturare)) : null,
        facturare_noua: !!optiuni.facturare && (!stare.date || ales.profil === NOU),
      };
    }
    function raporteaza() { if (typeof optiuni.laSchimbare === 'function') optiuni.laSchimbare(stareCurenta()); }

    // Alegerea lipsă (de ex. adresa aleasă a fost ștearsă) se marchează sub listă.
    function valideaza() {
      var s = stareCurenta();
      if (!s.are_agenda) return true;
      var lipsa = [];
      if (optiuni.prestare && !s.prestare_noua && !s.adresa_prestare_id) lipsa.push({ camp: 'adresa_prestare_id', mesaj: tr('Alege adresa lucrării.') });
      if (optiuni.facturare && !s.facturare_noua && !s.profil_facturare_id) lipsa.push({ camp: 'profil_facturare_id', mesaj: tr('Alege profilul de facturare.') });
      if (s.profil && s.profil.tip === 'pj' && (!s.adresa_facturare_id || s.adresa_facturare_id === 'lucrare')) lipsa.push({ camp: 'adresa_facturare_id', mesaj: tr('Alege adresa de facturare a profilului.') });
      if (lipsa.length) { window.MDFeedback.aplicaErori(radacina, lipsa); return false; }
      return true;
    }

    var dez = abonare(function () { if (document.contains(radacina)) deseneaza(); else dez(); });
    deseneaza();
    incarca(false);
    return {
      stare: stareCurenta,
      valideaza: valideaza,
      deseneaza: deseneaza,
      alege: function (cheie, v) { ales[cheie] = v; deseneaza(); },
      element: radacina,
    };
  }

  window.MYD_AGENDA = {
    monteaza: monteaza, deschidePanou: deschidePanou, selector: selector,
    incarca: incarca, abonare: abonare, textAdresa: textAdresa,
    date: function () { return stare.date; },
  };
})();
