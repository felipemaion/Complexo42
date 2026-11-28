-- Habilidades da pessoa (issue #15, decisão do Felipe de 28/11): sem nível, no máximo 10 por pessoa
-- (conferido no banco), gravação só por `set_my_skills`, e sugestão de habilidade nova
-- (`suggest_skill`) que a coordenação nacional aprova (`decide_skill_suggestion`) antes de entrar no
-- catálogo. Sinônimos normalizados (caixa e acento). Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(71);

create temp table unit_ids (slug text primary key, id uuid not null);
insert into unit_ids select path::text, id from public.units where path::text in ('br', 'br.sp');
create function pg_temp.unit(p_path text) returns uuid language sql stable as $$ select id from unit_ids where slug = p_path $$;

create temp table people (name text primary key, id uuid not null unique, email text not null);
insert into people values
  ('root_mgr', '00000000-0000-0000-0000-0000000000e1', 'root.mgr@exemplo.org'), -- coordenação nacional
  ('sp_mgr',   '00000000-0000-0000-0000-0000000000e2', 'sp.mgr@exemplo.org'),   -- gestor de SP (não é nacional)
  ('p_a',      '00000000-0000-0000-0000-0000000000e3', 'p.a@exemplo.org'),
  ('p_b',      '00000000-0000-0000-0000-0000000000e4', 'p.b@exemplo.org'),
  ('p_c',      '00000000-0000-0000-0000-0000000000e5', 'p.c@exemplo.org'),
  ('p_wait',   '00000000-0000-0000-0000-0000000000e6', 'p.wait@exemplo.org');   -- na espera
insert into auth.users (id, email) select id, email from people;

create function pg_temp.person(p_name text) returns uuid language sql stable as $$ select id from people where name = p_name $$;
create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.person(p_name), 'role', 'authenticated')::text, true);
$$;
grant select on people, unit_ids to authenticated;

insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'v1' from people;
insert into public.consent_acceptances (user_id, version) select id, 'v1' from public.profiles on conflict do nothing;
update public.profiles set access_status = 'active', status = 'active' where id in (select id from people) and id <> pg_temp.person('p_wait');
update public.profiles set access_status = 'waitlisted' where id = pg_temp.person('p_wait');

insert into public.role_assignments (profile_id, role, unit_id) values
  (pg_temp.person('root_mgr'), 'manager', pg_temp.unit('br')),
  (pg_temp.person('sp_mgr'), 'manager', pg_temp.unit('br.sp'));
-- Membro de verdade exige a casa aceita (ADR 0017).
insert into public.houses (key, active) select 'g-' || id::text, true from people on conflict do nothing;
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
select id, 'g-' || id::text, 'self', now() from people where name <> 'p_wait' on conflict do nothing;

-- Catálogo de teste: 13 habilidades ativas, 1 inativa.
create temp table skill_ids (n int primary key, id uuid not null);
grant select on skill_ids to authenticated;
with ins as (
  insert into public.skills (name, category, aliases, active)
  select 'Habilidade teste ' || g, 'Grupo teste', case when g = 1 then array['Oratória', 'ORATORIA', ' Falar em público '] else '{}' end, g <> 14
  from generate_series(1, 14) as g
  returning id, name
)
insert into skill_ids select (regexp_replace(name, '\D', '', 'g'))::int, id from ins;
create function pg_temp.sk(p int) returns uuid language sql stable as $$ select id from skill_ids where n = p $$;
create function pg_temp.sks(p_from int, p_to int) returns uuid[] language sql stable as $$
  select array_agg(id order by n) from skill_ids where n between p_from and p_to $$;
grant execute on function pg_temp.sk(int), pg_temp.sks(int, int) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Estrutura
-- ---------------------------------------------------------------------------------------
select hasnt_column('public', 'profile_skills', 'level', 'sem nível: a pessoa só marca "tenho"');
select has_table('public', 'skill_suggestions', 'existe a tabela de sugestões');
select is(app.norm_text('ORATÓRIA  de Rua'), 'oratoria  de rua', 'norm_text tira acento e caixa');
select is(
  (select aliases from public.skills where id = pg_temp.sk(1)),
  array['falar em publico', 'oratoria'],
  'os sinônimos são guardados sem acento, sem caixa, sem espaço nas pontas e sem repetição'
);
select throws_ok($$ insert into public.skills (name, category) values ('HABILIDADE teste 3', 'Grupo') $$, '23505', null,
  'não há duas habilidades com o mesmo nome normalizado (caixa e acento)');
select is((select n.nspname::text from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'unaccent'),
  'extensions', 'a unaccent está no schema extensions');
select is(app.ensure_unaccent_in_extensions(), 'extensions', 'garantir a unaccent é idempotente (cria ou move; aqui já está)');
select ok(
  not has_function_privilege('authenticated', 'app.ensure_unaccent_in_extensions()', 'execute')
  and not has_function_privilege('anon', 'app.ensure_unaccent_in_extensions()', 'execute'),
  'só o dono do banco garante a extensão'
);
select ok(
  not has_table_privilege('authenticated', 'public.profile_skills', 'insert')
  and not has_table_privilege('authenticated', 'public.profile_skills', 'update')
  and not has_table_privilege('authenticated', 'public.profile_skills', 'delete')
  and not has_table_privilege('authenticated', 'public.skill_suggestions', 'insert')
  and not has_table_privilege('authenticated', 'public.skill_suggestions', 'update')
  and not has_table_privilege('authenticated', 'public.skill_suggestions', 'delete')
  and not has_function_privilege('anon', 'public.set_my_skills(uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.suggest_skill(text)', 'execute')
  and not has_function_privilege('anon', 'public.decide_skill_suggestion(uuid, boolean, text)', 'execute'),
  'ninguém grava direto pela API; anônimo não chama as funções'
);
select is(
  (select array_agg(c.conname::text || ':' || c.confdeltype::text order by c.conname) from pg_constraint c
   where c.conname in ('profile_skills_profile_id_fkey', 'skill_suggestions_profile_id_fkey')),
  array['profile_skills_profile_id_fkey:c', 'skill_suggestions_profile_id_fkey:c'],
  'as habilidades e as sugestões da pessoa caem junto com o perfil (exclusão da conta)'
);
select is(
  (select c.confdeltype::text from pg_constraint c where c.conname = 'skill_suggestions_decided_by_fkey'),
  'n', 'quem decidiu vira nulo se a conta dele for apagada'
);

-- ---------------------------------------------------------------------------------------
-- set_my_skills: o conjunto inteiro, no máximo 10
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('p_a');
select is(public.set_my_skills(pg_temp.sks(1, 3)), 3, 'a pessoa marca 3 habilidades');
select set_eq(
  $$ select skill_id from public.profile_skills where profile_id = pg_temp.person('p_a') $$,
  $$ select id from skill_ids where n between 1 and 3 $$,
  'as 3 ficam gravadas'
);
select is(public.set_my_skills(array[pg_temp.sk(4), pg_temp.sk(4), pg_temp.sk(1)]), 2, 'repetidas contam uma vez');
select set_eq(
  $$ select skill_id from public.profile_skills where profile_id = pg_temp.person('p_a') $$,
  $$ select id from skill_ids where n in (1, 4) $$,
  'o conjunto novo substitui o anterior'
);
select is(public.set_my_skills(pg_temp.sks(1, 10)), 10, 'dez habilidades cabem');
select throws_ok($$ select public.set_my_skills(pg_temp.sks(1, 11)) $$, 'C7701', null, 'onze não cabem');
select is((select count(*)::int from public.profile_skills where profile_id = pg_temp.person('p_a')), 10,
  'a recusa não mexe no que já estava gravado');
select throws_ok($$ select public.set_my_skills(array[pg_temp.sk(14)]) $$, 'P0002', null, 'habilidade inativa não entra');
select throws_ok($$ select public.set_my_skills(array['00000000-0000-0000-0000-000000000999'::uuid]) $$, 'P0002', null,
  'habilidade que não existe não entra');
select is(public.set_my_skills(null), 0, 'lista vazia (ou nula) limpa as habilidades');
select is((select count(*)::int from public.profile_skills where profile_id = pg_temp.person('p_a')), 0, 'nenhuma sobrou');
select throws_ok($$ insert into public.profile_skills (profile_id, skill_id) values (pg_temp.person('p_a'), pg_temp.sk(1)) $$,
  '42501', null, 'a pessoa não insere direto na tabela');
select pg_temp.login('p_wait');
select throws_ok($$ select public.set_my_skills(array[pg_temp.sk(1)]) $$, '42501', null, 'quem está na espera não grava habilidades');
set local role anon;
select throws_ok($$ select public.set_my_skills(array[pg_temp.sk(1)]) $$, '42501', null, 'anônimo não grava habilidades');
reset role;
select throws_ok(
  $$ insert into public.profile_skills (profile_id, skill_id)
     select pg_temp.person('p_c'), id from skill_ids where n <= 11 $$,
  'C7701', null, 'o gatilho do banco recusa a 11ª, mesmo fora da função'
);

-- set_my_skills só mexe nas linhas de quem chama.
set local role authenticated;
select pg_temp.login('p_a');
select is(public.set_my_skills(pg_temp.sks(1, 3)), 3, 'p_a marca 3');
select pg_temp.login('p_b');
select is(public.set_my_skills(array[pg_temp.sk(5)]), 1, 'p_b marca 1');
select is(public.set_my_skills(null), 0, 'p_b limpa as dela');
reset role;
select is((select count(*)::int from public.profile_skills where profile_id = pg_temp.person('p_a')), 3,
  'as habilidades de p_a não mudaram com o que p_b fez');
set local role authenticated;
select pg_temp.login('p_a');
select is(public.set_my_skills(null), 0, 'p_a limpa as dela (para o resto do teste)');

-- ---------------------------------------------------------------------------------------
-- suggest_skill: nome livre, limites e finalidade
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('p_a');
create temp table made (n int, id uuid);
grant select, insert on made to authenticated;
insert into made select 1, public.suggest_skill('  Jardinagem urbana  ');
select is((select name from public.skill_suggestions where id = (select id from made where n = 1)), 'Jardinagem urbana',
  'a sugestão guarda o nome sem espaço nas pontas');
select throws_ok($$ select public.suggest_skill('a') $$, '22023', null, 'nome curto demais');
select throws_ok($$ select public.suggest_skill(repeat('x', 81)) $$, '22023', null, 'nome longo demais');
select throws_ok($$ select public.suggest_skill(null) $$, '22023', null, 'nome nulo');
select throws_ok($$ select public.suggest_skill('Ma' || chr(8203) || 'ria') $$, '22023', null, 'caractere invisível (largura zero) é recusado');
select throws_ok($$ select public.suggest_skill('Ma' || chr(7) || 'ria') $$, '22023', null, 'caractere de controle é recusado');
select throws_ok($$ select public.suggest_skill('Ma' || chr(10) || 'ria') $$, '22023', null, 'quebra de linha é recusada');
select throws_ok($$ select public.suggest_skill('habilidade TESTE 2') $$, 'C7704', null, 'já existe no catálogo (caixa e acento não importam)');
select throws_ok($$ select public.suggest_skill('JARDINAGEM Urbana') $$, 'C7704', null, 'a mesma sugestão aberta não se repete');
insert into made select 2, public.suggest_skill('Teatro de rua');
insert into made select 3, public.suggest_skill('Capoeira angola');
select throws_ok($$ select public.suggest_skill('Cerâmica') $$, 'C7702', null, 'no máximo 3 sugestões abertas');
select is((select count(*)::int from public.skill_suggestions), 3, 'a pessoa lê as próprias sugestões');
select pg_temp.login('p_b');
select is((select count(*)::int from public.skill_suggestions), 0, 'e não lê as dos outros');
select pg_temp.login('sp_mgr');
select is((select count(*)::int from public.skill_suggestions), 0, 'gestor de estado também não lê as sugestões dos outros');
select pg_temp.login('root_mgr');
select is((select count(*)::int from public.skill_suggestions), 3, 'a coordenação nacional lê todas');
select pg_temp.login('p_wait');
select throws_ok($$ select public.suggest_skill('Algo novo') $$, '42501', null, 'quem está na espera não sugere');
set local role anon;
select throws_ok($$ select public.suggest_skill('Algo novo') $$, '42501', null, 'anônimo não sugere');

-- ---------------------------------------------------------------------------------------
-- decide_skill_suggestion: só a coordenação nacional
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('sp_mgr');
select throws_ok($$ select public.decide_skill_suggestion((select id from made where n = 1), true, 'Jardim') $$, '42501', null,
  'gestor de estado não decide');
select pg_temp.login('p_a');
select throws_ok($$ select public.decide_skill_suggestion((select id from made where n = 1), true, 'Jardim') $$, '42501', null,
  'a própria pessoa não aprova a sua sugestão');
select pg_temp.login('root_mgr');
select throws_ok($$ select public.decide_skill_suggestion((select id from made where n = 1), true, null) $$, '22023', null,
  'aprovar exige o grupo');
select throws_ok($$ select public.decide_skill_suggestion((select id from made where n = 1), null, 'Jardim') $$, '22023', null,
  'a decisão é aprovar ou rejeitar');
select throws_ok($$ select public.decide_skill_suggestion('00000000-0000-0000-0000-000000000999', false, null) $$, 'P0002', null,
  'sugestão que não existe');
select lives_ok($$ select public.decide_skill_suggestion((select id from made where n = 1), true, 'Ofícios') $$,
  'a nacional aprova a sugestão com um grupo');
reset role;
select ok(
  exists (select 1 from public.skills where name = 'Jardinagem urbana' and category = 'Ofícios' and active),
  'a habilidade entra no catálogo, ativa'
);
select ok(
  exists (select 1 from public.profile_skills ps join public.skills s on s.id = ps.skill_id
          where ps.profile_id = pg_temp.person('p_a') and s.name = 'Jardinagem urbana'),
  'e já fica marcada para quem sugeriu'
);
select is(
  (select status || ':' || (decided_by = pg_temp.person('root_mgr'))::text || ':' || (decided_at is not null)::text
   from public.skill_suggestions where id = (select id from made where n = 1)),
  'approved:true:true', 'guarda o estado, quem decidiu e quando'
);
select is(
  (select count(*)::int from public.audit_log
   where event = 'skill_suggestion_decided' and actor_id = pg_temp.person('root_mgr') and target_id = pg_temp.person('p_a')),
  1, 'a decisão vai para o audit_log (ator e alvo, sem o texto)'
);
set local role authenticated;
select pg_temp.login('root_mgr');
select throws_ok($$ select public.decide_skill_suggestion((select id from made where n = 1), false, null) $$, 'P0002', null,
  'uma sugestão já decidida não se decide de novo');
select lives_ok($$ select public.decide_skill_suggestion((select id from made where n = 2), false, null) $$, 'a nacional rejeita outra');
reset role;
select ok(not exists (select 1 from public.skills where name = 'Teatro de rua'), 'rejeitada não entra no catálogo');

-- Aprovar quando a pessoa já tem 10: a habilidade entra no catálogo, mas não é marcada para ela.
select set_config('request.jwt.claims', null, true);
insert into public.profile_skills (profile_id, skill_id) select pg_temp.person('p_a'), id from skill_ids where n <= 9;
select is((select count(*)::int from public.profile_skills where profile_id = pg_temp.person('p_a')), 10,
  'p_a tem 10 (9 + a recém-aprovada)');
set local role authenticated;
select pg_temp.login('root_mgr');
select lives_ok($$ select public.decide_skill_suggestion((select id from made where n = 3), true, 'Luta') $$,
  'aprovar com a pessoa no limite não dá erro');
reset role;
select ok(
  exists (select 1 from public.skills where name = 'Capoeira angola')
  and not exists (select 1 from public.profile_skills ps join public.skills s on s.id = ps.skill_id
                  where ps.profile_id = pg_temp.person('p_a') and s.name = 'Capoeira angola'),
  'entra no catálogo, sem estourar o limite de quem sugeriu'
);

-- Teto diário: rejeitar não libera sugestão sem fim (5 por dia, de qualquer estado).
set local role authenticated;
select pg_temp.login('p_b');
insert into made select 4, public.suggest_skill('Sugestão B um');
insert into made select 5, public.suggest_skill('Sugestão B dois');
insert into made select 6, public.suggest_skill('Sugestão B três');
select pg_temp.login('root_mgr');
select public.decide_skill_suggestion((select id from made where n = 4), false, null);
select public.decide_skill_suggestion((select id from made where n = 5), false, null);
select public.decide_skill_suggestion((select id from made where n = 6), false, null);
select pg_temp.login('p_b');
insert into made select 7, public.suggest_skill('Sugestão B quatro');
insert into made select 8, public.suggest_skill('Sugestão B cinco');
select throws_ok($$ select public.suggest_skill('Sugestão B seis') $$, 'C7703', null,
  'depois de 5 sugestões em 24 horas, mesmo rejeitadas, a pessoa espera');
reset role;
update public.skill_suggestions set created_at = now() - interval '2 days' where profile_id = pg_temp.person('p_b') and status = 'rejected';
set local role authenticated;
select pg_temp.login('p_b');
select lives_ok($$ select public.suggest_skill('Sugestão B seis') $$, 'passado o dia, a pessoa volta a poder sugerir (2 abertas, cabe mais uma)');

-- Aprovar quando uma habilidade desativada de mesmo nome apareceu no meio: reativa, marca e registra.
set local role authenticated;
select pg_temp.login('p_c');
insert into made select 9, public.suggest_skill('Nova coisa');
reset role;
insert into public.skills (name, category, active) values ('nova COISA', 'Grupo', false);
set local role authenticated;
select pg_temp.login('root_mgr');
select public.decide_skill_suggestion((select id from made where n = 9), true, 'Grupo');
reset role;
select ok((select active from public.skills where app.norm_text(name) = 'nova coisa'), 'a habilidade desativada foi reativada');
select is((select count(*)::int from public.skills where app.norm_text(name) = 'nova coisa'), 1, 'e não se criou uma duplicada');
select ok(
  exists (select 1 from public.profile_skills ps join public.skills s on s.id = ps.skill_id
          where ps.profile_id = pg_temp.person('p_c') and app.norm_text(s.name) = 'nova coisa'),
  'a reativada foi marcada para quem sugeriu'
);
select is((select count(*)::int from public.audit_log where event = 'skill_reactivated' and actor_id = pg_temp.person('root_mgr')), 1,
  'a reativação vai para o audit_log');
set local role authenticated;

-- ---------------------------------------------------------------------------------------
-- Baixar meus dados
-- ---------------------------------------------------------------------------------------
select pg_temp.login('p_a');
select ok(
  jsonb_array_length(public.export_own_data() -> 'skills') = 10
  and public.export_own_data() -> 'skills' -> 0 ? 'name',
  'Baixar meus dados traz as habilidades (nome e grupo)'
);
select ok(
  jsonb_array_length(public.export_own_data() -> 'skill_suggestions') = 3
  and (public.export_own_data() -> 'skill_suggestions' -> 0) ? 'status',
  'e as sugestões da pessoa (nome, estado e datas)'
);

select * from finish();
rollback;
