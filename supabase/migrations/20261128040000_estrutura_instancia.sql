-- Estrutura e catálogo FIXOS da instância, por migration (issue do staging, follow-up do #295).
-- O `supabase/seed.sql` só roda no `supabase db reset`/`start` e o `migra.sh` não aplica seed: o
-- servidor ficou sem tipos de unidade, sem raiz, sem casas e sem habilidades (e o bootstrap da
-- primeira coordenação não tinha onde criar o papel). Estas quatro coisas são iguais em toda instalação
-- desta instância e entram sozinhas no deploy, sem script instalado:
--   1. tipos de unidade (rótulos de `unit_types.label`, R17);
--   2. a unidade raiz nacional (uma só; só se ainda não houver raiz);
--   3. as casas nacionais (a chave é o `id` da casa em config/instance.ts; ADR 0011);
--   4. o catálogo PROVISÓRIO de habilidades (aguarda a aprovação do stakeholder).
-- Tudo idempotente e SEM sobrescrever o que o operador mudou: casa desativada continua desativada,
-- habilidade desativada ou renomeada à mão não volta. Nenhuma pessoa, nenhum papel e nenhum vínculo
-- (o primeiro gestor vem do bootstrap, #295). A árvore ABAIXO da raiz (estados, regiões, equipes) depende
-- da instalação: no ambiente local vem do seed; no servidor, o operador cria (docs/OPERACAO.md).

-- 1. Tipos de unidade. Só `team` junta colegas de equipe (ADR 0010, #119).
insert into public.unit_types (key, label, level, is_team) values
  ('national', 'Nacional', 0, false),
  ('state', 'Estado', 1, false),
  ('region', 'Região', 2, false),
  ('team', 'Equipe', 3, true)
on conflict (key) do nothing;

-- 2. A raiz nacional (o trigger calcula o `path`). Só se a instância ainda não tem raiz.
insert into public.units (type_id, parent_id, slug, name, path)
select t.id, null, 'br', 'Nacional', 'br'::extensions.ltree
from public.unit_types as t
where t.key = 'national'
  and not exists (select 1 from public.units as u where u.parent_id is null);

-- 3. Casas nacionais (ADR 0011). `tests/house-units.test.ts` confere esta lista com config/instance.ts.
insert into public.houses (key) values
  ('esparta'),
  ('atenas'),
  ('alexandria'),
  ('siracusa')
on conflict (key) do nothing;

-- 4. Catálogo PROVISÓRIO de habilidades (47 em 8 grupos; a chave é o nome). Mudança de catálogo = migration nova.
insert into public.skills (category, name, aliases) values
  -- 1. Comunicação e oratória
  ('Comunicação e oratória', 'Falar em público', array['oratória', 'discurso', 'palestra']),
  ('Comunicação e oratória', 'Debate', array['argumentação', 'contraponto']),
  ('Comunicação e oratória', 'Gravar vídeos falando para a câmera', array['vídeo selfie', 'porta-voz', 'apresentador']),
  ('Comunicação e oratória', 'Entrevistas e podcasts', array['podcast', 'entrevistador', 'live']),
  ('Comunicação e oratória', 'Mediação de conversa ou evento', array['moderador', 'mestre de cerimônias']),
  ('Comunicação e oratória', 'Comunicação em outro idioma', array['inglês', 'espanhol', 'libras']),
  -- 2. Coordenação e organização
  ('Coordenação e organização', 'Coordenar equipes', array['liderança', 'gestão de pessoas']),
  ('Coordenação e organização', 'Planejamento e cronogramas', array['organização', 'planejamento de tarefas']),
  ('Coordenação e organização', 'Secretaria e registro', array['atas', 'controle', 'planilhas de acompanhamento']),
  ('Coordenação e organização', 'Organização de eventos', array['produção de evento', 'logística']),
  ('Coordenação e organização', 'Captação de voluntários', array['recrutamento', 'mobilização']),
  ('Coordenação e organização', 'Mediação de conflitos', array['negociação', 'conciliação']),
  ('Coordenação e organização', 'Formação e treinamento', array['ensinar', 'capacitação', 'monitoria']),
  -- 3. Escrita e pesquisa
  ('Escrita e pesquisa', 'Redação de textos e artigos', array['escrita', 'artigo', 'texto opinativo']),
  ('Escrita e pesquisa', 'Roteiros', array['roteiro de vídeo', 'script']),
  ('Escrita e pesquisa', 'Revisão de textos', array['revisor', 'gramática']),
  ('Escrita e pesquisa', 'Pesquisa e levantamento de dados', array['pesquisa', 'fontes', 'checagem']),
  ('Escrita e pesquisa', 'Análise de dados e estatística', array['dados', 'gráficos', 'planilha avançada']),
  ('Escrita e pesquisa', 'Leitura e resumo de documentos', array['resumo', 'fichamento', 'legislação']),
  ('Escrita e pesquisa', 'Tradução', array['tradutor', 'versão']),
  -- 4. Produção audiovisual
  ('Produção audiovisual', 'Edição de vídeo', array['editor', 'Premiere', 'CapCut', 'DaVinci']),
  ('Produção audiovisual', 'Vídeos curtos para redes', array['reels', 'shorts', 'TikTok']),
  ('Produção audiovisual', 'Filmagem', array['câmera', 'cinegrafista', 'captação']),
  ('Produção audiovisual', 'Fotografia', array['foto', 'fotógrafo']),
  ('Produção audiovisual', 'Edição de áudio', array['podcast', 'mixagem', 'som']),
  ('Produção audiovisual', 'Legendagem', array['legendas', 'transcrição']),
  ('Produção audiovisual', 'Animação e motion', array['motion graphics', 'After Effects']),
  -- 5. Design e artes visuais
  ('Design e artes visuais', 'Design gráfico', array['designer', 'peças', 'Canva', 'Photoshop']),
  ('Design e artes visuais', 'Memes', array['humor', 'meme']),
  ('Design e artes visuais', 'Ilustração', array['desenho', 'cartum', 'charge']),
  ('Design e artes visuais', 'Identidade visual', array['marca', 'logotipo']),
  ('Design e artes visuais', 'Apresentações', array['slides', 'PowerPoint', 'Google Slides']),
  -- 6. Redes sociais e comunicação digital
  ('Redes sociais e comunicação digital', 'Gestão de redes sociais', array['social media', 'Instagram', 'X', 'Facebook']),
  ('Redes sociais e comunicação digital', 'Criação de conteúdo', array['influenciador', 'criador', 'posts']),
  ('Redes sociais e comunicação digital', 'Copywriting e legendas', array['copy', 'legenda', 'chamada']),
  ('Redes sociais e comunicação digital', 'Análise de métricas', array['métricas', 'engajamento', 'alcance']),
  ('Redes sociais e comunicação digital', 'Comunidades e grupos', array['WhatsApp', 'Telegram', 'moderação de grupos']),
  -- 7. Tecnologia
  ('Tecnologia', 'Programação', array['desenvolvedor', 'programador', 'código']),
  ('Tecnologia', 'Sites e páginas', array['site', 'WordPress', 'landing page']),
  ('Tecnologia', 'Automação e planilhas', array['Excel', 'Google Sheets', 'automação']),
  ('Tecnologia', 'Suporte técnico', array['informática', 'configuração']),
  ('Tecnologia', 'Inteligência artificial (uso prático)', array['IA', 'ChatGPT', 'prompts']),
  -- 8. Atuação local
  ('Atuação local', 'Conhecimento do próprio bairro', array['comunidade', 'território']),
  ('Atuação local', 'Contato com associações e entidades', array['associação de bairro', 'conselhos']),
  ('Atuação local', 'Abordagem de rua e panfletagem', array['rua', 'abordagem', 'distribuição']),
  ('Atuação local', 'Motorista e transporte', array['carro', 'carona', 'transporte']),
  ('Atuação local', 'Jurídico', array['advogado', 'direito', 'OAB'])
on conflict (name) do nothing;
