/* ════════════════════════════════════════════════════════════════
   MY DARRIN — ui-feedback.js (MDFeedback), componenta comună de feedback
   la salvare (regula din CLAUDE.md, decizie LM 8 oct. 2026):

   „Se salvează…” (buton blocat) → „✓ Salvat” verde + mesaj verde, sau
   „✕ Nu s-a salvat” roșu + mesaj roșu care rămâne până e închis, cu eroarea
   explicată. Mesajul verde apare doar după răspunsul real al serverului;
   valorile introduse nu se șterg. Textele trec prin window.t (RO / EN).

   Utilizare:
     MDFeedback.salveaza(buton, zonaMesaj, async () => {
       const r = await fetch(...); const j = await r.json();
       if (!r.ok) throw new Error(j.error);      // mesajul afișat în roșu
       return 'Ciornă salvată.';                  // mesajul verde (opțional)
     });
     MDFeedback.mesaj(zonaMesaj, 'ok' | 'eroare' | 'info', 'text');
   Opțiuni: { textSalveaza: 'Se verifică…', textOk: '✓ Verificat', ok, eroare }.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MDFeedback) return;

  var VERDE = '#1A7A3A', ROSU = '#C0392B', GRI = '#5A6B7D';
  var tr = function (ro) { return typeof window.t === 'function' ? window.t(null, ro) : ro; };

  function mesaj(zona, tip, text) {
    if (!zona) return;
    zona.innerHTML = '';
    if (!text) return;
    var cutie = document.createElement('div');
    cutie.setAttribute('role', tip === 'eroare' ? 'alert' : 'status');
    cutie.className = 'md-feedback md-feedback-' + tip;
    var culoare = tip === 'ok' ? VERDE : tip === 'eroare' ? ROSU : GRI;
    cutie.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin-top:8px;padding:9px 12px;border-radius:10px;font-size:12.5px;line-height:1.45;'
      + 'border:1.5px solid ' + culoare + ';color:' + culoare + ';background:' + (tip === 'ok' ? '#EDF7F0' : tip === 'eroare' ? '#FDECEA' : '#F4F7F9');
    var span = document.createElement('span');
    span.style.flex = '1';
    span.textContent = text;
    cutie.appendChild(span);
    if (tip === 'eroare') {
      var inchide = document.createElement('button');
      inchide.type = 'button';
      inchide.textContent = '×';
      inchide.setAttribute('aria-label', tr('Închide'));
      inchide.style.cssText = 'background:none;border:none;color:' + ROSU + ';font-size:16px;line-height:1;cursor:pointer;padding:0 2px';
      inchide.onclick = function () { zona.innerHTML = ''; };
      cutie.appendChild(inchide);
    }
    zona.appendChild(cutie);
  }

  async function salveaza(buton, zona, fn, optiuni) {
    optiuni = optiuni || {};
    var textInitial = buton ? buton.textContent : '';
    var stilInitial = buton ? { bg: buton.style.background, color: buton.style.color } : null;
    if (buton) { buton.disabled = true; buton.textContent = tr(optiuni.textSalveaza || 'Se salvează…'); }
    if (zona) zona.innerHTML = '';
    try {
      var rezultat = await fn();
      if (buton) {
        buton.textContent = tr(optiuni.textOk || '✓ Salvat');
        buton.style.background = VERDE; buton.style.color = '#fff';
        setTimeout(function () {
          buton.disabled = false; buton.textContent = textInitial;
          buton.style.background = stilInitial.bg; buton.style.color = stilInitial.color;
        }, 1800);
      }
      mesaj(zona, 'ok', typeof rezultat === 'string' ? rezultat : tr(optiuni.ok || 'Salvat.'));
      return { ok: true, rezultat: rezultat };
    } catch (e) {
      if (buton) {
        buton.disabled = false;
        buton.textContent = tr('✕ Nu s-a salvat');
        buton.style.background = ROSU; buton.style.color = '#fff';
        setTimeout(function () {
          buton.textContent = textInitial;
          buton.style.background = stilInitial.bg; buton.style.color = stilInitial.color;
        }, 2500);
      }
      mesaj(zona, 'eroare', (e && e.message) || tr(optiuni.eroare || 'Nu s-a salvat. Încearcă din nou.'));
      return { ok: false, eroare: e };
    }
  }

  window.MDFeedback = { salveaza: salveaza, mesaj: mesaj };
})();
