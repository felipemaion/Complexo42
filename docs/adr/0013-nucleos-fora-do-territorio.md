# ADR 0013: Núcleos, uma árvore de grupos fora do território

- **Status:** Proposto. É decisão do gestor de 2026-11-24, com as respostas dele no mesmo dia.
  Os itens marcados com [?] dependem do stakeholder (`PERGUNTAS_STAKEHOLDER.md`, 87 a 89), e
  cada um traz o **padrão conservador** que vale até a resposta.
- **Data:** 2026-11-24
- **Numeração:** o 0012 está reservado pela issue #136.
- **Complementa:** ADR 0005 (árvore `ltree`), 0006 (missões e pontos), 0007 (medalhas), 0010
  (contato) e 0011 (casa fora do território). Se aceito, o 0010 ganha a linha do coordenador
  de núcleo.

## Contexto

O gestor definiu um agrupamento novo, o **núcleo**, separado da árvore de território. Pessoas
de regiões diferentes podem estar no mesmo núcleo. Ele funciona como núcleo de **debate e de
tarefas públicas**: reuniões periódicas, estudo e tarefas práticas no bairro ou na cidade (por
exemplo, recuperar uma praça).

O núcleo não é turma nem equipe (`unit`), e **não é casa**: a casa é um grupo da Academia, e o
núcleo é outro conceito, com hierarquia interna. Os dois são independentes e não têm vínculo
entre si.

O gestor confirmou que valem **duas hierarquias ao mesmo tempo**: (1) a **árvore de núcleos**
(núcleo e subnúcleos) e (2) a **hierarquia de cargos** dentro de cada núcleo (§4).

## Decisão

### 1. Árvore de núcleos, separada do território

- O rótulo na interface é **"Núcleo"** (e "Subnúcleo"), configurável em `config/` (R17). No
  código, o nome é `circle`: `circles` e `circle_members`.
- `circles(id, parent_id null, slug, name, path ltree, municipality_code null, status,
  created_by, created_at)`, com `status` `active` ou `archived`. É o mesmo padrão de `units`
  (ADR 0005), numa **árvore própria**: núcleo nenhum entra na árvore de território.
- O nome é do núcleo, nunca de pessoa. O `municipality_code` é **do núcleo** (onde ele atua);
  cada subnúcleo tem o seu.
- **Núcleo dentro de núcleo é permitido.** Um subnúcleo não muda de pai: para reorganizar,
  arquiva-se e cria-se de novo. Arquivar um núcleo arquiva os de baixo.
- **Quem cria:** o núcleo de topo, o `manager` da raiz [?] (pergunta 87); um subnúcleo, quem
  está no nível de topo (§4) do núcleo pai ou de um núcleo acima dele.
- **Independente da casa:** nenhuma regra de casa vale no núcleo, e nenhuma de núcleo vale na
  casa. O coordenador de casa não vê núcleos.

### 2. Vínculo pessoa↔núcleo: vários, um principal

`circle_members(id, circle_id, profile_id, level, is_primary, join_method, joined_at,
accepted_at null, left_at null, ended_by null)`, no molde de `house_members` (ADR 0011):

- **A pessoa pode estar em vários núcleos** (e subnúcleos), ao mesmo tempo. O vínculo é com um
  **nó** da árvore. Estar num subnúcleo **não** faz a pessoa membro do núcleo pai.
- **Exatamente um é o principal** (`is_primary`): índice único parcial por pessoa, só entre
  vínculos abertos e aceitos. O principal é o núcleo mostrado no perfil. Ele **não** muda
  visão nem aprovação.
  - O primeiro vínculo aceito vira o principal.
  - A pessoa troca o principal quando quiser, entre os vínculos abertos e aceitos.
  - Se o principal for encerrado ou arquivado, o vínculo aberto e aceito **mais antigo** vira o
    principal. Sem vínculo aberto, a pessoa não tem principal.
- **Só conta com `accepted_at`.** Sem aceite, o vínculo não dá visão a ninguém.
- **Encerrar não apaga:** `left_at` guarda o histórico. A pessoa sai quando quiser. Se outra
  pessoa encerrou o vínculo, ela não volta sozinha: a volta é decisão de quem tem o nível de
  topo naquele núcleo ou acima.
- Só `access_status` e `status` `active` entram, veem e são vistos (ADR 0008 §1).

### 3. Entrada por pedido e aprovação

```
circle_join_requests(id, circle_id, profile_id, status, requested_at, decided_by null,
                     decided_at null)
  status: 'pending' | 'approved' | 'rejected'
```

- A pessoa **pede**; quem aprova **aprova ou recusa**. Aprovar cria o vínculo, com
  `join_method = 'request'`, e a pessoa o aceita. Um pedido pendente por pessoa e núcleo.
- **Quem aprova a entrada num núcleo:** quem está no **nível de topo** daquele núcleo **ou de
  qualquer núcleo acima dele** na árvore. Para o subnúcleo, vale o coordenador dele ou o de
  qualquer ancestral. Níveis intermediários não aprovam (§4). Ninguém aprova o próprio pedido.
- **Sem diretório:** a pessoa não lista núcleos. Ela chega ao núcleo por um **link de pedido**
  que o coordenador compartilha; o link só abre a tela de pedir, e não dá entrada.
- **Para pedir um subnúcleo, não é preciso ser membro do pai** [?] (pergunta 88, padrão).
- Pedido, aprovação, recusa, entrada e saída geram evento no `audit_log` (§7), sem dado pessoal
  em claro.

### 4. Cargos dentro de cada núcleo (hierarquia 2)

- **Os níveis são configuráveis por instância**, com rótulos em `config/` (R17): uma lista
  ordenada, do **topo** (coordenador) ao **mais baixo** (membro), com níveis intermediários
  opcionais. O padrão são dois níveis: coordenador e membro. `circle_members.level` guarda a
  chave do nível; o código só conhece "topo" e "mais baixo", nunca os rótulos.
- **Quem concede:** quem tem o nível de topo do núcleo (ou de um núcleo acima) concede níveis
  **estritamente abaixo do topo**. Designar um **novo topo** cabe ao topo de um núcleo
  estritamente acima, ou, no núcleo de topo da árvore, ao `manager` da raiz. Ninguém muda o
  próprio nível. Pode haver vários no topo.
- **O nível de topo não tem escopo territorial**, como o coordenador de casa: não gerencia
  unidade, não decide acesso e não concede papel do ADR 0002.

### 5. Como as duas hierarquias se combinam

Seja **X** quem vê ou aprova, com nível L no núcleo N, e **Y** o alvo, com vínculo em M.

| O que | Regra |
|---|---|
| **Ver o perfil de Y** (nome, habilidades, medalhas) | **Topo de N:** vê todos os membros ativos de N **e dos subnúcleos abaixo** (`M.path <@ N.path`), de qualquer nível. **Nível intermediário de N:** vê só quem está em N, em nível **abaixo do seu**. **Nível mais baixo:** só vê a si |
| **Ver o contato de Y** (ADR 0010) | Só o **topo**, no escopo acima (N e abaixo), ao clicar, com `contact_viewed` e o limite por hora. Intermediário e colegas **não** veem contato |
| **Aprovar um pedido para M** | Topo de M **ou** de qualquer ancestral de M (`N.path @> M.path`) |
| **Conceder nível em M** | Topo de M ou de ancestral de M, abaixo do topo (§4) |
| **Registrar reunião e presença de M** (§6) | Topo de M; o de ancestral só vê |

- **Árvore** responde "**onde** X alcança": o próprio núcleo e os de baixo. **Cargo** responde
  "**o quê** X pode fazer": só o topo desce a árvore; os cargos intermediários valem **dentro de
  cada núcleo**, sem atravessar para o subnúcleo.
- **Não há vista para cima nem para os lados:** subnúcleo não vê o pai, e núcleo irmão não vê
  o irmão. Coordenação territorial e gestor da raiz também não veem os membros (§7).
- Funções `app.can_*` próprias (R15), sem reimplementar a regra no front.

### 6. Reuniões, pauta e presença

```
circle_meetings(id, circle_id, held_on, title, agenda null)       -- agenda ≤ 500 caracteres
circle_attendance(meeting_id, profile_id, registered_by)          -- só quem esteve presente
```

- **A pauta entra na plataforma.** É texto curto, com o aviso "não inclua dados de outras
  pessoas". Quem lê: os membros ativos do núcleo da reunião e quem vê o núcleo (§5).
- **Presença é dado pessoal mínimo:** só "esta pessoa esteve nesta reunião", sem hora, local
  nem anotação. É dado da pessoa. Lê quem esteve e quem vê o membro (§5); a coordenação
  territorial, não.
- **Quem registra** é o topo do núcleo. **Ninguém registra a própria presença:** a do
  coordenador é registrada por outro topo do núcleo ou de um núcleo acima.
- **A presença conta pontos**, além da medalha. Cada presença gera **um lançamento individual**
  no livro-razão do ADR 0006 §4, na mesma transação do registro, com `reason = 'attendance'`
  e `circle_id`. O valor por reunião vem de `config/`. Único por (reunião, pessoa); correção é
  lançamento negativo. Continua **sem ranking individual** (ADR 0006 §6).
- **Presença vira medalha:** a medalha `attendance` (ADR 0007 §3, issue #71) é concedida
  automaticamente a quem cumpre a regra do período.

### 7. Missões, privacidade e auditoria

- **O núcleo pode assumir missões** (ADR 0006 §3), com `mission_runs.circle_id`: a execução é
  de uma pessoa, de uma unidade **ou** de um núcleo (um só). O núcleo assume missão do modo
  `team`, publicada com escopo que o alcance: nacional, ou a unidade do `municipality_code`
  dele e acima. Sem município, só as nacionais.
- **Validação:** quem tem escopo sobre a missão (monitor ou gestor). **Quem está no núcleo não
  valida as entregas dele** (ADR 0006 §4). O núcleo **não entra no placar de turmas** (ADR 0006
  §6) até decisão [?] (pergunta 89).
- **Sem localização das pessoas.** A pessoa, por causa do núcleo, nunca ganha local novo. Nada
  de mapa nem de endereço de reunião. A conversa continua no WhatsApp (ADR 0006 §5).
- **O vínculo e a presença só os veem a própria pessoa e quem a vê pelo §5.** O gestor da raiz
  vê os núcleos e quantos membros cada um tem, não quem são.
- **Nada de dado de saúde.** Atividade física entra só como **participação em evento** (medalha
  `event`, ADR 0007 §3), sem distância, tempo nem comprovante (ADR 0006 §7). Evidência de tarefa
  pública segue o §7 do ADR 0006: protocolo, link ou notícia; sem foto.
- **Pertencer a um núcleo de debate pode revelar convicção** (LGPD art. 5º, II). Por isso a
  visibilidade é a mínima acima; o termo (#7) precisa citar vínculo, pauta e presença; e o
  módulo pede parecer jurídico antes do lançamento. Aceitar este ADR aprova o dado de presença
  (R4).
- **Exclusão da conta:** `circle_members`, `circle_join_requests` e `circle_attendance` saem em
  cascata; `ended_by`, `decided_by`, `registered_by` e `created_by` ficam nulos; o lançamento de
  pontos fica sem dono (ADR 0006, regra de `on delete`). A exportação "baixar meus dados"
  inclui tudo isso.
- **Auditoria:** `circle_join_requested`, `circle_join_approved`, `circle_join_rejected`,
  `circle_left`, `circle_member_removed`, `circle_level_changed` e `circle_primary_changed`.

### 8. Em aberto

| # | Pergunta | Padrão até a resposta |
|---|---|---|
| 87 | Quem cria núcleos de topo e designa o primeiro coordenador? | `manager` da raiz |
| 88 | Para pedir um subnúcleo, é preciso ser membro do núcleo pai? | Não |
| 89 | Núcleos entram em algum placar (de núcleos ou de turmas)? | Não |

**Respondidas pelo gestor em 2026-11-24:** vários núcleos com um principal (§2); entrada por
pedido aprovado (§3); sem diretório por enquanto (§3); núcleo independente da casa (§1);
reuniões com pauta e presença, e a presença conta pontos (§6); subnúcleos permitidos (§1);
níveis de cargo configuráveis (§4); as duas hierarquias valem juntas (§5).

## Alternativas consideradas

- **Núcleo como unidade da árvore de território:** o núcleo cruza regiões e teria de ficar sob
  um único pai. Descartado: a árvore é separada.
- **Núcleo como casa:** a casa é trilha de formação, um grupo da Academia, e o núcleo é outro
  conceito. Descartado.
- **Núcleo como atributo do perfil:** não daria visão ao coordenador sem regra nova de
  permissão (contraria a R15).
- **Cargo intermediário descendo a árvore:** daria a um nível médio do pai acesso a todo
  subnúcleo. Descartado: só o topo desce.

## Consequências

- (+) Pessoas de regiões diferentes se organizam, com subnúcleos, sem mexer no território.
- (+) Reusa moldes que já existem: `ltree` (ADR 0005), vínculo com aceite e histórico (casa) e
  livro-razão de pontos (ADR 0006).
- (−) Terceiro eixo de vínculo e duas hierarquias combinadas: matriz de permissões nova e
  revisão adversarial (R16), com casos "outro núcleo → negado", "subnúcleo vê o pai → negado",
  "intermediário vê contato → negado", "coordenação territorial → negado" e "aprovar o próprio
  pedido → negado".
- (−) Presença é dado novo, pauta é texto livre e o vínculo pode revelar convicção: termo de
  consentimento e parecer jurídico antes do lançamento.
- (−) Nada disso existe em código: as issues #168 a #170 ficam bloqueadas até o stakeholder
  responder as perguntas 87 a 89 e o jurídico opinar.
