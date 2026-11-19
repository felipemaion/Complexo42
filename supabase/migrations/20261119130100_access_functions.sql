-- Funções de acesso `app.*` (issue #46, ADR 0002 §Regras 3 e ADR 0005 §2).
-- Fonte única das decisões de acesso: as políticas RLS e o servidor usam estas funções
-- (R15). Todas são `security definer` (leem as tabelas sem passar pela RLS, o que evita
-- recursão nas políticas), `stable` e com `search_path = ''`.
--
-- Regra única de escopo: quem tem papel na unidade U enxerga U e tudo abaixo dela
-- (`units.path <@ U.path`). Papéis revogados (`revoked_at`) não contam.
--
-- | Papel        | Escopo de dados          | Vê perfil | Vê contato | Gerencia unidade | Concede papel (nunca a si)  |
-- |--------------|--------------------------|-----------|------------|------------------|-----------------------------|
-- | manager      | unidade e abaixo         | sim       | sim        | sim              | só em unidade descendente   |
-- | monitor      | unidade e abaixo         | sim       | sim        | sim              | nunca                       |
-- | spokesperson | unidade e abaixo         | sim       | não        | não              | nunca                       |
-- | tech_admin   | nenhum (só a estrutura)  | não       | não        | não              | só o 1º manager da raiz     |
-- | sem papel    | si mesmo                 | só o seu  | só o seu   | não              | nunca                       |
--
-- Revogar: quem concedeu revoga o que concedeu; manager revoga o que está abaixo dele.
--
-- Colegas de unidade não se veem por estas funções ainda: sem o `membership_axis` (#76),
-- um vínculo com a unidade do estado exporia todos os cadastrados do estado entre si.

-- Escopos ativos de quem chama. tech_admin fica de fora: é papel de sistema, sem escopo de
-- dados (ADR 0002, separação de funções).
create or replace function app.my_scopes()
returns table (unit_id uuid, unit_path extensions.ltree, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.unit_id, u.path, r.role
  from public.role_assignments as r
  join public.units as u on u.id = r.unit_id
  where r.profile_id = (select auth.uid())
    and r.revoked_at is null
    and r.role in ('monitor', 'manager', 'spokesperson');
$$;

comment on function app.my_scopes() is
  'Unidades (e caminhos) em que quem chama tem papel ativo com escopo de dados.';

-- Quem chama tem papel (entre `roles`) numa unidade igual ou acima de `target_path`?
create or replace function app.has_scope_over(target_path extensions.ltree, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.my_scopes() as s
    where s.role = any (roles)
      and target_path operator(extensions.<@) s.unit_path
  );
$$;

-- Pode ver o perfil (nome, habilidades) da pessoa? O próprio, ou alguém com vínculo aberto
-- numa unidade do escopo.
create or replace function app.can_view_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      target = (select auth.uid())
      or exists (
        select 1
        from public.unit_members as m
        join public.units as u on u.id = m.unit_id
        where m.profile_id = target
          and m.left_at is null
          and app.has_scope_over(u.path, array['monitor', 'manager', 'spokesperson'])
      )
    );
$$;

-- Pode ver o contato (WhatsApp, redes)? O próprio, ou monitor/manager do escopo. O servidor
-- registra `contact_viewed` no audit_log a cada visualização (ADR 0002, regra 6).
create or replace function app.can_view_contact(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      target = (select auth.uid())
      or exists (
        select 1
        from public.unit_members as m
        join public.units as u on u.id = m.unit_id
        where m.profile_id = target
          and m.left_at is null
          and app.has_scope_over(u.path, array['monitor', 'manager'])
      )
    );
$$;

-- Pode editar a unidade e seus vínculos? Monitor ou manager na unidade ou acima dela.
create or replace function app.can_manage_unit(target_unit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.units as u
    where u.id = target_unit
      and app.has_scope_over(u.path, array['monitor', 'manager'])
  );
$$;

-- Pode ver a unidade (nome, tipo, posição na árvore; nenhum dado pessoal)?
-- - tech_admin vê a estrutura inteira;
-- - quem tem papel vê o seu ramo e os ancestrais dele (o caminho até a raiz);
-- - quem tem vínculo aberto vê a sua unidade e os ancestrais dela.
create or replace function app.can_view_unit(target_unit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.units as u
    where u.id = target_unit
      and (
        exists (
          select 1 from public.role_assignments as r
          where r.profile_id = (select auth.uid())
            and r.role = 'tech_admin'
            and r.revoked_at is null
        )
        or exists (
          select 1 from app.my_scopes() as s
          where u.path operator(extensions.<@) s.unit_path
             or u.path operator(extensions.@>) s.unit_path
        )
        or exists (
          select 1
          from public.unit_members as m
          join public.units as mu on mu.id = m.unit_id
          where m.profile_id = (select auth.uid())
            and m.left_at is null
            and u.path operator(extensions.@>) mu.path
        )
      )
  );
$$;

-- Pode conceder `role` a `grantee` na unidade `target_unit`? (ADR 0005 §2)
-- - ninguém concede papel a si mesmo (nem o manager, nem o tech_admin: ADR 0002, regra 2);
-- - manager concede monitor, manager ou spokesperson só em unidade estritamente abaixo da
--   sua (nunca no mesmo nível nem acima, nunca fora do ramo);
-- - monitor e spokesperson nunca concedem;
-- - tech_admin só cria o primeiro manager da raiz, enquanto a raiz não tiver nenhum ativo
--   (o trigger `role_assignments_root_bootstrap` serializa essa checagem);
-- - ninguém concede tech_admin pela API (só no seed/operação).
create or replace function app.can_grant_role(role text, target_unit uuid, grantee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and grantee is not null
    and grantee <> (select auth.uid())
    and (
      (
        can_grant_role.role in ('monitor', 'manager', 'spokesperson')
        and exists (
          select 1
          from public.units as u
          join app.my_scopes() as s
            on u.path operator(extensions.<@) s.unit_path
           and u.path operator(extensions.<>) s.unit_path
          where u.id = target_unit
            and s.role = 'manager'
        )
      )
      or (
        can_grant_role.role = 'manager'
        and exists (
          select 1 from public.units as u
          where u.id = target_unit and u.parent_id is null
        )
        and exists (
          select 1 from public.role_assignments as r
          where r.profile_id = (select auth.uid())
            and r.role = 'tech_admin'
            and r.revoked_at is null
        )
        and not exists (
          select 1 from public.role_assignments as r
          where r.unit_id = target_unit
            and r.role = 'manager'
            and r.revoked_at is null
        )
      )
    );
$$;

-- Pode revogar um papel na unidade `target_unit`, concedido por `granter`?
-- - quem concedeu revoga o que concedeu;
-- - manager revoga qualquer papel em unidade estritamente abaixo da sua.
-- O manager da raiz não tem ninguém acima: se quem o concedeu não o revogar, removê-lo é
-- tarefa do operador, com acesso direto ao banco (ADR 0002).
create or replace function app.can_revoke_role(target_unit uuid, granter uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      granter = (select auth.uid())
      or exists (
        select 1
        from public.units as u
        join app.my_scopes() as s
          on u.path operator(extensions.<@) s.unit_path
         and u.path operator(extensions.<>) s.unit_path
        where u.id = target_unit
          and s.role = 'manager'
      )
    );
$$;

-- Serializa a criação do primeiro manager da raiz pela API: sem isto, dois INSERTs
-- simultâneos do tech_admin passariam ambos pela checagem "a raiz não tem manager" da
-- política (cada um com o seu snapshot). Depois da trava, a consulta da função (volátil)
-- vê o que a outra transação gravou. Inserções do operador (sem JWT) não passam por aqui.
create or replace function app.tg_role_assignments_root_bootstrap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'manager'
     and new.revoked_at is null
     and (select auth.uid()) is not null
     and exists (
       select 1 from public.units as u where u.id = new.unit_id and u.parent_id is null
     ) then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('app.root_manager_bootstrap')
    );
    if exists (
      select 1 from public.role_assignments as r
      where r.unit_id = new.unit_id and r.role = 'manager' and r.revoked_at is null
    ) then
      raise exception 'a raiz já tem um manager ativo'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

create trigger role_assignments_root_bootstrap
  before insert on public.role_assignments
  for each row execute function app.tg_role_assignments_root_bootstrap();

-- Ao se cadastrar, a pessoa entra na unidade do seu estado (ADR 0005 §2: "aluno sem
-- turma"). Função de trigger genérica para a tabela de perfis (#10), que tem `id` e
-- `state_code`:
--   create trigger ... after insert or update of state_code on public.profiles
--     for each row execute function app.tg_join_state_unit();
-- - sem unidade para o estado: não faz nada (o gestor matricula depois);
-- - já com vínculo numa unidade de estado: troca pelo do novo estado;
-- - já matriculado numa unidade abaixo (equipe, casa): não mexe, quem move é o gestor.
create or replace function app.tg_join_state_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  state_unit uuid;
  open_unit uuid;
  open_is_state boolean;
begin
  if new.state_code is null
     or (tg_op = 'UPDATE' and new.state_code is not distinct from old.state_code) then
    return null;
  end if;

  select u.id into state_unit
  from public.units as u
  where u.state_code = new.state_code and u.status = 'active';

  if state_unit is null then
    return null;
  end if;

  select m.unit_id, u.state_code is not null into open_unit, open_is_state
  from public.unit_members as m
  join public.units as u on u.id = m.unit_id
  where m.profile_id = new.id and m.left_at is null;

  if open_unit = state_unit or (open_unit is not null and not open_is_state) then
    return null;
  end if;

  if open_unit is not null then
    update public.unit_members
    set left_at = now()
    where profile_id = new.id and left_at is null;
  end if;

  insert into public.unit_members (unit_id, profile_id) values (state_unit, new.id);
  return null;
end;
$$;

-- Execução: as políticas RLS rodam com o papel de quem consulta (authenticated).
revoke execute on function
  app.my_scopes(),
  app.has_scope_over(extensions.ltree, text[]),
  app.can_view_profile(uuid),
  app.can_view_contact(uuid),
  app.can_manage_unit(uuid),
  app.can_view_unit(uuid),
  app.can_grant_role(text, uuid, uuid),
  app.can_revoke_role(uuid, uuid),
  app.tg_role_assignments_root_bootstrap(),
  app.tg_join_state_unit()
from public, anon;

grant execute on function
  app.my_scopes(),
  app.has_scope_over(extensions.ltree, text[]),
  app.can_view_profile(uuid),
  app.can_view_contact(uuid),
  app.can_manage_unit(uuid),
  app.can_view_unit(uuid),
  app.can_grant_role(text, uuid, uuid),
  app.can_revoke_role(uuid, uuid)
to authenticated;
