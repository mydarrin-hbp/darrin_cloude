-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (pasul 11-S, 23 oct. 2026)
-- SEO pe limbă, previzualizări la partajare (OG) și campanii social media
-- ═══════════════════════════════════════════════════════════════════
--
-- Starea live (citită 23 oct. 2026, doar citire)
--   seo_config: id, page_path (UNIQUE seo_config_page_path_key), meta_title,
--   meta_description, canonical_url, updated_at, updated_by; 0 rânduri; RLS
--   activ cu politica „seo_config citire publica” (SELECT pentru oricine) și
--   toate drepturile pentru anon / authenticated.
--
-- Ce face
--   1. seo_config:
--      - limba ('ro' / 'en', not null, implicit 'ro'): o suprascriere pe pagină
--        ȘI pe limbă (înainte, titlul RO se aplica și vizitatorilor EN);
--      - cheia unică (page_path, limba) în locul celei pe page_path;
--      - coloanele OG: og_titlu, og_descriere, og_imagine_url (1,91:1),
--        og_imagine_alt, plus og_imagine_latime / og_imagine_inaltime (pentru
--        og:image:width / og:image:height, citite din imaginea încărcată);
--      - fără acces din browser: politica de citire publică se șterge, drepturile
--        anon / authenticated se retrag. Citirea trece doar prin
--        api/public/seo-config.js și middleware.js (service role).
--   2. seo_campanii_social (nouă): campaniile social media ale unei pagini, pe
--      limbă, cu platforme, texte, CTA, URL + UTM, media (jsonb), stare.
--      Unicitate (page_path, limba, nume_campanie). RLS activ, fără politici,
--      fără drepturi anon / authenticated (doar api/admin/seo-campanii.js).
--   3. Bucket-uri:
--      - seo-og (PUBLIC, 5 MB, jpeg / png / webp): doar imaginile OG ale
--        paginilor publice (roboții Facebook / LinkedIn trebuie să le poată citi);
--      - campanii-media (PRIVAT, 50 MB, jpeg / png / webp, mp4 / quicktime /
--        webm): materialele campaniilor; descărcare doar prin adresă semnată.
--      Nicio politică de scriere pentru anon / authenticated: încărcarea se face
--      prin adrese semnate emise de server, pentru cei cu drept de scriere.
--   4. backoffice_config: limitele de text ale campaniilor (secțiunea `seo`,
--      ALL, editabile de superadmin), orientative, DE CONFIRMAT DE LM:
--      Meta — titlu 40, text principal 125 (recomandat; maximul tehnic e mai
--      mare), descrierea linkului 30; TikTok — text 100. YouTube: fără limită
--      implicită până o confirmă LM. O valoare schimbată din panou rămâne.
--   5. Dreptul: secțiunea `seo` din admin_permissions (rând = citire,
--      poate_scrie = true = scriere), plus superadminul — verificat de server
--      (lib/permisiuni-seo.js). Migrarea nu acordă drepturi nimănui.
--
-- Ce NU face
--   Nu inserează niciun titlu, text de reclamă sau imagine: câmpurile pornesc
--   goale și le completează LM din back-office. Nu șterge rânduri.
--
-- Siguranță
--   O singură tranzacție; rulabilă de mai multe ori (if not exists, drop ...
--   if exists, on conflict).
--
-- Ordine de lansare: înaintea codului din branch-ul seo-social-campanii-11s.
-- Fără migrare, codul răspunde „aplicați migrarea” și paginile publice rămân
-- cu titlurile statice din fișier.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 1. seo_config: limba + OG ────────────────────────────────────────
alter table public.seo_config
  add column if not exists limba text not null default 'ro',
  add column if not exists og_titlu text,
  add column if not exists og_descriere text,
  add column if not exists og_imagine_url text,
  add column if not exists og_imagine_alt text,
  add column if not exists og_imagine_latime integer,
  add column if not exists og_imagine_inaltime integer;

alter table public.seo_config drop constraint if exists seo_config_limba_check;
alter table public.seo_config
  add constraint seo_config_limba_check check (limba in ('ro', 'en'));

alter table public.seo_config drop constraint if exists seo_config_page_path_key;
alter table public.seo_config drop constraint if exists seo_config_page_path_limba_key;
alter table public.seo_config
  add constraint seo_config_page_path_limba_key unique (page_path, limba);

alter table public.seo_config drop constraint if exists seo_config_og_imagine_dimensiuni;
alter table public.seo_config
  add constraint seo_config_og_imagine_dimensiuni check (
    (og_imagine_latime is null or og_imagine_latime > 0) and (og_imagine_inaltime is null or og_imagine_inaltime > 0));

alter table public.seo_config enable row level security;
drop policy if exists "seo_config citire publica" on public.seo_config;
revoke all on table public.seo_config from anon, authenticated;
grant all on table public.seo_config to service_role;

-- ── 2. seo_campanii_social ───────────────────────────────────────────
create table if not exists public.seo_campanii_social (
  id uuid primary key default gen_random_uuid(),
  page_path text not null,
  limba text not null default 'ro',
  nume_campanie text not null,
  platforme text[] not null default '{}',
  titlu_reclama text,
  text_principal text,
  descriere_link text,
  cta text,
  url_destinatie text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  media jsonb not null default '{}'::jsonb,
  stare text not null default 'ciorna',
  note_interne text,
  creat_de uuid references public.profiles(id),
  actualizat_de uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.seo_campanii_social drop constraint if exists seo_campanii_social_limba_check;
alter table public.seo_campanii_social
  add constraint seo_campanii_social_limba_check check (limba in ('ro', 'en'));

alter table public.seo_campanii_social drop constraint if exists seo_campanii_social_stare_check;
alter table public.seo_campanii_social
  add constraint seo_campanii_social_stare_check check (stare in ('ciorna', 'activa', 'arhivata'));

alter table public.seo_campanii_social drop constraint if exists seo_campanii_social_cta_check;
alter table public.seo_campanii_social
  add constraint seo_campanii_social_cta_check check (cta is null or cta in
    ('afla_mai_multe', 'inscrie_te', 'contacteaza_ne', 'programeaza', 'cere_oferta', 'cumpara', 'descarca'));

alter table public.seo_campanii_social drop constraint if exists seo_campanii_social_platforme_check;
alter table public.seo_campanii_social
  add constraint seo_campanii_social_platforme_check check (platforme <@ array
    ['facebook', 'instagram', 'tiktok', 'youtube', 'general_patrat', 'vertical_mobil']::text[]);

alter table public.seo_campanii_social drop constraint if exists seo_campanii_social_media_obiect;
alter table public.seo_campanii_social
  add constraint seo_campanii_social_media_obiect check (jsonb_typeof(media) = 'object');

alter table public.seo_campanii_social drop constraint if exists seo_campanii_social_nume_check;
alter table public.seo_campanii_social
  add constraint seo_campanii_social_nume_check check (length(btrim(nume_campanie)) > 0);

alter table public.seo_campanii_social drop constraint if exists seo_campanii_social_unic;
alter table public.seo_campanii_social
  add constraint seo_campanii_social_unic unique (page_path, limba, nume_campanie);

create index if not exists seo_campanii_social_pagina
  on public.seo_campanii_social (page_path, limba, updated_at desc);

alter table public.seo_campanii_social enable row level security;
revoke all on table public.seo_campanii_social from anon, authenticated;
grant all on table public.seo_campanii_social to service_role;

-- ── 3. Bucket-urile ──────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('seo-og', 'seo-og', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campanii-media', 'campanii-media', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Scrierea doar prin server (adrese semnate, service role).
drop policy if exists "seo_og_scriere" on storage.objects;
drop policy if exists "campanii_media_scriere" on storage.objects;
drop policy if exists "campanii_media_citire" on storage.objects;

-- ── 4. Limitele de text (orientative, de confirmat de LM) ────────────
insert into public.backoffice_config (cheie, valoare, tip, sectiune, eticheta, descriere, unitate, editabil_de, tara_cod)
values
  ('campanii_limite_meta_titlu', '40', 'number', 'seo', 'Campanii: titlul reclamei (Meta)',
   'Facebook / Instagram — lungimea maximă a titlului, verificată de server. Orientativ, de confirmat de LM.', 'caractere', 'superadmin', 'ALL'),
  ('campanii_limite_meta_text', '125', 'number', 'seo', 'Campanii: textul principal (Meta)',
   'Facebook / Instagram — lungimea recomandată a textului principal (maximul tehnic e mai mare). Orientativ, de confirmat de LM.', 'caractere', 'superadmin', 'ALL'),
  ('campanii_limite_meta_descriere', '30', 'number', 'seo', 'Campanii: descrierea linkului (Meta)',
   'Facebook / Instagram — lungimea maximă a descrierii linkului. Orientativ, de confirmat de LM.', 'caractere', 'superadmin', 'ALL'),
  ('campanii_limite_tiktok_text', '100', 'number', 'seo', 'Campanii: textul reclamei (TikTok)',
   'TikTok — lungimea maximă a textului reclamei. Orientativ, de confirmat de LM.', 'caractere', 'superadmin', 'ALL')
on conflict (cheie, tara_cod) do nothing;

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
declare
  v_lipsa text;
begin
  select string_agg(c, ', ') into v_lipsa
  from unnest(array['limba', 'og_titlu', 'og_descriere', 'og_imagine_url', 'og_imagine_alt', 'og_imagine_latime', 'og_imagine_inaltime']) as c
  where not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'seo_config' and column_name = c);
  if v_lipsa is not null then
    raise exception 'seo_config: lipsesc coloanele %', v_lipsa;
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.seo_config'::regclass and conname = 'seo_config_page_path_key') then
    raise exception 'seo_config: cheia unică veche pe page_path încă există';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.seo_config'::regclass and conname = 'seo_config_page_path_limba_key') then
    raise exception 'seo_config: lipsește cheia unică (page_path, limba)';
  end if;
  if to_regclass('public.seo_campanii_social') is null then
    raise exception 'Tabela seo_campanii_social lipsește';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.seo_config'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.seo_campanii_social'::regclass) then
    raise exception 'RLS nu e activ pe seo_config / seo_campanii_social';
  end if;
  if has_table_privilege('anon', 'public.seo_config', 'SELECT')
     or has_table_privilege('authenticated', 'public.seo_config', 'SELECT')
     or has_table_privilege('anon', 'public.seo_campanii_social', 'SELECT')
     or has_table_privilege('authenticated', 'public.seo_campanii_social', 'SELECT') then
    raise exception 'anon / authenticated încă pot citi seo_config / seo_campanii_social';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('seo_config', 'seo_campanii_social')) then
    raise exception 'Au rămas politici RLS pe seo_config / seo_campanii_social';
  end if;
  if not exists (select 1 from storage.buckets where id = 'seo-og' and public = true and file_size_limit = 5242880) then
    raise exception 'Bucket-ul seo-og lipsește sau nu are setările cerute';
  end if;
  if not exists (select 1 from storage.buckets where id = 'campanii-media' and public = false and file_size_limit = 52428800) then
    raise exception 'Bucket-ul campanii-media lipsește sau nu are setările cerute';
  end if;
  if (select count(*) from public.backoffice_config where cheie like 'campanii_limite_%' and tara_cod = 'ALL') < 4 then
    raise exception 'Lipsesc limitele campanii_limite_* din backoffice_config';
  end if;
end;
$$;

commit;

-- ═══ STAREA DUPĂ MIGRARE (doar citire) ═════════════════════════════
select limba, count(*) as suprascrieri from public.seo_config group by limba order by limba;

select limba, stare, count(*) as campanii from public.seo_campanii_social group by limba, stare order by limba, stare;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id in ('seo-og', 'campanii-media') order by id;

select cheie, valoare, sectiune, editabil_de, tara_cod
from public.backoffice_config where cheie like 'campanii_limite_%' order by cheie;
