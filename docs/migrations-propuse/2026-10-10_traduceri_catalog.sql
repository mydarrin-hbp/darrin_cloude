-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (10 octombrie 2026)
-- Catalog: traducerile conținutului afișat public (platforma în engleză)
-- ═══════════════════════════════════════════════════════════════════
--
-- Problema
--   Decizie LM (9 oct. 2026): platforma publică se deschide în engleză.
--   Textele din HTML și din scripturi se traduc din /i18n, dar conținutul
--   de catalog vine din baza de date, doar în română:
--     catalog_servicii  226 rânduri publice — titlu, domeniu (56 distincte),
--                       descriere (18), etape_lucrare (1),
--                       instructiuni_intretinere (1);
--     catalog_niveluri  635 rânduri — label (619), descriere (635);
--     categorii         81 rânduri — title, description.
--   (numărate 10 oct. 2026 prin REST, cheia anon)
--
-- Ce adaugă
--   Coloana `traduceri jsonb not null default '{}'` pe cele trei tabele,
--   cu forma { "<limba>": { "<coloană>": "text tradus" } }, de exemplu
--     { "en": { "titlu": "Light bulb & fitting replacement",
--               "descriere": "..." } }.
--   Fără coloane noi pe limbă: o limbă nouă (de, fr, tr, bg, el) e doar o
--   cheie nouă în același jsonb. Româna rămâne în coloanele existente
--   (sursa și rezerva). Un check impune ca valoarea să fie obiect.
--   Fără RLS nou: rândurile sunt deja publice pentru citire; traducerile
--   se scriu doar din back-office / SQL Editor (service role).
--
-- Cine o citește
--   /api/public/traduceri-catalog?lang=en (service role) întoarce
--   { _texte: { "<text român>": "<traducere>" } }; i18n-loader.js îl aplică
--   peste orice text din pagină care se potrivește — titluri de servicii,
--   niveluri, categorii, oriunde apar (catalog, produs, marketplace, coș,
--   checkout). Fără coloana asta, endpoint-ul întoarce un dicționar gol
--   (paginile rămân pe textul român), deci codul poate fi publicat și
--   înainte; traducerea catalogului apare imediat după aplicare.
--
-- După aplicare
--   rulează scripts/traduceri-catalog-en.sql (completează traduceri.en),
--   după verificarea textelor de către LM.
--
-- Rulabil de mai multe ori fără erori.
-- ═══════════════════════════════════════════════════════════════════

begin;

alter table public.catalog_servicii add column if not exists traduceri jsonb not null default '{}'::jsonb;
alter table public.catalog_niveluri add column if not exists traduceri jsonb not null default '{}'::jsonb;
alter table public.categorii        add column if not exists traduceri jsonb not null default '{}'::jsonb;

alter table public.catalog_servicii drop constraint if exists catalog_servicii_traduceri_obiect_check;
alter table public.catalog_servicii add  constraint catalog_servicii_traduceri_obiect_check check (jsonb_typeof(traduceri) = 'object');
alter table public.catalog_niveluri drop constraint if exists catalog_niveluri_traduceri_obiect_check;
alter table public.catalog_niveluri add  constraint catalog_niveluri_traduceri_obiect_check check (jsonb_typeof(traduceri) = 'object');
alter table public.categorii        drop constraint if exists categorii_traduceri_obiect_check;
alter table public.categorii        add  constraint categorii_traduceri_obiect_check check (jsonb_typeof(traduceri) = 'object');

comment on column public.catalog_servicii.traduceri is 'Traduceri afișate public: { "<limba>": { "<coloană>": "text" } }. Româna rămâne în coloanele existente.';
comment on column public.catalog_niveluri.traduceri is 'Traduceri afișate public: { "<limba>": { "label": "...", "descriere": "..." } }.';
comment on column public.categorii.traduceri        is 'Traduceri afișate public: { "<limba>": { "title": "...", "description": "..." } }.';

-- Verificare
do $$
declare
  lipsa text;
begin
  select string_agg(t, ', ') into lipsa
  from unnest(array['catalog_servicii','catalog_niveluri','categorii']) t
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = t and column_name = 'traduceri' and data_type = 'jsonb'
  );
  if lipsa is not null then
    raise exception 'Coloana traduceri (jsonb) lipsește pe: %', lipsa;
  end if;
  if (select count(*) from pg_constraint where conname in (
        'catalog_servicii_traduceri_obiect_check',
        'catalog_niveluri_traduceri_obiect_check',
        'categorii_traduceri_obiect_check')) <> 3 then
    raise exception 'Lipsesc constrângerile *_traduceri_obiect_check';
  end if;
end $$;

commit;
