/* ════════════════════════════════════════════════════════════════
   MY DARRIN — meniu-partener.js, pasul 11-R3f (decizia LM, 3 nov. 2026)

   Meniul „Devino Partener” se generează doar de aici, pe toate paginile:
   meniul derulant din antet și lista din meniul lateral (telefon). Înainte,
   fiecare pagină avea copia ei și meniurile difereau (3, 4 sau 5 tipuri,
   asigurătorul lipsea). Paginile păstrează doar locul gol:

     <div class="mega-panel" data-meniu-partener="antet"></div>
     <div id="sb-partner" class="hidden pb-2" data-meniu-partener="lateral"></div>

   Cele 6 intrări, în ordine: cum devii partener, apoi cele 5 tipuri, fiecare
   spre pagina lui de informare. Sub listă, butonul după starea contului
   (cta-partener.js, data-cta-partener): vizitator „Creează-ți contul de
   partener”, client „Devino partener pe contul tău”, activare „Finalizează-ți
   contul”, verificare, partener activ.

   Pe „Devino partener”, butonul „Cum devii partener” deschide lista celor 5
   tipuri (data-meniu-partener="tipuri", butonul cu aria-controls spre ea).

   Meniul lateral luat din index.html (ui-comun.js) se completează prin
   MYD_MENIU_PARTENER.completeaza().
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MYD_MENIU_PARTENER) return;

  var INTRARI = [
    { href: 'cum-devii-partenerul-nostru.html', ico: 'clipboard-list', titlu: 'Cum devii partener My Darrin', desc: 'Ghidul complet, pas cu pas · Gratuit', ghid: true },
    { href: 'cum-devii-partenerul-nostru.html?type=servicii', ico: 'wrench', titlu: 'Furnizor de Servicii', desc: 'Meșteri, instalatori, tehnicieni', culoare: '#FF8C00', fundal: '#FFF0D6' },
    { href: 'cum-devii-furnizor-materiale.html', ico: 'package', titlu: 'Furnizor de Materiale', desc: 'Bricolaj, construcții, electrice, sanitare', culoare: '#003366', fundal: '#EBF4FB' },
    { href: 'cum-devii-operator-inchirieri.html', ico: 'hard-hat', titlu: 'Furnizor de Închirieri', desc: 'Utilaje, scule, transport', culoare: '#0E9E99', fundal: '#E0F5F4' },
    { href: 'cum-devii-curier-de-cartier.html', ico: 'truck', titlu: 'Curier de cartier', desc: 'Livrare locală de materiale la șantier', culoare: '#E65100', fundal: '#FFF3E0' },
    { href: 'ghidul-asiguratorului.html', ico: 'shield', titlu: 'Asigurător', desc: 'Polițe pentru comenzile platformei', culoare: '#7C3AED', fundal: '#F3E8FF' },
  ];

  function tr(ro) { return typeof window.t === 'function' ? window.t(null, ro) : ro; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ico(nume) { return '<i data-lucide="' + nume + '" style="width:16px;height:16px;display:inline-block;vertical-align:middle"></i>'; }

  // Același aspect ca meniul de până acum (fără elemente grafice noi).
  function stil() {
    if (document.getElementById('mmp-stil')) return;
    var s = document.createElement('style');
    s.id = 'mmp-stil';
    s.textContent =
      '.mmp-cutie{position:relative;background:#fff;border:1px solid #F3F4F6;border-radius:16px;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);padding:20px;box-sizing:border-box;text-align:left;font-family:inherit}' +
      '.mmp-sageata{position:absolute;top:-8px;left:50%;width:16px;height:16px;background:#fff;border-left:1px solid #F3F4F6;border-top:1px solid #F3F4F6;transform:translateX(-50%) rotate(45deg)}' +
      '.mmp-cutie a{text-decoration:none}' +
      '.mmp-ghid{display:flex;align-items:center;gap:12px;padding:10px;border-radius:12px;border:1px solid #E8F0FB;margin-bottom:8px;transition:background .15s}' +
      '.mmp-ghid:hover{background:#EBF4FB}.mmp-ghid .mmp-t{font-weight:700;color:#003366}.mmp-ghid:hover .mmp-t{color:#FF8C00}' +
      '.mmp-eticheta{margin:0 0 6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#9CA3AF}' +
      '.mmp-lista{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}' +
      '.mmp-tip{display:flex;align-items:center;gap:12px;padding:8px;border-radius:12px;transition:background .15s}' +
      '.mmp-t{font-size:14px;font-weight:600;color:#2D2D2D;line-height:1.3;transition:color .15s}' +
      '.mmp-d{font-size:11px;color:#9CA3AF;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.mmp-ico{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:16px;height:16px;color:#2D2D2D}' +
      '.mmp-cutie .mmp-text{min-width:0}' +
      '.mmp-jos{display:flex;justify-content:flex-end;padding-top:12px;border-top:1px solid #F3F4F6}' +
      '.mmp-cta{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;color:#FF8C00;text-decoration:none}.mmp-cta:hover{text-decoration:underline}' +
      // Meniul lateral (telefon)
      '.mmp-sb-rand{display:block;margin:0 12px 4px;border:1px solid #F3F4F6;border-radius:12px;overflow:hidden}' +
      '.mmp-sb-rand.mmp-sb-ghid{margin-bottom:8px;border:2px solid #E8F0FB;background:linear-gradient(135deg,#EBF4FB,#F4F7F9)}' +
      '.mmp-sb-rand a{display:flex;align-items:center;gap:12px;padding:10px 16px;min-height:44px;box-sizing:border-box;text-decoration:none}' +
      '.mmp-sb-ico{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0}' +
      '.mmp-sb-t{font-size:12px;font-weight:700;color:#2D2D2D;line-height:1.25}.mmp-sb-ghid .mmp-sb-t{color:#003366}' +
      '.mmp-sb-d{font-size:10px;color:#9CA3AF;margin-top:2px}' +
      // Antetele simple (categorii, termeni, politica): același comportament ca .mega-wrap
      // din paginile cu antetul complet. Sub 769 px bara se derulează orizontal: rămâne linkul.
      '.mmp-wrap{position:relative;display:inline-flex;align-items:center}' +
      '.mmp-wrap>.mega-panel{opacity:0;visibility:hidden;position:absolute;top:calc(100% + 14px);left:50%;transform:translateX(-50%) translateY(8px);transition:opacity .2s,transform .2s,visibility .2s;z-index:300}' +
      '.mmp-wrap:hover>.mega-panel,.mmp-wrap:focus-within>.mega-panel{opacity:1;visibility:visible;transform:translateX(-50%) translateY(0)}' +
      '@media (max-width:768px){.mmp-wrap>.mega-panel{display:none}.mmp-wrap>a>[data-lucide],.mmp-wrap>a>svg{display:none!important}}' +
      // Lista tipurilor de sub „Cum devii partener” (pagina „Devino partener”)
      '.mmp-tipuri{position:absolute;left:0;top:calc(100% + 8px);z-index:60;width:min(340px,calc(100vw - 32px));padding:8px}' +
      '.mmp-tipuri .mmp-lista{margin:0}' +
      '.mmp-sb-cta{display:flex;margin:8px 12px 0;padding:0 16px;min-height:44px;align-items:center;justify-content:center;border-radius:12px;background:#FF8C00;color:#fff;font-size:12.5px;font-weight:700;text-decoration:none;box-sizing:border-box;text-align:center}';
    (document.head || document.documentElement).appendChild(s);
  }

  function cta(clasa) {
    return '<a href="mydarrin-devino-partener.html" class="' + clasa + '" data-cta-partener="" data-cta-scurt="">' +
      '<span data-cta-text>' + esc(tr('Creează-ți contul de partener')) + '</span>' + (clasa === 'mmp-cta' ? ' ' + ico('arrow-right') : '') + '</a>';
  }

  function htmlAntet() {
    var ghid = INTRARI[0];
    return '<div class="mmp-cutie"><div class="mmp-sageata" aria-hidden="true"></div>' +
      '<a href="' + ghid.href + '" class="mmp-ghid" data-meniu-intrare="1"><span class="mmp-ico">' + ico(ghid.ico) + '</span>' +
        '<div class="mmp-text"><div class="mmp-t">' + esc(tr(ghid.titlu)) + '</div><div class="mmp-d">' + esc(tr(ghid.desc)) + '</div></div></a>' +
      '<p class="mmp-eticheta">' + esc(tr('Tipuri de parteneriat')) + '</p>' +
      '<div class="mmp-lista">' + INTRARI.slice(1).map(function (x, i) {
        return '<a href="' + x.href + '" class="mmp-tip" data-meniu-intrare="' + (i + 2) + '" data-culoare="' + x.culoare + '" data-fundal="' + x.fundal + '">' +
          '<span class="mmp-ico">' + ico(x.ico) + '</span>' +
          '<div class="mmp-text"><div class="mmp-t">' + esc(tr(x.titlu)) + '</div><div class="mmp-d">' + esc(tr(x.desc)) + '</div></div></a>';
      }).join('') + '</div>' +
      '<div class="mmp-jos">' + cta('mmp-cta') + '</div></div>';
  }

  function htmlTipuri() {
    return '<div class="mmp-lista">' + INTRARI.slice(1).map(function (x, i) {
      return '<a href="' + x.href + '" class="mmp-tip" data-meniu-intrare="' + (i + 2) + '" data-culoare="' + x.culoare + '" data-fundal="' + x.fundal + '">' +
        '<span class="mmp-ico">' + ico(x.ico) + '</span>' +
        '<div class="mmp-text"><div class="mmp-t">' + esc(tr(x.titlu)) + '</div><div class="mmp-d">' + esc(tr(x.desc)) + '</div></div></a>';
    }).join('') + '</div>';
  }

  // Butonul care deschide lista: clic, Escape și clic în afară o închid.
  function leagaLista(lista) {
    var btn = document.querySelector('[aria-controls="' + lista.id + '"]');
    if (!btn) return;
    function arata(da) {
      lista.hidden = !da;
      btn.setAttribute('aria-expanded', String(da));
      if (da) incadreazaLista(lista);
    }
    btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); arata(lista.hidden); });
    document.addEventListener('click', function (e) { if (!lista.hidden && !lista.contains(e.target) && !btn.contains(e.target)) arata(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !lista.hidden) { arata(false); btn.focus(); } });
  }
  function incadreazaLista(lista) {
    lista.style.left = '0px';
    var r = lista.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    if (r.right > vw - 16) lista.style.left = (vw - 16 - r.right) + 'px';
  }

  function htmlLateral() {
    return INTRARI.map(function (x, i) {
      var fundal = x.ghid ? 'background:#003366;color:#fff' : 'background:' + x.fundal + ';color:' + x.culoare;
      return '<div class="mmp-sb-rand' + (x.ghid ? ' mmp-sb-ghid' : '') + '"><a href="' + x.href + '" data-meniu-intrare="' + (i + 1) + '" onclick="if(typeof closeSidebar===\'function\')closeSidebar()">' +
        '<div class="mmp-sb-ico" style="' + fundal + '">' + ico(x.ico) + '</div>' +
        '<div style="min-width:0;flex:1"><div class="mmp-sb-t">' + esc(tr(x.titlu)) + '</div><div class="mmp-sb-d">' + esc(tr(x.desc)) + '</div></div></a></div>';
    }).join('') + cta('mmp-sb-cta');
  }

  // Culoarea de hover a fiecărui tip (ca în meniul vechi), fără clase Tailwind generate.
  function leagaHover(rad) {
    Array.prototype.forEach.call(rad.querySelectorAll('.mmp-tip'), function (a) {
      var t = a.querySelector('.mmp-t');
      a.addEventListener('mouseenter', function () { a.style.background = a.getAttribute('data-fundal'); t.style.color = a.getAttribute('data-culoare'); });
      a.addEventListener('mouseleave', function () { a.style.background = ''; t.style.color = ''; });
    });
  }

  // Meniul derulant nu iese din ecran: se mută spre interior cât e nevoie.
  function incadreaza(panou) {
    panou.style.marginLeft = '';
    var r = panou.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var mutare = 0;
    if (r.right > vw - 8) mutare = vw - 8 - r.right;
    if (r.left + mutare < 8) mutare = 8 - r.left;
    if (mutare) panou.style.marginLeft = mutare + 'px';
    var sag = panou.querySelector('.mmp-sageata');
    if (sag) sag.style.left = 'calc(50% - ' + mutare + 'px)';
  }

  function icone() { try { if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons(); } catch (e) {} }

  function ctaPornire() {
    if (window.MYD_CTA_PARTENER) { window.MYD_CTA_PARTENER.porneste(); return; }
    if (document.querySelector('script[src$="cta-partener.js"]')) return; // se încarcă deja; pornește singur
    var s = document.createElement('script');
    s.src = '/cta-partener.js';
    s.defer = true;
    document.head.appendChild(s);
  }

  function completeaza(radacina) {
    var r = radacina || document;
    var locuri = r.querySelectorAll('[data-meniu-partener]');
    if (!locuri.length) return 0;
    stil();
    var n = 0;
    Array.prototype.forEach.call(locuri, function (loc) {
      if (loc.getAttribute('data-meniu-gata') === '1') return;
      var tip = loc.getAttribute('data-meniu-partener');
      if (tip === 'antet') {
        loc.innerHTML = htmlAntet();
        loc.style.width = 'min(460px, calc(100vw - 16px))';
        leagaHover(loc);
        var wrap = loc.closest('.mega-wrap');
        if (wrap) {
          wrap.addEventListener('mouseenter', function () { incadreaza(loc); });
          wrap.addEventListener('focusin', function () { incadreaza(loc); });
        }
      } else if (tip === 'lateral') {
        loc.innerHTML = htmlLateral();
      } else if (tip === 'tipuri') {
        loc.classList.add('mmp-cutie', 'mmp-tipuri');
        loc.innerHTML = htmlTipuri();
        leagaHover(loc);
        leagaLista(loc);
      } else return;
      loc.setAttribute('data-meniu-gata', '1');
      n++;
    });
    if (n) { icone(); ctaPornire(); }
    return n;
  }

  window.MYD_MENIU_PARTENER = { INTRARI: INTRARI, completeaza: completeaza, incadreaza: incadreaza };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { completeaza(); });
  else completeaza();
})();
