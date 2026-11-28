# Modelo de dados

> Diagramas por área (pessoas e acesso, unidades, casas e questionário, localidades, auditoria):
> [DIAGRAMAS.md §5](DIAGRAMAS.md#5-modelo-de-dados).

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
| Totem do questionário (ADR 0014) | `questionnaire_results.totem_enc` | AES-256-GCM | A pessoa, a coordenação nacional e quem ela delegou (`questionnaire_data_grants`); nunca na tela da casa |
| Respostas do pedido de análise (ADR 0014) | `house_analysis_requests.answers_enc` | AES-256-GCM (JSON) | A pessoa, a coordenação nacional e quem ela delegou; só com o pedido aberto |
| Avaliação reservada | `member_evaluations.grade_enc`, `note_enc` | AES-256-GCM | **Só quem avaliou**; gestor por pedido auditado (ADR 0007 §4) [jurídico] |
| E-mail de login | `auth.users` (Supabase) | Texto puro, gerenciado pelo Supabase | Coordenação do escopo, ao clicar em "ver contato" (auditado); equipe e casa só se a pessoa autorizar (ADR 0010). O dono o vê **mascarado** no cabeçalho (`fu***@g***.com`). Não é exportado em massa |
| Lista de autorizados | `access_allowlist.email_hmac` | Só HMAC (sem nome, sem e-mail em claro) | Ninguém; usada só na conferência do primeiro login (ADR 0008 §1) |
| HMAC de quem espera | `access_waitlist_hmac.email_hmac` | Só HMAC | Ninguém; usado só para a importação liberar quem espera (ADR 0008 §1) |

Ficam **em texto puro**, por não identificarem sozinhos: município, UF, turma, equipe, casa,
habilidades, missões, pontos e badges.

O **totem** e as **respostas** do pedido de análise (ADR 0014) são dado pessoal e ficam
**cifrados** (AES-256-GCM, ADR 0003): `questionnaire_results.totem_enc` e
`house_analysis_requests.answers_enc`, com o AAD `tabela.coluna.<profile_id>`. O banco só guarda o
valor; o servidor decifra. O totem aparece em "Baixar meus dados" (LGPD art. 18) e nunca na tela da
casa. Quem lê: a própria pessoa, a coordenação nacional (gestor da raiz) e quem ela delegou
(`questionnaire_data_grants`, abaixo). As respostas só existem com o pedido de análise aberto e são
apagadas ao resolver.

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
   │            ├─< circle_members >── circles   (árvore de núcleos, fora do território; ADR 0013, aceito, sem migration ainda)
   │            ├─< profile_skills >── skills
   │            ├─< mission_run_members >── mission_runs
   │            └─< profile_badges >── badges
   ├── profile_contacts (1:1, só o titular lê pela tabela: WhatsApp e redes)
   └── contact_visibility (quem, além da coordenação, vê cada contato; ADR 0010)

access_allowlist (só HMAC do e-mail; define profiles.access_status, ADR 0008)
access_waitlist_hmac (1:1 com profiles em waitlisted; só HMAC, para a importação liberar)
questionnaire_consents (aceite do termo do questionário das casas: versão e data, ADR 0008 §2.1)
questionnaire_results (1:1 com profiles: casa sugerida e totem cifrado; leem a pessoa, a coordenação nacional e quem ela delegou, ADR 0014)
house_analysis_requests (fila de casos antigos e de correção pela coordenação, sem empate desde a chave de #211; as respostas, cifradas, só existem com o pedido aberto, ADR 0014)
questionnaire_data_grants (delegação: a coordenação nacional concede a um gestor o acesso ao totem e aos pedidos do escopo dele, ADR 0014)
consent_acceptances (aceite do termo de consentimento, por conta e versão; existe antes do perfil, #11)

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
- Telas: `/coordenacao/autorizados` (envio do CSV/TXT de até 1,5 MB e 35 mil e-mails; o
  arquivo é lido em memória e só os HMACs saem do servidor; a tela mostra só
  `{received, promoted}`, até 200 números de linha sem e-mail válido e o total delas) e
  `/coordenacao/espera` (fila paginada, nome decifrado no servidor, "Liberar"/"Bloquear" com
  confirmação; nunca e-mail nem HMAC). Nome que não decifra vai para o log só com código e
  `profile_id`, e a linha não deixa liberar (bloquear continua). O atalho só aparece para
  quem tem papel de gestor ativo, por conforto: quem decide é o banco (42501).
- `block_member(email, motivo?)` e `unblock_member(email)`: o gestor bloqueia quem **já está
  ativo** (`active` → `blocked`) ou desfaz (`blocked` → `waitlisted`: a pessoa volta para a fila
  e a liberação passa de novo pela coordenação). A pessoa é achada pelo e-mail de login em
  `auth.users`. Pode quem tem escopo sobre o vínculo do alvo (`app.manages_member`), nunca sobre
  si nem sobre quem tem papel no seu nível ou acima (`app.is_outranked_by_caller`); o gestor da
  raiz também alcança `house_coordinator` e `tech_admin` na raiz (como `can_revoke_role`), e um
  gestor da raiz nunca é bloqueável. A resposta é neutra no retorno, exista ou não a conta,
  esteja ou não no escopo; só quem não é gestor ativo recebe 42501. Limite: 30 tentativas por
  hora por quem chama (bloquear e desbloquear, inclusive as sem efeito), contadas em
  `app.member_block_attempts` (só `actor_id` e `attempted_at`; apagadas com a conta e depois de
  uma hora); acima disso, erro 54000. A RLS nega o acesso já na próxima consulta
  (`is_active_member` e `is_active_profile` leem `access_status`); o cookie da pessoa é limpo no
  próximo acesso dela ao app e o token de refresh vale até expirar, sem efeito. Papéis não são
  revogados. Depois do desbloqueio, a importação da lista não libera a pessoa (não há HMAC
  guardado dela): só a fila. A busca pelo e-mail usa o índice `(instance_id, lower(email))`
  que o GoTrue já cria; `auth.users` é do GoTrue e não recebe índice nosso. Gera
  `member_blocked` (motivo opcional de lista fechada) ou `member_unblocked`. Tela:
  `/coordenacao/bloqueio` (pedido e confirmação, funciona sem JavaScript).

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
| `display_name_enc` | text null | 🔒 `v1.iv.ct` (ADR 0003 §3); nulo só em perfil incompleto |
| `municipality_code` | int FK null | IBGE; nulo só em perfil incompleto |
| `profile_completed_at` | timestamptz null | nulo = perfil **incompleto** (ADR 0017): a linha nasce no primeiro login de quem está na lista de autorizados, sem nome, município, UF nem versão do termo; `save_own_profile` completa e marca; CHECK: nome, município, UF e termo não nulos quando completo; uma linha gravada já com nome, município e termo nasce completa (trigger); `consent_at` também só é nulo enquanto incompleto (a linha incompleta não grava data de termo que não houve); trigger: nunca volta a nulo. Quem não está na lista não ganha linha até salvar o perfil |
| `state_code` | char(2) null | derivado do município (trigger; nulo em perfil incompleto); no cadastro, o aluno entra na unidade do seu estado |
| `district_code` | int null FK | distrito (código IBGE de 9 dígitos, `districts`). Chave estrangeira composta com o município: o banco recusa distrito de outro. Nulo = sem escolha ou município com um distrito só (ver `districts`) |
| `neighborhood_enc` | text null | 🔒 bairro, **opcional**, texto livre cifrado (`v1.iv.ct`, AAD `profiles.neighborhood_enc.<id>`). Sem busca nem filtro. Ver "Bairro" abaixo |
| `status` | text | `pending`, `active`, `suspended` |
| `access_status` | text | `pending`, `active`, `waitlisted`, `blocked` (ADR 0008 §1) |
| `consent_version`, `consent_at` | text null, timestamptz null | Espelho do último aceite do termo (#11), para leitura rápida; a prova é `consent_acceptances`. `save_own_profile` cria o perfil já com a versão vigente (e recusa quem não aceitou); `accept_consent` avança a versão de quem já tem perfil, e o trigger grava `consent_at`. Nenhuma outra via muda |
| `created_at`, `updated_at` | timestamptz | gravados pelo trigger |

O papel **não** fica no perfil: fica em `role_assignments`.

- **O titular** cria e edita só o próprio perfil e o próprio contato, e **só pela função
  `public.save_own_profile`** (#12), que o servidor chama com os valores já cifrados e o HMAC
  calculado no servidor. `profiles` e `profile_contacts` não têm grant de INSERT/UPDATE para a
  API. Quem está liberado (`access_status = active`) só salva o perfil depois de aceitar uma casa (`house_required`, 42501; ADR 0017); quem ainda não está liberado (espera, sem linha) segue como antes. A função grava `display_name_enc`, `municipality_code`, `district_code`, `neighborhood_enc` e o contato. Distrito que não é do município volta como erro `PT422`; município com um distrito só grava distrito nulo. Ela não
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
Redes (#17): até 5 links, normalizados no servidor antes de cifrar (`src/modules/profiles/domain/social.ts`):
só `https://`, sem usuário/senha nem porta, com domínio (nada de IP ou `localhost`), até 256
caracteres; domínio em outro alfabeto fica em punycode (`xn--`), que é o que aparece na tela. Na tela,
links de rede só saem por `SocialLinkList` (texto puro com domínio, caminho, busca e fragmento,
cortado com "…" depois de 60 caracteres; `rel="noopener noreferrer nofollow"`).
Salvar o perfil sem mexer nos links os mantém: o formulário volta com eles, e um envio sem o campo
`socialLinksSent` repassa o valor cifrado guardado. Se o valor guardado não abre inteiro, o
formulário não envia esse campo (mostra um aviso) até a pessoa pedir para trocar os links.
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

### `municipalities` e `districts` (referência pública, só leitura)
`municipalities`: `code` (IBGE, 7 dígitos), `name`, `state_code`, `metro_region` (ex.: `rmsp`).
Todos os municípios da API de localidades do IBGE (5.571 registros na consulta de 2026-11-27).
`metro_region` só está preenchida nos 39 da Região Metropolitana de São Paulo: a API de regiões
metropolitanas lista 39 municípios em mais de uma região e a coluna guarda uma chave só.

`districts`: `code` (IBGE, 9 dígitos: os 7 primeiros são o município), `municipality_code`, `name`.
Todos os distritos do IBGE (10.751). Em 3.332 municípios o único distrito é a sede: ali o
formulário **esconde a escolha** e o perfil grava `district_code` nulo (o distrito seria o
próprio município; `save_own_profile` aplica a regra, não só a tela).

As duas são dado público, sem dado pessoal, com a mesma RLS: lê quem está logado e não está na
espera nem bloqueado; escrita só por migration. Vêm de migrations **geradas** por
`npm run db:gen-localities` (`scripts/generate-localities-sql.mjs`), que cita a URL e a data da
consulta no cabeçalho; para atualizar, rode o script e crie uma migration nova com a diferença.
O formulário do perfil carrega as cidades **por UF** (o maior estado tem 853), nunca as 5.570.

**Bairro** (#179, decisão do gestor em 2026-11-27) é opcional e **texto livre**, porque não há base
oficial nacional de bairros. Como texto livre pode virar endereço, é **dado pessoal**: só existe
cifrado (`profiles.neighborhood_enc`, ADR 0003), o banco recusa texto puro, e não há busca nem
filtro por bairro. O servidor valida antes de cifrar: 2 a 60 caracteres (letras, números, espaço,
hífen, apóstrofo e ponto), sem espaços nas pontas, espaços internos colapsados; o formulário pede
"não informe rua nem número". Quem já vê o perfil (`can_view_profile`) o vê pelo servidor, que
decifra; hoje nenhuma tela de terceiros o mostra. Vai no arquivo de exportação (`bairro`) e some
com a conta (cascata).

### `unit_types`, `units` e `unit_members` (ADR 0005)
`unit_types`: `id`, `key`, `label`, `level`, `is_team` (os membros são colegas de equipe, ADR 0010)
(rótulos configuráveis por instância). A interface lê o rótulo daqui (`readUnitTypeLabels`, módulo `instance`), nunca de texto fixo (R17).
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
`ended_by` null, `locked_until` (até quando a pessoa não troca a casa por conta própria; só o
banco grava) e `moved` (encerrado por troca, não por remoção). Um vínculo aberto por pessoa, **sem depender de região**. Do questionário,
guarda-se só a forma de entrada; a casa sugerida e o totem ficam em `questionnaire_results`
(que a coordenação de território e de casa **não** leem).

- **O vínculo de casa só conta com `accepted_at`:** sem aceite, não dá visão a quem coordena a
  casa nem entra em "mesma casa". A pessoa continua lendo o próprio vínculo.
- **Escolha e aceite** só pela função `accept_house(house_key, join_method, term_version)`
  (`security definer`): a própria pessoa, liberada e ativa (conferido depois de travar o
  perfil); a casa precisa existir e estar ativa; `questionnaire` exige o aceite de
  **exatamente** essa versão do termo, gravada em `consent_version` (nula em `self`); uma casa
  já aceita só é trocada pela pessoa depois de `locked_until` (4 meses do mais tardio entre o aceite
  do termo do questionário e o aceite da casa; relógio do servidor), senão `C7603` (`C7604` se a
  casa mudou no meio da troca); a troca
  reinicia a trava e gera `house_changed` (`self`). Repetir a mesma casa devolve o mesmo
  vínculo. A primeira definição gera `house_accepted` no `audit_log`.
- **Casa escolhida na coordenação:** `coordination_chosen_houses(pessoas)` (security definer, mesmo alcance
  das telas de resultado, nunca a própria pessoa) devolve a casa do vínculo aberto e aceito, a data e se a
  troca foi da coordenação (`house_changed` posterior ao aceite). A lista e o resultado comparam com a casa
  sugerida de `questionnaire_results`; só casas e datas, nada do totem. O filtro "escolheu outra casa" é
  `coordination_other_house_results(casa, limite)`: no banco, sobre todas as pessoas do alcance (até 201,
  das mais novas), com o mesmo alcance. Ver ADR 0016.
- **Troca pela coordenação** só por `coordination_set_house(profile, house_key)`: a qualquer
  momento, com alcance de gestão sobre a pessoa (`can_manage_house_member`; a delegação de leitura
  não basta), mantendo a trava; gera `house_changed` (`coordination`). Ver ADR 0016.
- **Quem lê e encerra** (RLS): a pessoa lê os próprios vínculos; a coordenação territorial
  (monitor ou manager acima do vínculo de território da pessoa) e o coordenador da casa aberta
  da pessoa, dentro do seu território, leem os vínculos aceitos de perfis ativos e podem
  encerrar o aberto (`left_at`, a única coluna com grant de escrita). Nunca o próprio vínculo:
  quem coordena não encerra a própria casa.
- **`ended_by`**: quem gravou `left_at` (trigger; nulo em operação direta no banco). Se outra
  pessoa encerrou o vínculo de casa, a pessoa não volta sozinha, nem para a mesma casa nem para
  outra (erro C7602): a volta é decisão da coordenação.

### `circles`, `circle_members` e reuniões (ADR 0013, aceito)
Nada disso existe em migration ainda: depende de missões e pontos (ADR 0006), do parecer jurídico e, nos
detalhes das perguntas 91 a 93, do padrão conservador. O núcleo é
uma **árvore própria**, fora do território e da casa; os rótulos ("Núcleo", "Subnúcleo" e os
níveis de cargo) vêm de `config/` (R17).

- `circles`: `id`, `parent_id` null, `slug`, `name`, `path` (ltree, como `units`),
  `municipality_code` null (**do núcleo**, nunca da pessoa), `status` (`active`, `archived`),
  `created_by`, `created_at`. Subnúcleo não muda de pai; arquivar arquiva os de baixo.
- `circle_members`: `id`, `circle_id`, `profile_id`, `level` (chave do nível, de `config/`),
  `is_primary`, `join_method`, `joined_at`, `accepted_at` null, `left_at` null, `ended_by` null.
  Várias por pessoa; **um principal** (índice único parcial por pessoa, entre vínculos abertos e
  aceitos). Só conta com aceite; encerrar guarda histórico.
- `circle_join_requests`: `id`, `circle_id`, `profile_id`, `status` (`pending`, `approved`,
  `rejected`), `requested_at`, `decided_by` null, `decided_at` null. **Só o topo do próprio
  núcleo aprova** a entrada; o topo de núcleo acima não.
- **Visão (duas hierarquias):** o nível de topo vê o núcleo e os subnúcleos abaixo (`path <@`),
  com contato pelo ADR 0010; nível intermediário vê só quem está abaixo dele no mesmo núcleo, sem
  contato; o mais baixo vê só a si. O topo de núcleo **acima** também pode **remover** pessoas do núcleo e dos
  subnúcleos abaixo (encerra o vínculo, `circle_member_removed` no `audit_log`). Sem vista para
  cima nem para os lados. Sem escopo territorial.
- `circle_meetings` (`circle_id`, `held_on`, `title`, `agenda` null, ≤ 500) e
  `circle_attendance` (`meeting_id`, `profile_id`, `registered_by`): presença é dado pessoal
  mínimo. Cada presença gera **um lançamento individual** em `points_ledger` (`circle_id`,
  `reason = 'attendance'`) e conta para a medalha `attendance`.
- `mission_runs.circle_id` null e `points_ledger.circle_id` null: a execução é de uma pessoa, de
  uma unidade **ou** de um núcleo.
- **`on delete`:** `circle_members`, `circle_join_requests` e `circle_attendance` são dado da
  pessoa (`cascade`); `ended_by`, `decided_by`, `registered_by` e `created_by`, `set null`.
- Fica **fora**: localização da pessoa, dado de saúde (atividade física só como participação em
  evento) e foto.

### `consent_acceptances` (#11)
`user_id` (FK `auth.users`, `on delete cascade`), `version`, `accepted_at`; PK `(user_id, version)`.
A prova do aceite do termo de consentimento, ligada à conta e não ao navegador. Gravada só por
`public.accept_consent(versão)` (a própria pessoa, ainda sem perfil ou não), que aceita **só a
versão vigente** (`app.current_consent_version()`, definida por migration; versão nova = migration
nova + texto novo em `config/consent.ts`, e um teste confere que os dois batem) e registra
`consent_accepted` no `audit_log`. RLS: a pessoa lê só os seus; nenhum INSERT, UPDATE ou DELETE
pela API. `save_own_profile` recusa (42501) quem não aceitou a vigente; `requireUser` manda para
`/termo`. `/termo`, `/meus-dados` e `/excluir-conta` funcionam sem aceite (direitos do titular).
A exportação inclui os aceites; a exclusão da conta os apaga em cascata.
**Perfil anterior a esta tabela** (criado antes da migration do #11, sem linha aqui) passa pelo termo uma vez no próximo acesso; o aceite então grava a linha e atualiza o espelho. O seed local (`npm run db:seed-profiles`) grava o aceite fictício da versão vigente, lida de `config/consent.ts`.

**`questionnaire_results.answers_enc`** (#256, nulo em resultado anterior ou decidido pela coordenação): a última resposta válida do
questionário, JSON item → intensidade (-5, -3, -1, 1, 3, 5), cifrado no servidor (AAD `questionnaire_results.answers_enc.<profile_id>`; o
banco só confere o formato `v<n>.<iv>.<ct>`, até 4 KB). Gravado só por `record_questionnaire_result` (parâmetro novo, coberto pela
assinatura do servidor). **Sem grant de leitura** para `authenticated`: a própria pessoa o lê por `own_questionnaire_answers_enc()`
(definer; só o servidor decifra). Apaga com a conta (cascata) e entra em "Baixar meus dados" (formato 10). Um resultado reescrito sem respostas novas (decidido pela coordenação, ou o caminho legado `record_totem_pending`, que com os pesos 1-3-5 não roda em respostas novas) as apaga (trigger). Tamanho real: 26 respostas cifradas ocupam menos de 1 KB (teto 4 KB).
Na tela "Trocar de casa" (#268) o servidor lê o resultado e `own_questionnaire_answers_enc()`, decifra e sela o token da comparação; sem respostas guardadas a tela mostra só o gráfico, sem expectativas (as frases gerais por eixo foram canceladas em 2026-11-28; `axes.<eixo>.expectation` é opcional e sem uso).

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
titular lê; sem grant de escrita. **A pontuação roda no servidor do app** (ADR 0014 §1): o
navegador manda só as respostas. O banco recebe só a casa, o totem e as notas
**cifrados**; as respostas não chegam mais ao banco (só estão em pedidos antigos de `house_analysis_requests`, abaixo).

### `questionnaire_results` e `house_analysis_requests` (ADR 0014, #172)
`questionnaire_results`: `profile_id` (PK, FK `profiles`, cascata), `term_version` (FK
`app.questionnaire_term_versions`), `house_key` (FK `houses`), `totem_enc`, `scores_enc` (as notas dos 4 eixos, JSON cifrado; nulo em resultado antigo) (o totem, duas letras
maiúsculas, cifrado no servidor; o banco só confere o formato `v<n>.<iv>.<ct>`; **nulo enquanto o totem está pendente**, quando só os eixos do totem empataram), `totem_state` (`decided`; `pending`, com o pedido de totem aberto; `undecided`, "totem não decidido": o pedido venceu ou a pessoa foi bloqueada),
`source` (`questionnaire`, pontuação no servidor do app; `analysis`, decidido pela coordenação
nacional), `created_at`. Uma linha por pessoa, a mais recente.

`house_analysis_requests`: `id`, `profile_id` (FK, cascata), `term_version`, `kind` (`full`: a coordenação
decide casa e totem; `totem`: a casa já saiu pelos eixos 1 e 2 e falta só o totem), `tied_axes` (eixos
empatados: `house1`, `house2`, `totem1`, `totem2`; em `kind = totem`, só os do totem), `answers_enc` (JSON item → intensidade
-5, -3, -1, 1, 3 ou 5 (-3 a 3 na chave antiga), cifrado no servidor; até 8 KB), `status` (`open` ou `resolved`), `resolution` (`coordination` ou `self`),
`created_at` (último envio: base do limite de renovação), `opened_at` (primeira abertura, nunca muda: base do prazo de 30 dias), `resolved_at`, `resolved_by` (nulo fora de `coordination` e se a conta de quem resolveu
sair). `resolution`: `coordination`, `self`, `inactive` (pessoa bloqueada ou suspensa) ou
`expired` (passou de 30 dias).
Um pedido aberto por pessoa. **As respostas existem só com o pedido aberto** (o banco recusa
`answers_enc` em pedido resolvido): são apagadas quando a coordenação nacional resolve, quando a
pessoa aceita uma casa (gatilho em `house_members`; só o pedido `full`, o de totem segue aberto), quando refaz o questionário com resultado
conclusivo, quando é bloqueada ou suspensa (gatilho em `profiles`) e **depois de 30 dias**
(`app.analysis_max_age()`: a política de leitura já esconde o pedido vencido, e as respostas são
apagadas na chamada seguinte das funções abaixo). A linha resolvida fica, sem respostas.

`app.server_secrets` (`name`, `value`): segredos que o app e o banco compartilham; hoje a
`questionnaire_signing_key` (ADR 0014 §1), instalada por quem opera (`docs/OPERACAO.md`). RLS sem
política e sem grant: só funções `security definer` leem.

- **Quem lê** (RLS, `app.can_read_questionnaire_data`): a própria pessoa; a coordenação nacional
  (gestor da raiz ativo) sobre pessoa ativa; e um gestor com concessão ativa (abaixo) sobre pessoa
  ativa do escopo dele. Ninguém escreve pela API: só as funções abaixo.
- **`record_questionnaire_result(termo, casa, totem_enc, notas_enc, emitido_em, assinatura)`:** a pessoa da
  sessão (ativa, com o aceite daquela versão do termo; casa existente e ativa) grava o resultado
  conclusivo e fecha um pedido aberto. **Só com a assinatura do servidor do app** (HMAC-SHA256
  sobre pessoa, termo, casa, totem e notas cifrados e hora; vale 5 minutos; erro 42501 se faltar ou não bater):
  chamar a API direto, sem a chave, não impõe resultado.
- **`request_house_analysis(termo, eixos, respostas_enc, emitido_em, assinatura)`** (sem uso no app desde #213 e sem grant para `authenticated` desde #220; fica a função): a pessoa da
  sessão abre (ou renova) o pedido do resultado inconclusivo e apaga o resultado anterior; também
  só com a assinatura (que cobre os eixos e o valor cifrado das respostas: é ela que garante que
  são as respostas completas e válidas, já que o banco não decifra). Valida os eixos e o formato do
  valor cifrado (erro 22023). Renovar um pedido completo antes de 1 hora é recusado (54000); renovar não estende o prazo de 30 dias. Gera `house_analysis_requested`.
- **`record_totem_pending(termo, casa, notas_enc, eixos, respostas_enc, emitido_em, assinatura)`:** quando só os
  eixos do totem empatam, o servidor grava, numa chamada, a casa com `totem_enc` nulo e o pedido `totem` (um
  pedido aberto por pessoa; renova na hora, sem o limite de 1 hora, porque a casa já é conclusiva). Assinatura
  com o prefixo `totem_pending` (cobre o tipo, a casa, as notas, os eixos e as respostas cifradas). Valida
  eixos só de totem, sem repetição, e formato dos valores cifrados (22023). Limites por tipo: o totem pendente só
  pode ser reenviado depois de 10 segundos (54000) e o pedido completo, depois de 1 hora; um tipo não segura o
  outro. Gera `house_analysis_requested`.
- **`resolve_house_analysis(pedido, casa, totem_enc, notas_enc, emitido_em, assinatura)`** (as notas o servidor refaz das respostas do pedido): a coordenação nacional ou um delegado com concessão sobre a pessoa do pedido (fora do escopo, ou de pessoa inativa, o pedido aparece como inexistente; o delegado também não resolve o de quem é gestor ativo na raiz ou na unidade da concessão ou acima dela), **com a assinatura do servidor** (HMAC sobre quem resolve, pedido, casa, totem e notas cifrados e o **hash das respostas** que o servidor leu; 5 minutos; se o pedido mudou desde a leitura, recusa 40001), nunca sobre o
  próprio pedido e só sobre pessoa ativa (trava o perfil na mesma ordem das outras funções). Em pedido `totem`, a casa tem de ser a do resultado (22023). Grava o resultado
  (`source = analysis`), apaga as respostas e gera `house_analysis_resolved`. A pessoa ainda
  aceita a casa pelo fluxo normal (`accept_house`). As telas da coordenação (#174, `/coordenacao/casas/`: resultados,
  análise e delegações) leem pelo servidor, que decifra (`src/modules/houses/server/coordination*.ts`).

`questionnaire_data_grants` (delegação, ADR 0014 §4): `id`, `grantee_id` (FK `profiles`, cascata),
`unit_id` (FK `units`: unidade abaixo da raiz onde o gestor tem o papel de gestor ativo),
`role_assignment_id` (FK `role_assignments`: o papel de gestor a que a concessão está amarrada; revogado
o papel, a concessão não volta com um papel novo, precisa de nova decisão da nacional), `granted_by`, `granted_at`, `revoked_at`, `revoked_by`. Uma concessão ativa por gestor e unidade.
Dá ao gestor o direito de ver o totem, os pedidos de análise e os eventos `house_analysis_*` das
pessoas **ativas** com vínculo aberto na unidade ou abaixo (`units.path <@`); só vale enquanto ele
mantém **esse mesmo papel** de gestor ali; nunca sobre si mesmo; inclui resolver a fila (no escopo).
- **Quem lê** (RLS): a coordenação nacional e o próprio gestor (a que recebeu).
- **`grant_questionnaire_access(gestor, unidade)` / `revoke_questionnaire_access(concessão)`:** só
  o gestor ativo da raiz; ninguém concede a si mesmo; a pessoa precisa estar ativa e ser gestora
  ativa da unidade, que não pode ser a raiz (22023); concessão repetida, 23505 (uma concessão antiga
  de papel já revogado é encerrada ao refazer). Geram `questionnaire_access_granted/revoked` (ator =
  a nacional, alvo = o gestor) com **`unit_id` e `grant_id`** do evento (ids, sem dado pessoal; só
  nesses eventos).

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

### `skills` e `profile_skills` (#8)
`skills`: `id`, `name` (único), `category`, `aliases` (text[], sinônimos para a busca), `active`.
Índice GIN em `aliases`. A **busca por habilidade roda no banco** (texto puro, indexado); só os
nomes da página exibida são decifrados no servidor (ADR 0003 §6). Leitura só de perfil ativo
(`app.is_active_member`); ninguém grava pela API (catálogo entra por seed ou migration).
`profile_skills`: `profile_id` (cascade com o perfil), `skill_id`; chave (`profile_id`,
`skill_id`) e índice `(skill_id, profile_id)`. Lê quem pode ver o perfil (`app.can_view_profile`).
Sem `level`: o nível (só "tenho" ou três graus) segue em aberto com o stakeholder; sem
limite por pessoa nem opção "outra" até a #15, que também grava e inclui as habilidades no
arquivo de exportação dos dados da pessoa.

**Catálogo PROVISÓRIO** (47 habilidades em 8 grupos, até o stakeholder aprovar): vai por migration
(`..._estrutura_instancia.sql`), no local e no servidor. Para trocar, crie uma migration nova (upsert pelo nome).

**Perfis fictícios (~50):** `npm run db:seed-profiles` (depois do `db:reset`) cria, só no
Supabase local, 50 contas `perfil-ficticio-NN@example.com` com nome e WhatsApp
(`+55119000000NN`, convenção deste projeto para teste) cifrados pelo código do app, município (da Região Metropolitana de São Paulo), distrito (onde há mais de um) e 2 a 6
habilidades. Roda de novo sem duplicar; recusa produção e qualquer endereço não local.

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
`access_granted`, `access_blocked`, `data_exported`, `house_accepted`, `questionnaire_consented`, `consent_accepted`,
`member_blocked`, `member_unblocked`, `house_analysis_requested`, `house_analysis_resolved`,
`house_changed`),
`target_id`, `item_count`, `reason`, `term_version`, `house_key`, `created_at`.
`item_count` só existe em evento de lote (`allowlist_imported`): a quantidade, nunca os itens.
`reason` existe nas decisões de acesso (`manual`, fila do gestor; `import`, liberação
automática na importação), em `house_accepted` (a forma de entrada: `self` ou
`questionnaire`) e em `contact_viewed` (o tipo do contato: `whatsapp`, `social` ou `email`); nesses
eventos é obrigatório. Em `member_blocked` é opcional (`impersonation`, `conduct` ou `other`). Em `contact_viewed`, `actor_id` é quem viu e `target_id` a pessoa vista. `term_version` é a versão do termo do questionário: obrigatória em
`questionnaire_consented` e em `house_accepted` pelo questionário. Em `house_accepted`,
`actor_id` e `target_id` são a pessoa e `house_key` é a casa (obrigatória). `house_changed`: o
ator é quem trocou (a pessoa, motivo `self`, ou a coordenação, motivo `coordination`), o alvo é a
pessoa e `house_key` é a casa nova.
Em `house_analysis_requested`, ator e alvo são a pessoa; em `house_analysis_resolved`, o ator é a
coordenação nacional e o alvo é a pessoa. Nenhum dos dois leva as respostas, o totem nem a casa.
**Leem a coordenação nacional e quem ela delegou sobre aquela pessoa**: o gestor territorial comum
que gerencia a pessoa não. `questionnaire_access_granted/revoked` (ator = a nacional, alvo = o
gestor): só a coordenação nacional os lê; o gestor os vê no próprio arquivo.
`questionnaire_result_viewed` (ator = quem abriu o resultado ou o caso, alvo = a pessoa vista; sem conteúdo, um por ator e alvo a cada 10 minutos,
gravado por `log_questionnaire_view`, só para quem pode ler os dados do alvo e nunca sobre si): só a
coordenação nacional o lê; a pessoa vista o vê no próprio arquivo. `questionnaire_coordination_access()`
diz ao menu e às telas se quem chama é a nacional e/ou delegado (só para o 404; não concede nada).
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
encerrados, aceites do termo do questionário, o resultado do questionário (casa, **totem** e **notas por eixo**, cifrados e decifrados pelo servidor; formato 9 do arquivo), os pedidos de
análise (com as respostas, se abertos, idem), as concessões de acesso que recebeu, papéis (com a casa do coordenador de casa),
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
  `access_waitlist_hmac`, `questionnaire_consents`, `questionnaire_results`, `house_analysis_requests`, `consent_acceptances`, `app.profile_save_attempts` e `app.member_block_attempts`. A função
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
