-- Guarda do `audit_log_event_check` (#365). Cada migration que acrescenta um evento redefine a restrição com a lista inteira;
-- partir de uma cópia velha apaga os eventos dos outros e só aparece no servidor, quando a função tenta gravar. Aqui, todo
-- `event` que uma função do banco grava em `audit_log` (lido do código da função, em `pg_proc.prosrc`) tem de ser aceito
-- pela restrição vigente: a perda vira falha de CI.
--
-- Como lê: em cada `insert into [public.]audit_log (colunas) values (...)` ou `... select ...`, pega a expressão que cai
-- na posição da coluna `event` (dividindo por vírgula no nível de cima, sem contar vírgula de parêntese nem de texto).
-- Literal simples vale como evento; num `case`, valem os literais depois de `then` e `else`. Limite: evento montado
-- por variável ou concatenação não é visto (nenhuma função faz isso hoje; o teste confere que acha os conhecidos).
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

create function pg_temp.split_top(txt text) returns text[] language plpgsql as $$
declare
  parts text[] := '{}';
  cur text := '';
  depth int := 0;
  quoted boolean := false;
  ch text;
begin
  for i in 1..coalesce(length(txt), 0) loop
    ch := substr(txt, i, 1);
    if ch = '''' then
      quoted := not quoted;
      cur := cur || ch;
    elsif quoted then
      cur := cur || ch;
    elsif ch = '(' then
      depth := depth + 1;
      cur := cur || ch;
    elsif ch = ')' then
      depth := depth - 1;
      cur := cur || ch;
    elsif ch = ',' and depth = 0 then
      parts := parts || btrim(cur, E' \n\t');
      cur := '';
    else
      cur := cur || ch;
    end if;
  end loop;
  return parts || btrim(cur, E' \n\t');
end
$$;

-- Eventos que as funções de `public` e `app` gravam em `audit_log`.
create function pg_temp.events_written() returns table (fn text, event text) language plpgsql as $$
declare
  f record;
  m text[];
  src text;
  cols text[];
  exprs text[];
  idx int;
  expr text;
  lit text;
begin
  for f in
    select n.nspname || '.' || p.proname as name, p.prosrc
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prokind = 'f' and p.prosrc ~* 'insert\s+into\s+(public\.)?audit_log'
  loop
    src := regexp_replace(f.prosrc, '--[^\n]*', '', 'g');
    for m in
      select regexp_matches(src,
        'insert\s+into\s+(?:public\.)?audit_log\s*\(([^)]*)\)\s*(?:values\s*\((.*?)\)\s*(?:;|returning|on\s+conflict)|select\s+(.*?)\s+(?:from\s|;))',
        'gis')
    loop
      cols := pg_temp.split_top(m[1]);
      idx := null;
      for i in 1..array_length(cols, 1) loop
        if lower(cols[i]) = 'event' then idx := i; end if;
      end loop;
      continue when idx is null;
      exprs := pg_temp.split_top(coalesce(m[2], m[3]));
      expr := exprs[idx];
      if expr ~* '^case\M' then
        for lit in select (regexp_matches(expr, '(?:then|else)\s+''([a-z0-9_]+)''', 'gi'))[1] loop
          fn := f.name; event := lit; return next;
        end loop;
      elsif expr ~ '^''[a-z0-9_]+''(::text)?$' then
        fn := f.name; event := (regexp_match(expr, '''([a-z0-9_]+)'''))[1]; return next;
      end if;
    end loop;
  end loop;
end
$$;

-- Os eventos que a restrição vigente aceita.
create function pg_temp.events_allowed() returns setof text language sql as $$
  select (regexp_matches(pg_get_constraintdef(c.oid), '''([a-z0-9_]+)''', 'g'))[1]
  from pg_constraint as c
  where c.conrelid = 'public.audit_log'::regclass and c.conname = 'audit_log_event_check'
$$;

select cmp_ok((select count(distinct event)::int from pg_temp.events_written()), '>=', 15,
  'a leitura do código das funções acha os eventos que elas gravam (sanidade do próprio teste)');
select ok(
  (select array_agg(event) from pg_temp.events_written() where event in ('house_window_opened', 'members_attached_to_state', 'data_exported', 'access_blocked')) @> array['house_window_opened', 'members_attached_to_state', 'data_exported', 'access_blocked'],
  'acha eventos conhecidos, inclusive o de um `case` (access_blocked)'
);
select is_empty(
  $$ select distinct w.event, w.fn from pg_temp.events_written() as w where w.event not in (select * from pg_temp.events_allowed()) order by 1, 2 $$,
  'todo evento que uma função grava é aceito por audit_log_event_check (cópia velha da lista apaga evento dos outros)'
);

-- Prova de que a guarda enxerga o problema: uma função que grava um evento fora da restrição aparece.
create function public.audit_guard_probe() returns void language plpgsql as $$
begin
  insert into public.audit_log (actor_id, event) values (null, 'evento_que_nao_existe');
end
$$;
select set_eq(
  $$ select w.event from pg_temp.events_written() as w where w.event not in (select * from pg_temp.events_allowed()) $$,
  array['evento_que_nao_existe'],
  'a guarda aponta o evento fora da restrição'
);
drop function public.audit_guard_probe();
select is_empty(
  $$ select 1 from pg_temp.events_written() as w where w.event not in (select * from pg_temp.events_allowed()) $$,
  'sem a função de prova, nada fora da restrição'
);

select * from finish();
rollback;
