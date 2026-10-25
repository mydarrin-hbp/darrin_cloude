# Pasul 11-S — SEO pe limbă, partajare (OG) și campanii social media (23 oct. 2026)

Notă tehnică a pasului: ce face, ce **nu** face și ce rămâne de confirmat de LM.

## Ce nu face pasul (punctul 2.7)
- **Nu publică reclame** și nu se leagă de conturile de reclame (Meta Ads Manager, TikTok Ads, Google Ads). Nu există niciun token sau API al acestor platforme în cod.
- Campaniile doar **pregătesc și păstrează** materialele: LM le descarcă din „Exportă materialele” (arhivă `.zip` cu `texte.txt` și fișierele) și le încarcă manual în platformele de reclame.
- Starea „Activă” înseamnă „gata de încărcat manual”, nu „publicată”.
- Nu procesează video: nici în browser, nici pe server (fără comprimare, fără conversie, fără miniaturi generate). Un video prea mare primește mesajul „Exportați din nou la …”.
- Paginile publice se schimbă doar prin:
  - titlul / descrierea / URL-ul canonic pe limbă, aplicate în browser de `seo-meta.js` (2.2);
  - etichetele `og:` / `twitter:` scrise de `middleware.js` **doar pentru roboții de previzualizare**, doar pe paginile din `PAGINI_PUBLICE` (2.3). Vizitatorii obișnuiți primesc exact aceeași pagină ca înainte, fără nicio cerere în plus.
- Nu se scrie nimic în Supabase din cod; migrarea e propusă în `docs/migrations-propuse/2026-10-23_seo_social_campanii.sql`.
- Nu se completează niciun titlu, text de reclamă sau imagine în locul lui LM: câmpurile pornesc goale.

## Alegeri tehnice
- **Exportul `.zip` se face în browser**, din adresele semnate de 10 minute întoarse de `GET /api/admin/seo-campanii?export=1&id=…`. Motiv: un răspuns al unei funcții Vercel are cel mult 4,5 MB, iar un videoclip are până la 50 MB. Fișierele se descarcă direct din Storage, nu prin Vercel; arhiva e „stored” (fără comprimare — materialele sunt deja comprimate).
- **Încărcarea** merge direct din browser în Storage (`campanii-media` privat, `seo-og` public), pe adresă semnată. Serverul verifică după încărcare **conținutul** (primii 64 de octeți, cerere `Range`), **mărimea reală** și **calea** (`<pagina>/<limba>/<id>/<tip>.<ext>`); un fișier necorespunzător se șterge.
- Imaginea OG primește un nume nou la fiecare încărcare (`og-<aleator>.<ext>`): Facebook și LinkedIn țin imaginea în cache după adresă.
- Duplicarea unei campanii nu copiază materialele (pot conține text în limba sursei, iar ștergerea unui fișier comun ar strica cealaltă campanie).
- `seo_config` pierde politica de citire publică și drepturile `anon` / `authenticated`: citirea trece doar prin server (service role).
- Dreptul pe secțiunea `seo` (`admin_permissions`): rând = citire, `poate_scrie = true` = scriere; superadminul are tot. În panoul „Permisiuni RBAC”, căsuța „SEO, partajare (OG) și campanii social media” acordă scrierea; debifată, rândul se șterge (nu rămâne o citire implicită). Pagina `mydarrin-superadmin.html` rămâne deschisă doar contului unic autorizat (middleware), deci un admin `seo` poate folosi azi doar API-ul.

## De confirmat de LM
- Limitele de text (orientative, din `backoffice_config`, editabile de superadmin):
  - Meta (Facebook / Instagram): titlu **40**, text principal **125** (recomandat; maximul tehnic al Meta e mai mare), descrierea linkului **30**;
  - TikTok: text **100**;
  - YouTube: **fără limită implicită** până la confirmare.
- Serverul refuză textele peste limită pentru platformele bifate; dacă LM vrea doar avertisment (fără refuz) la textul principal Meta, se schimbă o regulă în `lib/seo-campanii.js`.
- Miniatura video acceptă 16:9 (≥ 1280 × 720) sau 9:16 (≥ 720 × 1280) — cerința nu preciza raportul.
- Domeniul permis pentru linkul de destinație: doar `mydarrin.homebestpal.com` (nu `admin.*`).
