// /api/client/cos-multi.js
// Coș multi-serviciu (30 august 2026, cerere fondator): clientul poate
// configura mai multe servicii/materiale și le poate adăuga în coș, înainte
// de a trimite comanda finală (după plată). Fiecare rând din cos_multi_itemi
// e un item REAL, adăugat explicit. Endpointul nu creează niciodată comenzi.
//
// Pasul 11-C1 (3 nov. 2026, regula LM): acesta e singurul coș al site-ului
// (catalogul, configurarea, marketplace-ul și checkout-ul îl folosesc pe el).
//   - serviciu / închiriere (`configurare.tip` 'serviciu' | 'inchiriere'): se
//     acceptă doar cu adresa de prestare completă și doar dacă serviciul e
//     disponibil la adresă (lib/disponibilitate-adresa.js); altfel 400 pe
//     câmpul adresei sau 409 SERVICIU_INDISPONIBIL, cu motivul. Zona verificată
//     (cod de județ, localitate) și transportul se scriu pe rând de server.
//   - material (`tip` 'material'): direct, fără configurare. Material din
//     catalog (catalog_servicii, categorie 'materiale') sau produs din
//     marketplace (`id` 'mp:materiale:<uuid>' / 'mp:echipamente:<uuid>').
//     Cantitatea implicită 1; nivelul implicit e cel mai ieftin cu preț în țara
//     aleasă. Cantitatea și nivelul se schimbă din coș (PATCH).
//
// Identitate: client_id (dacă autentificat) SAU sesiune_token (vizitator,
// generat în pagină, în localStorage `myd_guest_token`).
//
// GET    ?sesiune_token=...                        → lista itemilor din coș
// POST   { sesiune_token?, configurare }           → adaugă un item, întoarce { item }
// POST   { preia_sesiune }  (autentificat)         → coșul vizitatorului trece pe cont
// PATCH  ?id=<uuid> { qty?, nivel? }               → cantitatea / nivelul unui material
// DELETE ?id=<uuid>&sesiune_token=...              → șterge un singur item
// DELETE ?clear=true&sesiune_token=...             → golește tot coșul
// Erorile au forma comună (lib/raspuns-eroare.js).

const { getAuthenticatedUser } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { trimiteEroare, camp } = require('../../lib/raspuns-eroare');
const { verificaDisponibilitate } = require('../../lib/disponibilitate-adresa');
const { adresaPrestareDinAgenda } = require('../../lib/agenda-cont');
const { parseazaIdMarketplace } = require('../../lib/rezolva-addon-materiale');
const v = require('../../lib/valideaza');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {
  sesiune_token: v.text({ max: 100, eticheta: ['Sesiunea coșului', 'Cart session'] }),
  preia_sesiune: v.text({ max: 100, eticheta: ['Sesiunea coșului', 'Cart session'] }),
  configurare: v.oricare({ maxOcteti: 50000, eticheta: ['Configurarea produsului', 'Product configuration'] }),
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMI = 50;
const QTY_MAX = 10000;
const RANG_NIVEL = { Bronze: 0, Silver: 1, Gold: 2, Platinum: 3 };

const MESAJE = {
  identitate: { ro: 'Coșul nu poate fi identificat. Reîncarcă pagina.', en: 'The basket cannot be identified. Reload the page.' },
  configurare: { ro: 'Produsul de adăugat lipsește din cerere.', en: 'The product to add is missing from the request.' },
  tip: { ro: 'Tipul produsului nu este recunoscut.', en: 'The product type is not recognised.' },
  plin: { ro: 'Coșul are deja 50 de produse. Finalizează o comandă sau șterge ceva din coș.', en: 'The basket already has 50 items. Complete an order or remove something from the basket.' },
  material_lipsa: { ro: 'Materialul nu se poate comanda încă: nu este în catalogul cu prețuri al platformei.', en: "This material cannot be ordered yet: it is not in the platform's priced catalogue." },
  material_fara_pret: { ro: 'Materialul nu are încă preț pentru țara ta, deci nu poate fi comandat.', en: 'This material has no price for your country yet, so it cannot be ordered.' },
  nivel: { ro: 'Nivelul ales nu are preț pentru acest material. Alege alt nivel.', en: 'The chosen level has no price for this material. Choose another level.' },
  qty: { ro: 'Cantitatea trebuie să fie un număr întreg între 1 și 10000.', en: 'The quantity must be a whole number between 1 and 10000.' },
  doar_material: { ro: 'Cantitatea unui serviciu se schimbă din pagina lui de configurare.', en: "A service's quantity is changed on its configuration page." },
  item_lipsa: { ro: 'Produsul nu mai este în coș.', en: 'This item is no longer in the basket.' },
  preia: { ro: 'Coșul de vizitator se poate muta doar într-un cont conectat.', en: 'The guest basket can only be moved into a signed-in account.' },
  server: { ro: 'Coșul nu a putut fi salvat. Încearcă din nou.', en: 'The basket could not be saved. Please try again.' },
  fara_pret: { ro: 'Acest serviciu nu are încă un preț fix. Cere un deviz.', en: 'This service does not have a fixed price yet. Ask for a quote.' },
};

function eroare(res, status, cod, cheie, numeCamp, mesaj) {
  const m = mesaj || MESAJE[cheie];
  return trimiteEroare(res, status, cod, m.ro, m.en, numeCamp ? [camp(numeCamp, m.ro, m.en)] : [], numeCamp ? { camp: numeCamp } : undefined);
}

function tipItem(c) {
  const t = String(c.tip || c.type || '').toLowerCase();
  if (t === 'serviciu' || t === 'servicii') return 'serviciu';
  if (t === 'inchiriere' || t === 'inchirieri') return 'inchiriere';
  if (t === 'material' || t === 'materiale' || c.tip_comanda === 'marketplace') return 'material';
  return null;
}

function cantitate(v) {
  const n = Number(v == null ? 1 : v);
  return Number.isInteger(n) && n >= 1 && n <= QTY_MAX ? n : null;
}

// Nivelurile cu preț ale unui material din catalog, în țara cerută, de la cel mai ieftin.
async function nivelurileMaterialului(serviciuId, tara) {
  const { data } = await supabaseAdmin
    .from('catalog_niveluri').select('id, nivel, catalog_preturi(pret, tara_cod)').eq('serviciu_id', serviciuId);
  return (data || [])
    .map((n) => {
      const p = (n.catalog_preturi || []).find((x) => x.tara_cod === tara);
      return p && Number(p.pret) > 0 ? { nivel: n.nivel, pret: Number(p.pret) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.pret - b.pret || (RANG_NIVEL[a.nivel] ?? 9) - (RANG_NIVEL[b.nivel] ?? 9));
}

// Material → rândul de coș (sau { eroare }).
async function pregatesteMaterial(c) {
  const qty = cantitate(c.qty);
  if (qty === null) return { eroare: [400, 'CANTITATE_INVALIDA', 'qty', 'qty'] };
  const tara = (typeof c.tara_cod === 'string' && /^[A-Za-z]{2}$/.test(c.tara_cod) ? c.tara_cod : 'RO').toUpperCase();

  const mp = parseazaIdMarketplace(c.id);
  if (mp) {
    const tabel = mp.tip === 'materiale' ? 'marketplace_materiale' : 'marketplace_echipamente';
    const { data: p } = await supabaseAdmin.from(tabel).select('id, denumire, status, activ').eq('id', mp.id).maybeSingle();
    if (!p || p.status !== 'live' || p.activ === false) return { eroare: [404, 'MATERIAL_INDISPONIBIL', 'id', 'material_lipsa'] };
    return {
      configurare: {
        tip: 'material', sursa: 'marketplace', id: c.id, titlu: p.denumire,
        unitate: mp.tip === 'materiale' ? (c.unitate || '') : 'zi', qty, tara_cod: tara, adaugat_la: new Date().toISOString(),
      },
    };
  }

  let q = supabaseAdmin.from('catalog_servicii').select('id, id_serviciu, titlu, unitate_masura, categorie, status_public');
  if (typeof c.serviciu_id === 'string' && UUID.test(c.serviciu_id)) q = q.eq('id', c.serviciu_id);
  else if (typeof c.slug === 'string' && c.slug.trim()) q = q.eq('id_serviciu', c.slug.trim().slice(0, 120));
  else return { eroare: [400, 'MATERIAL_LIPSA', 'serviciu_id', 'material_lipsa'] };
  const { data: m } = await q.maybeSingle();
  if (!m || m.status_public === false || m.categorie !== 'materiale') return { eroare: [404, 'MATERIAL_INDISPONIBIL', 'serviciu_id', 'material_lipsa'] };

  const niveluri = await nivelurileMaterialului(m.id, tara);
  if (!niveluri.length) return { eroare: [409, 'MATERIAL_FARA_PRET', 'serviciu_id', 'material_fara_pret'] };
  const ales = c.nivel ? niveluri.find((n) => n.nivel === c.nivel) : niveluri[0];
  if (!ales) return { eroare: [400, 'NIVEL_FARA_PRET', 'nivel', 'nivel'] };

  return {
    configurare: {
      tip: 'material', sursa: 'catalog', serviciu_id: m.id, slug: m.id_serviciu, titlu: m.titlu,
      unitate: m.unitate_masura || 'buc', nivel: ales.nivel, pret_unitar: ales.pret, niveluri, qty, tara_cod: tara,
      adaugat_la: new Date().toISOString(),
    },
  };
}

// Serviciu / închiriere → verificarea adresei pe server; rândul primește zona verificată.
async function pregatesteServiciu(c, tip, user) {
  let adresa = c.adresa_prestare;
  let adresaPrestareId = null;
  if (c.adresa_prestare_id) {
    if (!user) return { eroare: [400, 'ADRESA_INCOMPLETA', 'adresa_prestare_id', null, { ro: 'Alege adresa de prestare din nou.', en: 'Choose the service address again.' }] };
    const r = await adresaPrestareDinAgenda(user.id, c.adresa_prestare_id);
    if (!r.ok) return { eroare: [r.status || 400, r.cod || 'DATE_INVALIDE', r.camp || 'adresa_prestare_id', null, { ro: r.error, en: r.error_en }] };
    adresa = { strada: r.adresa_lucrare.strada, localitate: r.adresa_lucrare.localitate, judet: r.adresa_lucrare.judet, tara_cod: r.zona.tara_cod };
    adresaPrestareId = c.adresa_prestare_id;
  }

  // Pasul 11-C2: prețul din coș e cel al comenzii (lib/pret-serviciu.js), cu
  // materialele opționale alese; fără nivel cu preț real, serviciul nu intră.
  const addon = [...(Array.isArray(c.materiale) ? c.materiale : []), ...(Array.isArray(c.inchirieri) ? c.inchirieri : [])]
    .filter((m) => m && m.id).map((m) => ({ id: m.id, qty: m.qty }));
  const v = await verificaDisponibilitate({
    serviciu: { id: c.serviciu_id, slug: c.slug }, adresa, nivel_id: c.nivel_id || null, cantitate: c.cantitate || c.qty, addon_materiale: addon,
  });
  if (!v.ok) return { eroare: [v.status, v.cod, v.camp, null, v.mesaj] };
  if (!v.disponibil && v.motiv === 'fara_pret') return { eroare: [409, 'FARA_PRET', 'nivel_id', 'fara_pret'] };
  if (!v.disponibil && (v.motiv === 'addon_fara_pret' || v.motiv === 'nivel_inactiv')) return { eroare: [409, v.motiv === 'nivel_inactiv' ? 'NIVEL_INACTIV' : 'ADDON_FARA_PRET', 'nivel_id', null, v.mesaj] };
  if (!v.disponibil) return { eroare: [409, 'SERVICIU_INDISPONIBIL', 'adresa_prestare', null, v.mesaj, { motiv: v.motiv }] };
  if (v.pret_final == null) return { eroare: [409, 'FARA_PRET', 'nivel_id', 'fara_pret'] };

  const z = v.zona;
  return {
    configurare: Object.assign({}, c, {
      tip, serviciu_id: v.serviciu.id, slug: v.serviciu.slug, titlu: c.titlu || v.serviciu.titlu,
      adresa_prestare: { strada: z.strada, localitate: z.localitate, judet: z.judet, tara_cod: z.tara_cod },
      adresa_prestare_id: adresaPrestareId,
      addr: z.text, tara_cod: z.tara_cod, regiune: z.regiune, localitate: z.localitate,
      verificare: { disponibil: true, la: new Date().toISOString(), transport: v.transport, pret_final: v.pret_final },
    }),
  };
}

module.exports = async function handler(req, res) {
  let user = null;
  try {
    user = await getAuthenticatedUser(req);
  } catch (e) {
    // vizitator — continuă fără user, identitatea vine din sesiune_token
  }

  if (req.body && typeof req.body === 'object' && !v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora' })) return;
  const sesiuneToken = String(req.query?.sesiune_token || req.body?.sesiune_token || '').trim().slice(0, 100) || null;

  // Coșul vizitatorului trece pe contul conectat (după login sau creare de cont).
  if (req.method === 'POST' && req.body && req.body.preia_sesiune !== undefined) {
    if (!user) return eroare(res, 401, 'NEAUTENTIFICAT', 'preia');
    const token = String(req.body.preia_sesiune || '').trim().slice(0, 100);
    if (!token) return res.status(200).json({ ok: true, mutate: 0 });
    const { data, error } = await supabaseAdmin
      .from('cos_multi_itemi')
      .update({ client_id: user.id, sesiune_token: null })
      .eq('sesiune_token', token)
      .is('client_id', null)
      .select('id');
    if (error) { console.error('[cos-multi] preia', error); return eroare(res, 500, 'EROARE_SERVER', 'server'); }
    return res.status(200).json({ ok: true, mutate: (data || []).length });
  }

  if (!user && !sesiuneToken) return eroare(res, 400, 'IDENTITATE_LIPSA', 'identitate');
  const filtruIdentitate = user ? { client_id: user.id } : { sesiune_token: sesiuneToken };

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('cos_multi_itemi')
      .select('id, configurare, creat_la')
      .match(filtruIdentitate)
      .order('creat_la', { ascending: true });
    if (error) { console.error('[cos-multi] GET', error); return eroare(res, 500, 'EROARE_SERVER', 'server'); }
    return res.status(200).json({ ok: true, itemi: data || [] });
  }

  if (req.method === 'POST') {
    const { configurare } = req.body || {};
    if (!configurare || typeof configurare !== 'object' || Array.isArray(configurare)) return eroare(res, 400, 'CONFIGURARE_LIPSA', 'configurare', 'configurare');
    const tip = tipItem(configurare);
    if (!tip) return eroare(res, 400, 'TIP_NECUNOSCUT', 'tip', 'tip');

    const { count } = await supabaseAdmin.from('cos_multi_itemi').select('id', { count: 'exact', head: true }).match(filtruIdentitate);
    if ((count || 0) >= MAX_ITEMI) return eroare(res, 409, 'COS_PLIN', 'plin');

    let rez;
    try {
      rez = tip === 'material' ? await pregatesteMaterial(configurare) : await pregatesteServiciu(configurare, tip, user);
    } catch (e) {
      console.error('[cos-multi] verificare', e);
      return eroare(res, 500, 'EROARE_SERVER', 'server');
    }
    if (rez.eroare) {
      const [status, cod, numeCamp, cheie, mesaj, extra] = rez.eroare;
      const m = mesaj || MESAJE[cheie];
      return trimiteEroare(res, status, cod, m.ro, m.en, [camp(numeCamp, m.ro, m.en)], Object.assign({ camp: numeCamp }, extra));
    }

    const { data, error } = await supabaseAdmin
      .from('cos_multi_itemi')
      .insert({ ...filtruIdentitate, configurare: rez.configurare })
      .select('id, configurare, creat_la')
      .single();
    if (error) { console.error('[cos-multi] POST', error); return eroare(res, 500, 'EROARE_SERVER', 'server'); }
    return res.status(200).json({ ok: true, item: data });
  }

  if (req.method === 'PATCH') {
    const id = req.query?.id;
    if (!id) return eroare(res, 404, 'NU_EXISTA', 'item_lipsa');
    const { data: rand } = await supabaseAdmin
      .from('cos_multi_itemi').select('id, configurare').match({ ...filtruIdentitate, id }).maybeSingle();
    if (!rand) return eroare(res, 404, 'NU_EXISTA', 'item_lipsa');
    const c = rand.configurare || {};
    if (tipItem(c) !== 'material') return eroare(res, 400, 'DOAR_MATERIALE', 'doar_material', 'qty');

    const corp = req.body || {};
    const nou = Object.assign({}, c);
    if (corp.qty !== undefined) {
      const qty = cantitate(corp.qty);
      if (qty === null) return eroare(res, 400, 'CANTITATE_INVALIDA', 'qty', 'qty');
      nou.qty = qty;
    }
    if (corp.nivel !== undefined && c.sursa === 'catalog') {
      const niveluri = await nivelurileMaterialului(c.serviciu_id, c.tara_cod || 'RO');
      const ales = niveluri.find((n) => n.nivel === corp.nivel);
      if (!ales) return eroare(res, 400, 'NIVEL_FARA_PRET', 'nivel', 'nivel');
      Object.assign(nou, { nivel: ales.nivel, pret_unitar: ales.pret, niveluri });
    }
    const { data, error } = await supabaseAdmin
      .from('cos_multi_itemi').update({ configurare: nou }).match({ ...filtruIdentitate, id }).select('id, configurare, creat_la').single();
    if (error) { console.error('[cos-multi] PATCH', error); return eroare(res, 500, 'EROARE_SERVER', 'server'); }
    return res.status(200).json({ ok: true, item: data });
  }

  if (req.method === 'DELETE') {
    if (req.query?.clear === 'true') {
      const { error } = await supabaseAdmin.from('cos_multi_itemi').delete().match(filtruIdentitate);
      if (error) { console.error('[cos-multi] DELETE', error); return eroare(res, 500, 'EROARE_SERVER', 'server'); }
      return res.status(200).json({ ok: true, cleared: true });
    }
    const id = req.query?.id;
    if (!id) return eroare(res, 404, 'NU_EXISTA', 'item_lipsa');
    const { error } = await supabaseAdmin.from('cos_multi_itemi').delete().match({ ...filtruIdentitate, id });
    if (error) { console.error('[cos-multi] DELETE', error); return eroare(res, 500, 'EROARE_SERVER', 'server'); }
    return res.status(200).json({ ok: true });
  }

  return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
};
