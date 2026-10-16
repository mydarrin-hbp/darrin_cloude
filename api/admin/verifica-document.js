// /api/admin/verifica-document.js
// Adăugat în audit 2026-07-11 — fără acest endpoint, nimic din repo nu putea
// seta vreodată documente_partener.status sau partners.status_verificare la
// 'aprobat', ceea ce bloca definitiv gate-ul din api/partener/cmr-generare.js
// (niciun curier nu putea genera CMR, indiferent cât de complet era dosarul).
//
// Body: { tip: 'document' | 'partener', id, decizie: 'aprobat' | 'respins' }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { rolPentruTipPartener, asiguraRolInProfil } = require('../../lib/roluri-partener');

const DECIZII_VALIDE = ['aprobat', 'respins'];
// FIX (audit 2026-07-12): documente_partener.status folosește valorile
// românești ('aprobat'/'respins'), dar partners.status_verificare are o
// constrângere separată, în engleză ('pending_review'|'approved'|'rejected') —
// verificat direct în baza reală, nu doar presupus din schema.sql.
const DECIZIE_LA_STATUS_PARTNERS = { aprobat: 'approved', respins: 'rejected' };

async function handler(req, res, admin) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tip, id, decizie } = req.body || {};
  if (!['document', 'partener'].includes(tip) || !id || !DECIZII_VALIDE.includes(decizie)) {
    return res.status(400).json({ error: "tip ('document'|'partener'), id și decizie ('aprobat'|'respins') sunt obligatorii" });
  }

  try {
    if (tip === 'document') {
      const { data, error } = await supabaseAdmin
        .from('documente_partener')
        .update({ status: decizie, verificat_de: admin.id })
        .eq('id', id)
        .select()
        .single();
      if (error || !data) return res.status(404).json({ error: 'Documentul nu există' });
      await inregistreazaAudit({
        admin, req, actiune: `document_${decizie}`, entitate: 'documente_partener', entitate_id: id, detalii: { decizie },
      });
      return res.status(200).json({ ok: true, document: data });
    }

    const { data, error } = await supabaseAdmin
      .from('partners')
      .update({ status_verificare: DECIZIE_LA_STATUS_PARTNERS[decizie] })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: 'Partenerul nu există' });
    await inregistreazaAudit({
      admin, req, actiune: `partener_${decizie}`, entitate: 'partners', entitate_id: id, detalii: { decizie },
    });

    // Pasul 10b: un partener aprobat trebuie să aibă rolul lui în
    // profiles.roles (altfel API-urile de partener îi răspund 403). Se adaugă
    // lângă rolurile existente, nu le înlocuiește.
    // Aprobarea e deja salvată; o eroare la rol se raportează separat
    // (rol_eroare), nu ca aprobare eșuată.
    let rolAdaugat = null;
    let rolEroare = null;
    const rol = decizie === 'aprobat' ? rolPentruTipPartener(data.partner_type) : null;
    if (rol) {
      try {
        const { adaugat, roles } = await asiguraRolInProfil(id, rol);
        if (adaugat) {
          rolAdaugat = rol;
          await inregistreazaAudit({
            admin, req, actiune: 'rol_partener_adaugat', entitate: 'profiles', entitate_id: id,
            detalii: { rol, partner_type: data.partner_type, roles, motiv: 'aprobare_partener' },
          });
        }
      } catch (e) {
        console.error('[verifica-document] rolul de partener nu s-a putut adăuga:', e);
        rolEroare = `Partenerul e aprobat, dar rolul ${rol} nu s-a putut adăuga în profil: ${e.message || e}`;
      }
    }
    return res.status(200).json({ ok: true, partener: data, rol_adaugat: rolAdaugat, rol_eroare: rolEroare });
  } catch (err) {
    console.error('[verifica-document]', err);
    return res.status(500).json({ error: err.message || 'Eroare la verificarea documentului' });
  }
}

// Doar admin/superadmin pot aproba/respinge documente sau dosare de partener.
module.exports = requireAuth(['admin', 'superadmin'], handler);
