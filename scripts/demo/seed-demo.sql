-- Demonstração com pessoas FICTÍCIAS (perfil-ficticio-NN@example.com). Só para o banco LOCAL.
-- Ordem: npm run db:reset && npm run db:seed-profiles && psql ... -f scripts/demo/seed-demo.sql
-- Coordenação = perfil-ficticio-04 (Incubadora ABC); membro que coordena a Equipe Orçamento =
-- perfil-ficticio-07. Tudo depois do papel e das filiações passa pelas funções do app "em nome" de
-- cada pessoa (as regras de permissão e o livro de pontos valem). Uma transação: falhou, nada fica.
\set ON_ERROR_STOP on
begin;

create function pg_temp.como(p_email text) returns uuid language plpgsql as $$
declare uid uuid;
begin
  select id into strict uid from auth.users where email = p_email;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  return uid;
end $$;
create function pg_temp.uid(p_email text) returns uuid language sql as $$ select id from auth.users where email = p_email $$;
create function pg_temp.etapa(p_mission uuid, p_pos int) returns uuid language sql as $$
  select id from public.mission_steps where mission_id = p_mission and position = p_pos
$$;
create function pg_temp.email(p_n int) returns text language sql as $$ select format('perfil-ficticio-%s@example.com', lpad(p_n::text, 2, '0')) $$;

do $$
declare
  abc uuid := (select id from public.units where slug = 'abc');
  coord constant text := 'perfil-ficticio-04@example.com';
  gabi constant text := 'perfil-ficticio-07@example.com';
  orc uuid; sau uuid; edu uuid;
  n int;
  m_texto uuid; m_camara uuid; m_video uuid; m_escolas uuid; m_debate uuid; m_campanha uuid;
  r uuid; s uuid;
  b_primeira uuid; b_pesquisa uuid; b_comunica uuid; b_rua uuid;
begin
  if abc is null then raise exception 'rode antes: npm run db:reset (o seed cria a Incubadora ABC)'; end if;
  if pg_temp.uid(coord) is null then raise exception 'rode antes: npm run db:seed-profiles'; end if;

  -- 1) Papel e filiações (direto: é o que a nacional faria pela tela de papéis).
  insert into public.role_assignments (profile_id, role, unit_id) values (pg_temp.uid(coord), 'manager', abc);
  for n in 1..22 loop
    update public.unit_members set left_at = now() where profile_id = pg_temp.uid(pg_temp.email(n)) and left_at is null;
    insert into public.unit_members (unit_id, profile_id) values (abc, pg_temp.uid(pg_temp.email(n)));
  end loop;

  -- 2) Coordenação monta as equipes e escolhe quem coordena cada uma.
  perform pg_temp.como(coord);
  orc := public.create_team(abc, 'Equipe Orçamento');
  sau := public.create_team(abc, 'Equipe Saúde');
  edu := public.create_team(abc, 'Equipe Educação');
  foreach n in array array[7, 1, 5, 2, 6] loop perform public.assign_to_team(pg_temp.uid(pg_temp.email(n)), orc); end loop;
  foreach n in array array[8, 9, 10, 11, 12, 13] loop perform public.assign_to_team(pg_temp.uid(pg_temp.email(n)), sau); end loop;
  foreach n in array array[14, 15, 16, 17, 18] loop perform public.assign_to_team(pg_temp.uid(pg_temp.email(n)), edu); end loop;
  perform public.set_team_lead(orc, pg_temp.uid(gabi));
  perform public.set_team_lead(sau, pg_temp.uid(pg_temp.email(8)));
  perform public.set_team_lead(edu, pg_temp.uid(pg_temp.email(14)));
  perform public.set_team_identity(orc, 'Cada centavo com nome e endereço', array['#d4a537', '#0b0d12'], 'balanca');
  perform public.set_team_identity(sau, 'Saúde se cobra no bairro', array['#1e7b4a', '#f2efe6', '#0b0d12'], 'escudo');
  perform public.set_team_identity(edu, 'Escola cheia, futuro aberto', array['#1f4e79', '#f2c14e'], 'livro');

  -- 3) Missões da Incubadora ABC.
  m_texto := public.publish_mission('Texto sobre o orçamento da cidade', 'Escrever um texto curto sobre o orçamento e protocolar na câmara. Prazo: 28/11.',
    'escrita', abc, 'team', '[{"title":"Escrever o texto","points":10,"evidence_type":"text"}]');
  m_camara := public.publish_mission('Protocolar pedido de informação na Câmara',
    'Peça à Câmara os gastos com publicidade do último ano, pela Lei de Acesso à Informação. Prazo: 30 de novembro.', 'acao', abc, 'team',
    '[{"title":"Escrever o pedido","points":20,"evidence_type":"text"},{"title":"Protocolar na Câmara","points":40,"evidence_type":"protocol_number"},{"title":"Publicar a resposta","points":20,"evidence_type":"link"}]');
  m_video := public.publish_mission('Vídeo curto explicando a votação da semana', 'Um vídeo de até 1 minuto, em linguagem simples, sobre o que a Câmara votou.',
    'video', abc, 'individual', '[{"title":"Escrever o roteiro","points":10,"evidence_type":"text"},{"title":"Gravar e publicar","points":30,"evidence_type":"link"}]');
  m_escolas := public.publish_mission('Mapear as escolas do bairro', 'Liste as escolas públicas do bairro e visite duas para ouvir diretores e famílias.',
    'acao', abc, 'team',
    '[{"title":"Lista das escolas","points":20,"evidence_type":"text"},{"title":"Visitar duas escolas","points":40,"evidence_type":"text"},{"title":"Relatório final","points":30,"evidence_type":"link"}]');
  m_debate := public.publish_mission('Debate na praça sobre transporte', 'Organize um debate aberto sobre ônibus e mobilidade, com convite aos moradores.',
    'evento', abc, 'team', '[{"title":"Marcar local e data","points":20,"evidence_type":"text"},{"title":"Realizar o debate","points":60,"evidence_type":"link"}]');
  m_campanha := public.publish_mission('Campanha de assinaturas pela transparência', 'Junte assinaturas pedindo um portal de gastos abertos da prefeitura.',
    'campanha', abc, 'team', '[{"title":"Montar a página da campanha","points":20,"evidence_type":"link"},{"title":"Colher 100 assinaturas","points":50,"evidence_type":"text"}]');

  -- 4) Medalhas: manuais e uma automática (100 pontos).
  b_primeira := public.create_badge(abc, 'Primeira entrega', 'A primeira etapa validada numa missão.', 'estrela');
  b_pesquisa := public.create_badge(abc, 'Pesquisa de fôlego', 'Levantamento caprichado, com fontes.', 'livro');
  b_comunica := public.create_badge(abc, 'Comunicação', 'Explicou um tema difícil de um jeito simples.', 'megafone');
  b_rua := public.create_badge(abc, 'Na rua', 'Levou a missão para o bairro, cara a cara.', 'escudo');
  perform public.create_auto_badge(abc, 'Cem pontos', 'Chegou a 100 pontos.', 'fogo', 'points_threshold', null, 100);

  -- 5) Atividade: Orçamento (Gabriela) concluiu o texto; Câmara e vídeo com uma etapa validada e outra esperando.
  perform pg_temp.como(gabi);
  r := public.start_mission_run(m_texto);
  s := public.submit_step(r, pg_temp.etapa(m_texto, 1), null, 'Texto de uma página sobre o orçamento, com as três maiores despesas.');
  perform pg_temp.como(coord); perform public.review_submission(s, true, 'Claro e bem escrito.');
  perform pg_temp.como(gabi);
  r := public.start_mission_run(m_camara);
  s := public.submit_step(r, pg_temp.etapa(m_camara, 1), null, 'Pedido escrito com base na Lei de Acesso à Informação, artigo 10.');
  perform pg_temp.como(coord); perform public.review_submission(s, true, 'Bem escrito. Pode protocolar.');
  perform pg_temp.como(gabi);
  perform public.submit_step(r, pg_temp.etapa(m_camara, 2), null, 'PROT 2026/4482');
  r := public.start_mission_run(m_video);
  s := public.submit_step(r, pg_temp.etapa(m_video, 1), null, 'Roteiro: o que foi votado, quem votou a favor e o que muda no bairro.');
  perform pg_temp.como(coord); perform public.review_submission(s, true, 'Roteiro claro.');
  perform pg_temp.como(gabi);
  perform public.submit_step(r, pg_temp.etapa(m_video, 2), 'https://youtube.com/shorts/exemplo-votacao', null);

  -- Saúde: escolas com duas etapas validadas e o relatório esperando.
  perform pg_temp.como(pg_temp.email(8));
  r := public.start_mission_run(m_escolas);
  s := public.submit_step(r, pg_temp.etapa(m_escolas, 1), null, 'Doze escolas estaduais e municipais no bairro, com endereço.');
  perform pg_temp.como(coord); perform public.review_submission(s, true, 'Ótima lista.');
  perform pg_temp.como(pg_temp.email(9));
  s := public.submit_step(r, pg_temp.etapa(m_escolas, 2), null, 'Visitamos duas escolas; falta merenda no turno da noite.');
  perform pg_temp.como(coord); perform public.review_submission(s, true, 'Relato muito bom.');
  perform pg_temp.como(pg_temp.email(8));
  perform public.submit_step(r, pg_temp.etapa(m_escolas, 3), 'https://docs.google.com/document/d/relatorio-escolas', null);

  -- Educação: debate com a primeira etapa validada.
  perform pg_temp.como(pg_temp.email(14));
  r := public.start_mission_run(m_debate);
  s := public.submit_step(r, pg_temp.etapa(m_debate, 1), null, 'Praça da Matriz, sábado 29/11 às 10 h.');
  perform pg_temp.como(coord); perform public.review_submission(s, true, 'Combinado.');

  -- 6) Medalhas dadas pela coordenação, com motivo.
  perform public.grant_badge(b_primeira, pg_temp.uid(gabi), 'Primeira etapa validada na missão da Câmara.');
  perform public.grant_badge(b_comunica, pg_temp.uid(gabi), 'Roteiro do vídeo da votação muito claro.');
  perform public.grant_badge(b_pesquisa, pg_temp.uid(pg_temp.email(9)), 'Relato das visitas às escolas, com detalhes.');
  perform public.grant_badge(b_rua, pg_temp.uid(pg_temp.email(14)), 'Marcou o debate na praça com os moradores.');

  -- 7) Equipes de antes da plataforma (#136): a Gabriela informa duas, sem confirmação.
  perform pg_temp.como(gabi);
  perform public.add_prior_team('Equipe Transporte Público', '2023', 'spokesperson');
  perform public.add_prior_team('Equipe Bairro Limpo', 'ciclo 2024/1', 'member');
end $$;

commit;
