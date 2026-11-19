-- Perfil, contato e municípios (issues #10 e #12): estrutura, formato dos valores cifrados,
-- triggers, RLS do ponto de vista do titular e a gravação só por `save_own_profile`. A matriz papel × escopo fica em
-- permissions_matrix.test.sql. Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(84);

-- Valor no formato v1.<iv>.<ct> (o banco não decifra; só confere o formato).
create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- u1: cadastra-se pela API; u2: outro perfil ativo; u3: bloqueado; u4: na espera;
-- u5: conta suspensa; u6 e u7: sem perfil, para o limite de WhatsApp repetido (#127).
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000b3'),
  ('00000000-0000-0000-0000-0000000000b4'),
  ('00000000-0000-0000-0000-0000000000b5'),
  ('00000000-0000-0000-0000-0000000000b6'),
  ('00000000-0000-0000-0000-0000000000b7');
insert into public.municipalities (code, name, state_code) values (3106200, 'Belo Horizonte', 'MG');

-- ---------------------------------------------------------------------------------------
-- Municípios
-- ---------------------------------------------------------------------------------------
select is(
  (select count(*)::int from public.municipalities
   where metro_region = 'rmsp' and state_code = 'SP'),
  39,
  'os 39 municípios da região metropolitana de SP estão carregados'
);
select results_eq(
  $$ select code, name from public.municipalities
     where code in (3550308, 3548708, 3518800) order by code $$,
  $$ values (3518800, 'Guarulhos'), (3548708, 'São Bernardo do Campo'), (3550308, 'São Paulo') $$,
  'códigos IBGE de 7 dígitos conferem'
);
select throws_ok(
  $$ insert into public.municipalities (code, name, state_code) values (3399999, 'Errado', 'SP') $$,
  '23514', null,
  'a UF tem de bater com os dois primeiros dígitos do código IBGE'
);

-- ---------------------------------------------------------------------------------------
-- Estrutura: só as colunas da lista fechada (docs/MODELO_DADOS.md)
-- ---------------------------------------------------------------------------------------
select columns_are('public', 'profiles', array[
  'id', 'display_name_enc', 'municipality_code', 'state_code', 'district', 'status',
  'access_status', 'consent_version', 'consent_at', 'created_at', 'updated_at'
], 'profiles tem exatamente as colunas do modelo de dados');
select columns_are('public', 'profile_contacts', array[
  'profile_id', 'whatsapp_enc', 'whatsapp_hmac', 'social_links_enc', 'updated_at'
], 'profile_contacts tem exatamente as colunas do modelo de dados');
select fk_ok('public', 'profiles', 'id', 'auth', 'users', 'id', 'profiles.id = auth.users.id');
select fk_ok('public', 'unit_members', 'profile_id', 'public', 'profiles', 'id',
  'unit_members aponta para profiles');
select fk_ok('public', 'role_assignments', 'profile_id', 'public', 'profiles', 'id',
  'role_assignments aponta para profiles');
select fk_ok('public', 'role_assignments', 'granted_by', 'public', 'profiles', 'id',
  'role_assignments.granted_by aponta para profiles');

-- ---------------------------------------------------------------------------------------
-- Formato dos valores cifrados e demais CHECKs (como dono do banco, sem RLS)
-- ---------------------------------------------------------------------------------------
create function pg_temp.add_profile(p_id text, p_name text, p_municipality int default 3550308)
returns void language sql as $$
  insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
  values (p_id::uuid, p_name, p_municipality, 'v1')
$$;

select throws_ok(
  $$ select pg_temp.add_profile('00000000-0000-0000-0000-0000000000b2', 'Maria Silva') $$,
  '23514', null,
  'nome em texto puro é recusado'
);
select throws_ok(
  $$ select pg_temp.add_profile('00000000-0000-0000-0000-0000000000b2',
       'v1.AAAAAAAAAAAAAAAA.' || repeat('x', 600)) $$,
  '23514', null,
  'valor cifrado acima do teto de tamanho é recusado'
);
select throws_ok(
  $$ select pg_temp.add_profile('00000000-0000-0000-0000-0000000000b2',
       'v1.AAAA.BBBBBBBBBBBBBBBBBBBBBBBB') $$,
  '23514', null,
  'IV fora do tamanho (12 bytes) é recusado'
);
select throws_ok(
  $$ select pg_temp.add_profile('00000000-0000-0000-0000-0000000000b2',
       'v0.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB') $$,
  '23514', null,
  'versão de chave inválida é recusada'
);
select throws_ok(
  $$ select pg_temp.add_profile('00000000-0000-0000-0000-0000000000b2', pg_temp.enc('b2'), 1234567) $$,
  '23503', null,
  'município desconhecido é recusado'
);
select throws_ok(
  $$ insert into public.profiles (id, display_name_enc, municipality_code, consent_version, district)
     values ('00000000-0000-0000-0000-0000000000b2', pg_temp.enc('b2'), 3550308, 'v1', ' x ') $$,
  '23514', null,
  'distrito fora do formato é recusado'
);
select throws_ok(
  $$ insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
     values ('00000000-0000-0000-0000-0000000000b2', pg_temp.enc('b2'), 3550308, 'versão 1') $$,
  '23514', null,
  'versão do termo fora do formato é recusada'
);

-- u2 (ativo, MG), u3 (bloqueado) e u4 (na espera), criados pelo servidor.
insert into public.profiles (id, display_name_enc, municipality_code, consent_version,
                             state_code, consent_at, created_at)
values ('00000000-0000-0000-0000-0000000000b2', pg_temp.enc('b2'), 3106200, 'v1',
        'SP', '2000-01-01', '2000-01-01');
select pg_temp.add_profile('00000000-0000-0000-0000-0000000000b3', pg_temp.enc('b3'));
select pg_temp.add_profile('00000000-0000-0000-0000-0000000000b4', pg_temp.enc('b4'));
select pg_temp.add_profile('00000000-0000-0000-0000-0000000000b5', pg_temp.enc('b5'));
update public.profiles set access_status = 'active', status = 'active'
where id = '00000000-0000-0000-0000-0000000000b2';
update public.profiles set access_status = 'active', status = 'suspended'
where id = '00000000-0000-0000-0000-0000000000b5';
update public.profiles set access_status = 'blocked' where id = '00000000-0000-0000-0000-0000000000b3';
update public.profiles set access_status = 'waitlisted' where id = '00000000-0000-0000-0000-0000000000b4';

select results_eq(
  $$ select state_code::text, consent_at = now(), created_at = now()
     from public.profiles where id = '00000000-0000-0000-0000-0000000000b2' $$,
  $$ values ('MG', true, true) $$,
  'UF vem do município e as datas são do servidor (valores enviados são ignorados)'
);

insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac)
values ('00000000-0000-0000-0000-0000000000b2', pg_temp.enc('w2'), repeat('b', 64));

select throws_ok(
  $$ insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac)
     values ('00000000-0000-0000-0000-0000000000b3', '+5511999998888', repeat('c', 64)) $$,
  '23514', null,
  'WhatsApp em texto puro é recusado'
);
select throws_ok(
  $$ insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac)
     values ('00000000-0000-0000-0000-0000000000b3', pg_temp.enc('w3'), repeat('C', 64)) $$,
  '23514', null,
  'whatsapp_hmac fora do formato (hex minúsculo de 64) é recusado'
);
select throws_ok(
  $$ insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac, social_links_enc)
     values ('00000000-0000-0000-0000-0000000000b3', pg_temp.enc('w3'), repeat('c', 64),
             '["https://exemplo.org/perfil"]') $$,
  '23514', null,
  'redes sociais em texto puro são recusadas'
);

-- ---------------------------------------------------------------------------------------
-- O titular pela API: só por `save_own_profile` (#12, achado do #112)
-- ---------------------------------------------------------------------------------------
-- Chamada como a server action faz: valores já cifrados e HMAC calculado no servidor.
create function pg_temp.save(
  p_name text, p_whatsapp_hmac text,
  p_municipality int default 3550308, p_district text default null,
  p_whatsapp text default null, p_links text default null
) returns text language sql as $$
  select public.save_own_profile(
    p_display_name_enc => p_name,
    p_municipality_code => p_municipality,
    p_district => p_district,
    p_whatsapp_enc => coalesce(p_whatsapp, pg_temp.enc('wa')),
    p_whatsapp_hmac => p_whatsapp_hmac,
    p_social_links_enc => p_links
  )
$$;
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');

select lives_ok(
  $$ select pg_temp.save(pg_temp.enc('b1'), repeat('a', 64)) $$,
  'a pessoa sem perfil cria o próprio perfil e contato pela função'
);
-- Conferido como dono: quem está pendente ainda não lê a estrutura.
reset role;
select results_eq(
  $$ select u.path::text from public.unit_members as m
     join public.units as u on u.id = m.unit_id
     where m.profile_id = '00000000-0000-0000-0000-0000000000b1' and m.left_at is null $$,
  array['br.sp'],
  'ao criar o perfil, a pessoa entra na unidade do seu estado'
);
set local role authenticated;
select is(
  (select count(*)::int from public.municipalities),
  40,
  'quem está pendente lê os municípios (escolha no cadastro)'
);
select is_empty(
  $$ select 1 from public.unit_members $$,
  'quem está pendente NÃO lê vínculos, nem o próprio'
);
select results_eq(
  $$ select status, access_status, state_code::text, consent_version from public.profiles $$,
  $$ values ('pending', 'pending', 'SP', 'none') $$,
  'o perfil nasce pendente, com a UF do município, sem aceite do termo (none), e é o único que ela lê'
);
-- Revisão do PR #125: a versão do termo não vem do cliente. Chamar a RPC direto pedindo
-- outra versão não acha a função; nem a criação nem a edição a mudam.
select throws_ok(
  $$ select public.save_own_profile(
       p_display_name_enc => pg_temp.enc('b1'), p_municipality_code => 3550308,
       p_district => null, p_consent_version => 'v1',
       p_whatsapp_enc => pg_temp.enc('wa'), p_whatsapp_hmac => repeat('a', 64)) $$,
  '42883', null,
  'chamar a RPC direto NÃO define a versão do termo (o parâmetro não existe)'
);
select results_eq(
  $$ select profile_id, whatsapp_hmac, social_links_enc from public.profile_contacts $$,
  $$ values ('00000000-0000-0000-0000-0000000000b1'::uuid, repeat('a', 64), null::text) $$,
  'o contato foi gravado e ela lê só o próprio'
);
select is_empty(
  $$ select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000b2' $$,
  'a pessoa NÃO lê o perfil de outra'
);

-- Edição pela função: troca nome, município, distrito e WhatsApp; o termo não muda aqui.
select lives_ok(
  $$ select pg_temp.save(pg_temp.enc('b1novo'), repeat('9', 64), 3106200, null,
                         pg_temp.enc('w1novo'), pg_temp.enc('links')) $$,
  'a pessoa edita o próprio perfil e contato pela função'
);
select results_eq(
  $$ select p.display_name_enc, p.state_code::text, p.district, p.consent_version,
            c.whatsapp_enc, c.whatsapp_hmac, c.social_links_enc
     from public.profiles as p join public.profile_contacts as c on c.profile_id = p.id $$,
  $$ values (pg_temp.enc('b1novo'), 'MG', null::text, 'none',
             pg_temp.enc('w1novo'), repeat('9', 64), pg_temp.enc('links')) $$,
  'a edição foi gravada, a UF foi recalculada e a versão do termo NÃO mudou (é do fluxo do termo)'
);
select lives_ok(
  $$ select pg_temp.save(pg_temp.enc('b1'), repeat('a', 64), 3550308, 'Sé') $$,
  'volta para São Paulo com distrito'
);

-- WhatsApp de outra pessoa (o HMAC de u2): resposta fixa, sem o HMAC, nada gravado. Desde a
-- #127 é retorno, e não erro, para o registro da tentativa sobreviver à chamada.
select is(
  pg_temp.save(pg_temp.enc('b1outro'), repeat('b', 64)),
  'duplicate_whatsapp',
  'o mesmo WhatsApp (HMAC) não se cadastra duas vezes: a resposta é só `duplicate_whatsapp`'
);
select is(
  pg_temp.save(pg_temp.enc('b1'), repeat('a', 64), 3550308, 'Sé'),
  'saved',
  'salvar com o próprio WhatsApp responde `saved`'
);
select results_eq(
  $$ select p.display_name_enc, p.district, c.whatsapp_hmac
     from public.profiles as p join public.profile_contacts as c on c.profile_id = p.id $$,
  $$ values (pg_temp.enc('b1'), 'Sé', repeat('a', 64)) $$,
  'com o WhatsApp repetido, nem o perfil nem o contato mudaram'
);

-- Formato: o banco não decifra, mas recusa o que não é valor cifrado nem HMAC.
select throws_ok($$ select pg_temp.save('Maria Silva', repeat('a', 64)) $$,
  '22023', 'nome em formato inválido', 'função recusa nome em texto puro');
select throws_ok($$ select pg_temp.save(null, repeat('a', 64)) $$,
  '22023', 'nome em formato inválido', 'função recusa nome nulo');
select throws_ok(
  $$ select pg_temp.save(pg_temp.enc('b1'), repeat('a', 64), p_whatsapp => '+5511999998888') $$,
  '22023', 'WhatsApp em formato inválido', 'função recusa WhatsApp em texto puro');
select throws_ok($$ select pg_temp.save(pg_temp.enc('b1'), repeat('A', 64)) $$,
  '22023', 'HMAC em formato inválido', 'função recusa HMAC fora do formato');
select throws_ok($$ select pg_temp.save(pg_temp.enc('b1'), null) $$,
  '22023', 'HMAC em formato inválido', 'função recusa HMAC nulo');
select throws_ok(
  $$ select pg_temp.save(pg_temp.enc('b1'), repeat('a', 64), p_links => '["https://exemplo.org"]') $$,
  '22023', 'redes em formato inválido', 'função recusa redes em texto puro');
select throws_ok($$ select pg_temp.save(pg_temp.enc('b1'), repeat('a', 64), null) $$,
  '22023', 'município obrigatório', 'função recusa município nulo');
select throws_ok($$ select pg_temp.save(pg_temp.enc('b1'), repeat('a', 64), 1234567) $$,
  '23503', null, 'função recusa município desconhecido');
select throws_ok($$ select pg_temp.save(pg_temp.enc('b1'), repeat('a', 64), 3550308, ' x ') $$,
  '23514', null, 'função recusa distrito fora do formato');

-- Sem atalho pela API: nada de INSERT/UPDATE direto, nem na própria linha.
select throws_ok(
  $$ insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
     values (gen_random_uuid(), pg_temp.enc('xx'), 3550308, 'v1') $$,
  '42501', 'permission denied for table profiles',
  'ninguém cria perfil direto pela API'
);
select throws_ok(
  $$ update public.profiles set display_name_enc = pg_temp.enc('direto') $$,
  '42501', 'permission denied for table profiles',
  'a pessoa NÃO grava o nome cifrado direto pela API'
);
select throws_ok(
  $$ update public.profiles set district = 'Centro' $$,
  '42501', 'permission denied for table profiles',
  'a pessoa NÃO grava o distrito direto pela API'
);
select throws_ok(
  $$ update public.profile_contacts set whatsapp_hmac = repeat('c', 64) $$,
  '42501', 'permission denied for table profile_contacts',
  'a pessoa NÃO grava o HMAC do WhatsApp direto pela API (achado do #112)'
);
select throws_ok(
  $$ update public.profile_contacts set whatsapp_enc = pg_temp.enc('direto') $$,
  '42501', 'permission denied for table profile_contacts',
  'a pessoa NÃO grava o WhatsApp cifrado direto pela API'
);
select throws_ok(
  $$ insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac)
     values ('00000000-0000-0000-0000-0000000000b4', pg_temp.enc('w4'), repeat('d', 64)) $$,
  '42501', 'permission denied for table profile_contacts',
  'ninguém cadastra contato direto pela API'
);
select throws_ok(
  $$ update public.profiles set status = 'active' $$,
  '42501', 'permission denied for table profiles',
  'a pessoa NÃO altera o próprio status'
);
select throws_ok(
  $$ update public.profiles set access_status = 'active' $$,
  '42501', 'permission denied for table profiles',
  'a pessoa NÃO altera o próprio access_status'
);
select throws_ok(
  $$ delete from public.profiles $$,
  '42501', 'permission denied for table profiles',
  'perfil não é apagado pela API'
);
select throws_ok(
  $$ delete from public.profile_contacts $$,
  '42501', 'permission denied for table profile_contacts',
  'contato não é apagado pela API'
);

-- Sem `sub` no JWT (auth.uid() nulo): nada é gravado.
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$ select pg_temp.save(pg_temp.enc('x'), repeat('1', 64)) $$,
  '42501', 'sessão obrigatória', 'JWT sem `sub` NÃO grava perfil');

-- Bloqueado: lê o próprio perfil, mas não edita nem cadastra contato.
select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$ select pg_temp.save(pg_temp.enc('b3'), repeat('e', 64)) $$,
  '42501', 'sem permissão para editar este perfil', 'perfil bloqueado NÃO edita o perfil nem o contato');

-- Na espera: lê só o próprio perfil e consegue completá-lo.
select pg_temp.login('00000000-0000-0000-0000-0000000000b4');
select results_eq(
  $$ select id, access_status from public.profiles $$,
  $$ values ('00000000-0000-0000-0000-0000000000b4'::uuid, 'waitlisted') $$,
  'quem está na espera lê só o próprio perfil'
);
select is_empty(
  $$ select 1 from public.municipalities $$,
  'quem está na espera NÃO lê municípios'
);
select lives_ok($$ select pg_temp.save(pg_temp.enc('b4'), repeat('d', 64)) $$,
  'quem está na espera completa o próprio cadastro');
select results_eq(
  $$ select access_status, status, consent_version from public.profiles $$,
  $$ values ('waitlisted', 'pending', 'v1') $$,
  'quem está na espera, ao salvar pela RPC, NÃO muda o próprio access_status, status nem termo'
);

-- Conta suspensa: lê o próprio perfil, mas não edita nem cadastra contato.
select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select results_eq(
  $$ select id, status from public.profiles $$,
  $$ values ('00000000-0000-0000-0000-0000000000b5'::uuid, 'suspended') $$,
  'conta suspensa lê o próprio perfil'
);
select throws_ok($$ select pg_temp.save(pg_temp.enc('b5'), repeat('f', 64)) $$,
  '42501', 'sem permissão para editar este perfil', 'conta suspensa NÃO edita o perfil nem o contato');

-- ---------------------------------------------------------------------------------------
-- Limite de WhatsApp repetido (#127): 5 por pessoa, por hora
-- ---------------------------------------------------------------------------------------
-- u6 testa números já usados (o de u2, 'b'). Cada tentativa é registrada, sem o número.
select pg_temp.login('00000000-0000-0000-0000-0000000000b6');
select is(
  (select array_agg(pg_temp.save(pg_temp.enc('b6'), repeat('b', 64))) from generate_series(1, 5)),
  array_fill('duplicate_whatsapp'::text, array[5]),
  'as 5 primeiras tentativas com WhatsApp repetido na hora respondem `duplicate_whatsapp`'
);
select throws_ok(
  $$ select pg_temp.save(pg_temp.enc('b6'), repeat('b', 64)) $$,
  'PT429', 'too_many_attempts',
  'a 6ª tentativa na hora é recusada com `too_many_attempts`'
);
select throws_ok(
  $$ select pg_temp.save(pg_temp.enc('b6'), repeat('7', 64)) $$,
  'PT429', 'too_many_attempts',
  'depois do limite, até um número LIVRE é recusado igual (o limite não vira oráculo)'
);
select throws_ok(
  $$ select 1 from app.profile_save_attempts $$,
  '42501', null,
  'quem está logado NÃO lê as tentativas (nem as próprias)'
);
select throws_ok(
  $$ delete from app.profile_save_attempts $$,
  '42501', null,
  'quem está logado NÃO apaga as próprias tentativas para driblar o limite'
);

-- u7: outra pessoa, não é afetada pelo limite de u6.
select pg_temp.login('00000000-0000-0000-0000-0000000000b7');
select is(
  pg_temp.save(pg_temp.enc('b7'), repeat('b', 64)),
  'duplicate_whatsapp',
  'o limite é por pessoa: outra pessoa ainda recebe `duplicate_whatsapp`'
);
select is(
  pg_temp.save(pg_temp.enc('b7'), repeat('c', 64)),
  'saved',
  'e salva o próprio cadastro normalmente'
);

-- Conferência e relógio como dono do banco.
reset role;
select is_empty(
  $$ select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000b6'
     union all
     select 1 from public.profile_contacts where whatsapp_hmac = repeat('7', 64) $$,
  'nada de u6 foi gravado: nem perfil, nem contato, nem o número livre recusado'
);
select results_eq(
  $$ select profile_id, count(*)::int from app.profile_save_attempts
     where profile_id in ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000b7')
     group by profile_id order by profile_id $$,
  $$ values ('00000000-0000-0000-0000-0000000000b6'::uuid, 5),
            ('00000000-0000-0000-0000-0000000000b7'::uuid, 1) $$,
  'só os repetidos contam; as recusas pelo limite e os salvamentos não'
);
select columns_are(
  'app', 'profile_save_attempts', array['profile_id', 'attempted_at'],
  'a tentativa guarda só quem e quando, nunca o número nem o HMAC'
);
update app.profile_save_attempts set attempted_at = now() - interval '59 minutes'
  where profile_id = '00000000-0000-0000-0000-0000000000b6';
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000b6');
select throws_ok(
  $$ select pg_temp.save(pg_temp.enc('b6'), repeat('7', 64)) $$,
  'PT429', 'too_many_attempts',
  'com as tentativas a 59 minutos, ainda dentro da hora: recusado'
);
reset role;
update app.profile_save_attempts set attempted_at = now() - interval '61 minutes'
  where profile_id = '00000000-0000-0000-0000-0000000000b6';
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000b6');
select is(
  pg_temp.save(pg_temp.enc('b6'), repeat('7', 64)),
  'saved',
  'passada a hora, a pessoa volta a salvar'
);
select is(
  pg_temp.save(pg_temp.enc('b6'), repeat('b', 64)),
  'duplicate_whatsapp',
  'e um repetido novo volta a ser só `duplicate_whatsapp`'
);
reset role;
select is(
  (select count(*)::int from app.profile_save_attempts
   where profile_id = '00000000-0000-0000-0000-0000000000b6'),
  1,
  'ao registrar a tentativa nova, as de mais de uma hora foram apagadas'
);
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class as c
   where c.oid = 'app.profile_save_attempts'::regclass)
  and not exists (
    select 1 from unnest(array['anon', 'authenticated', 'service_role']) as r(role_name)
    cross join unnest(array['select', 'insert', 'update', 'delete']) as p(priv)
    where has_table_privilege(r.role_name, 'app.profile_save_attempts', p.priv)
  ),
  'tentativas: RLS ligada e nenhum grant para os papéis da API (só a função usa)'
);
set local role authenticated;

-- Visitante anônimo
reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok(
  $$ select 1 from public.municipalities $$,
  '42501', null,
  'visitante anônimo não lê municípios'
);
select throws_ok(
  $$ select pg_temp.save(pg_temp.enc('anon'), repeat('2', 64)) $$,
  '42501', null,
  'visitante anônimo NÃO chama a função de gravar perfil'
);
select throws_ok(
  $$ select 1 from app.profile_save_attempts $$,
  '42501', null,
  'visitante anônimo NÃO lê as tentativas'
);

-- Conferência como dono do banco
reset role;
select results_eq(
  $$ select p.id, p.display_name_enc, p.district, c.whatsapp_hmac
     from public.profiles as p left join public.profile_contacts as c on c.profile_id = p.id
     where p.id in ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b3',
                    '00000000-0000-0000-0000-0000000000b5')
     order by p.id $$,
  $$ values ('00000000-0000-0000-0000-0000000000b2'::uuid, pg_temp.enc('b2'), null::text, repeat('b', 64)),
            ('00000000-0000-0000-0000-0000000000b3'::uuid, pg_temp.enc('b3'), null::text, null::text),
            ('00000000-0000-0000-0000-0000000000b5'::uuid, pg_temp.enc('b5'), null::text, null::text) $$,
  'os perfis e contatos de outra pessoa, do bloqueado e do suspenso não foram alterados'
);
select ok(
  has_table_privilege('authenticated', 'public.municipalities', 'select')
  and not has_table_privilege('authenticated', 'public.municipalities', 'insert')
  and not has_table_privilege('authenticated', 'public.municipalities', 'update'),
  'municípios: leitura para quem está logado, escrita só por migration'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'access_status', 'insert')
  and not has_column_privilege('authenticated', 'public.profiles', 'status', 'insert')
  and not has_column_privilege('authenticated', 'public.profiles', 'state_code', 'insert'),
  'ninguém cria perfil já liberado, com status ou com UF escolhida'
);
select is_empty(
  $$ select table_name, column_name, privilege_type
     from information_schema.column_privileges
     where grantee in ('authenticated', 'anon', 'PUBLIC')
       and table_schema = 'public' and table_name in ('profiles', 'profile_contacts')
       and privilege_type in ('INSERT', 'UPDATE') $$,
  'nenhuma coluna de perfil ou contato tem INSERT/UPDATE para a API (só a função grava)'
);
select ok(
  has_function_privilege('authenticated',
    'public.save_own_profile(text, integer, text, text, text, text)', 'execute')
  and not has_function_privilege('anon',
    'public.save_own_profile(text, integer, text, text, text, text)', 'execute'),
  'a função de gravar perfil é de quem está logado; visitante anônimo não executa'
);

select * from finish();
rollback;
