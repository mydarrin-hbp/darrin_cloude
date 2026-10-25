// lib/verifica-firma-partener.js
// Pasul 11-P1 (25 oct. 2026): verificarea comună a datelor firmei pentru
// rutele care creează sau modifică un partener (api/public/partner-register.js,
// api/partener/wizard-companie.js):
//   1. forma juridică, denumirea și CUI-ul (lib/forme-juridice.js);
//   2. pentru România, starea firmei la ANAF: inactivă sau radiată → refuz;
//      ANAF nu răspunde sau nu găsește CUI-ul → înregistrarea continuă și se
//      marchează pentru verificarea manuală a adminului (audit_log,
//      acțiunea 'partener_verificare_anaf_manuala'; aprobarea în 48 h rămâne).
//
//   const v = await verificaFirmaPartener(req.body, tara);
//   if (!v.ok) return trimiteEroare(res, v.status, v.cod, v.error, v.error_en, [camp(v.camp, v.error, v.error_en)]);

const { valideazaDateFirma } = require('./forme-juridice');
const { verificaFirmaRoLaAnaf, MESAJE_ANAF } = require('./cauta-firma');
const { inregistreazaAudit } = require('./audit-log');

const ACTIUNE_VERIFICARE_MANUALA = 'partener_verificare_anaf_manuala';

async function verificaFirmaPartener(corp, tara) {
  const d = corp || {};
  const v = valideazaDateFirma({
    tip_entitate_legala: d.tip_entitate_legala,
    cui: d.cui,
    nume_firma: d.nume_firma,
    tara,
    forma_juridica_locala: d.forma_juridica_locala,
  });
  if (!v.ok) return { ...v, status: 400, cod: 'DATE_INVALIDE' };

  if (v.date.tara !== 'RO') return { ok: true, date: v.date, verificare_manuala: null };

  const anaf = await verificaFirmaRoLaAnaf(v.date.cui);
  if (anaf.stare === 'inactiva') {
    const m = MESAJE_ANAF.firma_inactiva;
    return { ok: false, status: 400, cod: 'FIRMA_INACTIVA', camp: 'cui', error: m.ro, error_en: m.en };
  }
  return { ok: true, date: v.date, verificare_manuala: anaf.stare === 'neverificata' ? anaf.motiv : null };
}

// Marcajul pentru admin: rândul din audit_log e citit de api/admin/parteneri-lista.js.
// admin_id rămâne gol: marcajul îl pune serverul, nu un administrator.
async function marcheazaVerificareManuala({ partenerId, motiv, cui, req }) {
  if (!motiv) return;
  await inregistreazaAudit({
    admin: null, req, actiune: ACTIUNE_VERIFICARE_MANUALA, entitate: 'partners', entitate_id: partenerId,
    detalii: { motiv, cui },
  });
}

module.exports = { verificaFirmaPartener, marcheazaVerificareManuala, ACTIUNE_VERIFICARE_MANUALA };
