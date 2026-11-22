-- Habilidades marcadas pela própria pessoa (#15): só do catálogo ativo, até 12, ids repetidos
-- contam uma vez, desativada que a pessoa já tinha fica, e sai no "Baixar meus dados".
-- Pessoas e habilidades fictícias.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.skill(p_name text) returns uuid language sql as $$
  select id from public.skills where name = p_name
$$;
create function pg_temp.mine() returns text language sql as $$
  select coalesce(string_agg(s.name, ',' order by s.name), '')
  from public.my_skills() as m join public.skills as s on s.id = m.skill_id
$$;

-- a1 marca habilidades | f1 outra pessoa ativa | e1 na fila de espera
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-0000000000e1');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000%';
update public.profiles set access_status = 'active', status = 'active'
where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1');
update public.profiles set access_status = 'waitlisted' where id = '00000000-0000-0000-0000-0000000000e1';

-- 14 habilidades de teste (13 para estourar o limite) e uma já desativada.
insert into public.skills (name, category)
select format('Teste %s', lpad(n::text, 2, '0')), 'Teste' from generate_series(1, 14) as n;
insert into public.skills (name, category, active) values ('Teste Desativada', 'Teste', false);
select set_config('test.s1', pg_temp.skill('Teste 01')::text, true);
select set_config('test.s2', pg_temp.skill('Teste 02')::text, true);
select set_config('test.s3', pg_temp.skill('Teste 03')::text, true);
select set_config('test.s4', pg_temp.skill('Teste 04')::text, true);
select set_config('test.off', pg_temp.skill('Teste Desativada')::text, true);
select set_config('test.many', (select string_agg(id::text, ',') from public.skills where name ~ '^Teste [0-9]{2}$' and name <= 'Teste 13'), true);

-- 1-2) Sem sessão (anon) não executa nada.
set local role anon;
select throws_ok($$ select public.set_my_skills(array[current_setting('test.s1')::uuid]) $$, '42501', null, 'anon não marca habilidades');
select throws_ok($$ select * from public.my_skills() $$, '42501', null, 'anon não lê habilidades marcadas');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');

-- 3-4) Marca 3 e lê exatamente essas.
select is(public.set_my_skills(array[current_setting('test.s1'), current_setting('test.s2'), current_setting('test.s3')]::uuid[]), 3,
  'marca 3 habilidades e devolve 3');
select is(pg_temp.mine(), 'Teste 01,Teste 02,Teste 03', 'lê exatamente as 3 marcadas');

-- 5) Troca por outra lista: tira a que saiu, põe a nova.
select public.set_my_skills(array[current_setting('test.s1'), current_setting('test.s4')]::uuid[]);
select is(pg_temp.mine(), 'Teste 01,Teste 04', 'trocar a lista deixa só as marcadas agora');

-- 6) Repetidas contam uma vez.
select is(public.set_my_skills(array[current_setting('test.s1'), current_setting('test.s1'), current_setting('test.s2')]::uuid[]), 2,
  'id repetido conta uma vez');

-- 7-9) Recusas.
select throws_ok($$ select public.set_my_skills(string_to_array(current_setting('test.many'), ',')::uuid[]) $$,
  '22023', null, 'mais de 12 é recusado');
select throws_ok($$ select public.set_my_skills(array['00000000-0000-4000-8000-000000000000']::uuid[]) $$,
  '22023', null, 'habilidade que não existe é recusada');
select throws_ok($$ select public.set_my_skills(array[current_setting('test.off')]::uuid[]) $$,
  '22023', null, 'habilidade desativada não pode ser marcada');

-- 10) Uma habilidade que a pessoa tinha e foi desativada depois continua com ela.
reset role;
update public.skills set active = false where id = current_setting('test.s2')::uuid;
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select public.set_my_skills(array[current_setting('test.s3')]::uuid[]);
select is(pg_temp.mine(), 'Teste 02,Teste 03', 'desativar no catálogo não tira de quem já tinha');

-- 11) Outra pessoa só vê as próprias (nenhuma).
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select is(pg_temp.mine(), '', 'outra pessoa não vê as habilidades da primeira');

-- 12) Quem está na fila de espera não marca.
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select throws_ok($$ select public.set_my_skills(array[current_setting('test.s1')]::uuid[]) $$, '42501', null,
  'quem está na espera não marca habilidades');

-- 13) "Baixar meus dados" leva as habilidades.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select jsonb_array_length(public.export_own_activity() -> 'skills')), 2, 'Baixar meus dados leva as habilidades marcadas');

-- 14-16) Sem atalho pela tabela: ninguém grava direto; anon não lê; excluir a conta apaga.
select throws_ok($$ insert into public.profile_skills (profile_id, skill_id)
  values ('00000000-0000-0000-0000-0000000000a1', current_setting('test.s4')::uuid) $$,
  '42501', null, 'ninguém grava direto na tabela (só pela função)');
set local role anon;
select throws_ok($$ select * from public.profile_skills $$, '42501', null, 'anon não lê a tabela');
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1';
select is((select count(*)::int from public.profile_skills where profile_id = '00000000-0000-0000-0000-0000000000a1'), 0,
  'excluir a conta apaga as habilidades marcadas');

select * from finish();
rollback;
