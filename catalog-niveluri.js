/* ════════════════════════════════════════════════════════════════
   MY DARRIN — catalog-niveluri.js: editorul de niveluri și prețuri al unui
   serviciu (Bronz / Argint / Aur / Platinum), cu rețeta tehnică a nivelului
   și recalcularea prețului din rețetă.

   Pasul 9 (15 oct. 2026): mutat din mydarrin-superadmin.html (panel-catalog),
   ca să fie folosit, fără duplicare, și de mydarrin-admin-catalog.html.
   Aceleași funcții globale ca înainte (creeazaNivelCatalog, salveazaNivelCatalog,
   creeazaPretCatalog…), aceleași acțiuni din /api/admin/catalog.

   - MDCatalogNiveluri.html(serviciu) → HTML-ul nivelurilor + formularul de nivel nou;
   - MDCatalogNiveluri.reincarca(serviciuId) → reîncărcarea după o salvare
     (implicit loadCatalogList() din superadmin; pagina de catalog o suprascrie).
   Textele trec prin window.t (RO în superadmin, RO / EN în pagina de catalog);
   rezultatul salvărilor apare prin MDFeedback (ui-feedback.js), nu prin alert().
   Culorile vin din variabile CSS (--mdn-*), cu valori implicite pentru
   tema închisă a superadminului.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var t = function (ro, p) {
    var s = typeof window.t === 'function' ? window.t(null, ro) : ro;
    return p ? s.replace(/\{(\w+)\}/g, function (m, k) { return p[k] != null ? p[k] : m; }) : s;
  };
  var esc = function (s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
  async function antet() {
    var sesiune = (await window.supabaseClient.auth.getSession()).data.session;
    return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sesiune ? sesiune.access_token : '') };
  }
  async function cere(corp) {
    var r = await fetch('/api/admin/catalog', { method: 'POST', headers: await antet(), body: JSON.stringify(corp) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      var e = new Error((window.MYD_I18N && window.MYD_I18N.lang !== 'ro' && j.error_en) || j.error || t('Eroare necunoscută'));
      e.status = r.status; e.date = j;
      throw e;
    }
    return j;
  }
  var zona = function (sid) { return document.getElementById('niv-msg-' + sid); };
  function feedback(sid, tip, text) { if (window.MDFeedback) window.MDFeedback.mesaj(zona(sid), tip, text); }
  function reincarca(sid) { return window.MDCatalogNiveluri.reincarca(sid); }
  // Salvează, apoi reîncarcă lista: mesajul verde se scrie după redesenare,
  // în zona nouă (cea veche dispare la reîncărcare).
  async function salveazaSiReincarca(buton, sid, fn) {
    var r = await window.MDFeedback.salveaza(buton, zona(sid), fn);
    if (r.ok) { await reincarca(sid); feedback(sid, 'ok', r.rezultat); }
    return r;
  }

  var STIL = '.mdn-nivel{background:var(--mdn-card,#131B27);border-radius:9px;padding:10px 12px;margin-bottom:8px;border:1px solid var(--mdn-border,transparent)}'
    + '.mdn-titlu{font-size:12px;font-weight:700;color:var(--mdn-text,#fff)}.mdn-sub{color:var(--mdn-muted,#8BA3C0);font-weight:400}'
    + '.mdn-muted{font-size:11px;color:var(--mdn-muted,#8BA3C0)}'
    + '.mdn-in{background:var(--mdn-input,#0F1826);border:1px solid var(--mdn-line,#2D3F55);border-radius:7px;padding:6px 9px;color:var(--mdn-text,#fff);font-size:11px;font-family:inherit;max-width:100%}'
    + '.mdn-b{font-size:11px;padding:5px 10px;border-radius:7px;border:1px solid var(--mdn-line,#2D3F55);background:transparent;color:var(--mdn-muted,#8BA3C0);cursor:pointer}'
    + '.mdn-b.p{border:none;background:#0E9E99;color:#fff;font-weight:700}.mdn-b.o{border:none;background:#FF8C00;color:#fff;font-weight:700}'
    + '.mdn-b.r{border:1px solid rgba(192,57,43,.4);color:#E57373}.mdn-rand{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center}'
    + '.mdn-pret{display:inline-flex;align-items:center;gap:6px;font-size:11px;background:var(--mdn-input,#0F1826);color:var(--mdn-muted,#8BA3C0);border-radius:7px;padding:4px 9px;margin:2px 4px 2px 0}'
    + '.mdn-pret b{color:var(--mdn-text,#fff)}.mdn-sep{margin-top:8px;padding-top:8px;border-top:1px dashed var(--mdn-line,#2D3F55)}';
  function stil() {
    if (document.getElementById('mdn-stil')) return;
    var s = document.createElement('style'); s.id = 'mdn-stil'; s.textContent = STIL; document.head.appendChild(s);
  }

  function html(s) {
    stil();
    var niveluri = s.niveluri || [];
    return niveluri.map(function (n) {
      var preturi = (n.preturi || []).map(function (p) {
        return '<span class="mdn-pret">' + esc(p.tara_cod) + (p.regiune ? '/' + esc(p.regiune) : '') + ': <b>' + esc(p.pret) + ' ' + esc(p.moneda) + '</b>'
          + '<button onclick="stergePretCatalog(\'' + p.id + '\', \'' + s.id + '\')" aria-label="' + esc(t('Șterge prețul')) + '" style="background:none;border:none;color:#E57373;cursor:pointer;font-size:11px;padding:0">✕</button></span>';
      }).join('') || '<span class="mdn-muted">' + esc(t('La cerere: niciun preț activ încă')) + '</span>';
      return '<div class="mdn-nivel" data-nivel="' + n.id + '">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">'
        + '<div class="mdn-titlu">' + esc(n.label || n.nivel) + ' <span class="mdn-sub">· ' + esc(t('complexitate {c}', { c: n.nivel_complexitate })) + ' · ' + esc(t('{h} h normă', { h: n.norma_timp }))
        + (n.garantie_luni ? ' · ' + esc(t('garanție {g} luni', { g: n.garantie_luni })) : '') + '</span></div>'
        + '<button class="mdn-b" onclick="toggleEditareNivel(\'' + n.id + '\')">' + esc(t('✎ Editează nivel')) + '</button></div>'
        + (n.descriere ? '<div class="mdn-muted" style="margin-top:4px">' + esc(n.descriere) + '</div>' : '')
        + '<div id="nivel-editare-' + n.id + '" class="mdn-sep" style="display:none">'
        + '<div class="mdn-rand" style="margin-bottom:6px">'
        + '<input id="nivel-edit-label-' + n.id + '" class="mdn-in" value="' + esc(n.label || '') + '" placeholder="' + esc(t('Titlu afișat (ex: Bronz — Manoperă pură)')) + '" style="flex:1;min-width:180px">'
        + '<input id="nivel-edit-norma-' + n.id + '" class="mdn-in" value="' + esc(n.norma_timp) + '" type="number" step="0.01" placeholder="' + esc(t('Normă timp (h)')) + '" style="width:110px">'
        + '<input id="nivel-edit-materiale-' + n.id + '" class="mdn-in" value="' + esc(n.materiale_baza_estimat || 0) + '" type="number" step="0.01" placeholder="' + esc(t('Materiale estimate (Lei)')) + '" style="width:150px">'
        + '<input id="nivel-edit-garantie-' + n.id + '" class="mdn-in" value="' + esc(n.garantie_luni || 0) + '" type="number" placeholder="' + esc(t('Garanție (luni)')) + '" style="width:120px"></div>'
        + '<textarea id="nivel-edit-desc-' + n.id + '" class="mdn-in" rows="2" placeholder="' + esc(t('Descriere nivel — afișată public (ex: ce include acest nivel)')) + '" style="width:100%;resize:vertical">' + esc(n.descriere || '') + '</textarea>'
        + '<div class="mdn-rand"><button class="mdn-b p" onclick="salveazaNivelCatalog(\'' + n.id + '\', \'' + s.id + '\', this)">' + esc(t('Salvează nivelul')) + '</button></div></div>'
        + '<div style="margin-top:6px">' + preturi + '</div>'
        + '<div class="mdn-rand" style="margin-top:8px">'
        + '<input id="pret-tara-' + n.id + '" class="mdn-in" placeholder="' + esc(t('Țară (RO)')) + '" style="width:110px">'
        + '<input id="pret-moneda-' + n.id + '" class="mdn-in" placeholder="' + esc(t('Monedă (Lei)')) + '" style="width:120px">'
        + '<input id="pret-val-' + n.id + '" class="mdn-in" placeholder="' + esc(t('Preț')) + '" type="number" style="width:80px">'
        + '<button class="mdn-b o" onclick="creeazaPretCatalog(\'' + n.id + '\', \'' + s.id + '\', this)">' + esc(t('+ Preț')) + '</button>'
        + '<button class="mdn-b r" onclick="stergeNivelCatalog(\'' + n.id + '\', \'' + s.id + '\')" style="margin-left:auto">' + esc(t('Șterge nivelul')) + '</button></div>'
        + '<div class="mdn-sep"><div class="mdn-rand" style="margin-top:0">'
        + '<button class="mdn-b" onclick="toggleRetetaNivel(\'' + n.id + '\')">' + esc(t('Rețetă tehnică — articole legate ▾')) + '</button>'
        + '<input id="recalc-tara-' + n.id + '" class="mdn-in" value="RO" aria-label="' + esc(t('Țara pentru recalculare')) + '" style="width:48px;text-transform:uppercase">'
        + '<button class="mdn-b o" onclick="recalculeazaPretNivel(\'' + n.id + '\', \'' + s.id + '\')">' + esc(t('Recalculează prețul din rețetă')) + '</button></div>'
        + '<div id="recalc-rezultat-' + n.id + '" class="mdn-muted" style="margin-top:6px"></div>'
        + '<div id="reteta-nivel-' + n.id + '" style="display:none;margin-top:8px">'
        + '<div id="reteta-lista-' + n.id + '" class="mdn-muted">' + esc(t('Se încarcă...')) + '</div>'
        + '<div class="mdn-rand"><input id="reteta-cauta-' + n.id + '" class="mdn-in" placeholder="' + esc(t('Caută articol (nume sau cod indicator)')) + '" style="flex:1;min-width:160px">'
        + '<button class="mdn-b p" onclick="cautaArticolePentruNivel(\'' + n.id + '\', \'' + s.id + '\')">' + esc(t('Caută')) + '</button></div>'
        + '<div id="reteta-rezultate-' + n.id + '" style="margin-top:6px"></div></div></div></div>';
    }).join('')
      + '<div class="mdn-rand">'
      + '<input id="nivel-nume-' + s.id + '" class="mdn-in" placeholder="' + esc(t('Nivel (ex: Bronz)')) + '" style="width:140px">'
      + '<input id="nivel-complex-' + s.id + '" class="mdn-in" placeholder="' + esc(t('Complexitate (1-4)')) + '" type="number" style="width:150px">'
      + '<input id="nivel-norma-' + s.id + '" class="mdn-in" placeholder="' + esc(t('Normă timp (h)')) + '" type="number" style="width:160px">'
      + '<input id="nivel-garantie-' + s.id + '" class="mdn-in" placeholder="' + esc(t('Garanție (luni, opțional)')) + '" type="number" style="width:210px">'
      + '<button class="mdn-b p" onclick="creeazaNivelCatalog(\'' + s.id + '\', this)">' + esc(t('+ Nivel nou')) + '</button></div>'
      + '<div class="mdn-muted" style="margin-top:4px">' + esc(t('Nivelul nou se creează minimal; descrierea și materialele estimate se completează din „Editează nivel”.')) + '</div>'
      + '<div id="niv-msg-' + s.id + '" aria-live="polite"></div>';
  }

  // ── Acțiuni (aceleași nume globale ca în superadmin) ──
  window.toggleEditareNivel = function (nivelId) {
    var el = document.getElementById('nivel-editare-' + nivelId);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
  };

  window.creeazaNivelCatalog = function (serviciuId, buton) {
    var nivel = document.getElementById('nivel-nume-' + serviciuId).value.trim();
    var nivel_complexitate = Number(document.getElementById('nivel-complex-' + serviciuId).value);
    var norma_timp = Number(document.getElementById('nivel-norma-' + serviciuId).value);
    var garantie_luni = Number(document.getElementById('nivel-garantie-' + serviciuId).value) || 0;
    return salveazaSiReincarca(buton, serviciuId, async function () {
      if (!nivel || !nivel_complexitate || !norma_timp) throw new Error(t('Completează nivelul, complexitatea și norma de timp.'));
      await cere({ action: 'creeaza_nivel', serviciu_id: serviciuId, nivel: nivel, nivel_complexitate: nivel_complexitate, norma_timp: norma_timp, label: nivel, garantie_luni: garantie_luni });
      return t('Nivel creat.');
    });
  };

  window.salveazaNivelCatalog = function (nivelId, serviciuId, buton) {
    var v = function (k) { return document.getElementById('nivel-edit-' + k + '-' + nivelId).value; };
    var norma_timp = Number(v('norma'));
    return salveazaSiReincarca(buton, serviciuId, async function () {
      if (!norma_timp) throw new Error(t('Norma de timp e obligatorie.'));
      await cere({ action: 'actualizeaza_nivel', id: nivelId, label: v('label').trim() || null, norma_timp: norma_timp,
        materiale_baza_estimat: Number(v('materiale')) || 0, garantie_luni: Number(v('garantie')) || 0, descriere: v('desc').trim() || null });
      return t('Nivel salvat.');
    });
  };

  window.stergeNivelCatalog = async function (nivelId, serviciuId) {
    if (!confirm(t('Ștergi acest nivel și toate prețurile lui?'))) return;
    try { await cere({ action: 'sterge_nivel', id: nivelId }); await reincarca(serviciuId); feedback(serviciuId, 'ok', t('Nivel șters.')); }
    catch (e) { feedback(serviciuId, 'eroare', e.message); }
  };

  window.toggleRetetaNivel = function (nivelId) {
    var el = document.getElementById('reteta-nivel-' + nivelId);
    if (!el) return;
    var deschis = el.style.display !== 'none';
    el.style.display = deschis ? 'none' : 'block';
    if (!deschis) window.loadArticoleNivel(nivelId);
  };

  window.loadArticoleNivel = async function (nivelId) {
    var el = document.getElementById('reteta-lista-' + nivelId);
    if (!el) return;
    el.textContent = t('Se încarcă...');
    try {
      var data = await cere({ action: 'listeaza_articole_nivel', catalog_nivel_id: nivelId });
      el.innerHTML = data.articole.length
        ? data.articole.map(function (a) {
          return '<div class="mdn-rand" style="background:var(--mdn-input,#0F1826);border-radius:7px;padding:5px 9px;margin-top:4px">'
            + '<span style="flex:1"><code>' + esc(a.indicator_id) + '</code> ' + esc(a.denumire_articol) + ' <span class="mdn-sub">(' + esc(a.unitate_masura) + ')</span></span>'
            + '<button onclick="dezleagaArticolDeNivel(' + a.articol_id + ', \'' + nivelId + '\')" style="background:none;border:none;color:#E57373;cursor:pointer;font-size:11px;padding:0">' + esc(t('✕ dezleagă')) + '</button></div>';
        }).join('')
        : '<span>' + esc(t('Niciun articol legat încă: rețeta tehnică a nivelului e goală.')) + '</span>';
    } catch (e) {
      el.innerHTML = '<span style="color:#E57373">' + esc(e.message) + '</span>';
    }
  };

  window.cautaArticolePentruNivel = async function (nivelId) {
    var termen = document.getElementById('reteta-cauta-' + nivelId).value.trim();
    var el = document.getElementById('reteta-rezultate-' + nivelId);
    el.textContent = t('Se caută...');
    try {
      var data = await cere({ action: 'cauta_articole', termen: termen });
      el.innerHTML = data.articole.length
        ? data.articole.map(function (a) {
          return '<div class="mdn-rand" style="background:var(--mdn-card,#131B27);border-radius:7px;padding:5px 9px;margin-top:4px">'
            + '<span style="flex:1"><code>' + esc(a.indicator_id) + '</code> ' + esc(a.denumire_articol) + (a.catalog_nivel_id ? ' <span style="color:#FF8C00">· ' + esc(t('deja legat în altă parte')) + '</span>' : '') + '</span>'
            + '<button class="mdn-b p" onclick="leagaArticolLaNivel(' + a.articol_id + ', \'' + nivelId + '\')">' + esc(t('Leagă')) + '</button></div>';
        }).join('')
        : '<span class="mdn-muted">' + esc(t('Niciun rezultat.')) + '</span>';
    } catch (e) {
      el.innerHTML = '<span style="color:#E57373">' + esc(e.message) + '</span>';
    }
  };

  window.leagaArticolLaNivel = async function (articolId, nivelId, forteaza) {
    var el = document.getElementById('reteta-rezultate-' + nivelId);
    try {
      var data = await cere({ action: 'leaga_articol_nivel', articol_id: articolId, catalog_nivel_id: nivelId, forteaza: !!forteaza });
      if (data.avertisment && window.MDFeedback) window.MDFeedback.mesaj(el, 'info', '⚠ ' + data.avertisment);
      window.loadArticoleNivel(nivelId);
    } catch (e) {
      if (e.status === 409 && confirm(e.message + '\n\n' + t('Îl muți aici?'))) return window.leagaArticolLaNivel(articolId, nivelId, true);
      if (window.MDFeedback) window.MDFeedback.mesaj(el, 'eroare', e.message);
    }
  };

  window.dezleagaArticolDeNivel = async function (articolId, nivelId) {
    if (!confirm(t('Dezlegi acest articol de la nivel? Rețeta tehnică va exclude linia din calculul de preț.'))) return;
    var el = document.getElementById('reteta-lista-' + nivelId);
    try { await cere({ action: 'dezleaga_articol_nivel', articol_id: articolId }); window.loadArticoleNivel(nivelId); }
    catch (e) { if (window.MDFeedback) window.MDFeedback.mesaj(el, 'eroare', e.message); }
  };

  // Prețul din rețetă se scrie doar dacă toate resursele au tarif; altfel
  // motorul refuză și prețul rămâne „la cerere” (fără cifre inventate).
  window.recalculeazaPretNivel = async function (nivelId, serviciuId) {
    var tara_cod = ((document.getElementById('recalc-tara-' + nivelId) || {}).value || 'RO').trim().toUpperCase();
    var el = document.getElementById('recalc-rezultat-' + nivelId);
    if (el) el.textContent = t('Se calculează...');
    try {
      var data = await cere({ action: 'recalculeaza_pret', nivel_id: nivelId, tara_cod: tara_cod });
      if (!data.scris) {
        var lista = (data.resurse_fara_pret || []).map(function (r) { return r.denumire || r.resursa_id || String(r); }).join(', ');
        window.MDFeedback.mesaj(el, 'info', t('Niciun preț scris: resurse fără tarif ({lista}). Prețul rămâne la cerere.', { lista: lista || '—' }));
        return;
      }
      var text = t('Preț calculat din rețetă: {pret} ({tara}).', { pret: data.pret.pret_final, tara: tara_cod });
      if (serviciuId) { await reincarca(serviciuId); feedback(serviciuId, 'ok', text); }
      else window.MDFeedback.mesaj(el, 'ok', text);
    } catch (e) {
      window.MDFeedback.mesaj(el, 'eroare', e.message);
    }
  };

  window.creeazaPretCatalog = function (nivelId, serviciuId, buton) {
    var tara_cod = document.getElementById('pret-tara-' + nivelId).value.trim().toUpperCase();
    var moneda = document.getElementById('pret-moneda-' + nivelId).value.trim();
    var pret = Number(document.getElementById('pret-val-' + nivelId).value);
    return salveazaSiReincarca(buton, serviciuId, async function () {
      if (!tara_cod || !moneda || !pret) throw new Error(t('Completează țara, moneda și prețul.'));
      await cere({ action: 'creeaza_pret', nivel_id: nivelId, tara_cod: tara_cod, moneda: moneda, pret: pret });
      return t('Preț adăugat.');
    });
  };

  window.stergePretCatalog = async function (pretId, serviciuId) {
    try { await cere({ action: 'sterge_pret', id: pretId }); await reincarca(serviciuId); feedback(serviciuId, 'ok', t('Preț șters.')); }
    catch (e) { feedback(serviciuId, 'eroare', e.message); }
  };

  window.MDCatalogNiveluri = {
    html: html,
    // Superadminul reîncarcă toată lista; pagina de catalog suprascrie.
    reincarca: function () { if (typeof window.loadCatalogList === 'function') return window.loadCatalogList(); },
  };
})();
