-- HistoRévise — Atlas : vérifications en LECTURE SEULE (à lancer après atlas.sql).
-- Attendu : voir les commentaires.

-- 1) Les 3 organes fixes (attendu : peau, rein, intestin)
select key, name, position from public.atlas_organs order by position;

-- 2) RLS actif sur les 3 tables (attendu : rowsecurity = true partout)
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('atlas_organs', 'atlas_sections', 'atlas_audit_log');

-- 3) Policies (attendu : 2 SELECT sur tables atlas ; 3 policies atlas_storage_* sur storage.objects ;
--    AUCUNE policy insert/update/delete sur atlas_sections ni atlas_organs)
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where tablename in ('atlas_organs', 'atlas_sections', 'atlas_audit_log')
   or policyname like 'atlas_storage_%'
order by schemaname, tablename, policyname;

-- 4) Droits d'exécution des fonctions (attendu : anon seulement ; _atlas_assert_code : aucun des 2 rôles)
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon_peut_executer,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_peut_executer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like '%atlas%'
order by p.proname;

-- 5) Le bucket (attendu : public = true, 5242880 octets, jpeg/png/webp)
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'atlas';

-- 6) Le secret existe-t-il ? (n'affiche PAS sa valeur — attendu : 1 ligne après l'étape manuelle)
select name, created_at from vault.secrets where name = 'atlas_contributor_code';
