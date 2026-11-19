-- Catálogo de habilidades — PROVISÓRIO, aguardando a aprovação do stakeholder (issue #8; a
-- #15 depende dele). Só desenvolvimento local: roda no `supabase db reset` e nunca em
-- produção, que recebe o catálogo aprovado por migration.
--
-- Para trocar o catálogo, edite SÓ este arquivo (uma linha por habilidade:
-- categoria, nome, sinônimos da busca) e rode `npm run db:reset`. O comando é idempotente:
-- a chave é o nome. Rodar de novo REATIVA as habilidades que estiverem desativadas (`active`
-- volta a true) e restaura categoria e sinônimos; uma habilidade que sair daqui não é apagada,
-- só some com o reset.
-- Testes: supabase/tests/skills.test.sql (quantidade e grupos).

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
on conflict (name) do update
  set category = excluded.category, aliases = excluded.aliases, active = true;
