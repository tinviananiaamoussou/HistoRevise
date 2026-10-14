-- =====================================================================
-- HistoRévise — Atlas (Phase 5) — SCRIPT SQL COMPLET, À RELIRE AVANT EXÉCUTION
--
-- Non destructif : uniquement des créations ("if not exists" / "or replace").
-- Aucune table, donnée, fonction ou policy existante (Coffre-fort, Chat, QCM,
-- Suivi) n'est lue, modifiée ou supprimée. Les seuls "drop policy if exists"
-- visent des policies portant les noms atlas_* créées par CE script (pour pouvoir
-- le relancer sans erreur).
--
-- Qui peut quoi (résumé) :
--   atlas_organs      : LIRE = tout le monde. Écrire = personne (hors admin Supabase).
--   atlas_sections    : LIRE = tout le monde. Écrire = UNIQUEMENT via les fonctions
--                       atlas_add_section / atlas_delete_section, qui exigent le code
--                       d'ajout (secret Vault `atlas_contributor_code`).
--   atlas_audit_log   : personne côté app (lecture réservée à l'admin Supabase).
--   bucket `atlas`    : LIRE = public. DÉPOSER = ouvert (comme le Coffre-fort) mais
--                       limité à jpeg/png/webp, 5 Mo, chemin sections/<nom>. Un fichier
--                       déposé seul reste INVISIBLE tant qu'aucune coupe ne le référence.
--                       RETIRER = autorisé uniquement pour un fichier orphelin
--                       (non référencé par une coupe). Aucune modification/écrasement.
--
-- Le code d'ajout n'est PAS dans ce fichier (voir README, étape manuelle).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------
create table if not exists public.atlas_organs (
  key       text primary key,
  name      text not null,
  icon      text,
  position  int  not null default 0
);

insert into public.atlas_organs (key, name, icon, position) values
  ('peau',     'Peau',     '🧴', 1),
  ('rein',     'Rein',     '🫘', 2),
  ('intestin', 'Intestin', '🌀', 3)
on conflict (key) do nothing;

create table if not exists public.atlas_sections (
  id               uuid primary key default gen_random_uuid(),
  organ_key        text not null references public.atlas_organs (key),
  title            text not null check (char_length(title) between 3 and 120),
  description      text check (description is null or char_length(description) <= 1000),
  stain            text check (stain is null or char_length(stain) <= 60),
  magnification    text check (magnification is null or char_length(magnification) <= 30),
  image_path       text not null unique check (image_path ~ '^sections/[A-Za-z0-9._-]{1,150}$'),
  contributor_name text not null check (char_length(contributor_name) between 2 and 80),
  session_id       text check (session_id is null or char_length(session_id) <= 80),
  created_at       timestamptz not null default now()
);
create index if not exists atlas_sections_organ_idx on public.atlas_sections (organ_key, created_at desc);

-- Journal de traçabilité (qui a ajouté / supprimé quoi, quand). Illisible depuis l'app.
create table if not exists public.atlas_audit_log (
  id               bigint generated always as identity primary key,
  action           text not null check (action in ('add', 'delete')),
  section_id       uuid,
  organ_key        text,
  title            text,
  contributor_name text,
  session_id       text,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) RLS : lecture publique des 2 tables d'affichage, RIEN en écriture directe
-- ---------------------------------------------------------------------
alter table public.atlas_organs    enable row level security;
alter table public.atlas_sections  enable row level security;
alter table public.atlas_audit_log enable row level security;   -- aucune policy = fermé

drop policy if exists "atlas_organs_lecture_publique" on public.atlas_organs;
create policy "atlas_organs_lecture_publique" on public.atlas_organs
  for select to anon, authenticated using (true);

drop policy if exists "atlas_sections_lecture_publique" on public.atlas_sections;
create policy "atlas_sections_lecture_publique" on public.atlas_sections
  for select to anon, authenticated using (true);

-- Ceinture + bretelles : on retire aussi les privilèges SQL d'écriture aux rôles de l'app.
revoke insert, update, delete, truncate on public.atlas_organs    from anon, authenticated;
revoke insert, update, delete, truncate on public.atlas_sections  from anon, authenticated;
revoke all                              on public.atlas_audit_log from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) Fonctions (SECURITY DEFINER, search_path verrouillé)
-- ---------------------------------------------------------------------

-- Vérifie le code d'ajout stocké dans Vault. Interne : non appelable par l'app.
create or replace function public._atlas_assert_code(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text;
begin
  select ds.decrypted_secret into v_expected
  from vault.decrypted_secrets ds
  where ds.name = 'atlas_contributor_code'
  limit 1;

  if v_expected is null or v_expected = '' then
    raise exception 'CODE_NON_CONFIGURE';
  end if;
  if p_code is null or p_code <> v_expected then
    raise exception 'CODE_INVALIDE';
  end if;
end;
$$;

-- Pré-contrôle du code (évite d'envoyer une grosse image avec un mauvais code).
create or replace function public.atlas_check_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._atlas_assert_code(p_code);
  return true;
end;
$$;

-- Ajout d'une coupe : code + validations + fichier réellement présent dans le bucket.
create or replace function public.atlas_add_section(
  p_code             text,
  p_organ_key        text,
  p_title            text,
  p_description      text,
  p_stain            text,
  p_magnification    text,
  p_image_path       text,
  p_contributor_name text,
  p_session_id       text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title   text := btrim(coalesce(p_title, ''));
  v_name    text := btrim(coalesce(p_contributor_name, ''));
  v_desc    text := nullif(btrim(coalesce(p_description, '')), '');
  v_stain   text := nullif(btrim(coalesce(p_stain, '')), '');
  v_mag     text := nullif(btrim(coalesce(p_magnification, '')), '');
  v_session text := nullif(btrim(coalesce(p_session_id, '')), '');
  v_id      uuid;
begin
  perform public._atlas_assert_code(p_code);

  if char_length(v_title) < 3 or char_length(v_title) > 120 then
    raise exception 'DONNEES_INVALIDES: titre (3 à 120 caractères)';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'DONNEES_INVALIDES: nom du contributeur (2 à 80 caractères)';
  end if;
  if v_desc  is not null and char_length(v_desc)  > 1000 then raise exception 'DONNEES_INVALIDES: description (1000 caractères max)'; end if;
  if v_stain is not null and char_length(v_stain) > 60   then raise exception 'DONNEES_INVALIDES: coloration (60 caractères max)'; end if;
  if v_mag   is not null and char_length(v_mag)   > 30   then raise exception 'DONNEES_INVALIDES: grossissement (30 caractères max)'; end if;
  if v_session is not null and char_length(v_session) > 80 then v_session := left(v_session, 80); end if;

  if not exists (select 1 from public.atlas_organs o where o.key = p_organ_key) then
    raise exception 'ORGANE_INCONNU';
  end if;
  if p_image_path is null or p_image_path !~ '^sections/[A-Za-z0-9._-]{1,150}$' then
    raise exception 'DONNEES_INVALIDES: chemin de l''image';
  end if;
  if not exists (
    select 1 from storage.objects so
    where so.bucket_id = 'atlas' and so.name = p_image_path
  ) then
    raise exception 'FICHIER_ABSENT';
  end if;

  insert into public.atlas_sections
    (organ_key, title, description, stain, magnification, image_path, contributor_name, session_id)
  values
    (p_organ_key, v_title, v_desc, v_stain, v_mag, p_image_path, v_name, v_session)
  returning id into v_id;

  insert into public.atlas_audit_log (action, section_id, organ_key, title, contributor_name, session_id)
  values ('add', v_id, p_organ_key, v_title, v_name, v_session);

  return v_id;
end;
$$;

-- Suppression d'une coupe : code requis. Renvoie le chemin du fichier devenu orphelin ;
-- l'app le retire ensuite via l'API Storage (la policy de retrait ne l'autorise que
-- pour un fichier non référencé). On ne supprime PAS storage.objects en SQL
-- (Supabase le bloque / laisserait le fichier physique en place).
create or replace function public.atlas_delete_section(
  p_code       text,
  p_section_id uuid,
  p_session_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path    text;
  v_organ   text;
  v_title   text;
  v_contrib text;
begin
  perform public._atlas_assert_code(p_code);

  delete from public.atlas_sections s
  where s.id = p_section_id
  returning s.image_path, s.organ_key, s.title, s.contributor_name
  into v_path, v_organ, v_title, v_contrib;

  if not found then
    raise exception 'SECTION_INTROUVABLE';
  end if;

  insert into public.atlas_audit_log (action, section_id, organ_key, title, contributor_name, session_id)
  values ('delete', p_section_id, v_organ, v_title, v_contrib, left(nullif(btrim(coalesce(p_session_id, '')), ''), 80));

  return v_path;
end;
$$;

-- Droits d'exécution : uniquement le rôle `anon` (l'app n'a pas de comptes).
revoke all on function public._atlas_assert_code(text) from public, anon, authenticated;

revoke all on function public.atlas_check_code(text) from public, anon, authenticated;
grant execute on function public.atlas_check_code(text) to anon;

revoke all on function public.atlas_add_section(text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.atlas_add_section(text, text, text, text, text, text, text, text, text) to anon;

revoke all on function public.atlas_delete_section(text, uuid, text) from public, anon, authenticated;
grant execute on function public.atlas_delete_section(text, uuid, text) to anon;

-- ---------------------------------------------------------------------
-- 4) Stockage : bucket `atlas`
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('atlas', 'atlas', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "atlas_storage_lecture" on storage.objects;
create policy "atlas_storage_lecture" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'atlas');

drop policy if exists "atlas_storage_depot" on storage.objects;
create policy "atlas_storage_depot" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'atlas' and name ~ '^sections/[A-Za-z0-9._-]{1,150}$');

drop policy if exists "atlas_storage_retrait_orphelins" on storage.objects;
create policy "atlas_storage_retrait_orphelins" on storage.objects
  for delete to anon, authenticated
  using (
    bucket_id = 'atlas'
    and not exists (select 1 from public.atlas_sections s where s.image_path = objects.name)
  );
-- Pas de policy UPDATE : impossible d'écraser ou de renommer une image existante.
