# My Darrin — Ghid de Implementare Backend (Etapele 1-4)

Acest pachet implementează structura tehnică cerută în cele 4 etape, plus fix-ul
critic de securitate din audit (`upload.js` fail-open). **Nu e "plug & play"** —
câțiva pași necesită conturi/configurare manuală (Supabase, provider SMS, DNS)
care nu pot fi rezolvați prin cod.

---

## Pasul 0 — Ce s-a livrat în acest pachet

```
vercel.json                    Etapa 1 — Clean URLs + rutare pe subdomenii + security headers
account-system.js              Etapa 2 — înlocuiește complet fișierul vechi (sessionStorage → Supabase Auth real)
supabase/schema.sql            Toate tabelele necesare (profiles, comenzi, devize, KYC, GPS, CMR, comisioane...)
lib/supabaseClient.js          Client Supabase pentru browser (anon key)
lib/supabaseAdmin.js           Client Supabase pentru server (service_role key) — NU-l expune niciodată în browser
lib/auth-middleware.js         RBAC fail-closed, folosit de toate endpoint-urile /api
api/branding/get.js            Mutat corect în /api (Etapa 1 — fix bug deploy)
api/branding/upload.js         FIX CRITIC — fail-closed, cere autentificare admin reală
api/admin/invite-admin.js      Etapa 2.2 — invitare admini secundari
api/admin/assign-role.js       Etapa 2.3 — alocare roluri
api/auth/verify-otp.js         Etapa 3.2 — confirmare finală pas 2 înregistrare
api/deviz/calculate.js         Etapa 3.1 — motor deviz, formula din README
api/investitori/kyc.js         Etapa 3.3 — dosar KYC
api/investitori/exit.js        Etapa 3.4 — Buy-Back / Piață Secundară
api/partener/login-config.js   Etapa 4.1 — permisiuni/ecrane per rol
api/partener/accept-comanda.js Etapa 4.2 — alocare FIFO, sigură la concurență
api/partener/gps.js            Etapa 4.3 — geolocație live + citire ETA
api/partener/cmr-generare.js   Etapa 4.4 — CMR digital + validare documente
api/financiar/comision.js      Etapa 4.5 — calcul comision 12% + eliberare escrow
package.json                   + dependența @supabase/supabase-js
```

---

## Pasul 1 — Creează proiectul Supabase (15 min, manual)

1. Cont nou pe [supabase.com](https://supabase.com) → **New Project** (regiune Frankfurt, cea mai apropiată de România).
2. **SQL Editor** → copiază tot conținutul din `supabase/schema.sql` → Run.
3. **Authentication → Providers**:
   - Activează **Email** (deja activ implicit).
   - Activează **Phone** și conectează un provider SMS (Twilio e cel mai simplu) — necesar pentru OTP-ul din Etapa 3.2.
4. **Authentication → URL Configuration** → adaugă `https://mydarrin.homebestpal.com` și `https://admin.mydarrin.homebestpal.com` ca Redirect URLs.
5. **Project Settings → API** → notează:
   - `Project URL` → devine `SUPABASE_URL`
   - `anon public` key → devine `SUPABASE_ANON_KEY`
   - `service_role` key → devine `SUPABASE_SERVICE_ROLE_KEY` (**secret, nu-l pune niciodată în cod frontend**)

## Pasul 2 — Creează primul superadmin (manual, o singură dată)

Contul de superadmin nu se poate auto-crea prin `signUp()` din motive de securitate. În Supabase:
**Authentication → Users → Invite user** → introdu email-ul tău → după acceptare, în **SQL Editor**:
```sql
update auth.users
set raw_user_meta_data = raw_user_meta_data || '{"role":"superadmin","roles":["superadmin"]}'
where email = 'email-ul-tau@example.com';
```
De aici încolo, restul adminilor se invită din UI (`mydarrin-superadmin.html`), care apelează `/api/admin/invite-admin`.

## Pasul 3 — Configurează domeniile în Vercel (manual)

`vercel.json` conține regulile de rutare, dar **subdomeniile trebuie adăugate în Vercel Dashboard**:
`Project → Settings → Domains` → adaugă:
- `mydarrin.homebestpal.com`
- `admin.mydarrin.homebestpal.com`
- `api.mydarrin.homebestpal.com`

(fiecare cere un CNAME în DNS-ul `homebestpal.com` către `cname.vercel-dns.com`).

## Pasul 4 — Variabile de mediu în Vercel

`Project → Settings → Environment Variables`:

| Variabilă | Valoare | Notă |
|---|---|---|
| `SUPABASE_URL` | din Pasul 1 | |
| `SUPABASE_SERVICE_ROLE_KEY` | din Pasul 1 | **secret** |
| `ALLOWED_ORIGIN` | `https://mydarrin.homebestpal.com` | folosit de `upload.js` |

Pentru frontend (anon key), cel mai simplu e să injectezi `SUPABASE_URL`/`SUPABASE_ANON_KEY`
într-un `<script>` mic în fiecare pagină HTML înainte de `lib/supabaseClient.js` (ex. printr-un
build step simplu, sau hardcodat direct — anon key e public prin design, nu e secret).

## Pasul 5 — Integrează în repo-ul existent

1. Copiază folderele `api/` și `lib/`, plus `vercel.json`, `account-system.js`, `package.json`
   peste cele din `darrin_cloude`, suprascriind fișierele vechi.
2. În fiecare pagină HTML care folosea `account-system.js`, adaugă **înainte** de el:
   ```html
   <script type="module" src="/lib/supabaseClient.js"></script>
   ```
3. În `mydarrin-superadmin.html` și `mydarrin-backoffice-serviciu.html`, la începutul body-ului:
   ```html
   <script>
     window.MyDarrinAuth.enforceSuperadminBarrier(); // sau enforceAdminBarrier() pt backoffice
   </script>
   ```
4. `npm install` → `vercel deploy`.

## Pasul 6 — Ce rămâne de construit după acest pachet (nu e cod, e integrare de business)

- **Procesator de plăți real** pentru escrow (Stripe Connect / Netopia / EuPlătesc) — comisionul (Etapa 4.5) e calculat corect, dar transferul efectiv de bani cere un cont comercial real la un procesator, cu contract și KYB pentru My Darrin însuși.
- **Semnătură eIDAS calificată** pentru CMR — hash-ul SHA-256 implementat e un substitut tehnic minim, nu o semnătură eIDAS legal calificată (asta necesită un furnizor certificat, ex. certSIGN).
- **Storage pentru documente** (CI, licențe, cazier, KYC) — creează un bucket privat `documents` în Supabase Storage cu politici RLS `owner-only`, separat de schema SQL de mai sus.
- **Job/cron pentru expirarea alocărilor FIFO** — dacă un partener nu răspunde în X secunde, trebuie un job (Vercel Cron sau Supabase Edge Function) care marchează alocarea `expirat` și trece la următorul partener din listă.
- **Migrarea datelor existente**: nu există date reale de migrat (totul era în `sessionStorage`), deci nu e nevoie de un script de migrare — pornești curat.

## Ordinea recomandată de lucru

1. Pasul 1-2 (Supabase + superadmin) — poți testa autentificarea local.
2. Fix `upload.js` (deja inclus) — deployează-l separat, imediat, indiferent de restul, pentru că e vulnerabilitatea critică.
3. Etapa 2 (RBAC admin) — al doilea cel mai urgent, pentru că protejează restul.
4. Etapa 3 și 4 în paralel, pe măsură ce echipa mobile e pregătită să consume API-urile.
