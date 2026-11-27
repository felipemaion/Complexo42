-- Parte SQL do seed em volume (#74). Chega depois do COPY de scripts/seed-volume.mjs, com a tabela
-- temporária seed_people (i, id, email, name_enc, wa_enc, wa_hmac) cheia. Tudo fictício.
-- Distribuição:
--   municípios da RMSP com pesos (São Paulo pesa 60, Guarulhos 8, Osasco/Santo André/SBC 5, o
--   resto 1); 10 regiões de volume em SP com equipes de 10 pessoas; 1 a 8 habilidades por pessoa;
--   20 missões publicadas para SP com 3 etapas; cada equipe faz uma missão, com a 1ª etapa
--   aprovada (e os pontos no livro-razão) e a 2ª entregue esperando validação.
begin;

do $$
begin
  if exists (select 1 from auth.users where email like 'volume-%@example.com') then
    raise exception 'já existe base em volume neste banco: rode npm run db:reset antes';
  end if;
  -- Trava que não depende do endereço: banco com contas de gente de verdade (fora dos domínios
  -- de teste) é recusado, mesmo que o endereço tenha passado pela trava do script.
  if (select count(*) from auth.users
      where email is null or (email not like '%@example.com' and email not like '%@exemplo.org')) > 20 then
    raise exception 'recusado: este banco tem contas que não são de teste (parece produção)';
  end if;
end;
$$;

-- 1) Contas e perfis ativos, com o termo vigente aceito.
insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
select id, email, 'authenticated', 'authenticated', now(), now(), now() from seed_people;

create temp table seed_city as
select m.code,
       sum(case m.code when 3550308 then 60 when 3518800 then 8 when 3534401 then 5 when 3547809 then 5 when 3548708 then 5 else 1 end)
         over (order by m.code) as upper_bound,
       sum(case m.code when 3550308 then 60 when 3518800 then 8 when 3534401 then 5 when 3547809 then 5 when 3548708 then 5 else 1 end)
         over () as total
from public.municipalities as m where m.state_code = 'SP';

insert into public.profiles (id, display_name_enc, municipality_code, consent_version, status, access_status)
select p.id, p.name_enc,
       (select c.code from seed_city as c where c.upper_bound > (p.i::bigint * 7919) % c.total order by c.upper_bound limit 1),
       app.current_consent_version(), 'active', 'active'
from seed_people as p;
insert into public.consent_acceptances (user_id, version) select id, app.current_consent_version() from seed_people;
insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac) select id, wa_enc, wa_hmac from seed_people;

-- 2) Regiões e equipes de volume (o trigger da tabela calcula o caminho a partir do pai).
insert into public.units (type_id, parent_id, slug, name, state_code, path)
select t.id, sp.id, format('vol_r%s', lpad(r::text, 2, '0')), format('Região de volume %s', r), null,
       format('vol_r%s', lpad(r::text, 2, '0'))::extensions.ltree
from generate_series(1, 10) as r
cross join (select id from public.unit_types where key = 'region') as t
cross join (select id from public.units where path = 'br.sp'::extensions.ltree) as sp;

create temp table seed_team as
select g as team_no, format('vol_t%s', lpad(g::text, 6, '0')) as slug, 1 + g % 10 as region_no
from generate_series(0, (select (max(i) / 10) from seed_people)) as g;

insert into public.units (type_id, parent_id, slug, name, state_code, path)
select t.id, r.id, st.slug, format('Equipe de volume %s', st.team_no), null, st.slug::extensions.ltree
from seed_team as st
cross join (select id from public.unit_types where key = 'team') as t
join public.units as r on r.slug = format('vol_r%s', lpad(st.region_no::text, 2, '0'));

-- Como o app faz ao pôr alguém numa equipe: fecha o vínculo aberto (o do estado, do cadastro).
update public.unit_members set left_at = now()
where left_at is null and profile_id in (select id from seed_people);
insert into public.unit_members (unit_id, profile_id)
select u.id, p.id
from seed_people as p
join seed_team as st on st.team_no = p.i / 10
join public.units as u on u.slug = st.slug;

-- 3) De 1 a 8 habilidades por pessoa, do catálogo ativo.
create temp table seed_skill as
select row_number() over (order by id) - 1 as k, id from public.skills where active;

insert into public.profile_skills (profile_id, skill_id)
select distinct p.id, s.id
from seed_people as p
cross join lateral generate_series(0, p.i % 8) as j
join seed_skill as s on s.k = (p.i * 7 + j * 11) % (select count(*) from seed_skill);

-- 4) Missões, etapas, execuções, entregas e pontos.
insert into public.missions (title, category, scope_unit_id, status, mode)
select format('Missão de volume %s', m), 'volume', sp.id, 'published', 'team'
from generate_series(1, 20) as m
cross join (select id from public.units where path = 'br.sp'::extensions.ltree) as sp;

insert into public.mission_steps (mission_id, position, title, points)
select mi.id, s, format('Etapa %s', s), s * 10
from public.missions as mi cross join generate_series(1, 3) as s
where mi.category = 'volume';

create temp table seed_mission as
select row_number() over (order by id) - 1 as k, id from public.missions where category = 'volume';

insert into public.mission_runs (mission_id, unit_id, status)
select sm.id, u.id, 'active'
from seed_team as st
join public.units as u on u.slug = st.slug
join seed_mission as sm on sm.k = st.team_no % 20;

-- Quem entrega: a primeira pessoa de cada equipe.
create temp table seed_run as
select r.id as run_id, r.mission_id, r.unit_id, p.id as author
from public.mission_runs as r
join public.units as u on u.id = r.unit_id and u.slug like 'vol\_t%'
join seed_team as st on st.slug = u.slug
join seed_people as p on p.i = st.team_no * 10;

insert into public.mission_run_members (run_id, profile_id) select run_id, author from seed_run;

insert into public.step_submissions (run_id, step_id, submitted_by, status, evidence_text, reviewed_at)
select sr.run_id, st.id, sr.author, 'approved', 'Entrega fictícia da base em volume.', now()
from seed_run as sr join public.mission_steps as st on st.mission_id = sr.mission_id and st.position = 1;
insert into public.step_submissions (run_id, step_id, submitted_by, status, evidence_text)
select sr.run_id, st.id, sr.author, 'submitted', 'Entrega fictícia esperando validação.'
from seed_run as sr join public.mission_steps as st on st.mission_id = sr.mission_id and st.position = 2;

insert into public.points_ledger (unit_id, profile_id, points, reason)
select sr.unit_id, sr.author, 10, 'Etapa aprovada (base em volume)' from seed_run as sr;

commit;
analyze;
