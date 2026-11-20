// scripts/landing-rpc-simulat.js — funcțiile SQL ale paginilor de destinație (pasul 12-L1),
// simulate peste scripts/supabase-simulat.js: landing_publica și landing_revino, cu aceeași
// regulă ca în docs/migrations-propuse/2026-11-19_pagini-destinatie.sql (verificată pe
// Postgres de scripts/test-migrare-pagini-destinatie.js).
// Folosit de scripts/test-pagini-destinatie-server.js și scripts/test-pagini-destinatie-backoffice.js.

function instaleaza(DB) {
  const CAMPURI_OBLIGATORII = ['eticheta', 'titlu', 'subtitlu', 'beneficiu_1', 'beneficiu_2', 'beneficiu_3', 'buton', 'sub_buton'];
  function versiuneUrmatoare(p, v) {
    const toate = DB.tabele.landing_continut.concat(DB.tabele.landing_continut_istoric).filter((r) => r.pagina === p && r.varianta === v).map((r) => r.versiune || 0);
    return Math.max(0, ...toate) + 1;
  }
  function arhiveaza(p, v, autor) {
    DB.tabele.landing_continut.filter((r) => r.pagina === p && r.varianta === v && r.stare === 'publicat').forEach((r) => {
      if (DB.tabele.landing_continut_istoric.some((h) => h.pagina === p && h.varianta === v && h.limba === r.limba && h.versiune === r.versiune)) return;
      DB.tabele.landing_continut_istoric.push(Object.assign({}, r, { id: 'h' + (++DB.seq), publicat_de: r.autor, arhivat_de: autor, arhivat_la: new Date().toISOString() }));
    });
  }
  DB.rpc.landing_publica = ({ p_pagina: p, p_varianta: v, p_autor: autor }) => {
    const c = DB.tabele.landing_continut.filter((r) => r.pagina === p && r.varianta === v && r.stare === 'ciorna');
    if (c.length < 2) throw new Error('LANDING_LIPSA_LIMBA');
    c.sort((a, b) => (a.limba === 'ro' ? -1 : 1)).forEach((r) => {
      if (CAMPURI_OBLIGATORII.some((k) => !String(r[k] || '').trim()) || (r.imagine_url && !String(r.imagine_alt || '').trim())) throw new Error('LANDING_INCOMPLET_' + r.limba.toUpperCase());
    });
    const n = versiuneUrmatoare(p, v);
    arhiveaza(p, v, autor);
    DB.tabele.landing_continut = DB.tabele.landing_continut.filter((r) => !(r.pagina === p && r.varianta === v && r.stare === 'publicat'));
    c.forEach((r) => { DB.tabele.landing_continut.push(Object.assign({}, r, { id: 'p' + (++DB.seq), stare: 'publicat', versiune: n, autor, publicat_la: new Date().toISOString() })); r.versiune = n; });
    return n;
  };
  DB.rpc.landing_revino = ({ p_pagina: p, p_varianta: v, p_versiune: ver, p_autor: autor }) => {
    const h = DB.tabele.landing_continut_istoric.filter((r) => r.pagina === p && r.varianta === v && r.versiune === ver);
    if (h.length < 2) throw new Error('LANDING_VERSIUNE_LIPSA');
    const n = versiuneUrmatoare(p, v);
    arhiveaza(p, v, autor);
    DB.tabele.landing_continut = DB.tabele.landing_continut.filter((r) => !(r.pagina === p && r.varianta === v));
    h.forEach((r) => ['ciorna', 'publicat'].forEach((stare) => {
      const x = Object.assign({}, r, { id: 'r' + (++DB.seq), stare, versiune: n, autor, publicat_la: stare === 'publicat' ? new Date().toISOString() : null });
      delete x.publicat_de; delete x.arhivat_de; delete x.arhivat_la;
      DB.tabele.landing_continut.push(x);
    }));
    return n;
  };
}

module.exports = { instaleaza };
