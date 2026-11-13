# Pasul 11-A3: bannerul de cookie-uri cu categoria „Marketing” și pornirea pixelilor

Macheta aprobată de LM pe 13 nov. 2026. Aspectul bannerului (culori, dimensiuni, poziție) rămâne cel de la 11-A1; s-au schimbat doar textele, categoria nouă și ordinea butoanelor pe telefon.

## 1. Bannerul (`cookie-consent.js`)
- **Bara de jos:** textul aprobat, în RO și EN, după limba paginii. Pe telefon (sub 640 px) apare textul scurt.
- **Butoanele:**
  - pe desktop, ordinea de azi: Doar esențiale · Personalizează · Acceptă toate;
  - pe telefon, pe verticală: **Acceptă toate**, Personalizează, Doar esențiale, fiecare de cel puțin 44 px.
- **Panoul „Setări cookie-uri”:**
  - rândurile Esențiale (comutator blocat), Analitice și Marketing, cu eticheta „NOU” / „NEW” până pe 12 ian. 2027 (60 de zile de la 13 nov. 2026);
  - butoanele „Salvează alegerea” și „Acceptă toate”; Escape închide panoul.
- **Înălțimea pe telefon:** cu trei butoane pe verticală, limita barei a crescut de la 30% la 50% din ecran. În practică bara ocupă ~29% pe un ecran de 390 × 844.
- **Traducerea:** textele sunt în fișier, în RO și EN, ca la `ui-feedback.js`. Bannerul are `data-i18n-skip`, ca să nu fie retradus pe bucăți.

## 2. Regulile
1. **Marketing** e oprit implicit. Pornește doar la „Acceptă toate” sau din comutator.
2. **„Doar esențiale”** oprește analitice și marketing.
3. **Acordul** se păstrează în `myd_cookie_consent_v1` = `{ analitice, marketing, data, versiune: 2 }`.
   - Cine are `versiune: 1` vede bannerul din nou până alege.
   - Până atunci, analiticele rămân cum le-a ales, iar marketingul rămâne oprit.
   - După alegere, bannerul nu mai apare.
4. **Linkul „Setări cookie-uri” / „Cookie settings”** redeschide panoul:
   - e în subsolul comun, după „Confidențialitate & GDPR”, pe 30 de pagini;
   - pe cele 11 pagini fără subsol (coș, wizard, panouri de cont, resetarea parolei etc.), `cookie-consent.js` adaugă un rând discret la final.
5. **Retragerea acordului** oprește pixelii fără reîncărcare:
   - Meta primește `fbq('consent', 'revoke')`, TikTok `ttq.revokeConsent()`, iar `masurare.js` nu le mai trimite niciun eveniment.
   - Cookie-urile pixelilor din domeniul nostru (`_fbp`, `_fbc`, `_ttp`, `ttclid`, `ttcsid*`, `li_fat_id`, `li_giant` etc.) se șterg imediat și încă o dată după 1,5 s.
   - La pagina următoare, scripturile nu se mai încarcă.
   - LinkedIn nu are o funcție de retragere: nu mai primește nimic de la noi.

## 3. Pixelii (`masurare.js`)
- **Când pornesc:** doar dacă sunt îndeplinite amândouă:
  - `MYD_CONSENT.marketingAllowed()` (acord versiunea 2 cu `marketing: true`);
  - un ID setat în Vercel (`META_PIXEL_ID`, `TIKTOK_PIXEL_ID`, `LINKEDIN_PARTNER_ID`), citit prin `/api/public/config-masurare`.
- **Ce primesc:** doar numele evenimentului și o categorie (`content_category`, de exemplu `courier`).
  - Fără advanced matching, fără email, telefon, nume sau sursa UTM.
  - Corespondența evenimentelor e în `docs/audit-masurare-11a1.md`, secțiunea 4.
- **Doar marketing, fără analitice:** pixelii primesc evenimentele, GA4 nu se încarcă, iar sursa UTM nu se păstrează.
- **Evenimentele de dinaintea pornirii:** cele trimise înainte să sosească configurația așteaptă într-o coadă. Evenimentele paginii trimise înainte de acordul de marketing (doar la GA4) ajung și la pixeli când aceștia pornesc.

## 4. CSP (`vercel.json`), doar domeniile din `docs/audit-masurare-11a1.md`

| Rețea | `script-src` | `connect-src` |
|---|---|---|
| Meta | `https://connect.facebook.net` | `https://www.facebook.com https://connect.facebook.net` |
| TikTok | `https://analytics.tiktok.com` | `https://analytics.tiktok.com` |
| LinkedIn | `https://snap.licdn.com` | `https://px.ads.linkedin.com` |

`img-src` permitea deja `https:`, deci nu s-a schimbat.

## 5. Politica de confidențialitate: paragrafele noi
Textul juridic final îl verifică LM cu un jurist. Paragrafele noi sunt:

| Articol | Paragraful nou (RO) |
|---|---|
| Antet | „Ultima actualizare: 13 noiembrie 2026” (înainte: 10 iulie 2026) |
| Art. 2 | „Cookie-uri de marketing, doar cu acordul dumneavoastră (detalii în Art. 7).” |
| Art. 3, tabel | rândul „Măsurarea reclamelor (cookie-uri de marketing) · Art. 6(1)(a) — consimțământ · Retragibil oricând, din „Setări cookie-uri”” |
| Art. 4 | „Cookie-uri de marketing: între 7 zile și 13 luni, după furnizor (detalii în Art. 7).” |
| Art. 5 | „Meta Platforms Ireland Ltd., TikTok Technology Limited, LinkedIn Ireland Unlimited Company — măsurarea reclamelor, doar dacă ați acceptat cookie-urile de marketing (Art. 7). Nu le transmitem numele, emailul sau telefonul dumneavoastră.” |
| Art. 6 | „Meta, TikTok și LinkedIn (folosiți doar cu consimțământul dumneavoastră pentru cookie-urile de marketing, Art. 7) pot procesa date în afara SEE, pe baza mecanismelor de mai sus, conform propriilor politici de confidențialitate.” |
| Art. 7 | subtitlul „Cookie-uri de marketing (cu consimțământ)” și paragraful despre scop |
| Art. 7 | lista furnizorilor, cu cookie-urile și duratele (Meta, TikTok, LinkedIn) |
| Art. 7 | „Duratele sunt cele publicate de fiecare furnizor…” |
| Art. 7 | „Vă puteți retrage oricând acordul… din linkul „Setări cookie-uri” din subsolul fiecărei pagini…” |

Traducerile EN sunt în `i18n/en/mydarrin-politica-confidentialitate.json`.

### De unde vin duratele (verificate pe 13 nov. 2026)
- **TikTok:** [About using cookies with TikTok Pixel](https://ads.tiktok.com/help/article/using-cookies-with-tiktok-pixel) (actualizat în iulie 2025). `_ttp`, `ttclid` și `ttcsid`: „13 months from the last date it was used”.
- **LinkedIn:** [LinkedIn Cookie Table](https://www.linkedin.com/legal/l/cookie-table) (actualizat pe 26 aug. 2026):
  - `li_fat_id` 30 de zile, `li_giant` 7 zile;
  - pe linkedin.com: `bcookie` 1 an, `lidc` 24 de ore, `UserMatchHistory` și `AnalyticsSyncHistory` 30 de zile, `li_sugr` 90 de zile.
- **Meta:** politica de cookie-uri ([facebook.com/privacy/policies/cookies](https://www.facebook.com/privacy/policies/cookies/)) nu afișează durata în textul paginii.
  - Documentația Meta pentru dezvoltatori ([fbp și fbc](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc)) recomandă 90 de zile pentru `_fbc`.
  - De aceea politica spune „până la 90 de zile”. **De confirmat de jurist.**

## 6. Verificarea pixelului Meta în producție (după merge, pașii pentru LM)
`META_PIXEL_ID` e setat de LM în Vercel (Production).
1. **Fereastră privată**, la `https://mydarrin.homebestpal.com/cum-devii-curier-de-cartier`. Apare bannerul.
2. **Verificare:** DevTools → Network, filtru `facebook`. Nu trebuie să apară nicio cerere.
3. **„Personalizează”**, apoi pornește doar „Analitice” → „Salvează alegerea”. În Network tot nu trebuie să apară `facebook`.
4. **Pornirea pixelului:** subsol → „Setări cookie-uri”, pornește „Marketing” → „Salvează alegerea”. În Network trebuie să apară:
   - `connect.facebook.net/en_US/fbevents.js`;
   - o cerere `www.facebook.com/tr/?id=<ID>&ev=PageView`;
   - o cerere `ev=ViewContent`.
5. **Confirmarea în Meta:** Events Manager → pixelul → „Test events” (sau extensia Meta Pixel Helper) arată `PageView` de pe domeniu.
6. **Oprirea:** „Setări cookie-uri” → oprește „Marketing” → „Salvează alegerea”. Apoi verifică:
   - la pagina următoare nu mai apare nicio cerere `facebook`;
   - în Application → Cookies, `_fbp` și `_fbc` nu mai există.

Verificarea automată se face cu `node scripts/test-banner-marketing.js` (local, cererile interceptate).
