# ADR 0013: Núcleos, um agrupamento fora do território

- **Status:** Proposto. É decisão do gestor de 2026-11-24; os itens marcados com [?] dependem
  do stakeholder (`PERGUNTAS_STAKEHOLDER.md`, 81 a 87). Onde há [?], o texto traz o **padrão
  conservador** que vale até a resposta.
- **Data:** 2026-11-24
- **Numeração:** o 0012 está reservado pela issue #136.
- **Complementa:** ADR 0006 (missões), 0007 (medalhas), 0010 (contato) e 0011 (casa fora do
  território). Se aceito, o 0010 ganha a linha do coordenador de núcleo.

## Contexto

O gestor definiu um agrupamento novo, o **núcleo**, separado da árvore de território. Pessoas
de regiões diferentes podem estar no mesmo núcleo. Ele funciona como núcleo de **debate e de
tarefas públicas**: reuniões periódicas, estudo e tarefas práticas no bairro ou na cidade (por
exemplo, recuperar uma praça).

O núcleo não é turma nem equipe (`unit`), porque não tem lugar na árvore, e não é casa, porque
a casa é trilha de formação. O precedente mais próximo é a casa nacional do ADR 0011.

## Decisão

### 1. Entidade fora do território

- O rótulo na interface é **"Núcleo"**, configurável em `config/` (R17). No código, o nome
  é `circle`: `circles` e `circle_members`.
- `circles(id, name, municipality_code null, status, created_by, created_at)`, com `status`
  `active` ou `archived`. O nome é do núcleo, nunca de pessoa. O `municipality_code` é **do
  núcleo** (onde ele atua), não de quem participa.
- Não há `path` nem `parent_id`: o núcleo não herda escopo de ninguém, e a regra "quem tem
  papel em U vê U e abaixo" não o alcança.
- Quem cria o núcleo: o `manager` da raiz [?] (padrão conservador).

### 2. Vínculo pessoa↔núcleo, com aceite e histórico

`circle_members(id, circle_id, profile_id, join_method, joined_at, accepted_at null, left_at
null, ended_by null)`, no mesmo molde de `house_members` (ADR 0011):

- **Só conta com `accepted_at`.** Sem aceite, o vínculo não dá visão a ninguém.
- **Encerrar não apaga:** `left_at` guarda o histórico. A pessoa sai quando quiser. Se o
  coordenador encerrou, a pessoa não volta sozinha: a volta é dele.
- **Quantos núcleos por pessoa** [?]: padrão conservador, **um vínculo aberto**. Afrouxar
  depois é tirar o índice único; apertar exigiria migrar dados.
- **Como se entra** [?]: padrão conservador, **convite com aceite da pessoa** (o coordenador
  gera o convite; a pessoa o abre e aceita). Não exige diretório nem busca de pessoas. Entrada
  por pedido aprovado pelo coordenador fica para a resposta.
- **Quem está ativo:** só `access_status` e `status` `active` entram, veem e são vistos
  (ADR 0008 §1).

### 3. Coordenador de núcleo

- Papel `circle_coordinator`, com `circle_id`, em `role_assignments`. Como o
  `house_coordinator`, **não tem escopo territorial**: não gerencia unidade, não decide acesso
  e não concede nem revoga papel. Pode haver vários por núcleo.
- Concedido e revogado pelo `manager` da raiz (padrão conservador, [?]). Ninguém concede a si
  mesmo.
- **O que ele vê:** só os membros **ativos** do núcleo, com vínculo aceito: nome, habilidades
  e medalhas, pelas mesmas regras de perfil. **Não vê** território nem município da pessoa,
  vínculo de casa, avaliações nem outros núcleos dela.
- **Contato:** conta como "coordenação do escopo" do ADR 0010 **só para os membros do seu
  núcleo**: ao clicar em "ver contato", com `contact_viewed` e o mesmo limite por hora.
- **Colegas de núcleo não veem o contato uns dos outros.** Ampliar exige mudar o ADR 0010.
- Ele registra reuniões e presenças (§4) e encerra vínculos do próprio núcleo.

### 4. Reuniões e presença [?]

O núcleo tem reuniões periódicas. Se virarem entidade [?], o padrão conservador é o mínimo:

```
circle_meetings(id, circle_id, held_on, title null)     -- sem pauta em texto livre
circle_attendance(meeting_id, profile_id)               -- só quem esteve presente
```

- **Presença é dado pessoal mínimo:** só "esta pessoa esteve nesta reunião", sem hora, sem
  local e sem anotação. É dado da pessoa: `on delete cascade` (regra do `MODELO_DADOS`).
- Lê a presença quem esteve, o coordenador do núcleo e a própria pessoa. Mais ninguém, nem a
  coordenação territorial.
- Registrada pelo coordenador. Aceitar este ADR aprova esse dado (R4).
- **Pauta em texto livre fica fora** enquanto não houver resposta: ela atrai dado de terceiros.

### 5. Missões, pontos e medalhas

- **O núcleo pode assumir missões** (ADR 0006 §3), com `mission_runs.circle_id`: a execução é
  de uma pessoa, de uma unidade **ou** de um núcleo, nunca de mais de um. O núcleo assume
  missão do modo `team`, publicada com escopo que o alcance: nacional, ou a unidade do
  `municipality_code` do núcleo e acima. Sem município, só as nacionais.
- **Validação:** quem tem escopo sobre a missão (monitor ou gestor). **O coordenador de
  núcleo não valida as entregas do próprio núcleo.** Valem as regras antifraude do ADR 0006 §4.
- **Pontos:** os lançamentos do núcleo ficam no livro-razão, e o núcleo **não entra no placar
  de turmas** (ADR 0006 §6) até decisão [?]. Continua sem ranking individual.
- **Presença vira medalha:** a medalha de presença (`attendance`, ADR 0007 §3, issue #71) é
  concedida automaticamente a quem cumpre a regra do período. **A presença não conta pontos**
  [?] (padrão conservador).
- A conversa continua no WhatsApp (ADR 0006 §5): a plataforma não guarda bate-papo do núcleo.

### 6. Privacidade

- **Sem localização das pessoas.** O núcleo pode ter `municipality_code`; a pessoa, por causa
  do núcleo, nunca ganha local novo. Nada de mapa nem de endereço de reunião.
- **O vínculo de núcleo e a presença só os veem a própria pessoa e o coordenador do núcleo.**
  O gestor da raiz vê o núcleo e quantos membros ele tem, não quem são [?].
- **Nada de dado de saúde.** Atividade física entra só como **participação em evento**
  (medalha `event`, ADR 0007 §3), sem distância, tempo, batimentos nem comprovante (ADR 0006
  §7).
- **Evidência de tarefa pública** segue o ADR 0006 §7: protocolo, link ou notícia; sem foto.
- **Pertencer a um núcleo de debate pode revelar convicção** (LGPD art. 5º, II). Por isso a
  visibilidade é a mínima acima e o texto do termo (#7) precisa citar o vínculo e a presença.
  Pede parecer jurídico antes do lançamento do módulo.
- **Exclusão da conta:** `circle_members` e `circle_attendance` saem em cascata;
  `circle_members.ended_by` e `created_by` ficam nulos. A exportação "baixar meus dados"
  inclui os dois.
- **Auditoria:** `circle_joined`, `circle_left`, `circle_member_removed` e
  `circle_coordinator_granted`/`_revoked`, sem dado pessoal em claro.

### 7. Em aberto

| # | Pergunta | Padrão até a resposta |
|---|---|---|
| 81 | A pessoa está em um ou em vários núcleos? | Um |
| 82 | A entrada é por pedido aprovado pelo coordenador ou só por convite? | Convite |
| 83 | Há diretório de núcleos visível aos membros? | Não |
| 84 | Qual a relação com as casas? | Independentes: núcleo não substitui nem restringe a casa |
| 85 | Reunião, pauta e presença são entidades? | Reunião e presença mínimas; sem pauta |
| 86 | A presença conta pontos? | Não; só medalha |
| 87 | Quem cria núcleos e concede o coordenador? | `manager` da raiz |

## Alternativas consideradas

- **Núcleo como unidade da árvore:** daria escopo por `ltree`, mas o núcleo cruza regiões e
  teria de ficar sob um único pai. Descartado.
- **Núcleo como casa:** a casa é trilha de formação, uma por pessoa; misturar os dois apagaria
  o propósito de cada um. Descartado.
- **Núcleo como atributo do perfil:** não daria visão ao coordenador sem regra nova de
  permissão (contraria a R15).

## Consequências

- (+) Pessoas de regiões diferentes se organizam sem mexer na árvore de território.
- (+) Reusa o molde da casa: vínculo com aceite, histórico, coordenador sem escopo territorial.
- (−) Terceiro eixo de vínculo e papel novo: matriz de permissões nova e revisão adversarial
  (R16), com casos "outro núcleo → negado" e "coordenação territorial → negado".
- (−) Presença é dado novo e o vínculo pode revelar convicção: termo de consentimento e parecer
  jurídico antes do lançamento.
- (−) Nada disso existe em código: as issues de tabelas, reuniões e telas ficam bloqueadas até
  o stakeholder responder.
