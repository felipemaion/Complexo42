-- "Baixar meus dados" (#20, LGPD art. 18, II) com o que entrou depois: medalhas, portfólio,
-- pontos, entregas de missão e mensagens da equipe escritas pela pessoa. Função irmã de
-- export_own_data (que segue igual, com o limite por hora e a auditoria); o app chama as duas e
-- junta no mesmo arquivo. Só lê, só os dados de quem chama; o que é cifrado sai cifrado e o app
-- decifra. A avaliação reservada fica fora até o parecer do jurídico (ADR 0007 §4).

create or replace function public.export_own_activity()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'badges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', b.name,
        'reason', pb.reason,
        'awarded_at', pb.awarded_at,
        'revoked_at', pb.revoked_at,
        'revoked_reason', pb.revoked_reason
      ) order by pb.awarded_at, pb.id)
      from public.profile_badges as pb
      join public.badges as b on b.id = pb.badge_id
      where pb.profile_id = caller
    ), '[]'::jsonb),
    'portfolio', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', i.title,
        'kind', i.kind,
        'url_enc', i.url_enc,
        'created_at', i.created_at
      ) order by i.position)
      from public.portfolio_items as i
      where i.profile_id = caller
    ), '[]'::jsonb),
    'points_total', coalesce((select sum(l.points) from public.points_ledger as l where l.profile_id = caller), 0),
    'points', coalesce((
      select jsonb_agg(jsonb_build_object('points', l.points, 'reason', l.reason, 'created_at', l.created_at)
        order by l.created_at, l.id)
      from public.points_ledger as l
      where l.profile_id = caller
    ), '[]'::jsonb),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mission', m.title,
        'step', st.title,
        'status', s.status,
        'evidence_url', s.evidence_url,
        'evidence_text', s.evidence_text,
        'review_note', s.review_note,
        'created_at', s.created_at
      ) order by s.created_at, s.id)
      from public.step_submissions as s
      join public.mission_steps as st on st.id = s.step_id
      join public.missions as m on m.id = st.mission_id
      where s.submitted_by = caller
    ), '[]'::jsonb),
    'team_messages', coalesce((
      select jsonb_agg(jsonb_build_object('team_id', t.unit_id, 'body_enc', t.body_enc, 'created_at', t.created_at)
        order by t.created_at, t.id)
      from public.team_messages as t
      where t.author_id = caller
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.export_own_activity() from public, anon;
grant execute on function public.export_own_activity() to authenticated;
