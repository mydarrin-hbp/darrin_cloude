/* ════════════════════════════════════════════════════════════════
   MY DARRIN — ui-feedback.js (MDFeedback), componenta comună de feedback
   la salvare (regula din CLAUDE.md, decizie LM 8 oct. 2026; extinsă la
   pasul 11-N1, 22 oct. 2026):

   „Se salvează…” (buton blocat) → „✓ Salvat” verde + mesaj verde, sau
   „✕ Nu s-a salvat” roșu + mesaj roșu care rămâne până e închis, cu eroarea
   explicată. Mesajul verde apare doar după răspunsul real al serverului;
   valorile introduse nu se șterg. Textele trec prin window.t (RO / EN).

   Utilizare:
     MDFeedback.salveaza(buton, zonaMesaj, async () => {
       const j = await MDFeedback.cerere('/api/...', { method: 'POST', headers, body });
       return 'Ciornă salvată.';                  // mesajul verde (opțional)
     }, { form: formular });                      // câmpurile greșite se marchează
     MDFeedback.mesaj(zonaMesaj, 'ok' | 'eroare' | 'info', 'text');
     MDFeedback.toast('succes' | 'eroare' | 'info', 'text', { reincearca: fn });
     if (await MDFeedback.confirma('Ștergi…?', { textOk: 'Șterge', periculos: true })) { … }
     MDFeedback.aplicaErori(formular, [{ camp: 'suma_tinta', mesaj: { ro, en } }]);
   Opțiuni salveaza: { textSalveaza: 'Se verifică…', textOk: '✓ Verificat', ok, eroare,
     form, toast: true, timeout: 15000 }. Fără zonă de mesaj, rezultatul apare
   ca toast. Peste 15 s fără răspuns sau fără rețea: eroare cu „Reîncearcă”.

   Forma comună a erorilor de la server (lib/raspuns-eroare.js):
     { ok:false, cod, mesaj:{ro,en}, campuri:[{camp, mesaj:{ro,en}}] }
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MDFeedback) return;

  var VERDE = '#1A7A3A', ROSU = '#C0392B', GRI = '#5A6B7D';
  var TIMEOUT_MS = 15000;
  var DURATA_TOAST_MS = 4000;
  var tr = function (ro, param) {
    if (typeof window.t === 'function') return window.t(null, ro, param);
    return param ? String(ro).replace(/\{(\w+)\}/g, function (m, x) { return param[x] != null ? param[x] : m; }) : ro;
  };

  // Limba paginii: RO doar unde pagina e în română (superadminul rămâne RO).
  function limba() {
    var l = (window.MYD_I18N && window.MYD_I18N.lang) || document.documentElement.lang || 'ro';
    return String(l).slice(0, 2).toLowerCase() === 'ro' ? 'ro' : 'en';
  }
  // Un mesaj { ro, en } în limba paginii; textele simple rămân așa cum sunt.
  function textBilingv(m) {
    if (m == null) return '';
    if (typeof m !== 'object') return String(m);
    return m[limba()] || m.ro || m.en || '';
  }

  function butonMic(text, culoare) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.style.cssText = 'background:none;border:1.5px solid ' + culoare + ';color:' + culoare + ';border-radius:8px;padding:3px 10px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap';
    return b;
  }
  function butonInchide(culoare, laClic) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = '×';
    b.setAttribute('aria-label', tr('Închide'));
    b.style.cssText = 'background:none;border:none;color:' + culoare + ';font-size:18px;line-height:1;cursor:pointer;padding:0 2px;min-width:24px;min-height:24px';
    b.onclick = laClic;
    return b;
  }

  function mesaj(zona, tip, text, optiuni) {
    if (!zona) return;
    optiuni = optiuni || {};
    zona.innerHTML = '';
    if (!text) return;
    var cutie = document.createElement('div');
    cutie.setAttribute('role', tip === 'eroare' ? 'alert' : 'status');
    cutie.className = 'md-feedback md-feedback-' + tip;
    var culoare = tip === 'ok' ? VERDE : tip === 'eroare' ? ROSU : GRI;
    cutie.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin-top:8px;padding:9px 12px;border-radius:10px;font-size:12.5px;line-height:1.45;flex-wrap:wrap;'
      + 'border:1.5px solid ' + culoare + ';color:' + culoare + ';background:' + (tip === 'ok' ? '#EDF7F0' : tip === 'eroare' ? '#FDECEA' : '#F4F7F9');
    var span = document.createElement('span');
    span.style.cssText = 'flex:1;min-width:0;overflow-wrap:anywhere';
    span.textContent = text;
    cutie.appendChild(span);
    if (tip === 'eroare' && optiuni.reincearca) {
      var reia = butonMic(tr('Reîncearcă'), ROSU);
      reia.className = 'md-reincearca';
      reia.onclick = function () { zona.innerHTML = ''; optiuni.reincearca(); };
      cutie.appendChild(reia);
    }
    if (tip === 'eroare') cutie.appendChild(butonInchide(ROSU, function () { zona.innerHTML = ''; }));
    zona.appendChild(cutie);
  }

  // ── Toast: succes / eroare / info ─────────────────────────────────────
  // Sus, în dreapta; dacă ar acoperi butonul care l-a declanșat (de ex. la
  // 390 px), se mută jos. Succesul și informația dispar după ~4 s; eroarea
  // rămâne până e închisă.
  function zonaToast() {
    var z = document.getElementById('md-toast-zona');
    if (!z) {
      z = document.createElement('div');
      z.id = 'md-toast-zona';
      z.style.cssText = 'position:fixed;top:12px;right:12px;z-index:100000;display:flex;flex-direction:column;gap:8px;'
        + 'width:380px;max-width:calc(100vw - 24px);pointer-events:none';
      document.body.appendChild(z);
    }
    return z;
  }
  function seSuprapun(a, b) {
    return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  }
  function aseazaToast(z, evita) {
    z.style.top = '12px'; z.style.bottom = 'auto';
    if (!evita || !evita.getBoundingClientRect || !z.children.length) return;
    var rb = evita.getBoundingClientRect();
    if (seSuprapun(z.getBoundingClientRect(), rb)) { z.style.top = 'auto'; z.style.bottom = '12px'; }
  }

  function toast(tip, text, optiuni) {
    optiuni = optiuni || {};
    tip = tip === 'ok' || tip === 'succes' ? 'succes' : tip === 'eroare' || tip === 'error' ? 'eroare' : 'info';
    var culoare = tip === 'succes' ? VERDE : tip === 'eroare' ? ROSU : GRI;
    var fundal = tip === 'succes' ? '#EDF7F0' : tip === 'eroare' ? '#FDECEA' : '#F4F7F9';
    var z = zonaToast();
    var t = document.createElement('div');
    t.className = 'md-toast md-toast-' + tip;
    t.setAttribute('role', tip === 'eroare' ? 'alert' : 'status');
    t.setAttribute('aria-live', tip === 'eroare' ? 'assertive' : 'polite');
    t.style.cssText = 'pointer-events:auto;display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;padding:11px 12px;border-radius:12px;'
      + 'font-size:13px;line-height:1.45;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.25);font-family:inherit;'
      + 'border:1.5px solid ' + culoare + ';color:' + culoare + ';background:' + fundal;
    var ico = document.createElement('span');
    ico.setAttribute('aria-hidden', 'true');
    ico.textContent = tip === 'succes' ? '✓' : tip === 'eroare' ? '✕' : 'ℹ';
    ico.style.cssText = 'font-weight:800;flex:none';
    var span = document.createElement('span');
    span.className = 'md-toast-text';
    span.style.cssText = 'flex:1;min-width:0;overflow-wrap:anywhere;white-space:pre-line';
    span.textContent = text == null ? '' : String(text);
    t.appendChild(ico);
    t.appendChild(span);
    var inchide = function () { if (t.parentNode) t.parentNode.removeChild(t); };
    if (optiuni.reincearca) {
      var reia = butonMic(tr('Reîncearcă'), culoare);
      reia.className = 'md-reincearca';
      reia.onclick = function () { inchide(); optiuni.reincearca(); };
      t.appendChild(reia);
    }
    t.appendChild(butonInchide(culoare, inchide));
    z.appendChild(t);
    // cel mult 5 toast-uri; primele care pleacă sunt cele care nu sunt erori
    while (z.children.length > 5) {
      var vechi = Array.prototype.find.call(z.children, function (c) { return !/md-toast-eroare/.test(c.className); }) || z.children[0];
      z.removeChild(vechi);
    }
    aseazaToast(z, optiuni.evita || document.activeElement);
    if (tip !== 'eroare') setTimeout(inchide, optiuni.durata || DURATA_TOAST_MS);
    return t;
  }

  // ── Confirmare: fereastră proprie (nu confirm() nativ) ────────────────
  // Întoarce Promise<boolean>. La acțiunile periculoase focusul pornește pe
  // „Anulează”; Escape și clicul în afara ferestrei = anulare.
  function confirma(text, optiuni) {
    optiuni = optiuni || {};
    return new Promise(function (rezolva) {
      var anterior = document.activeElement;
      var id = 'md-confirma-' + Date.now().toString(36);
      var fundal = document.createElement('div');
      fundal.className = 'md-confirma-fundal';
      fundal.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(15,25,35,.6);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
      var cutie = document.createElement('div');
      cutie.className = 'md-confirma';
      cutie.setAttribute('role', 'alertdialog');
      cutie.setAttribute('aria-modal', 'true');
      cutie.setAttribute('aria-labelledby', id + '-t');
      cutie.setAttribute('aria-describedby', id + '-m');
      cutie.style.cssText = 'background:#fff;color:#1A2332;border-radius:14px;padding:20px;width:100%;max-width:440px;box-sizing:border-box;box-shadow:0 16px 48px rgba(0,0,0,.35);font-family:inherit;max-height:calc(100vh - 32px);overflow:auto';
      var titlu = document.createElement('div');
      titlu.id = id + '-t';
      titlu.style.cssText = 'font-weight:800;font-size:15px;margin-bottom:8px;color:' + (optiuni.periculos ? ROSU : '#1A2332');
      titlu.textContent = optiuni.titlu || tr('Confirmare');
      var corp = document.createElement('div');
      corp.id = id + '-m';
      corp.style.cssText = 'font-size:13.5px;line-height:1.5;white-space:pre-line;overflow-wrap:anywhere';
      corp.textContent = text == null ? '' : String(text);
      var rand = document.createElement('div');
      rand.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px';
      var stil = 'border-radius:9px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;min-height:40px;';
      var anuleaza = document.createElement('button');
      anuleaza.type = 'button';
      anuleaza.className = 'md-confirma-anuleaza';
      anuleaza.textContent = optiuni.textAnulare || tr('Anulează');
      anuleaza.style.cssText = stil + 'background:#fff;color:#1A2332;border:1.5px solid #C5D2E0';
      var ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'md-confirma-ok';
      ok.textContent = optiuni.textOk || tr('Confirmă');
      ok.style.cssText = stil + 'color:#fff;border:1.5px solid ' + (optiuni.periculos ? ROSU : '#0E9E99') + ';background:' + (optiuni.periculos ? ROSU : '#0E9E99');
      rand.appendChild(anuleaza);
      rand.appendChild(ok);
      cutie.appendChild(titlu);
      cutie.appendChild(corp);
      cutie.appendChild(rand);
      fundal.appendChild(cutie);

      function inchide(v) {
        document.removeEventListener('keydown', tasta, true);
        if (fundal.parentNode) fundal.parentNode.removeChild(fundal);
        try { if (anterior && anterior.focus && document.contains(anterior)) anterior.focus(); } catch (e) {}
        rezolva(v);
      }
      function tasta(ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); inchide(false); }
        else if (ev.key === 'Tab') {
          ev.preventDefault();
          (document.activeElement === ok ? anuleaza : ok).focus();
        }
      }
      anuleaza.onclick = function () { inchide(false); };
      ok.onclick = function () { inchide(true); };
      fundal.addEventListener('mousedown', function (ev) { if (ev.target === fundal) inchide(false); });
      document.addEventListener('keydown', tasta, true);
      document.body.appendChild(fundal);
      (optiuni.periculos ? anuleaza : ok).focus();
    });
  }

  // ── Câmpurile formularului ────────────────────────────────────────────
  function gasesteCamp(form, camp) {
    if (!form || !camp) return null;
    if (camp.nodeType === 1) return camp;
    var e = window.CSS && CSS.escape ? CSS.escape(camp) : String(camp).replace(/["\\]/g, '\\$&');
    return form.querySelector('[data-camp="' + e + '"]') || form.querySelector('[name="' + e + '"]')
      || form.querySelector('#' + e) || form.querySelector('[id$="-' + e + '"]');
  }
  // Numele câmpului, așa cum îl vede utilizatorul (eticheta lui).
  function etichetaCamp(el) {
    if (el.getAttribute('data-eticheta')) return el.getAttribute('data-eticheta');
    var lab = (el.id && document.querySelector('label[for="' + el.id + '"]')) || (el.closest && el.closest('label'));
    if (lab) {
      var copie = lab.cloneNode(true);
      Array.prototype.forEach.call(copie.querySelectorAll('input,select,textarea,.md-camp-eroare'), function (x) { x.remove(); });
      var s = copie.textContent.replace(/\s+/g, ' ').trim();
      if (s) return s;
    }
    return el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.id || '';
  }
  function deFocus(el) {
    if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName)) return el;
    return el.querySelector('input,select,textarea,button') || el;
  }
  var nrEroare = 0;
  function curataCamp(el) {
    if (!el || !el.__mdEroare) return;
    var m = el.__mdEroare;
    if (m.parentNode) m.parentNode.removeChild(m);
    var desc = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(function (x) { return x && x !== m.id; }).join(' ');
    if (desc) el.setAttribute('aria-describedby', desc); else el.removeAttribute('aria-describedby');
    el.removeAttribute('aria-invalid');
    el.style.borderColor = el.__mdChenar || '';
    el.style.boxShadow = el.__mdUmbra || '';
    el.removeEventListener('input', el.__mdAscultator);
    el.removeEventListener('change', el.__mdAscultator);
    el.__mdEroare = null;
  }
  function curataErori(form) {
    if (!form) return;
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid="true"]'), curataCamp);
    Array.prototype.forEach.call(form.querySelectorAll('.md-camp-eroare'), function (x) { x.remove(); });
  }
  function marcheaza(el, text) {
    curataCamp(el);
    var m = document.createElement('div');
    m.id = 'md-err-' + (++nrEroare);
    m.className = 'md-camp-eroare';
    m.style.cssText = 'color:' + ROSU + ';font-size:12px;font-weight:600;line-height:1.4;margin-top:4px';
    m.textContent = text;
    el.__mdChenar = el.style.borderColor;
    el.__mdUmbra = el.style.boxShadow;
    el.setAttribute('aria-invalid', 'true');
    el.style.borderColor = ROSU;
    el.style.boxShadow = '0 0 0 1px ' + ROSU;
    el.setAttribute('aria-describedby', ((el.getAttribute('aria-describedby') || '') + ' ' + m.id).trim());
    el.insertAdjacentElement('afterend', m);
    el.__mdEroare = m;
    // eroarea dispare când câmpul e corectat (prima modificare)
    el.__mdAscultator = function () { curataCamp(el); };
    el.addEventListener('input', el.__mdAscultator);
    el.addEventListener('change', el.__mdAscultator);
  }

  // Marchează câmpurile greșite; focus pe primul și îl aduce în ecran.
  // campuri: [{ camp: 'suma_tinta' | element, mesaj: { ro, en } | 'text' }].
  // Întoarce etichetele câmpurilor marcate (pentru rezumat).
  function aplicaErori(form, campuri) {
    curataErori(form);
    var marcate = [];
    (campuri || []).forEach(function (c) {
      var el = gasesteCamp(form, c && c.camp);
      if (!el) return;
      marcheaza(el, textBilingv(c.mesaj) || tr('Câmp invalid.'));
      marcate.push({ el: el, eticheta: etichetaCamp(el) });
    });
    if (marcate.length) {
      var primul = deFocus(marcate[0].el);
      try { primul.focus({ preventScroll: true }); } catch (e) { primul.focus(); }
      if (primul.scrollIntoView) primul.scrollIntoView({ block: 'center' });
    }
    return marcate.map(function (m) { return m.eticheta; });
  }

  // Validarea din browser a câmpurilor obligatorii ([required] sau
  // [data-obligatoriu]), cu același mesaj ca serverul. Serverul rămâne
  // sursa de adevăr. Întoarce lista de erori (goală = totul e completat).
  function campuriLipsa(form) {
    if (!form) return [];
    var lipsa = [];
    Array.prototype.forEach.call(form.querySelectorAll('[required],[data-obligatoriu]'), function (el) {
      if (el.disabled || el.hidden) return;
      var gol;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) gol = el.type === 'checkbox' ? !el.checked : !String(el.value || '').trim();
      else gol = !el.querySelector('input:checked');
      if (gol) lipsa.push({ camp: el, mesaj: tr('Completați «{eticheta}».', { eticheta: etichetaCamp(el) }) });
    });
    return lipsa;
  }
  function rezumat(etichete) {
    return tr('Salvarea nu a putut fi efectuată. Corectați câmpurile marcate: {campuri}.', { campuri: etichete.join(', ') });
  }

  // ── Răspunsul serverului ──────────────────────────────────────────────
  function eroareDinRaspuns(status, corp) {
    corp = corp == null ? {} : corp;
    var text = '';
    if (typeof corp === 'string') text = corp.trim().slice(0, 300);
    else if (corp.mesaj && typeof corp.mesaj === 'object') text = textBilingv(corp.mesaj);
    else text = (limba() === 'en' && corp.error_en) || corp.error || corp.mesaj || corp.motiv || corp.message || '';
    if (!text || /^\s*</.test(text)) text = tr('Eroare de server (HTTP {status}).', { status: status });
    var e = new Error(text);
    e.status = status;
    e.cod = (corp && corp.cod) || null;
    e.campuri = corp && Array.isArray(corp.campuri) ? corp.campuri : [];
    e.date = corp;
    e.reincercabil = !status || status >= 500 || status === 408 || status === 429;
    return e;
  }
  // Citește răspunsul: JSON (sau text). Eroare dacă HTTP ≥ 400 sau ok:false.
  async function citesteRaspuns(res) {
    var text = '', corp;
    try { text = await res.text(); } catch (e) { text = ''; }
    try { corp = text ? JSON.parse(text) : {}; } catch (e) { corp = text; }
    if (!res.ok || (corp && corp.ok === false)) throw eroareDinRaspuns(res.status, corp);
    return corp || {};
  }
  function eroareTimeout() {
    var e = new Error(tr('Serverul nu a răspuns în 15 secunde. Verificați conexiunea și reîncercați.'));
    e.cod = 'TIMEOUT'; e.reincercabil = true; e.campuri = [];
    return e;
  }
  function eroareRetea() {
    var e = new Error(tr('Nu s-a putut contacta serverul. Verificați conexiunea și reîncercați.'));
    e.cod = 'RETEA'; e.reincercabil = true; e.campuri = [];
    return e;
  }
  function esteEroareRetea(e) {
    return e && e.name === 'TypeError' && /fetch|network|load failed/i.test(e.message || '');
  }
  // fetch cu timeout de 15 s și citirea formei comune de eroare.
  // optiuni: ca la fetch; body obiect → JSON.
  async function cerere(url, optiuni) {
    var o = Object.assign({}, optiuni || {});
    if (o.body && typeof o.body === 'object' && !(o.body instanceof FormData) && !(o.body instanceof Blob)) {
      o.headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
      o.body = JSON.stringify(o.body);
    }
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var ceas = ctrl ? setTimeout(function () { ctrl.abort(); }, o.timeout || TIMEOUT_MS) : null;
    if (ctrl) o.signal = ctrl.signal;
    delete o.timeout;
    var res;
    try { res = await fetch(url, o); }
    catch (e) {
      if (e && e.name === 'AbortError') throw eroareTimeout();
      if (esteEroareRetea(e)) throw eroareRetea();
      throw e;
    } finally { if (ceas) clearTimeout(ceas); }
    return citesteRaspuns(res);
  }

  function cuTimeout(promisiune, ms) {
    var ceas;
    return Promise.race([
      promisiune,
      new Promise(function (_, respinge) { ceas = setTimeout(function () { respinge(eroareTimeout()); }, ms); }),
    ]).finally(function () { clearTimeout(ceas); });
  }

  async function salveaza(buton, zona, fn, optiuni) {
    optiuni = optiuni || {};
    // fără clic dublu: cât timp așteaptă, al doilea clic nu mai pornește nimic
    if (buton && buton.__mdOcupat) return { ok: false, ignorat: true };
    var cuToast = optiuni.toast || !zona;
    var form = optiuni.form || null;
    if (form) curataErori(form);
    if (zona) zona.innerHTML = '';

    var lipsa = form ? campuriLipsa(form) : [];
    if (lipsa.length) {
      var etichete = aplicaErori(form, lipsa);
      var txt = rezumat(etichete);
      mesaj(zona, 'eroare', txt);
      if (cuToast) toast('eroare', txt, { evita: buton });
      var ev = new Error(txt); ev.campuri = lipsa;
      return { ok: false, eroare: ev };
    }

    var htmlInitial = buton ? buton.innerHTML : '';
    var stilInitial = buton ? { bg: buton.style.background, color: buton.style.color } : null;
    var restaureaza = function () {
      if (!buton) return;
      buton.innerHTML = htmlInitial;
      buton.style.background = stilInitial.bg; buton.style.color = stilInitial.color;
    };
    if (buton) {
      buton.__mdOcupat = true;
      buton.disabled = true;
      buton.setAttribute('aria-busy', 'true');
      buton.textContent = tr(optiuni.textSalveaza || 'Se salvează…');
    }
    try {
      var rezultat = await cuTimeout(Promise.resolve().then(fn), optiuni.timeout || TIMEOUT_MS);
      var textOk = typeof rezultat === 'string' ? rezultat : tr(optiuni.ok || 'Salvat.');
      if (buton) {
        buton.removeAttribute('aria-busy');
        buton.textContent = tr(optiuni.textOk || '✓ Salvat');
        buton.style.background = VERDE; buton.style.color = '#fff';
        setTimeout(function () { buton.disabled = false; buton.__mdOcupat = false; restaureaza(); }, 1800);
      }
      mesaj(zona, 'ok', textOk);
      if (cuToast) toast('succes', textOk, { evita: buton });
      return { ok: true, rezultat: rezultat };
    } catch (e) {
      if (esteEroareRetea(e)) e = eroareRetea();
      var text = (e && e.message) || tr(optiuni.eroare || 'Nu s-a salvat. Încearcă din nou.');
      if (form && e && e.campuri && e.campuri.length) {
        var marcate = aplicaErori(form, e.campuri);
        if (marcate.length) text = rezumat(marcate);
      }
      var reia = e && e.reincercabil ? function () { salveaza(buton, zona, fn, optiuni); } : null;
      if (buton) {
        buton.__mdOcupat = false;
        buton.disabled = false;
        buton.removeAttribute('aria-busy');
        buton.textContent = tr('✕ Nu s-a salvat');
        buton.style.background = ROSU; buton.style.color = '#fff';
        setTimeout(restaureaza, 2500);
      }
      mesaj(zona, 'eroare', text, { reincearca: reia });
      if (cuToast) toast('eroare', text, { reincearca: reia, evita: buton });
      return { ok: false, eroare: e };
    }
  }

  window.MDFeedback = {
    salveaza: salveaza, mesaj: mesaj, toast: toast, confirma: confirma,
    aplicaErori: aplicaErori, curataErori: curataErori, campuriLipsa: campuriLipsa,
    cerere: cerere, citesteRaspuns: citesteRaspuns, eroareDinRaspuns: eroareDinRaspuns,
    textBilingv: textBilingv, limba: limba, TIMEOUT_MS: TIMEOUT_MS,
  };
})();
