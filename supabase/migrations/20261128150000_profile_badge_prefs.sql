-- Perfil público (#305, decisão do Felipe de 2026-11-28): todo membro ativo vê foto, nome e medalhas de outro
-- membro ativo; o DONO escolhe quais medalhas aparecem e em que ordem.
-- 1. `profile_badge_prefs`: uma linha por medalha que a pessoa ordenou (`shown` liga ou desliga). Sem linhas,
--    vale o padrão (casa, totem). A lista de tipos é um CHECK fechado: crescer é trocar o CHECK numa migration.
-- 2. A pessoa grava só pelo conjunto inteiro, `set_my_badge_prefs`; nada é gravado direto pela API.
-- 3. `public_profile(id)` é a única leitura do perfil de OUTRA pessoa: nome cifrado e a lista de medalhas na
--    ordem escolhida. "Não existe", "inativo" e "sem permissão" dão o MESMO resultado (zero linhas): não
--    dá para enumerar perfis. Contato, formação, atividade e respostas NÃO passam por aqui (ADR 0010).
-- 4. A exclusão da conta apaga as preferências (cascade). O "baixar meus dados" as inclui em migration à parte,
--    junto da foto (#346), porque as duas redefinem `export_own_data`.

create table public.profile_badge_prefs (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  badge_kind text not null check (badge_kind in ('house', 'totem')),
  position smallint not null check (position between 1 and 20),
  shown boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (profile_id, badge_kind),
  -- Deferível: reordenar troca posições dentro de uma transação.
  constraint profile_badge_prefs_position_key unique (profile_id, position) deferrable initially deferred
);

comment on table public.profile_badge_prefs is
  'Quais medalhas aparecem no perfil público e em que ordem (#305). Sem linhas = padrão (casa, totem). Só o dono lê; grava por set_my_badge_prefs.';

create trigger profile_badge_prefs_set_updated_at
  before insert or update on public.profile_badge_prefs
  for each row execute function app.tg_set_updated_at();

alter table public.profile_badge_prefs enable row level security;

revoke all on public.profile_badge_prefs from public, anon, authenticated;
grant select on public.profile_badge_prefs to authenticated;

create policy profile_badge_prefs_select on public.profile_badge_prefs
  for select to authenticated
  using (profile_id = (select auth.uid()));

-- O conjunto inteiro, na ordem dada. `p_kinds` e `p_shown` têm o mesmo tamanho; tipo repetido ou fora da
-- lista dá 22023. Lista vazia volta ao padrão.
create or replace function public.set_my_badge_prefs(p_kinds text[], p_shown boolean[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  n integer := coalesce(cardinality(p_kinds), 0);
begin
  if caller is null or not app.is_active_member() then
    raise exception 'só quem está ativo escolhe as medalhas' using errcode = 'insufficient_privilege';
  end if;
  if n <> coalesce(cardinality(p_shown), 0)
     or n > 20
     or exists (select 1 from unnest(p_kinds) as k where k is null or k not in ('house', 'totem'))
     or exists (select 1 from unnest(p_shown) as s where s is null)
     or (select count(distinct k) from unnest(p_kinds) as k) <> n then
    raise exception 'medalhas inválidas' using errcode = 'invalid_parameter_value';
  end if;

  perform 1 from public.profiles as p where p.id = caller for update;

  delete from public.profile_badge_prefs where profile_id = caller;
  insert into public.profile_badge_prefs (profile_id, badge_kind, position, shown)
  select caller, t.k, t.ord::smallint, t.s
  from unnest(p_kinds, p_shown) with ordinality as t(k, s, ord);
end;
$$;

comment on function public.set_my_badge_prefs(text[], boolean[]) is
  'Define quais medalhas aparecem no perfil de quem chama e em que ordem. Única forma de gravar profile_badge_prefs (#305).';

revoke execute on function public.set_my_badge_prefs(text[], boolean[]) from public, anon;
grant execute on function public.set_my_badge_prefs(text[], boolean[]) to authenticated;

-- O perfil de uma pessoa ativa, para quem é membro ativo. Zero linhas em qualquer outro caso (sem distinguir).
create or replace function public.public_profile(p_id uuid)
returns table (profile_id uuid, display_name_enc text, badges text[])
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.display_name_enc,
    case
      when exists (select 1 from public.profile_badge_prefs as b where b.profile_id = p.id) then
        array(select b.badge_kind from public.profile_badge_prefs as b
              where b.profile_id = p.id and b.shown order by b.position)
      else array['house', 'totem']
    end
  from public.profiles as p
  where p.id = p_id
    and (select auth.uid()) is not null
    and app.is_active_member()
    and app.is_active_profile(p.id)
$$;

comment on function public.public_profile(uuid) is
  'Perfil público (#305): nome cifrado e medalhas na ordem do dono. Só para membro ativo; zero linhas se não existe, está inativo ou sem permissão.';

revoke execute on function public.public_profile(uuid) from public, anon;
grant execute on function public.public_profile(uuid) to authenticated;
