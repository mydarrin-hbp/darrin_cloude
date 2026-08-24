# Arhitectura Statusurilor — My Darrin

**Document generat: 24 august 2026, pe baza unui audit live complet (cod sursă + constrângeri reale din Supabase, proiect `aacojyvujhywanaulvuu`), nu presupus din documentație externă.**

## Rezumat executiv — corecție de premisă

Cererea inițială descrie „Darrin AI" ca un **agent activ orchestrator**, care „participă la toate fluxurile, rutele, procesele, alocările de resurse" și trebuie „integrat ca actor/auditor în fiecare schimbare de stare".

Verificat live, exhaustiv, pe toate cele 5 module: **acest lucru nu există azi, în nicio formă**. Nu există niciun apel către un LLM/agent AI la niciun punct de tranziție de status, în niciunul din cele 5 module. Ce există real sub numele „Darrin AI":

- `api/darrin-ai/deviz.js` — un LLM real, dar folosit **exclusiv pentru estimarea unui deviz la cererea explicită a clientului** (scrie în tabela separată `devize_ai_requests`), nu pentru nicio decizie de orchestrare.
- Widget-ul de chat „Darrin AI" din catalogul public — **complet simulat** (potrivire de cuvinte cheie, fără niciun apel LLM real).

Alocarea de parteneri (`lib/aloca-partener.js`, `lib/aloca-subcontractori.js`) și tot calculul de preț (`lib/calculeaza-pret.js`) sunt **algoritmi deterministici**, scriși în cod, nu decizii de AI.

Acest document tratează separat, pentru fiecare secțiune cerută: **(A) ce există real azi**, verificat live — și **(B) ce e propus**, ca extensie viitoare, clar marcat, neimplementat. Nu s-a scris nicio linie de cod în aplicație pentru acest item — doar documentația cerută explicit, în `/docs`.

---

## Descoperire pozitivă: un mecanism real de audit pe statusuri există deja — dar doar pe un singur modul

Înainte de secțiunile pe module, o descoperire care schimbă baza propunerii: **există deja, live, în producție, exact mecanismul de audit cerut** — dar aplicat azi doar tabelei `comenzi`.

```sql
-- Trigger real, live (verificat direct, nu din schema.sql — acolo apare
-- sub alt nume, fn_audit_trail, care NU există live; cel real e diferit)
CREATE TRIGGER tr_audit_comenzi AFTER UPDATE ON comenzi
FOR EACH ROW EXECUTE FUNCTION fn_audit_status_comanda();

CREATE OR REPLACE FUNCTION fn_audit_status_comanda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_comenzi(comanda_id, actor_id, actor_rol, actiune, detalii)
    VALUES (
      NEW.id, auth.uid(),
      COALESCE(current_setting('app.user_role', true), 'system'),
      'status_schimbat',
      jsonb_build_object('status_vechi', OLD.status, 'status_nou', NEW.status,
                         'escrow_eliberat', NEW.escrow_eliberat)
    );
  END IF;
  RETURN NEW;
END;
$$;
```

Verificat live: `audit_comenzi` are 6 rânduri reale, capturând corect fiecare tranziție reală (`in_cautare_partener→acceptata→in_executie→finalizata→confirmata_client`) pe cele 2 comenzi reale ale platformei, cu timestamp exact.

**Gap real, nu ipotetic**: `actor_rol` e mereu `'system'` — `current_setting('app.user_role')` nu e populat niciodată de aplicație, deci atribuirea de actor e azi neinformativă (nu se pierde tranziția, dar nu se știe onest cine/ce a declanșat-o). Și — cel mai important — **acest trigger există doar pe `comenzi`**. Niciun tabel din celelalte 4 module nu are un mecanism echivalent.

---

## 1. Cont Utilizator / Partener

### 1.1 Matricea de tranziție a statusurilor (A — real, verificat live)

**`profiles.status`** (enum Postgres real, `account_status`):

| Stare | Tranziție permisă spre | Declanșator real |
|---|---|---|
| `pending_otp` | `active` | verificare OTP la înregistrare |
| `active` | `suspended` | acțiune admin (manual) |
| `suspended` | — | — |

**`partners.status_verificare`** (`text` + CHECK):

| Stare | Tranziție permisă spre | Declanșator real |
|---|---|---|
| `pending_review` | `approved`, `rejected` | `api/admin/verifica-document.js:45` — decizie admin, mapată din română |
| `approved` | — | citit ca poartă în `api/partener/accept-comanda.js`, `contract-trimite-otp.js`, `lib/aloca-subcontractori.js` |
| `rejected` | — | terminal |

Notă: `profiles` are **două** coloane de rol suprapuse — `role` (text, CHECK cu 9 valori: client/investor/admin/superadmin + 5 tipuri partener) și `roles` (array, populat de trigger-ul de signup + `api/admin/assign-role.js`). Existența simultană a ambelor nu era documentată explicit până acum — de clarificat separat dacă `role` (singular) mai e folosit undeva sau e rămășiță.

### 1.2 Rolul „Darrin AI" — (A) real: inexistent. (B) propus, neimplementat

Niciun fișier din fluxul de verificare partener nu apelează vreun LLM. **Propunere** (neimplementată): la tranziția `pending_review→approved/rejected`, Darrin AI ar putea pre-analiza documentele încărcate (deja există infrastructură de upload, `documente_partener`) și propune o decizie, pe care adminul o confirmă/respinge — un asistent, nu un decident automat pe date financiare/identitare. Necesită decizie de business separată (cost LLM, prag de încredere, cine răspunde legal de decizie).

### 1.3 Audit — (A) real: inexistent. (B) propus

Nu există echivalentul `audit_comenzi` pentru `profiles`/`partners`. Propunere: tabelă nouă `audit_conturi(entitate_tip, entitate_id, actor_id, actiune, status_vechi, status_nou, detalii, creat_la)`, populată printr-un trigger identic ca formă cu `fn_audit_status_comanda`, pe ambele tabele.

---

## 2. Comenzi & Alocări active (Rute, resurse)

### 2.1 Matricea de tranziție (A — real, verificat live)

**`comenzi.status`**:

```
in_cautare_partener → acceptata → in_executie → finalizata → confirmata_client
                                                                    ↓
                                                              (escrow eliberat)
(oricare stare) → anulata
```

| Tranziție | Fișier + linie |
|---|---|
| (creare) → `in_cautare_partener` | `api/comenzi/creeaza.js:207` |
| `in_cautare_partener` → `acceptata` | `api/partener/accept-comanda.js:86-88` (gardă atomică `.eq('status','in_cautare_partener')`) |
| `in_executie` → `finalizata` | `api/partener/finalizeaza-comanda.js:77` (gardă: cere `in_executie` la linia 55, plus foto before/after) |
| `finalizata` → `confirmata_client` | `api/public/confirma-livrare.js:61` (gardă: cere `finalizata` la linia 51) |

Tranziții **interzise explicit** (verificate în cod, nu presupuse): orice salt care ocolește o stare (ex. `in_cautare_partener→finalizata` direct) — fiecare endpoint validează starea curentă înainte de scriere, respinge cu 409 altfel.

**`comanda_subcontractori.status`** (alocare multi-partener pe aceeași comandă):

```
alocat → facturat → platit
```
(`executat` există în schema DB, dar n-are niciun declanșator real în cod — rândul se creează abia la eliberarea escrow-ului, moment care survine deja după execuția fizică; vezi și fix-ul D2c, 24 august 2026, care a implementat exact tranzițiile `facturat`/`platit` de mai sus.)

### 2.2 Rolul „Darrin AI" — (A) real: inexistent ca decident. (B) propus

Alocarea partenerilor e azi 100% algoritm determinist (`lib/aloca-partener.js`: potrivire pe cod NACE + zonă/regiune + disponibilitate calendaristică). **Propunere pentru „anomalie pe rută/status blocat"**: un cron/watcher (nu există azi) care, dacă o comandă rămâne prea mult în `in_cautare_partener` fără nicio alocare, declanșează o notificare — poate folosi Darrin AI doar pentru a **formula** mesajul/sugestia către admin, nu pentru a decide realocarea automat pe bani reali fără supraveghere umană.

### 2.3 Audit — (A) real, funcțional, verificat live

`audit_comenzi` (vezi mai sus) — deja acoperă complet acest modul pentru `comenzi.status`. **Gap real**: `comanda_subcontractori.status` (fix-ul D2c de azi) **nu are echivalent** — tranzițiile noi `alocat→facturat→platit` nu sunt logate automat nicăieri, doar în `facturi_parteneri` (starea facturii, nu a alocării).

---

## 3. Finanțe (Plăți, Garanții, Generare automată de Deviz)

### 3.1 Matricea de tranziție (A — real, verificat live)

**`invoices.status`** + `.tip`: `proforma` → `validat` → `convertita` (scrise în `api/accountancy.js:62,75`, la confirmarea încasării+livrării).

**`facturi_parteneri.status`**: `emisa` → `platita` (vezi D2c, secțiunea 2).

**`comisioane.status_plata`**: coloana **există în schemă** (`in_asteptare`/`platit`) dar **niciun fișier nu scrie vreodată în ea** — rândurile din `comisioane` se creează o singură dată (`lib/elibereaza-escrow.js`), fără ciclu de viață urmărit după aceea. Gol genuin, nu doar neconfirmat.

**`devize` (devizele client, distincte de motorul tehnic de deviz)**: **nu are nicio coloană de status** — e strict un jurnal de calcul (`cost_baza`/`cost_brut`/`pret_final`), nu o ofertă cu ciclu de viață (accept/refuz/expirare). Cererea din prompt („Când comanda trece în `READY_FOR_DEVIZ`, Darrin AI colectează datele... generează automat devizul") presupune o stare `READY_FOR_DEVIZ` care **nu există în schema `comenzi.status`** — cea mai apropiată realitate: `api/deviz/calculate.js` rulează la cererea directă a clientului din UI, nu declanșat de o tranziție de stare a unei comenzi.

### 3.2 Rolul „Darrin AI" — (A) parțial real (doar estimare, la cerere). (B) propus

`api/darrin-ai/deviz.js` **există și e real** — un LLM interpretează descrierea liberă a clientului și produce o estimare. Dar rulează **la cererea explicită a clientului**, nu declanșat automat de o tranziție de status a unei comenzi reale — nu există azi conceptul „comanda a intrat în starea X, deci genereză automat deviz". Implementarea acestui trigger ar necesita mai întâi să existe o stare intermediară reală în `comenzi.status` (nu există azi) unde asta ar avea sens.

### 3.3 Audit — (A) parțial. (B) propus

Nu există trigger dedicat pe `invoices`/`facturi_parteneri`/`comisioane` — doar `lib/audit-log.js` (`inregistreazaAudit`), apelat manual, per acțiune admin (ex. `confirmare_plata_factura_partener`), nu automat la fiecare schimbare de rând.

---

## 4. Termene (Execuție, Prestare, Livrare, Închiriere)

### 4.1 Matricea de tranziție (A — real, verificat live — gap major)

**Nu există un modul „Termene" distinct** — nicio tabelă/coloană dedicată urmăririi termenelor de execuție/livrare/închiriere, separată de `comenzi.status` (secțiunea 2).

Verificat explicit, punct cu punct din cererea externă:
- **Garanții** — tabela pe care documentele anterioare o presupuneau (`garantii_lucrari`) **nu există sub acel nume**; tabelele reale sunt `garantii`/`garantii_evenimente`, dar **zero referințe de cod către ele, în niciun fișier** — schema există, nimic nu scrie/citește din ea. Complet orfană.
- **Închiriere** — `marketplace_echipamente.status` (`in_asteptare`/`live`/`respins`/`suspendat`) e statusul **anunțului de listare** al furnizorului, nu al unei tranzacții de închiriere active. Nu există niciun status de tipul „închiriat/returnat/întârziat".
- **Sloturi disponibile** — `api/public/sloturi-disponibile.js` **nu are niciun apel către Supabase** — complet static/hardcodat azi.

### 4.2 Rolul „Darrin AI" — (A) inexistent, nu are pe ce să opereze. (B) propus, condiționat

Nu se poate propune un trigger AI pe un modul care n-are nicio stare reală de urmărit. **Precondiție reală**: acest modul trebuie construit de la zero (tabelă de termene + garanții conectate + stare de închiriere activă) înainte ca vreun rol Darrin AI să aibă sens aici — altfel ar fi un trigger legat de nimic.

### 4.3 Audit — n/a, nu există ce audita încă.

---

## 5. Investiții (Cote, Acțiuni, Pachete)

### 5.1 Matricea de tranziție (A — real, verificat live)

**`investitori_kyc.status`**: `pending_review`... verificat exact: `in_verificare` (implicit la depunere, `api/investitori/kyc.js:27`) → `aprobat`/`respins` — **dar niciun endpoint din cod nu scrie vreodată `aprobat`/`respins`** — nu există panou admin care să decidă. Rândurile rămân permanent `in_verificare`.

**`investitori_leads`**: tabelă fără coloană de status folosită real (`api/public/investor-lead.js` doar inserează, fără stare).

**Exit/retragere**: `api/investitori/exit.js:32` inserează cu `status:'in_procesare'` — la fel, fără endpoint care să avanseze starea mai departe.

**Confirmat, neschimbat de la auditurile anterioare**: fluxul de subscriere din `mydarrin-investitori.html` (`finalizeazaSubscriere()`) **încă nu apelează niciun endpoint real** — scrie doar în `sessionStorage`. Tot modulul de investiții e azi, funcțional, un shell fără flux complet de la un capăt la altul.

### 5.2 Rolul „Darrin AI" — (A) inexistent. (B) propus, dar pe o bază care nu există încă

La fel ca la Termene — nu are sens un trigger AI peste un modul unde nici fluxul de bază (subscriere→KYC→aprobare→portofoliu) nu e conectat cap-la-coadă azi.

### 5.3 Audit — n/a.

---

## 6. Regulă de audit generalizată — propunere de cod de referință

**Propunere (neimplementată)**: generalizează tiparul deja real și funcțional din `fn_audit_status_comanda()` (secțiunea „Descoperire pozitivă") la toate tabelele cu status din secțiunile 1-3, ca migrare SQL (același precedent tehnic din tot proiectul — trigger-uri Postgres, nu cod aplicație), plus populează `app.user_role` din backend la fiecare cerere autentificată (gap real găsit: azi `actor_rol` e mereu `'system'`).

Codul de mai jos e **de referință**, pentru `/docs` — proiectul e Node.js/CommonJS, nu TypeScript; nu s-a integrat în aplicație.

```javascript
// lib/status-machine.js (PROPUS, neimplementat — exemplu de referință)

// Enum-uri, oglindă exactă a CHECK-urilor reale verificate live (secțiunile 1-5)
const COMANDA_STATUS = Object.freeze({
  IN_CAUTARE_PARTENER: 'in_cautare_partener',
  ACCEPTATA: 'acceptata',
  IN_EXECUTIE: 'in_executie',
  FINALIZATA: 'finalizata',
  CONFIRMATA_CLIENT: 'confirmata_client',
  ANULATA: 'anulata',
});

// Tranzițiile permise, exact cele deja implementate (nu inventate) — vezi 2.1
const TRANZITII_PERMISE = {
  [COMANDA_STATUS.IN_CAUTARE_PARTENER]: [COMANDA_STATUS.ACCEPTATA, COMANDA_STATUS.ANULATA],
  [COMANDA_STATUS.ACCEPTATA]: [COMANDA_STATUS.IN_EXECUTIE, COMANDA_STATUS.ANULATA],
  [COMANDA_STATUS.IN_EXECUTIE]: [COMANDA_STATUS.FINALIZATA, COMANDA_STATUS.ANULATA],
  [COMANDA_STATUS.FINALIZATA]: [COMANDA_STATUS.CONFIRMATA_CLIENT],
  [COMANDA_STATUS.CONFIRMATA_CLIENT]: [],
  [COMANDA_STATUS.ANULATA]: [],
};

function validateStatusTransition(statusVechi, statusNou) {
  const permise = TRANZITII_PERMISE[statusVechi] || [];
  if (!permise.includes(statusNou)) {
    throw new Error(`Tranziție interzisă: ${statusVechi} → ${statusNou}`);
  }
  return true;
}

// Trigger la nivel de aplicație — util DOAR ca back-up la trigger-ul DB real
// (fn_audit_status_comanda, deja live) sau pentru tabelele care încă n-au
// echivalent DB (comanda_subcontractori, invoices, facturi_parteneri,
// investitori_kyc, partners.status_verificare — vezi gap-urile de mai sus).
// darrinAI e opțional — DOAR pentru formulare de mesaj/sugestie, niciodată
// pentru scriere directă de stare pe date financiare, per toate constatările
// de mai sus (nicio decizie AI automată pe bani reali azi, și nicio propunere
// din acest document nu schimbă asta fără o decizie de business separată).
async function onStatusChange({ entitate, entitateId, statusVechi, statusNou, actorId, actorRol, darrinAI }) {
  validateStatusTransition(statusVechi, statusNou);

  await inregistreazaAudit({
    entitate, entitate_id: entitateId, actor_id: actorId, actor_rol: actorRol,
    actiune: 'status_schimbat',
    detalii: { status_vechi: statusVechi, status_nou: statusNou },
  });

  if (darrinAI && darrinAI.declanseazaLa?.includes(statusNou)) {
    // Doar sugestie/formulare mesaj — nu scriere de stare, nu decizie financiară.
    await darrinAI.sugereaza({ entitate, entitateId, statusNou });
  }
}

module.exports = { COMANDA_STATUS, TRANZITII_PERMISE, validateStatusTransition, onStatusChange };
```

---

## 7. Ce rămâne pentru aprobare separată (nimic din secțiunile de mai jos implementat)

| Item | Modul | Scop estimat |
|---|---|---|
| Trigger DB de audit pe `comanda_subcontractori`, `partners`, `invoices`, `facturi_parteneri`, `investitori_kyc` (extinde tiparul deja real din `audit_comenzi`) | 1, 2, 3, 5 | mic, precedent clar |
| Populare `app.user_role` din backend la fiecare cerere (repară `actor_rol` mereu `'system'`) | toate | mic |
| Panou admin de aprobare KYC investitor (`aprobat`/`respins` nu se scrie azi nicăieri) | 5 | mediu |
| Conectare reală `finalizeazaSubscriere()` la `api/public/investitori-subscrie.js` (deja semnalat în audituri anterioare, neschimbat) | 5 | mediu |
| Modul „Termene" de la zero (garanții conectate, stare de închiriere activă) | 4 | mare, necesită decizii de design separate |
| Rol Darrin AI ca sugestie (nu decizie automată) pe anomalii de status — necesită decizie de business (cost LLM, prag de încredere) | 1, 2 | necesită decizie de business înainte de scop tehnic |

**Nimic de mai sus nu a fost implementat.** Documentul răspunde integral cererii de audit + specificații; implementarea oricărui item necesită aprobare separată, per regula de proces activă în acest proiect.
