// share-widget.js
// Buton flotant de distribuire, reutilizabil pe orice pagină de conținut —
// Web Share API (meniul nativ al telefonului) pe mobil, cu fallback la
// linkuri reale de distribuire (Facebook/WhatsApp/X/LinkedIn/Email/Copiază)
// pe desktop, unde API-ul nu e disponibil în toate browserele. Zero
// dependențe, zero cheie API — toate linkurile sunt intent-URL-uri publice,
// documentate de fiecare rețea.
//
// Titlul/descrierea/URL-ul se citesc automat din pagina curentă
// (document.title, meta[name="description"], location.href) — nu necesită
// nicio configurare per pagină dincolo de includerea acestui script.

(function () {
  'use strict';

  function datePagina() {
    const title = document.title || 'My Darrin';
    const descEl = document.querySelector('meta[name="description"]');
    const text = descEl?.content || '';
    const url = window.location.href;
    return { title, text, url };
  }

  function linkuriShare({ title, text, url }) {
    const u = encodeURIComponent(url);
    const t = encodeURIComponent(title);
    const tu = encodeURIComponent(`${title} ${url}`);
    return [
      { nume: 'Facebook', icon: 'facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
      { nume: 'WhatsApp', icon: 'whatsapp', href: `https://wa.me/?text=${tu}` },
      { nume: 'X', icon: 'x', href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
      { nume: 'LinkedIn', icon: 'linkedin', href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
      { nume: 'Email', icon: 'email', href: `mailto:?subject=${t}&body=${u}` },
    ];
  }

  const ICON_SVG = {
    facebook: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
    whatsapp: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884M20.463 3.488A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    linkedin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
    email: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5A6B7D" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    copy: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5A6B7D" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
  };

  function creeazaWidget() {
    if (document.getElementById('myd-share-fab')) return;

    // Nu suprapune butonul de chat Darrin AI, dacă există pe pagină.
    const areFabAI = !!document.getElementById('dai-fab');
    const dreapta = areFabAI ? 92 : 24;

    const fab = document.createElement('button');
    fab.id = 'myd-share-fab';
    fab.setAttribute('aria-label', 'Distribuie această pagină');
    fab.style.cssText = `position:fixed;bottom:24px;right:${dreapta}px;width:52px;height:52px;border-radius:50%;background:#003366;border:none;box-shadow:0 6px 20px rgba(0,51,102,.35);cursor:pointer;z-index:8999;display:flex;align-items:center;justify-content:center;transition:transform .2s`;
    fab.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
    fab.onmouseover = () => { fab.style.transform = 'scale(1.06)'; };
    fab.onmouseout = () => { fab.style.transform = 'scale(1)'; };

    const panel = document.createElement('div');
    panel.id = 'myd-share-panel';
    panel.style.cssText = `position:fixed;bottom:84px;right:${dreapta}px;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.2);padding:10px;display:none;flex-direction:column;gap:4px;z-index:9000;min-width:190px;font-family:inherit`;

    const date = datePagina();
    const linkuri = linkuriShare(date);

    linkuri.forEach((l) => {
      const a = document.createElement('a');
      a.href = l.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;text-decoration:none;color:#2D2D2D;font-size:13px;font-weight:600;transition:background .15s';
      a.innerHTML = `${ICON_SVG[l.icon]}<span>${l.nume}</span>`;
      a.onmouseover = () => { a.style.background = '#F4F7F9'; };
      a.onmouseout = () => { a.style.background = ''; };
      panel.appendChild(a);
    });

    const copyBtn = document.createElement('button');
    copyBtn.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;border:none;background:none;color:#2D2D2D;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;text-align:left;transition:background .15s';
    copyBtn.innerHTML = `${ICON_SVG.copy}<span>Copiază linkul</span>`;
    copyBtn.onmouseover = () => { copyBtn.style.background = '#F4F7F9'; };
    copyBtn.onmouseout = () => { copyBtn.style.background = ''; };
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(date.url);
        copyBtn.querySelector('span').textContent = 'Copiat!';
        setTimeout(() => { copyBtn.querySelector('span').textContent = 'Copiază linkul'; }, 1800);
      } catch (e) { /* clipboard indisponibil — fără acțiune, nu blocăm pagina */ }
    };
    panel.appendChild(copyBtn);

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    let deschis = false;
    fab.addEventListener('click', async () => {
      const dateProaspete = datePagina();
      if (navigator.share) {
        try {
          await navigator.share(dateProaspete);
          return;
        } catch (e) {
          // utilizatorul a anulat sau share a eșuat — cădem pe panoul de fallback
        }
      }
      deschis = !deschis;
      panel.style.display = deschis ? 'flex' : 'none';
    });

    document.addEventListener('click', (e) => {
      if (deschis && !panel.contains(e.target) && e.target !== fab && !fab.contains(e.target)) {
        deschis = false;
        panel.style.display = 'none';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', creeazaWidget);
  } else {
    creeazaWidget();
  }
})();
