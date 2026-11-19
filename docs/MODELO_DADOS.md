# Modelo de dados

> **Lista fechada.** Os únicos dados pessoais permitidos estão marcados com 🔒 e são
> **guardados cifrados** (ADR 0003). Adicionar qualquer outro exige ADR aprovado (regra R4).
> O script `scripts/check-forbidden-fields.sh` bloqueia no CI colunas proibidas e colunas
> pessoais em texto puro.

## Dados pessoais permitidos (🔒 = cifrado)

| Dado | Coluna | Proteção | Quem vê (ADR 0002) |
|---|---|---|---|
| Nome | `profiles.display_name_enc` | AES-256-GCM | Escopo do monitor/gestor; colegas de equipe |
| WhatsApp | `profile_contacts.whatsapp_enc` + `whatsapp_hmac` | AES-256-GCM + HMAC | Coordenação do escopo, ao clicar em "ver contato" (auditado); equipe e casa só se a pessoa autorizar (ADR 0010) |
| Redes sociais (máx. 5 URLs https) | `profile_contacts.social_links_enc` | AES-256-GCM | Coordenação do escopo (auditado); equipe e casa só se a pessoa autorizar (ADR 0010) |
| Portfólio (máx. 3 links https) | `portfolio_items.url_enc` | AES-256-GCM | Escopo, porta-voz da equipe (ADR 0007 §5) |
| Avaliação reservada | `member_evaluations.grade_enc`, `note_enc` | AES-256-GCM | **Só quem avaliou**; gestor por pedido auditado (ADR 0007 §4) [jurídico] |
| E-mail de login | `auth.users` (Supabase) | Texto puro, gerenciado pelo Supabase | Coordenação do escopo, ao clicar em "ver contato" (auditado); equipe e casa só se a pessoa autorizar (ADR 0010). O dono o vê **mascarado** no cabeçalho (`fu***@g***.com`). Não é exportado em massa |
| Lista de autorizados | `access_allowlist.email_hmac` | Só HMAC (sem nome, sem e-mail em claro) | Ninguém; usada só na conferência do primeiro login (ADR 0008 §1) |
| HMAC de quem espera | `access_waitlist_hmac.email_hmac` | Só HMAC | Ninguém; usado só para a importação liberar quem espera (ADR 0008 §1) |

Ficam **em texto puro**, por não identificarem sozinhos: município, UF, turma, equipe, casa,
habilidades, missões, pontos e badges.

> **"Feitos" = entregas de missão validadas** (ADR 0006). Não existe campo de texto livre
> para isso.

## Proibidos

CPF, RG, título de eleitor, endereço/CEP, data de nascimento, gênero, raça, religião, filiação
partidária, foto de rosto, foto de documento, geolocalização precisa, IP em tabela de negócio,
e **qualquer coluna `display_name`, `whatsapp` ou `social_links` sem o sufixo `_enc`**.

## Entidades

```
unit_types ─< units (árvore: nacional > estado > [região] > turma, via ltree)
                │
profiles ───────┼─< unit_members >── units
   │            ├─< role_assignments >── units   (papel vale na unidade e abaixo dela)
   │            ├─< house_members >── houses     (casa nacional, fora da árvore; ADR 0011)
   │            ├─< profile_skills >── skills
   │            ├─< mission_run_members >── mission_runs
   │            └─< profile_badges >── badges
   ├── profile_contacts (1:1, só o titular lê pela tabela: WhatsApp e redes)
   └── contact_visibility (quem, além da coordenação, vê cada contato; ADR 0010)

access_allowlist (só HMAC do e-mail; define profiles.access_status, ADR 0008)
access_waitlist_hmac (1:1 com profiles em waitlisted; só HMAC, para a importação liberar)
questionnaire_consents (aceite do termo do questionário das casas: versão e data, ADR 0008 §2.1)

missions ─< mission_steps
missions ─< mission_runs (uma turma assume a missão) ─< step_submissions (entregas)
step_submissions (approved = "feito") ──> points_ledger (só INSERT)
audit_log
```

**Uma instância por uso** (ADR 0005): o banco da Academia só tem dados da Academia. Todas as
tabelas têm **RLS habilitada**.

### Exemplo concreto da árvore (instância Academia)

| `units.path` | tipo | Quem enxerga |
|---|---|---|
| `br` | Nacional | gestor nacional |
| `br.sp` | Estado | gestor de SP (+ nacional) |
| `br.sp.zona_leste` | Região (opcional) | coordenador da região (+ SP + nacional) |
| `br.sp.zona_leste.turma_azul` | Turma | monitor da turma (+ todos acima) |
| `br.sp.turma_verde` | Turma sem região | monitor da turma (+ SP + nacional) |

**Turma = equipe.** Cada aluno está em **uma** turma (constraint), e mudar de turma gera um
evento `member_moved` no audit_log.

**Depois da Academia (ADR 0008 §2 e ADR 0011):** a região ("incubadora") tem equipes abaixo
dela. A **casa é nacional**, fora da árvore (`houses`): cada pessoa tem um vínculo de território
aberto (`unit_members`) e um vínculo de casa aberto (`house_members`), independentes.

| `units.path` | tipo | Quem enxerga |
|---|---|---|
| `br.sp.abc` | Região (incubadora) | coordenação regional (+ SP + nacional), de qualquer casa |
| `br.sp.abc.equipe_7` | Equipe | coordenador da equipe e porta-voz do ciclo |

| Papel `house_coordinator` | Quem enxerga |
|---|---|
| casa 1 em `br` | membros ativos da casa 1, com casa aceita, de todo o país |
| casa 1 em `br.sp` | membros ativos da casa 1 cujo território está em SP |
| casa 1 em `br.sp.abc` | membros ativos da casa 1 cujo território está no ABC |

### `access_allowlist` (ADR 0008 §1)
`id`, `email_hmac` (único), `source` (`form`, `academy`, `manual`), `added_by`, `added_at`.
O primeiro login compara o HMAC do e-mail e define `profiles.access_status`
(`pending`, `active`, `waitlisted`, `blocked`). Quem está `waitlisted` só lê o próprio perfil.

- **Ninguém lê nem grava a tabela pela API** (sem grant). Tudo passa por funções do banco
  (`security definer`), chamadas pelo servidor com o JWT de quem está logado (#26):
  - `resolve_access(email_hmac)`: no primeiro login, decide só o perfil de quem chama e só a
    partir de `pending` (`active` se o HMAC está na lista, senão `waitlisted`). Depois disso
    devolve o estado atual sem consultar a lista, e a função não serve para testar HMACs em
    série. Devolve só o estado, nunca dados da lista. Ao mandar para a espera, guarda o HMAC
    em `access_waitlist_hmac`.
  - `import_allowlist(email_hmacs[], source)`: só o gestor (`manager`) da raiz. Recebe só HMACs
    (o servidor lê o CSV e descarta os e-mails) e grava `allowlist_imported` com a quantidade
    de HMACs distintos recebidos (não a de novos, para não revelar quem já estava). Em
    seguida **libera quem está na espera** (`waitlisted`, conta não `suspended`; nunca
    `blocked`) cujo HMAC guardado está entre os importados: `access_status` e `status` viram
    `active`, a linha sai de `access_waitlist_hmac` e cada pessoa gera um `access_granted`
    com `reason = import`. Devolve `{received, promoted}`.
  - `list_waitlist(limit, cursor)` (paginada, mais antigos primeiro, até 200 por página) e
    `decide_access(profile, 'active' | 'blocked')`: o gestor com escopo
    sobre o vínculo aberto de quem espera (sem vínculo, o gestor da raiz) aprova ou bloqueia;
    cada decisão gera `access_granted` ou `access_blocked` (`reason = manual`) e apaga a linha
    de `access_waitlist_hmac`.
- Liberar (`active`) também tira a conta de `status = pending`; `suspended` não muda.

### `access_waitlist_hmac` (ADR 0008 §1)
`profile_id` (PK, FK `profiles` com `on delete cascade`), `email_hmac`, `created_at`. O HMAC
que a pessoa apresentou no primeiro login quando foi para a espera. RLS ligada, sem grant para
nenhum papel da API e política `using (false)`: só as funções `resolve_access`,
`import_allowlist` e `decide_access` leem e escrevem, e nenhuma função devolve o HMAC. Não
expõe nada novo: o e-mail da conta já está em `auth.users`, e o HMAC só serve para comparar
com a lista importada.

### `profiles`
| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | = `auth.users.id` |
| `display_name_enc` | text | 🔒 `v1.iv.ct` (ADR 0003 §3) |
| `municipality_code` | int FK | IBGE |
| `state_code` | char(2) | derivado do município (trigger); no cadastro, o aluno entra na unidade do seu estado |
| `district` | text null | distrito, só para município com lista em `config/districts.ts` (hoje a capital paulista, 96 distritos do IBGE); nulo nos demais (2 a 60 caracteres) |
| `status` | text | `pending`, `active`, `suspended` |
| `access_status` | text | `pending`, `active`, `waitlisted`, `blocked` (ADR 0008 §1) |
| `consent_version`, `consent_at` | text, timestamptz | `consent_at` gravado pelo trigger quando a versão muda. O perfil nasce com `none` (ainda sem aceite); só a função do aceite (#11) muda |
| `created_at`, `updated_at` | timestamptz | gravados pelo trigger |

O papel **não** fica no perfil: fica em `role_assignments`.

- **O titular** cria e edita só o próprio perfil e o próprio contato, e **só pela função
  `public.save_own_profile`** (#12), que o servidor chama com os valores já cifrados e o HMAC
  calculado no servidor. `profiles` e `profile_contacts` não têm grant de INSERT/UPDATE para a
  API. A função grava `display_name_enc`, `municipality_code`, `district` e o contato. Ela não
  recebe a versão do termo: cria o perfil com `consent_version = 'none'` e nunca a altera (só a
  função do aceite, #11, avança a versão, derivada no servidor). Perfil `blocked` ou com conta `suspended` não edita (mas lê o
  próprio). WhatsApp repetido volta como o retorno `duplicate_whatsapp`, sem dizer de quem é
  (o sucesso volta como `saved`). **Limite (#127):** depois de 5 repetidos na última hora, a
  função recusa qualquer salvamento da pessoa com o erro `PT429` (`too_many_attempts`), antes
  de gravar e sem consultar o índice único, igual para número livre ou já usado. Os repetidos
  ficam em `app.profile_save_attempts` (só `profile_id` e `attempted_at`, sem o número nem o
  HMAC; RLS ligada, política `using (false)` e nenhum grant para a API; as linhas de mais de
  uma hora são apagadas quando a função registra uma nova).
- **Terceiros** (escopo, via `app.can_view_profile`) só enxergam perfis com `access_status` e
  `status` = `active` (`app.is_active_profile`).
- **Quem chama também precisa estar ativo** (`app.is_active_member`): sem isso, o papel não
  vale (sem escopo, não concede nem revoga) e a pessoa não lê `unit_types`, `units`,
  `unit_members` nem `role_assignments`. Em `waitlisted` ou `blocked`, lê só o próprio perfil;
  em `pending` (ou ainda sem perfil), lê também `municipalities`, para se cadastrar.
- **Validação do texto** (nome de 2 a 80 caracteres, WhatsApp em E.164, até 5 URLs https) fica
  no schema Zod de `src/modules/profiles/`, aplicado no servidor antes de cifrar. O banco só
  confere o formato `v<n>.<iv>.<ct>` e um teto de tamanho.

### `profile_contacts` (1:1 com `profiles`)
`profile_id` PK, `whatsapp_enc` 🔒, `whatsapp_hmac` (único, hex de 64), `social_links_enc` 🔒 null
(JSON da lista de URLs), `updated_at`.
Fica **separada** para que listagens de perfis nunca tragam contato por engano. Pela tabela,
só o próprio titular lê (RLS). O contato de outra pessoa sai só por `public.view_contact` (abaixo),
que registra cada acesso. Ideia adaptada do protótipo original Vguedess/Complexo42
(`member_contacts`).

### `contact_visibility` e "ver contato" (#119, ADR 0010)
`profile_id`, `kind` (`whatsapp`, `social`, `email`), `scope` (`none`, `team`, `team_house`),
`updated_at`; chave (`profile_id`, `kind`). Não guarda contato: só a escolha da pessoa. Sem
linha vale `none` (só a coordenação). Só o titular lê (RLS) e só ele grava, por
`public.set_contact_visibility(kind, scope)` (não se `blocked`). A escolha vale na hora.

- **`app.can_view_contact(alvo, tipo)`** permite ao titular; à coordenação do escopo (monitor
  ou manager com papel na unidade do vínculo de território aberto do alvo, ou acima dela; e o
  coordenador da casa do alvo, dentro do seu território, ADR 0011); e ao colega, se a escolha do
  alvo para aquele contato deixar: `team` exige vínculo aberto na **mesma equipe**;
  `team_house`, na mesma equipe ou na **mesma casa no mesmo território** (abaixo). Quem chama e o
  alvo precisam estar ativos. Porta-voz e admin técnico não entram.
- **"Mesma equipe"** (`app.shares_open_team`): unidade **ativa** de um tipo marcado com
  `unit_types.is_team` (configuração da instância; o seed marca o tipo `team`). Dividir a unidade de entrada do estado, a região ou uma equipe arquivada não faz de
  ninguém colega.
- **"Mesma casa"** (`app.shares_open_house`): a mesma casa nacional, com os dois vínculos de casa abertos,
  aceitos **há pelo menos 7 dias**, e o **mesmo território mais próximo**
  (`app.home_territory`: a região do vínculo de equipe, ou o estado se não houver região). Sem
  vínculo de território, a casa sozinha não dá acesso.
- **"Mesma casa"** fica só em `app.shares_open_house`, e "o coordenador da casa conta como
  coordenação" só em `app.is_house_coordinator_of` (sobre `house_members` e
  `role_assignments.house_key`, ADR 0011). Nenhuma das auxiliares é chamável pela API.
- **`public.view_contact(alvo, tipo)`** é a única leitura do contato de terceiros, um tipo por
  chamada: aplica a regra e devolve o valor guardado (WhatsApp e redes cifrados, para o servidor
  decifrar; o e-mail lido de `auth.users`). Grava `contact_viewed` (quem, de quem, o tipo,
  quando; nunca o valor) só quando há valor, e uma vez só se o mesmo ator vê o mesmo tipo da
  mesma pessoa em 10 minutos. Negado: erro 42501, sem registro. O titular lê o próprio sem
  registro. **Limite:** 60 pessoas distintas por hora por quem chama (erro 54000; rever quem já
  entrou na conta da hora não gasta o limite), contado no `audit_log` pelo índice
  `(actor_id, event, created_at)`, com lock por quem chama.
- **`public.list_contact_views()`**: os 200 acessos mais recentes ao contato de quem chama, com o
  nome cifrado de quem viu. O id de quem viu vem junto porque é o AAD da decifragem; o servidor
  decifra e a tela e o arquivo mostram só o nome. Limite conhecido: quem chama a RPC direto vê
  o id (aceito: a pessoa já tem o direito de saber quem viu). Tela "Quem vê meu contato"
  (`/perfil/contato`).

### `municipalities` (referência pública, só leitura)
`code` (IBGE, 7 dígitos), `name`, `state_code`, `metro_region` (ex.: `rmsp`). Carregada por
migration (referência de produção), conferida com a API de localidades do IBGE. Hoje: os 39
municípios da Região Metropolitana de São Paulo.

### `unit_types`, `units` e `unit_members` (ADR 0005)
`unit_types`: `id`, `key`, `label`, `level`, `is_team` (os membros são colegas de equipe, ADR 0010)
(rótulos configuráveis por instância).
`units`: `id`, `type_id`, `parent_id`, `slug` (rótulo do nó no `path`: `a-z`, `0-9`, `_`),
`name`, `path` (ltree, índice GiST, mantido por trigger a partir de `parent_id` e `slug`),
`state_code` null (marca a unidade que recebe quem se cadastra no estado; única por UF), `municipality_code` null (região), `motto` null (≤ 80), `colors` (2 a 3 hex: a
"bandeira"), `logo_path` null + `logo_status` (`pending`, `approved`, `rejected`),
`public_links` (redes **da turma**, até 5 URLs https), `starts_on`/`ends_on` null,
`status`. Logo só PNG/JPEG/WebP ≤ 512 KB, **nunca SVG** (ADR 0006 §2).
`unit_members`: `unit_id`, `profile_id`, `member_role` (`lead`, `member`), `joined_at`,
`left_at` null, `left_reason` null, `ended_by` null. É o vínculo de **território** (estado,
região, equipe). Mover alguém encerra o vínculo (não apaga): é o **histórico** da pessoa (ADR
0007 §2). Índice único parcial: um vínculo aberto por pessoa. A casa não é unidade (ADR 0011).

- **`ended_by`**: quem encerrou o vínculo (quem gravou `left_at`, por trigger; nulo quando foi
  operação direta no banco).

### `houses` e `house_members` (ADR 0008 §2, ADR 0011)
`houses`: `key` (PK; o `id` da casa em `config/instance.ts`: minúsculas, números e hífens, até
63), `active`, `created_at`. **Sem nome**: o nome e os textos ficam só na config (R17), e
`tests/house-units.test.ts` confere o seed contra a config. Quem está ativo lê as chaves;
ninguém grava pela API (seed ou migration). `active = false` só impede novas entradas e novos
coordenadores; quem já está na casa continua.

`house_members`: `id`, `profile_id`, `house_key`, `join_method` (`self`, `questionnaire`),
`consent_version` null (só pelo questionário), `joined_at`, `accepted_at` null, `left_at` null,
`ended_by` null. Um vínculo aberto por pessoa, **sem depender de região**. Do questionário,
guarda-se só a casa sugerida.

- **O vínculo de casa só conta com `accepted_at`:** sem aceite, não dá visão a quem coordena a
  casa nem entra em "mesma casa". A pessoa continua lendo o próprio vínculo.
- **Escolha e aceite** só pela função `accept_house(house_key, join_method, term_version)`
  (`security definer`): a própria pessoa, liberada e ativa (conferido depois de travar o
  perfil); a casa precisa existir e estar ativa; `questionnaire` exige o aceite de
  **exatamente** essa versão do termo, gravada em `consent_version` (nula em `self`); uma casa
  já aceita não é trocada pela pessoa (é com a coordenação); repetir a mesma casa devolve o
  mesmo vínculo. Gera `house_accepted` no `audit_log`.
- **Quem lê e encerra** (RLS): a pessoa lê os próprios vínculos; a coordenação territorial
  (monitor ou manager acima do vínculo de território da pessoa) e o coordenador da casa aberta
  da pessoa, dentro do seu território, leem os vínculos aceitos de perfis ativos e podem
  encerrar o aberto (`left_at`, a única coluna com grant de escrita). Nunca o próprio vínculo:
  quem coordena não encerra a própria casa.
- **`ended_by`**: quem gravou `left_at` (trigger; nulo em operação direta no banco). Se outra
  pessoa encerrou o vínculo de casa, a pessoa não volta sozinha, nem para a mesma casa nem para
  outra (erro C7602): a volta é decisão da coordenação.

### `questionnaire_consents` (ADR 0008 §2.1)
`profile_id` (FK `profiles`, `on delete cascade`), `term_version` (FK
`app.questionnaire_term_versions`), `consented_at`; PK `(profile_id, term_version)`. Aceite do
termo do questionário: versão e data, sem assinatura nem e-mail. Gravado só por
`record_questionnaire_consent(term_version)` (a própria pessoa, liberada e ativa; a versão
precisa existir; repetir a versão mantém a primeira data e não gera outro
`questionnaire_consented`).

`app.questionnaire_term_versions` (`version` PK, `created_at`): as versões do termo que
existem. Entram só por migration ou seed (sem grant para a API); a versão do arquivo do
questionário instalado no servidor precisa estar aqui. RLS: só o
titular lê; sem grant de escrita. **As respostas do questionário nunca chegam ao banco**: a
pontuação roda no aparelho e só a casa vai ao servidor.

### `role_assignments` (ADR 0002 + 0005)
`id`, `profile_id`, `role` (`monitor`, `manager`, `spokesperson`, `tech_admin`,
`house_coordinator`), `unit_id`, `house_key` (só em `house_coordinator`, obrigatória), `granted_by`,
`granted_at`, `revoked_at`. O papel vale na unidade **e em todas abaixo dela**. Um papel ativo
por pessoa, papel, unidade e casa.

- **`house_coordinator` (ADR 0011):** vê as pessoas **ativas** da casa `house_key`, com vínculo
  de casa aberto e aceito, cujo vínculo de território está em `unit_id` ou abaixo; conta como
  coordenação do escopo para o contato só desses membros. Não tem escopo territorial (não entra
  em `app.my_scopes`): não gerencia unidade, não decide acesso, não concede nem revoga. Vê a
  estrutura do território (unidades abaixo e o caminho até a raiz). Vários por casa e por
  território. Concedido por um `manager` estritamente acima do território (como os outros
  papéis); na raiz (coordenador nacional de casa), pelo `manager` ativo da própria raiz, só
  este papel (PR #141), que também o revoga mesmo sem ter concedido (por exemplo, quando quem
  concedeu excluiu a conta). Nunca a si mesmo, e só para casa ativa.
`unit_members.profile_id`, `role_assignments.profile_id` e `role_assignments.granted_by`
apontam para `profiles(id)` (o mesmo id de `auth.users`): ninguém tem vínculo ou papel sem perfil.
As regras de cada papel (ver, ver contato, gerenciar, conceder) estão no cabeçalho de
`supabase/migrations/20261119130100_access_functions.sql`.

### `skills` e `profile_skills`
`skills`: `id`, `name`, `category`, `aliases` (text[], sinônimos para a busca), `active`.
Índices: `profile_skills(skill_id, profile_id)` e GIN em `skills.aliases`. A **busca por
habilidade roda no banco** (texto puro, indexado); só os nomes da página exibida são
decifrados no servidor (ADR 0003 §6).
`profile_skills`: `profile_id`, `skill_id`, `level` [?].

### Missões, entregas e pontos (ADR 0006)
`missions`: `id`, `title`, `description`, `category`, `scope_unit_id`, `status`
(`proposed`, `published`, `archived`), `origin` (`national`, `regional`, por trigger),
`mode` (`individual`, `team`), `repeatable`, `cooldown_days`, `badge_id` null,
`proposed_by_unit_id` null, `created_by`, `created_at`.
`mission_steps`: `id`, `mission_id`, `position`, `title`, `description`, `points` (> 0),
`evidence_type` (`none`, `link`, `protocol_number`, `text`), `requires_previous`.
`mission_runs`: `id`, `mission_id`, `unit_id`, `profile_id` null (missão individual), `status` (`active`, `completed`,
`abandoned`), `started_at`, `completed_at`.
`mission_run_members`: `run_id`, `profile_id`.
`step_submissions`: `id`, `run_id`, `step_id`, `submitted_by`, `evidence_url` null (https),
`evidence_text` null (≤ 500), `status` (`submitted`, `approved`, `rejected`),
`reviewed_by`, `reviewed_at`, `review_note`. Único por (`run_id`, `step_id`) aprovado.
`points_ledger`: `id`, `unit_id`, `profile_id` null, `submission_id`, `points`, `reason`,
`created_by`, `created_at`. **Só INSERT**: correção é lançamento negativo.

> Missões de saúde (doação de sangue): o monitor decide como comprovar, mas **não há upload
> de comprovante**; dado de saúde é sensível (ADR 0006 §7).

### `badges` e `profile_badges`
`badges`: `id`, `scope_unit_id` (nacional ou escopo do monitor), `created_by`, `name`,
`description`, `icon`, `rule_type` (`manual`, `event`, `worked_with`, `milestone`,
`attendance`, `mission_completed`, `points_threshold`), `rule_params` jsonb,
`named_after_profile_id` null + `story` null (medalha de marco, ADR 0007 §3).
`profile_badges`: `profile_id`, `badge_id`, `awarded_at`, `awarded_by` (null quando
automático), `submission_id` null, `reason`, `revoked_at` null, `revoked_by` null,
`revoked_reason` null.

### `portfolio_items` e `member_evaluations` (ADR 0007)
`portfolio_items`: `id`, `profile_id`, `url_enc`, `kind`, `title` (≤ 80), `position`
(máx. 3 por pessoa).
`member_evaluations`: `id`, `profile_id`, `evaluator_id`, `unit_id`, `axis` (`team`,
`house`), `mission_id` null, `cycle_ends_on`, `grade_enc`, `note_enc` null, `created_at`
(avaliação dupla, ADR 0008 §3). Só INSERT; leitura por
`app.request_evaluation_access` (gera `evaluation_viewed`).

### `audit_log`
`id`, `actor_id`, `event` (`contact_viewed`, `role_granted`,
`role_revoked`, `member_moved`, `logo_approved`, `export`, `badge_granted`, `badge_revoked`, `submission_approved`,
`submission_rejected`, `points_adjusted`, `account_deleted`, `allowlist_imported`,
`access_granted`, `access_blocked`, `data_exported`, `house_accepted`, `questionnaire_consented`),
`target_id`, `item_count`, `reason`, `term_version`, `house_key`, `created_at`.
`item_count` só existe em evento de lote (`allowlist_imported`): a quantidade, nunca os itens.
`reason` existe nas decisões de acesso (`manual`, fila do gestor; `import`, liberação
automática na importação), em `house_accepted` (a forma de entrada: `self` ou
`questionnaire`) e em `contact_viewed` (o tipo do contato: `whatsapp`, `social` ou `email`); nesses
eventos é obrigatório. Em `contact_viewed`, `actor_id` é quem viu e `target_id` a pessoa vista. `term_version` é a versão do termo do questionário: obrigatória em
`questionnaire_consented` e em `house_accepted` pelo questionário. Em `house_accepted`,
`actor_id` e `target_id` são a pessoa e `house_key` é a casa (obrigatória; só neste evento).
Registros antigos da #76 (alvo = unidade de casa, sem `house_key`) ficam como estão. Nunca
respostas do questionário.
**Nunca contém dados pessoais em claro.** Quem lê (`app.can_read_audit(evento, alvo, ator,
casa)`): `allowlist_imported`, o gestor da raiz; eventos sobre uma pessoa, o gestor com escopo
sobre ela; `house_accepted`, também o coordenador da casa do registro, dentro do seu território,
enquanto a pessoa está nessa casa (#132); e a própria pessoa lê os seus `house_accepted` e
`questionnaire_consented`. A coordenação não lê `questionnaire_consented`, mas o `house_accepted`
que ela lê vai inteiro, com a forma de entrada e, pelo questionário, a versão do termo. Ninguém grava, altera nem apaga pela API: só as funções do banco.
Um trigger recusa `UPDATE`, `DELETE` e `TRUNCATE` até para o dono do banco: o log só aceita
inserções. `account_deleted` (#18): ator e alvo = o id da conta apagada, que fica como uuid solto
em todos os eventos (veja "Excluir minha conta"). Limpeza (retenção, LGPD) precisa de migration própria que desligue o trigger de
forma explícita; nenhum teste ou migration atual limpa o log.

### "Baixar meus dados" (#20, LGPD art. 18)
A pessoa baixa, pelo botão da página inicial, um JSON com tudo o que a plataforma guarda sobre
ela. O servidor chama `public.export_own_data()` (`security definer`) com o JWT dela; a função
lê só as linhas de `auth.uid()` (perfil, contato, vínculos de território e de casa inclusive
encerrados, aceites do termo do questionário, papéis (com a casa do coordenador de casa),
eventos do `audit_log` cujo alvo é a pessoa, os `house_accepted` e `questionnaire_consented` que
ela fez (#132) e quem acessou o contato dela) e devolve os valores ainda cifrados. O servidor
decifra (ADR 0003) e acrescenta o e-mail de login, lido da sessão.

- **Fica de fora:** `whatsapp_hmac`, os HMACs de e-mail (lista e espera), ids de terceiros
  (`granted_by`, `actor_id`), colegas de unidade e o próprio id interno. Dos vínculos e papéis
  vão só o nome e o tipo da unidade; da casa, o nome da config (ou a chave, se saiu da config). De quem acessou o contato (ADR 0010, #119) vão o nome,
  o tipo do contato e quando, nunca o id.
- **Auditoria e limite:** cada exportação grava `data_exported` (ator e alvo = a pessoa, sem
  dado pessoal); a 6ª na mesma hora é recusada (erro 54000). O contador é o próprio
  `audit_log`, que só aceita inserções.
- **Resposta:** anexo `meus-dados-AAAA-MM-DD.json`, `Cache-Control: private, no-store`. O
  conteúdo nunca vai para log (R11).

### "Excluir minha conta" (#18, LGPD art. 18, VI)
A pessoa exclui a própria conta pelo link da página inicial (ou da tela de espera), em
`/excluir-conta`. A exclusão é **real e imediata**: não há "conta desativada".

- **Quem:** qualquer pessoa com sessão, inclusive quem está na espera ou ainda não preencheu o
  perfil. A página fica fora do portão de acesso de propósito. Quem está `blocked` perde a
  sessão no login e hoje pede a exclusão ao encarregado (pendência anotada no PR).
- **Como:** o servidor chama `public.delete_own_account()` (`security definer`) com o JWT da
  pessoa. A função **não recebe alvo**: apaga só `auth.uid()`. Nunca `service_role` (R6): o app
  não tem essa chave. O dono da função é quem roda as migrations: `supabase_admin`
  (superusuário) no servidor, onde o `postgres` deve ser NOLOGIN (conferir em volumes anteriores à #95: `docs/OPERACAO.md`), e `postgres` no `supabase start`
  local. Os dois apagam `auth.users` e leem `auth.sessions`.
- **Confirmação forte:** escrever `EXCLUIR` (conferido no servidor, com Zod) **e** ter entrado
  há no máximo 10 minutos. O **banco** confere pela sessão do JWT: o `session_id` (assinado
  pelo GoTrue) precisa existir em `auth.sessions`, ser da pessoa e ter `created_at` (a hora do
  login) de no máximo 10 minutos. Renovar o token não muda a sessão (E2E ao vivo confere).
  Sem `session_id` ou sem a sessão, falha fechado (erro `PT401`, `reauth_required`). A tela
  só usa o `amr` do JWT como pista para mostrar a confirmação ou o botão "Sair e entrar de
  novo"; se o banco recusar, ela passa a pedir o login. Cookie roubado ou aparelho esquecido
  aberto não bastam.
- **O que some:** `auth.users` e, em cascata, sessões, identidades e tokens do GoTrue,
  `profiles`, `profile_contacts`, `unit_members`, `house_members` e `role_assignments` da pessoa,
  `access_waitlist_hmac`, `questionnaire_consents` e `app.profile_save_attempts`. A função
  apaga também o rastro do GoTrue com e-mail e IP (`auth.audit_log_entries`, pelo id ou pelo
  e-mail exato da conta, lido antes de apagar) e o `auth.flow_state`. Depois, a sessão é encerrada e a pessoa vê `/conta-excluida`.
- **O que fica dos outros:** quando a pessoa aparece no dado de outra
  (`role_assignments.granted_by`, `unit_members.ended_by`, `house_members.ended_by`), a linha fica e a referência vira
  nula. O trigger de `ended_by` aceita esse nulo só quando o perfil citado não existe mais.
- **`audit_log`:** continua só-inserção (o trigger não muda; ninguém pseudonimiza linhas). Os
  eventos antigos guardam o id da conta apagada como uuid solto, sem FK: sem `auth.users` e
  sem perfil, nada no banco liga esse id a uma pessoa. A função grava `account_deleted` (ator e
  alvo = o id apagado, sem mais nada). Esse evento serve também para **reaplicar** a exclusão
  quando um backup antigo for restaurado (`docs/OPERACAO.md`). Gestores não leem esse evento
  pela API (o escopo depende de vínculo, que já não existe). O JWT de uma conta apagada vale
  até expirar; por isso um trigger recusa evento cujo `actor_id` não é uma conta existente, e
  nada mais é gravado com o uuid morto (nem pelo dono do banco).
- **Fica de fora, por decisão:** `access_allowlist` é a lista que a organização importa (só
  HMAC do e-mail, sem ligação com a conta). Ela não muda: se a pessoa quiser sair da lista, o
  pedido vai à organização, que a reimporta sem ela. `access_allowlist.added_by` é uuid solto.
- **Contagem anônima de ações:** ainda não existe tabela de ações (missões, entregas, pontos);
  nada a preservar hoje. A regra abaixo diz como as futuras tratam a exclusão.
- **Backups:** saem do ar em até 35 dias (7 diários + 4 semanais, `docs/OPERACAO.md`), como
  diz o termo.

#### Regra para tabelas novas (`on delete`)
Toda tabela que cita uma pessoa precisa sobreviver à exclusão da conta sem guardar nada dela:

| Caso | `on delete` | Exemplos (futuros) |
|---|---|---|
| A linha é **dado da pessoa** | `cascade` | `profile_skills`, `profile_badges`, `portfolio_items`, `mission_run_members` |
| A pessoa é **autora/ator** numa linha de outra pessoa ou de uma unidade | `set null` | `granted_by`, `ended_by`, `reviewed_by`, `awarded_by`, `created_by`, `member_evaluations.evaluator_id` |
| **Contagem anônima** que precisa ficar (ações da unidade) | `set null` na coluna da pessoa | `points_ledger.profile_id`, `step_submissions.submitted_by`: o lançamento fica para a unidade, sem dono |
| Log só-inserção | **sem FK** (uuid solto) | `audit_log.actor_id`/`target_id` |

- `restrict` ou `no action` para `auth.users`/`profiles` é proibido: impediria a exclusão. O
  teste `supabase/tests/delete_own_account.test.sql` falha se alguma FK de `public`/`app`
  fizer isso.
- Texto livre que possa identificar a pessoa numa linha que fica (ex.: `badges.story` de uma
  medalha com `named_after_profile_id`) precisa ser apagado junto, na própria função ou por
  trigger.
- Trigger que "protege" uma coluna de referência (como o de `ended_by`) precisa aceitar o nulo
  da cascata.
- Quem cria tabela que cita pessoa acrescenta uma linha da pessoa A no teste da exclusão: a
  checagem `leftovers` varre toda coluna uuid e falha se o id sobrar.

## Acesso

A matriz completa está em [`adr/0002-permissoes-hierarquicas.md`](adr/0002-permissoes-hierarquicas.md).
Toda política RLS usa as funções `app.can_*`, e toda mudança atualiza
`supabase/tests/permissions_matrix.test.sql`.
