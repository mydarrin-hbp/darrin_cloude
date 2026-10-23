-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (pasul 11-K, 22 oct. 2026)
-- Pitch deck-ul pe limbi (RO + EN), cu versiuni, note de verificare și media
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce face
--   1. pitch_deck_versiuni (azi 0 rânduri, verificat live 23 oct. 2026):
--      - limba ('ro' / 'en', not null, implicit 'ro'): deck-ul RO e pentru
--        limba română; deck-ul EN pentru toate celelalte limbi din selector
--        (en, bg, de, el, fr, tr) — cerința LM din 22 oct. 2026;
--      - titlu, sursa (ex. „Canva V1 22 oct. 2026”);
--      - disclaimer: eticheta de prognoză a versiunii, în limba ei
--        („Prognoză: cifrele sunt estimări și ținte, nu rezultate realizate.”),
--        afișată pe fiecare slide cu `prognoza: true`;
--      - note_verificare (jsonb, listă): notele `de_verificat` din fișierul
--        importat, fiecare cu `rezolvat`; aprobarea e refuzată de server cât
--        timp rămâne una nerezolvată (lib/pitch-deck.js);
--      - actualizat_de, actualizat_la;
--      - slide_uri și note_verificare trebuie să fie liste JSON.
--   2. Index unic parțial: cel mult o versiune aprobată pe limbă.
--   3. RLS activ, fără nicio politică și fără drepturi pentru anon /
--      authenticated: tabela nu se citește și nu se scrie din browser. Citirea
--      publică trece doar prin api/public/pitch-deck.js (service role), care
--      trimite numai versiunea aprobată.
--   4. backoffice_config: cheia `pitch_deck_vizibilitate` (secțiunea
--      `investitori`, tara_cod ALL, editabilă de superadmin), cu valorile
--      `public` (oricine vede deck-ul complet) sau `investitori_aprobati`
--      (deck-ul complet doar investitorilor cu KYC aprobat; ceilalți văd
--      rezumatul). Migrarea creează cheia cu `investitori_aprobati`, varianta
--      prudentă; valoarea finală o stabilește LM din back-office.
--   5. Bucket-ul `pitch-deck-media`: citire publică (imaginile versiunilor
--      viitoare și fotografiile echipei), 5 MB, image/webp, image/png,
--      image/jpeg. Nicio politică de scriere pentru anon / authenticated:
--      încărcarea se face doar prin adrese semnate emise de server
--      (api/admin/pitch-deck.js), pentru cei cu drept de scriere.
--
-- Ce NU face
--   Nu inserează niciun conținut de pitch deck: cele două JSON-uri v1
--   (docs/pitch-deck/) le importă LM din back-office, ca ciorne.
--   Nu șterge și nu modifică rânduri existente.
--
-- Siguranță
--   O singură tranzacție; rulabilă de mai multe ori (if not exists, drop ...
--   if exists, on conflict). Dacă cheia de vizibilitate există deja (schimbată
--   din panou), valoarea ei rămâne neatinsă.
--
-- Ordine de lansare: înaintea codului din branch-ul pitch-deck-11k. Fără
-- migrare, codul tratează lipsa coloanelor ca „Pitch deck în pregătire”.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 1. Coloanele noi ─────────────────────────────────────────────────
alter table public.pitch_deck_versiuni
  add column if not exists limba text not null default 'ro',
  add column if not exists titlu text,
  add column if not exists sursa text,
  add column if not exists disclaimer text,
  add column if not exists note_verificare jsonb not null default '[]'::jsonb,
  add column if not exists actualizat_de uuid references public.profiles(id),
  add column if not exists actualizat_la timestamptz not null default now();

alter table public.pitch_deck_versiuni drop constraint if exists pitch_deck_versiuni_limba_check;
alter table public.pitch_deck_versiuni
  add constraint pitch_deck_versiuni_limba_check check (limba in ('ro', 'en'));

alter table public.pitch_deck_versiuni drop constraint if exists pitch_deck_versiuni_slide_uri_lista;
alter table public.pitch_deck_versiuni
  add constraint pitch_deck_versiuni_slide_uri_lista check (jsonb_typeof(slide_uri) = 'array');

alter table public.pitch_deck_versiuni drop constraint if exists pitch_deck_versiuni_note_lista;
alter table public.pitch_deck_versiuni
  add constraint pitch_deck_versiuni_note_lista check (jsonb_typeof(note_verificare) = 'array');

-- ── 2. Cel mult o versiune aprobată pe limbă ─────────────────────────
create unique index if not exists pitch_deck_versiuni_o_aprobata_pe_limba
  on public.pitch_deck_versiuni (limba) where aprobat;

create index if not exists pitch_deck_versiuni_limba_creat
  on public.pitch_deck_versiuni (limba, creat_la desc);

-- ── 3. Fără acces din browser ────────────────────────────────────────
alter table public.pitch_deck_versiuni enable row level security;
revoke all on table public.pitch_deck_versiuni from anon, authenticated;
grant all on table public.pitch_deck_versiuni to service_role;

-- ── 4. Vizibilitatea (o stabilește LM) ───────────────────────────────
insert into public.backoffice_config (cheie, valoare, tip, sectiune, eticheta, descriere, unitate, editabil_de, tara_cod)
values
  ('pitch_deck_vizibilitate', 'investitori_aprobati', 'text', 'investitori',
   'Vizibilitatea pitch deck-ului',
   'public = oricine vede deck-ul complet; investitori_aprobati = deck-ul complet doar investitorilor cu verificarea identității aprobată, ceilalți văd rezumatul (titlul și slide-urile 1–3). Verificarea se face pe server (api/public/pitch-deck.js). Valoarea o stabilește LM; migrarea pornește cu varianta prudentă.',
   null, 'superadmin', 'ALL')
on conflict (cheie, tara_cod) do nothing;

-- ── 5. Bucket-ul pentru imaginile versiunilor viitoare ───────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pitch-deck-media', 'pitch-deck-media', true, 5242880,
        array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Scrierea doar prin server (adrese semnate, service role): nicio politică
-- de insert / update / delete pentru anon sau authenticated pe acest bucket.
drop policy if exists "pitch_deck_media_scriere" on storage.objects;
drop policy if exists "pitch_deck_media_actualizare" on storage.objects;
drop policy if exists "pitch_deck_media_stergere" on storage.objects;

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
declare
  v_lipsa text;
begin
  select string_agg(c, ', ') into v_lipsa
  from unnest(array['limba', 'titlu', 'sursa', 'disclaimer', 'note_verificare', 'actualizat_de', 'actualizat_la']) as c
  where not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'pitch_deck_versiuni' and column_name = c);
  if v_lipsa is not null then
    raise exception 'pitch_deck_versiuni: lipsesc coloanele %', v_lipsa;
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'pitch_deck_versiuni_o_aprobata_pe_limba') then
    raise exception 'Indexul unic pitch_deck_versiuni_o_aprobata_pe_limba lipsește';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.pitch_deck_versiuni'::regclass) then
    raise exception 'RLS nu e activ pe pitch_deck_versiuni';
  end if;
  if has_table_privilege('anon', 'public.pitch_deck_versiuni', 'SELECT')
     or has_table_privilege('authenticated', 'public.pitch_deck_versiuni', 'SELECT') then
    raise exception 'anon / authenticated încă pot citi pitch_deck_versiuni';
  end if;
  if not exists (select 1 from public.backoffice_config
                 where cheie = 'pitch_deck_vizibilitate' and tara_cod = 'ALL'
                   and valoare in ('public', 'investitori_aprobati')) then
    raise exception 'Cheia pitch_deck_vizibilitate (ALL) lipsește sau are o valoare nevalidă';
  end if;
  if not exists (select 1 from storage.buckets
                 where id = 'pitch-deck-media' and public = true and file_size_limit = 5242880) then
    raise exception 'Bucket-ul pitch-deck-media lipsește sau nu are setările cerute';
  end if;
end;
$$;

commit;

-- ═══ STAREA DUPĂ MIGRARE (doar citire) ═════════════════════════════
select limba, count(*) as versiuni, count(*) filter (where aprobat) as aprobate
from public.pitch_deck_versiuni group by limba order by limba;

select cheie, valoare, sectiune, editabil_de, tara_cod
from public.backoffice_config where cheie = 'pitch_deck_vizibilitate';

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'pitch-deck-media';
