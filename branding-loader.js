/* ════════════════════════════════════════════════════════════════
   MY DARRIN — Branding Loader (dynamic logo from Vercel KV)
   Inclus pe toate paginile publice. La încărcare, verifică dacă
   adminul a salvat un logo nou în backoffice — dacă da, îl aplică;
   altfel, păstrează imaginea implicită (base64 din HTML).
   Fail-safe: orice eroare de rețea => păstrează imaginea existentă.
   ════════════════════════════════════════════════════════════════ */
(function () {
  function applyLogo(selector, dataUrl) {
    if (!dataUrl) return;
    document.querySelectorAll(selector).forEach(function (img) {
      img.src = dataUrl;
    });
  }

  function loadBranding() {
    fetch('/api/branding/get', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('branding api status ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (data.header_logo && data.header_logo.dataUrl) {
          applyLogo('img[alt="My Darrin"]', data.header_logo.dataUrl);
        }
        if (data.footer_logo && data.footer_logo.dataUrl) {
          applyLogo('img[alt="HomeBestPal — Darrin"]', data.footer_logo.dataUrl);
        }
        if (data.robot_mascot && data.robot_mascot.dataUrl) {
          applyLogo('img[alt="Darrin AI"]', data.robot_mascot.dataUrl);
        }
      })
      .catch(function () {
        // Silent fail — pagina rămâne cu logo-urile implicite din HTML.
        // Nu blocăm randarea și nu afișăm erori utilizatorului final.
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadBranding);
  } else {
    loadBranding();
  }
})();
