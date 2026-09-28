// lib/contract-partener.js
// Contract-cadru standard de colaborare și subcontractare Antreprenor General ↔ Partener
// (28 sept. 2026). Textul preia conceptul din Termeni și Condiții (art. 3, 7, 8, 11, 12):
// Home Best Pal este antreprenor general și parte contractantă directă față de clienți;
// Partenerul execută, ca subcontractor, la ordinul lui, serviciile din portofoliul cu care
// și-a creat contul. Datele părților și Anexa 1 (portofoliu, cod CAEN, competențe) se
// completează din date reale; ce lipsește apare marcat „de completat", niciodată inventat.
//
// Modelul necesită revizuire juridică înainte de folosire ca document contractual.

const CONTRACT_VERSIUNE = '2026.09-m1';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

const TIP_PARTENER = {
  servicii_tehnice: { eticheta: 'Furnizor de servicii tehnice', activitate: 'servicii tehnice de execuție (manoperă și lucrări)', obiect: 'serviciile' },
  furnizor_materiale: { eticheta: 'Furnizor de materiale', activitate: 'furnizare de materiale de construcții și bricolaj', obiect: 'materialele' },
  inchirieri_utilaje: { eticheta: 'Furnizor de închirieri', activitate: 'închiriere de echipamente și utilaje', obiect: 'echipamentele' },
  curier_utilitara: { eticheta: 'Curier / transport local', activitate: 'transport și livrare locală', obiect: 'serviciile de transport și livrare' },
  asigurari: { eticheta: 'Furnizor de asigurări', activitate: 'intermediere și emitere de polițe de asigurare asociate comenzilor', obiect: 'serviciile de asigurare' },
};

const CATEGORIE = { servicii: 'Servicii', materiale: 'Materiale', inchirieri: 'Închirieri' };

function lipsa(eticheta) {
  return `<span class="ctr-lipsa">[${esc(eticheta)} — de completat]</span>`;
}
const camp = (v, eticheta) => (v != null && String(v).trim() !== '' ? esc(v) : lipsa(eticheta));
const pct = (v, eticheta) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? `${esc(String(v).replace('.', ','))}%` : lipsa(eticheta));

function numarContract(an, idPartener) {
  const id8 = String(idPartener || '').replace(/-/g, '').slice(0, 8).toUpperCase();
  return `MP-${an}-${id8 || 'XXXXXXXX'}`;
}

function tabel(antet, randuri) {
  if (!randuri.length) return '';
  return `<table class="ctr-t"><thead><tr>${antet.map((a) => `<th>${esc(a)}</th>`).join('')}</tr></thead><tbody>${randuri.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function anexaPortofoliu(d) {
  const p = d.portofoliu || {};
  const tip = d.partner.partner_type;
  const parti = [];

  const caen = (p.caen || []).map((c) => `<li>${esc(c.cod)}${c.principal ? ' (principal)' : ''}</li>`).join('');
  parti.push(`<h4>1.1 Cod(uri) CAEN / NACE de activitate</h4>` + (caen
    ? `<ul>${caen}</ul><p class="ctr-nota">Codurile provin din serviciile selectate în Portofoliu și din codurile declarate la înregistrare.</p>`
    : `<p>${lipsa('cod CAEN — se stabilește odată cu selectarea serviciilor din Portofoliu')}</p>`));

  if (['servicii_tehnice', 'furnizor_materiale', 'inchirieri_utilaje'].includes(tip)) {
    const grupate = {};
    (p.servicii || []).forEach((s) => {
      const k = `${CATEGORIE[s.categorie] || 'Servicii'} · ${s.domeniu || 'General'}`;
      (grupate[k] = grupate[k] || []).push(s);
    });
    const randuri = [];
    Object.keys(grupate).sort().forEach((k) => {
      grupate[k].forEach((s) => randuri.push([esc(k), esc(s.titlu), esc(s.nace || '—'), esc(s.cod_esco ? `${s.cod_esco}${s.competenta ? ' · ' + s.competenta : ''}` : '—')]));
    });
    parti.push(`<h4>1.2 Categorii și servicii selectate (Portofoliul de activități)</h4>` + (randuri.length
      ? tabel(['Categorie · domeniu', 'Serviciu selectat', 'CAEN/NACE', 'Competență (cod ESCO)'], randuri)
      : `<p>${lipsa('niciun serviciu selectat încă — se bifează din dashboard, la „Portofoliu servicii”')}</p>`));
  }

  if (tip === 'curier_utilitara') {
    const zone = (p.zone || []).map((z) => [esc([z.tara_cod, z.regiune_cod, z.localitate].filter(Boolean).join(' · ')), esc(z.raza_livrare_km != null ? z.raza_livrare_km + ' km' : '—')]);
    parti.push('<h4>1.2 Zone de acoperire</h4>' + (zone.length ? tabel(['Zonă', 'Rază de livrare'], zone) : `<p>${lipsa('nicio zonă declarată')}</p>`));
    const veh = (p.vehicule || []).map((v) => [esc([v.denumire, v.marca, v.model].filter(Boolean).join(' ')), esc(v.capacitate_kg != null ? v.capacitate_kg + ' kg' : '—')]);
    parti.push('<h4>1.3 Vehicule declarate</h4>' + (veh.length ? tabel(['Vehicul', 'Capacitate'], veh) : `<p>${lipsa('niciun vehicul declarat')}</p>`));
  }

  if (tip === 'asigurari') {
    const pol = (p.polite || []).map((x) => [esc(x.tip_polita), esc(x.limita_acoperire_eur != null ? x.limita_acoperire_eur + ' EUR' : '—'), pct(x.comision_pct, 'comision')]);
    parti.push('<h4>1.2 Tipuri de poliță oferite</h4>' + (pol.length ? tabel(['Tip poliță', 'Limită de acoperire', 'Comision'], pol) : `<p>${lipsa('niciun tip de poliță declarat')}</p>`));
  }

  const comp = (p.competente || []).map((c) => [esc(c.cod), esc(c.denumire || '—'), esc(c.nr_persoane != null ? String(c.nr_persoane) : '—')]);
  parti.push('<h4>1.4 Competențe și personal declarat</h4>' + (comp.length
    ? tabel(['Cod ESCO', 'Competență / meserie', 'Persoane declarate'], comp)
    : `<p>${lipsa('nicio competență declarată pentru personal — se adaugă din „Echipa mea”')}</p>`));

  const cert = (p.certificari || []).map((c) => `<li>${esc(c)}</li>`).join('');
  parti.push('<h4>1.5 Autorizații și certificări încărcate</h4>' + (cert ? `<ul>${cert}</ul>` : `<p>${lipsa('nicio certificare încărcată')}</p>`));

  return `<h3 id="ctr-anexa1">Anexa 1 — Portofoliul de activități al Partenerului</h3>
<p class="ctr-nota">Situația la data generării acestui document. Portofoliul se poate modifica din contul Partenerului; varianta în vigoare este cea din Platformă.</p>${parti.join('')}`;
}

function clauzaEconomica(d) {
  const pr = d.procente || {};
  const tip = d.partner.partner_type;
  if (tip === 'furnizor_materiale') {
    return `<p>7.1 Valoarea netă alocată Partenerului pentru materialele livrate este valoarea materialelor din deviz, din care se reține comisionul Antreprenorului General de ${pct(pr.materiale, 'comision materiale')}.</p>`;
  }
  if (tip === 'inchirieri_utilaje') {
    return `<p>7.1 Valoarea netă alocată Partenerului pentru închirierea echipamentelor este valoarea chiriei din deviz, din care se reține comisionul Antreprenorului General de ${pct(pr.inchirieri, 'comision închirieri')}.</p>`;
  }
  if (tip === 'asigurari') {
    return `<p>7.1 Valoarea netă alocată Partenerului este prima de asigurare din deviz, din care se reține comisionul de intermediere al Antreprenorului General de ${pct(pr.asigurari, 'comision intermediere asigurări')}.</p>`;
  }
  return `<p>7.1 Valoarea netă alocată Partenerului corespunde componentei din deviz atribuite acestuia (${tip === 'curier_utilitara' ? 'transport și livrare' : 'manoperă și, după caz, alte componente proprii'}). Comisionul platformei (în prezent ${pct(pr.comision_platforma, 'comision platformă')} din valoarea directă a serviciului), costurile de marketing și de mentenanță se adaugă la prețul afișat Clientului și <strong>nu se rețin</strong> din valoarea netă alocată.</p>`;
}

function genereazaContract(d) {
  const model = !!d.model;
  const an = d.an || new Date().getFullYear();
  const numar = numarContract(an, d.partner.id);
  const tip = TIP_PARTENER[d.partner.partner_type] || { eticheta: 'Partener', activitate: 'activități conform Portofoliului', obiect: 'serviciile' };
  const e = d.entitate || {};
  const p = d.partner;

  const antreprenor = `<strong>${camp(e.denumire, 'denumire entitate Home Best Pal')}</strong>, cu sediul în ${camp(e.adresa, 'adresa sediului')}, CUI ${camp(e.cui, 'CUI')}, nr. reg. com. ${camp(e.nr_reg_com, 'nr. reg. com.')}, cont bancar ${camp(e.iban, 'IBAN')}, reprezentată prin platforma „My Darrin”, în calitate de <strong>Antreprenor General</strong>`;
  const partener = `<strong>${camp(p.nume_firma, 'denumire')}</strong>${p.tip_entitate_legala ? ` (${esc(p.tip_entitate_legala.toUpperCase())})` : ''}, cu sediul în ${camp(p.adresa_sediu_social, 'adresa sediului')}, CUI/CNP ${camp(p.cui, 'CUI')}, nr. reg. com. ${camp(p.nr_reg_com, 'nr. reg. com.')}, reprezentat prin ${camp(d.reprezentant, 'nume reprezentant legal')}, în calitate de ${lipsa('funcția reprezentantului')}, e-mail ${camp(d.contact && d.contact.email, 'e-mail')}, telefon ${camp(d.contact && d.contact.telefon, 'telefon')}, în calitate de <strong>Partener</strong>`;

  const semnare = d.semnat
    ? `<p><strong>Acceptat electronic</strong> la ${esc(new Date(d.semnat.la).toLocaleString('ro-RO'))}, versiunea contractului ${esc(d.semnat.versiune || '—')}, prin cod unic (OTP) trimis pe adresa de e-mail declarată.</p>`
    : (model
      ? '<p class="ctr-nota">Acceptarea se face electronic, prin cod unic (OTP), din contul Partenerului.</p>'
      : '<p class="ctr-nota">Contractul nu este încă acceptat. Acceptarea se face din panoul de start al contului, prin cod unic (OTP) trimis pe e-mail.</p>');

  const art = [];
  art.push(`<h3>Art. 1. Părțile</h3>
<p>1.1 ${antreprenor}.</p>
<p>1.2 ${partener}.</p>`);

  art.push(`<h3>Art. 2. Definiții</h3>
<p><strong>Platforma</strong> — serviciul online „My Darrin”, operat de grupul Home Best Pal. <strong>Antreprenorul General</strong> — Home Best Pal, parte contractantă directă față de Clienți. <strong>Client</strong> — persoana fizică, juridică sau entitatea publică (B2C, B2B, B2G) care comandă servicii prin Platformă. <strong>Ordin de execuție</strong> — solicitarea transmisă Partenerului prin Platformă, pentru o Comandă a unui Client. <strong>Portofoliu</strong> — activitățile selectate de Partener în Platformă, descrise în Anexa 1. <strong>Deviz</strong> — calculul valorii Comenzii, generat de Platformă. <strong>Escrow</strong> — reținerea temporară a sumelor plătite de Client, până la confirmarea finalizării. <strong>Nivel de serviciu</strong> — pachetul (Bronze/Silver/Gold/Platinum) ales de Client, cu garanția aferentă.</p>`);

  art.push(`<h3>Art. 3. Obiectul contractului</h3>
<p>3.1 Partenerul se obligă să execute, ca <strong>subcontractor al Antreprenorului General</strong>, ${esc(tip.obiect)} pentru care și-a creat contul pe Platformă și care alcătuiesc Portofoliul de activități din Anexa 1, <strong>în limita competențelor, calificărilor și autorizațiilor sale, conform codului/codurilor CAEN de activitate și categoriilor de servicii selectate</strong> în Portofoliu, pentru activitatea de tip „${esc(tip.activitate)}”.</p>
<p>3.2 Prestațiile se execută <strong>la comandă, către terți</strong> (Clienții Antreprenorului General), <strong>exclusiv la ordinul Antreprenorului General</strong> (Home Best Pal), transmis prin Platformă sub forma unui Ordin de execuție. Partenerul nu execută lucrări pentru Clienți la cererea directă a acestora.</p>
<p>3.3 Prezentul contract este un cadru. Nu obligă Antreprenorul General să transmită un volum minim de Ordine și nu conferă exclusivitate niciuneia dintre părți. Fiecare Ordin acceptat de Partener formează un contract de execuție subsecvent, guvernat de acest cadru.</p>
<p>3.4 Conform Termenilor și Condițiilor Platformei (art. 3 și 8), Antreprenorul General este parte contractantă directă față de Client și răspunde față de acesta pentru execuția conformă. Partenerul nu are raporturi contractuale directe cu Clientul și răspunde față de Antreprenorul General, potrivit art. 12.</p>`);

  art.push(`<h3>Art. 4. Portofoliul, competențele și codul CAEN</h3>
<p>4.1 Anexa 1 cuprinde codurile CAEN de activitate, categoriile și serviciile selectate, competențele și personalul declarat, precum și autorizațiile încărcate de Partener.</p>
<p>4.2 Partenerul declară că activitățile din Portofoliu intră în obiectul său de activitate autorizat (cod CAEN), că deține calificările și autorizațiile legale necesare și că informațiile din cont sunt reale. Răspunde pentru exactitatea lor.</p>
<p>4.3 Ordinele se alocă doar pentru activitățile din Portofoliu. Partenerul nu acceptă Ordine în afara competențelor, a codului CAEN sau a autorizațiilor deținute. Lucrările reglementate (de exemplu instalații de gaze, ISCIR, electrice) se execută doar cu autorizările valabile la data execuției; Antreprenorul General poate suspenda alocarea dacă autorizarea expiră sau nu este dovedită.</p>
<p>4.4 Partenerul poate modifica Portofoliul din contul său. Modificările produc efecte pentru Ordinele viitoare, nu afectează Ordinele deja acceptate și nu necesită act adițional. Versiunile Anexei 1 se păstrează în Platformă.</p>`);

  art.push(`<h3>Art. 5. Ordinul de execuție</h3>
<p>5.1 Ordinul se transmite prin Platformă, prin alocare automată (după competență, zonă și program) sau manuală, și cuprinde descrierea lucrării, locația, intervalul, nivelul de serviciu, devizul și valoarea netă alocată Partenerului.</p>
<p>5.2 Partenerul confirmă sau refuză Ordinul în termenul afișat în Platformă. Lipsa răspunsului în termen echivalează cu refuzul. Refuzurile sau neconfirmările repetate pot duce la reducerea alocării.</p>
<p>5.3 După confirmare, Ordinul este obligatoriu. Partenerul poate renunța doar pentru motive justificate, comunicate imediat prin Platformă.</p>
<p>5.4 Alinierea intervalului de execuție prin Platformă este strict tehnică. Orice modificare comercială (preț, condiții speciale) se stabilește numai cu Antreprenorul General, niciodată cu Clientul.</p>`);

  art.push(`<h3>Art. 6. Executarea lucrărilor</h3>
<p>6.1 Partenerul execută Ordinul cu diligență profesională, la standardul nivelului de serviciu comandat și conform devizului, cu materialele și echipamentele prevăzute în acesta.</p>
<p>6.2 La locul lucrării, Partenerul se identifică prin codul de verificare din Platformă și respectă intervalul confirmat.</p>
<p>6.3 Finalizarea se declară în Platformă, după încărcarea a cel puțin unei fotografii „înainte” și a uneia „după”. Clientul confirmă finalizarea sau aceasta se consideră confirmată la expirarea termenului din Termenii și Condițiile Platformei.</p>
<p>6.4 Partenerul nu subcontractează mai departe execuția fără acordul scris al Antreprenorului General. Personalul propriu este angajat sau contractat legal, iar normele de securitate și sănătate în muncă și de prevenire a incendiilor cad în sarcina Partenerului.</p>
<p>6.5 Partenerul nu negociază și nu încasează de la Client sume în legătură cu Ordinul. Orice plată se face prin Platformă, prin Escrow.</p>`);

  art.push(`<h3>Art. 7. Prețul, valoarea netă alocată și comisionul</h3>
${clauzaEconomica(d)}
<p>7.2 Devizul este calculat de Platformă; Partenerul nu stabilește prețul final către Client. Procentele de mai sus sunt cele configurate la data generării și pot fi modificate de Antreprenorul General cu notificare de cel puțin 15 zile (art. 17), fără efect asupra Ordinelor deja acceptate.</p>`);

  art.push(`<h3>Art. 8. Escrow, facturare și plată</h3>
<p>8.1 Sumele plătite de Client sunt reținute în Escrow și se eliberează după finalizarea lucrării și confirmarea Clientului sau expirarea termenului de dispută, conform Termenilor și Condițiilor (art. 7).</p>
<p>8.2 După eliberare, Partenerul emite factură către Antreprenorul General pentru valoarea netă alocată și o încarcă în Platformă. Pe factură se înscrie numărul acestui contract: <strong>${esc(numar)}</strong>. Platforma nu emite factura fiscală a Partenerului.</p>
<p>8.3 Antreprenorul General plătește prin transfer bancar, în contul înregistrat de Partener, în termen de ${lipsa('numărul de zile lucrătoare')} de la validarea facturii.</p>
<p>8.4 Antreprenorul General poate reține sau compensa din sumele datorate Partenerului valorile impuse prin hotărâre a unei dispute confirmate sau a unui dosar de daună aprobat, cu notificarea motivată a Partenerului.</p>`);

  art.push(`<h3>Art. 9. Calitate, garanție și reclamații</h3>
<p>9.1 Garanția de execuție are durata afișată Clientului pentru nivelul de serviciu comandat. În acest interval, Partenerul remediază, la solicitarea Antreprenorului General și fără costuri suplimentare pentru acesta, viciile de execuție imputabile lui.</p>
<p>9.2 Reclamațiile și disputele Clienților se gestionează de Antreprenorul General prin Platformă. Partenerul răspunde în termenul comunicat și pune la dispoziție dovezile solicitate (fotografii, date de identificare la locul lucrării).</p>`);

  art.push(`<h3>Art. 10. Asigurare</h3>
<p>10.1 Pentru Comenzile pentru care costul include prima de asigurare, acoperirea garanției și a daunelor se face prin infrastructura de asigurare a Antreprenorului General. Aceasta nu înlocuiește obligația Partenerului de a-și menține propriile asigurări cerute de lege pentru activitatea sa.</p>
<p>10.2 Dosarele de daună se deschid și se urmăresc prin Platformă, sub ID-ul de eveniment corelat comunicat tuturor părților.</p>`);

  art.push(`<h3>Art. 11. Statutul Partenerului</h3>
<p>Partenerul este subcontractor independent al Antreprenorului General. Nu este angajat, reprezentant sau mandatar al acestuia și își organizează singur personalul, echipamentele și conformarea legală și fiscală. Nu folosește denumirea, sigla sau identitatea vizuală My Darrin decât în modul permis prin Platformă.</p>`);

  art.push(`<h3>Art. 12. Răspunderea</h3>
<p>12.1 Partenerul răspunde față de Antreprenorul General pentru execuția neconformă, întârzierile imputabile și daunele cauzate prin fapta sa, inclusiv pentru sumele plătite de Antreprenorul General Clientului sau unui terț din această cauză.</p>
<p>12.2 Antreprenorul General răspunde față de Client, păstrându-și dreptul de regres împotriva Partenerului pentru prejudiciile cauzate de acesta.</p>
<p>12.3 Nicio parte nu răspunde pentru daune indirecte sau pierderi de profit, în măsura permisă de lege.</p>`);

  art.push(`<h3>Art. 13. Confidențialitate și date cu caracter personal</h3>
<p>13.1 Părțile păstrează confidențialitatea informațiilor comerciale și tehnice primite prin Platformă, pe durata contractului și 3 ani după încetare.</p>
<p>13.2 Datele personale ale Clienților (adresă, contact, detalii comandă) se prelucrează de Partener doar pentru executarea Ordinului alocat, conform Regulamentului (UE) 2016/679 și instrucțiunilor Antreprenorului General, cu măsuri de securitate adecvate. Partenerul le șterge după expirarea garanției și notifică Antreprenorul General fără întârziere, în cel mult 24 de ore, despre orice incident de securitate. Calificarea juridică a părților în raport cu aceste date (operator, persoană împuternicită) ${lipsa('de stabilit de avocat')}.</p>`);

  art.push(`<h3>Art. 14. Interdicții</h3>
<p>Partenerul nu contactează Clientul în scop comercial, nu îi propune executarea de lucrări în afara Platformei și nu folosește datele primite prin Ordin în alt scop decât executarea acestuia, pe durata contractului și 12 luni după încetare, în măsura permisă de lege.</p>`);

  art.push(`<h3>Art. 15. Durata, suspendarea și încetarea</h3>
<p>15.1 Contractul se încheie pe durată nedeterminată, de la data acceptării electronice.</p>
<p>15.2 Oricare parte îl poate denunța cu notificare de ${lipsa('numărul de zile')} zile. Ordinele acceptate înainte de încetare se finalizează.</p>
<p>15.3 Antreprenorul General poate suspenda imediat accesul Partenerului în caz de reclamații repetate confirmate, pierderea calificărilor sau autorizărilor, documente false sau fraudă, și poate înceta contractul pentru culpă gravă, fără preaviz.</p>`);

  art.push(`<h3>Art. 16. Forța majoră</h3>
<p>Nicio parte nu răspunde pentru neexecutarea cauzată de un eveniment de forță majoră, în condițiile legii, cu notificare în 5 zile de la apariție.</p>`);

  art.push(`<h3>Art. 17. Modificări</h3>
<p>Antreprenorul General poate modifica prezentul contract și anexele cu notificare prin e-mail sau în Platformă cu cel puțin 15 zile înainte de intrarea în vigoare. Continuarea activității după această dată înseamnă acceptarea modificărilor. Modificările nu afectează Ordinele deja acceptate.</p>`);

  art.push(`<h3>Art. 18. Legea aplicabilă și litigiile</h3>
<p>Contractul este guvernat de legea țării entității Antreprenorului General cu care a fost încheiat. Litigiile se soluționează amiabil în 30 de zile; în lipsa unui acord, de instanțele competente de la sediul Antreprenorului General.</p>`);

  art.push(`<h3>Art. 19. Comunicări și acceptare electronică</h3>
<p>19.1 Comunicările se fac prin Platformă și la adresele de e-mail declarate.</p>
<p>19.2 Contractul se acceptă electronic, prin cod unic (OTP) trimis pe e-mail. Se înregistrează data, adresa IP și versiunea acceptată. Părțile recunosc această modalitate ca formă valabilă de exprimare a consimțământului, ${lipsa('încadrarea juridică a semnăturii electronice, de confirmat de avocat')}.</p>`);

  art.push(`<h3>Art. 20. Dispoziții finale</h3>
<p>Anexele fac parte din contract. Dacă o clauză este declarată nulă, celelalte rămân în vigoare. Contractul înlocuiește orice înțelegere anterioară privind același obiect. Prevederile Termenilor și Condițiilor Platformei se aplică complementar; în caz de conflict, prevalează prezentul contract.</p>`);

  const anexa2 = `<h3 id="ctr-anexa2">Anexa 2 — Identificarea părților</h3>
${tabel(['', 'Antreprenorul General', 'Partenerul'], [
    ['Denumire', camp(e.denumire, 'denumire'), camp(p.nume_firma, 'denumire')],
    ['CUI', camp(e.cui, 'CUI'), camp(p.cui, 'CUI')],
    ['Nr. reg. comerțului', camp(e.nr_reg_com, 'nr. reg. com.'), camp(p.nr_reg_com, 'nr. reg. com.')],
    ['Sediu', camp(e.adresa, 'adresa'), camp(p.adresa_sediu_social, 'adresa')],
    ['Cont bancar', camp(e.iban, 'IBAN'), 'conform contului activ înregistrat în Platformă'],
    ['Reprezentant', lipsa('reprezentant legal'), camp(d.reprezentant, 'nume reprezentant')],
    ['Număr contract', esc(numar), esc(numar)],
  ])}`;

  const css = `<style>.ctr{font-family:Georgia,'Times New Roman',serif;color:#1A2332;line-height:1.7;font-size:13.5px}.ctr h2{font-size:18px;margin:0 0 4px;color:#003366;text-align:center}.ctr h3{font-size:14px;margin:20px 0 6px;color:#003366}.ctr h4{font-size:13px;margin:14px 0 4px}.ctr p{margin:0 0 8px}.ctr .ctr-sub{text-align:center;color:#5A6B7D;margin-bottom:14px;font-size:12.5px}.ctr .ctr-nota{font-size:11.5px;color:#5A6B7D}.ctr .ctr-lipsa{background:#FFF0D6;color:#8A5F00;padding:0 4px;border-radius:4px;font-family:Arial,sans-serif;font-size:11.5px}.ctr .ctr-t{width:100%;border-collapse:collapse;font-size:12px;margin:6px 0 10px}.ctr .ctr-t th{text-align:left;background:#F0F4F8;padding:6px 8px;border:1px solid #D5DFE8}.ctr .ctr-t td{padding:6px 8px;border:1px solid #E2E8F0;vertical-align:top}</style>`;

  const html = `${css}<div class="ctr">
<h2>CONTRACT-CADRU DE COLABORARE ȘI SUBCONTRACTARE</h2>
<div class="ctr-sub">Partener My Darrin · ${esc(tip.eticheta)} · Nr. ${esc(numar)} · versiunea ${esc(CONTRACT_VERSIUNE)}${model ? ' · MODEL' : ''}</div>
<p>Între părțile de mai jos se încheie prezentul contract, având în vedere că My Darrin este operată de grupul Home Best Pal, care acționează ca antreprenor general și este parte contractantă directă față de clienți, iar partenerii integrați acționează ca subcontractori ai săi (Termeni și Condiții, art. 3 și 8).</p>
${art.join('\n')}
<p class="ctr-nota">Anexele: 1 — Portofoliul de activități; 2 — Identificarea părților.</p>
${semnare}
${anexaPortofoliu(d)}
${anexa2}
</div>`;

  return { versiune: CONTRACT_VERSIUNE, numar, titlu: 'Contract-cadru de colaborare și subcontractare', html };
}

module.exports = { genereazaContract, numarContract, CONTRACT_VERSIUNE, TIP_PARTENER };
