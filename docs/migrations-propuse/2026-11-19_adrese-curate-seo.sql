-- docs/migrations-propuse/2026-11-19_adrese-curate-seo.sql
-- Pasul 12-U1 (19 nov. 2026): datele SEO și campaniile salvate pe adresele vechi
-- trec pe adresele curate (lib/adrese-curate.js, lib/seo-pagini.js → ALIASURI).
--
-- Ce face:
--   1. public.seo_config.page_path și public.seo_campanii_social.page_path:
--      adresa veche → adresa nouă (ex. /partener, /cum-devii-partenerul-nostru → /parteneri);
--   2. canonical_url (seo_config) și url_destinatie (campanii): calea veche din
--      linkul absolut https://mydarrin.homebestpal.com/<cale> → calea nouă,
--      cu parametrii și ancora păstrate;
--   3. când două rânduri ajung pe aceeași cheie unică — (page_path, limba) la
--      seo_config, (page_path, limba, nume_campanie) la campanii —, rămâne cel
--      actualizat cel mai recent; celelalte se copiază întâi în
--      public.seo_arhiva_adrese_12u1 (rândul întreg, în jsonb), apoi se șterg.
--      Nimic nu se pierde: un rând arhivat se poate pune înapoi din panoul SEO.
--
-- Live (citire, 19 nov. 2026): seo_config are 11 rânduri; se mută
--   /partener (ro) și /cum-devii-partenerul-nostru (ro, en) → /parteneri
--     (ro: două rânduri pe aceeași cheie → rămâne cel din 14 nov., /partener din 31 oct. se arhivează);
--   /investitor (ro, en) → /investitori;
--   /mydarrin-catalog (ro, en) și /mydarrin-serviciu (ro, en) → /catalog
--     (rămân cele /mydarrin-catalog, mai noi; /mydarrin-serviciu se arhivează);
--   / (ro, en) rămâne neschimbat.
-- seo_campanii_social: 2 rânduri pe /partener (ro, en) → /parteneri, url_destinatie gol.
--
-- Se rulează de LM în SQL Editor ÎNAINTE de publicarea codului 12-U1 (merge).
-- Între migrare și publicare, codul vechi caută datele pe adresele vechi: ca
-- pauza să fie scurtă, migrarea se rulează chiar înainte de merge.
-- Rulabilă de mai multe ori: a doua rulare nu mai găsește nimic de mutat.
-- Fără funcții noi; tabelul de arhivă are RLS activ, fără politici (doar service_role).

begin;

create table if not exists public.seo_arhiva_adrese_12u1 (
  id bigint generated always as identity primary key,
  arhivat_la timestamptz not null default now(),
  tabel text not null check (tabel in ('seo_config', 'seo_campanii_social')),
  cale_veche text not null,
  cale_noua text not null,
  rand jsonb not null
);
alter table public.seo_arhiva_adrese_12u1 enable row level security;
revoke all on public.seo_arhiva_adrese_12u1 from anon, authenticated;

-- Harta adreselor: aceeași listă ca lib/seo-pagini.js → ALIASURI
-- (verificată de scripts/test-migrare-adrese-curate-seo.js).
create temp table if not exists _harta_12u1 (veche text primary key, noua text not null) on commit drop;
truncate _harta_12u1;
insert into _harta_12u1 (veche, noua) values
  ('/asigurator', '/parteneri/asigurari'),
  ('/cum-comanzi', '/ajutor/cum-comand'),
  ('/cum-devii-curier-de-cartier', '/parteneri/curieri'),
  ('/cum-devii-furnizor-materiale', '/parteneri/materiale'),
  ('/cum-devii-furnizor-servicii', '/parteneri/servicii'),
  ('/cum-devii-operator-inchirieri', '/parteneri/inchirieri'),
  ('/cum-devii-partenerul-nostru', '/parteneri'),
  ('/cum-platesc', '/ajutor/cum-platesc'),
  ('/cum-prestam-livram', '/ajutor/livrare'),
  ('/cum-programez-serviciu', '/ajutor/programare'),
  ('/curier-cartier', '/parteneri/curieri'),
  ('/despre-noi', '/despre'),
  ('/garantii-si-asigurari', '/garantii'),
  ('/ghidul-asiguratorului', '/parteneri/asigurari'),
  ('/intrebari-frecvente-clienti', '/intrebari'),
  ('/intrebari-frecvente-parteneri', '/parteneri/intrebari'),
  ('/investitor', '/investitori'),
  ('/mydarrin-catalog', '/catalog'),
  ('/mydarrin-categorie-inchirieri', '/inchirieri'),
  ('/mydarrin-categorie-materiale', '/materiale'),
  ('/mydarrin-categorie-servicii', '/servicii'),
  ('/mydarrin-contact', '/contact'),
  ('/mydarrin-creeaza-deviz', '/deviz'),
  ('/mydarrin-cum-functioneaza', '/ajutor'),
  ('/mydarrin-dashboard-client', '/cont/comenzi'),
  ('/mydarrin-dashboard-partener', '/cont/partener'),
  ('/mydarrin-devino-partener', '/parteneri'),
  ('/mydarrin-inscriere-partener', '/parteneri/inscriere'),
  ('/mydarrin-investitori', '/investitori'),
  ('/mydarrin-panou-investitor', '/cont/investitor'),
  ('/mydarrin-politica-confidentialitate', '/confidentialitate'),
  ('/mydarrin-rolurile-mele', '/cont/roluri'),
  ('/mydarrin-serviciu', '/catalog'),
  ('/mydarrin-termeni', '/termeni'),
  ('/partener', '/parteneri'),
  ('/servicii-urgente', '/urgente');

-- ── seo_config ──────────────────────────────────────────────────────────
-- Rândurile atinse: cele de pe o adresă veche și cele aflate deja pe o adresă nouă din hartă.
create temp table if not exists _seo_rang_12u1 (id uuid primary key, cale text, tinta text, rn int) on commit drop;
truncate _seo_rang_12u1;
insert into _seo_rang_12u1 (id, cale, tinta, rn)
select id, page_path, tinta,
       row_number() over (partition by tinta, limba order by updated_at desc nulls last, (page_path = tinta) desc, id) as rn
from (
  select s.id, s.page_path, s.limba, s.updated_at, coalesce(h.noua, s.page_path) as tinta
  from public.seo_config s
  left join _harta_12u1 h on h.veche = s.page_path
  where h.veche is not null or s.page_path in (select noua from _harta_12u1)
) c;

insert into public.seo_arhiva_adrese_12u1 (tabel, cale_veche, cale_noua, rand)
select 'seo_config', r.cale, r.tinta, to_jsonb(s)
from _seo_rang_12u1 r join public.seo_config s on s.id = r.id
where r.rn > 1;
delete from public.seo_config where id in (select id from _seo_rang_12u1 where rn > 1);

update public.seo_config s set page_path = h.noua
from _harta_12u1 h where s.page_path = h.veche;

-- canonical_url: https://mydarrin.homebestpal.com/<cale veche>[?…|#…] → <cale nouă>
update public.seo_config s
set canonical_url = regexp_replace(s.canonical_url, '^(https://mydarrin\.homebestpal\.com)' || h.veche || '(?=[?#]|$)', '\1' || h.noua)
from _harta_12u1 h
where s.canonical_url ~ ('^https://mydarrin\.homebestpal\.com' || h.veche || '([?#]|$)');

-- ── seo_campanii_social ─────────────────────────────────────────────────
create temp table if not exists _camp_rang_12u1 (id uuid primary key, cale text, tinta text, rn int) on commit drop;
truncate _camp_rang_12u1;
insert into _camp_rang_12u1 (id, cale, tinta, rn)
select id, page_path, tinta,
       row_number() over (partition by tinta, limba, nume_campanie order by updated_at desc nulls last, (page_path = tinta) desc, id) as rn
from (
  select c.id, c.page_path, c.limba, c.nume_campanie, c.updated_at, coalesce(h.noua, c.page_path) as tinta
  from public.seo_campanii_social c
  left join _harta_12u1 h on h.veche = c.page_path
  where h.veche is not null or c.page_path in (select noua from _harta_12u1)
) x;

insert into public.seo_arhiva_adrese_12u1 (tabel, cale_veche, cale_noua, rand)
select 'seo_campanii_social', r.cale, r.tinta, to_jsonb(c)
from _camp_rang_12u1 r join public.seo_campanii_social c on c.id = r.id
where r.rn > 1;
delete from public.seo_campanii_social where id in (select id from _camp_rang_12u1 where rn > 1);

update public.seo_campanii_social c set page_path = h.noua
from _harta_12u1 h where c.page_path = h.veche;

update public.seo_campanii_social c
set url_destinatie = regexp_replace(c.url_destinatie, '^(https://mydarrin\.homebestpal\.com)' || h.veche || '(?=[?#]|$)', '\1' || h.noua)
from _harta_12u1 h
where c.url_destinatie ~ ('^https://mydarrin\.homebestpal\.com' || h.veche || '([?#]|$)');

-- ── Verificare ──────────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from public.seo_config where page_path in (select veche from _harta_12u1);
  if n > 0 then raise exception 'seo_config: % rânduri au rămas pe adrese vechi', n; end if;
  select count(*) into n from public.seo_campanii_social where page_path in (select veche from _harta_12u1);
  if n > 0 then raise exception 'seo_campanii_social: % rânduri au rămas pe adrese vechi', n; end if;
  select count(*) into n from public.seo_config s join _harta_12u1 h
    on s.canonical_url ~ ('^https://mydarrin\.homebestpal\.com' || h.veche || '([?#]|$)');
  if n > 0 then raise exception 'seo_config: % adrese canonice vechi', n; end if;
  select count(*) into n from public.seo_campanii_social c join _harta_12u1 h
    on c.url_destinatie ~ ('^https://mydarrin\.homebestpal\.com' || h.veche || '([?#]|$)');
  if n > 0 then raise exception 'seo_campanii_social: % linkuri de destinație vechi', n; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.seo_config'::regclass and conname = 'seo_config_page_path_limba_key') then
    raise exception 'seo_config: lipsește cheia unică (page_path, limba)';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.seo_arhiva_adrese_12u1'::regclass) then
    raise exception 'seo_arhiva_adrese_12u1: RLS inactiv';
  end if;
  if has_table_privilege('anon', 'public.seo_arhiva_adrese_12u1', 'select') or has_table_privilege('authenticated', 'public.seo_arhiva_adrese_12u1', 'select') then
    raise exception 'seo_arhiva_adrese_12u1: anon / authenticated au acces';
  end if;
  raise notice '12-U1: adresele SEO sunt pe adresele curate';
end $$;

commit;
