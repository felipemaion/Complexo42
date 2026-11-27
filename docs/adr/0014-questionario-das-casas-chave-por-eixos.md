# ADR 0014: Questionário das casas por eixos, totem e fila de análise

- **Status:** Aceito em 2026-11-27, aprovado pelo gestor (R4). Cria dois dados novos (o totem
  e, só no caso inconclusivo, as respostas), ambos **cifrados** (ADR 0003), e uma delegação de
  acesso. Os itens marcados com [?] dependem do stakeholder.
- **Data:** 2026-11-26 (proposto); 2026-11-27 (aceito)
- **Substitui:** o formato e a pontuação do ADR 0008 §2.1 (quatro eixos de temperamento).
  Continuam valendo dele: a escolha da casa, o aceite do termo, a interface e o fato de a
  pessoa poder escolher outra casa.
- **Refs:** issues #91, #76 e #172.

## Contexto

Em 2026-11-25 o stakeholder enviou uma versão nova do questionário e da chave de correção.
Em vez de temperamentos, a chave tem **quatro eixos**, cada um com uma lista própria de itens:

- **Eixos 1 e 2** definem a **casa** (casas 1 a 4);
- **Eixos 3 e 4** definem o **totem** (quatro totens), um dado interno.

O texto das perguntas e a chave real são privados e não entram no repositório.

## Decisão

### 1. Formato e pontuação

Cada item tem duas alternativas, **a** e **b**. O config lista os **itens de cada eixo** (não a
ordem 1..n) e, em todo item, "a" marca o polo "a" do eixo e "b" marca o polo "b". Cada eixo tem um
**nome** e o **nome dos dois polos** no config (`label`, `poleLabels`), usados no gráfico.

**Escala de intensidade** (decisão do gestor, 2026-11-27; substitui a escolha a/b/"as duas"). Cada
pergunta mostra seis círculos, sem meio, maiores nas pontas (a à esquerda, b à direita), **nenhum
marcado de início** (resposta obrigatória). A resposta é um inteiro em {-5, -3, -1, 1, 3, 5}
(pesos 1, 3 e 5 por lado; negativo = polo "a"; decisão do gestor, 2026-11-27, #211, no lugar de 1/2/3). Sem "a)" e "b)": as pontas mostram o texto de cada alternativa e, abaixo dos
círculos, a **frase composta** da posição escolhida (ou em foco/sob o mouse): "Intensidade: texto da
alternativa." (ex.: "Totalmente: …", "Na maior parte das vezes: …", "Um pouco mais: …"; as intensidades
ficam na config da instância). A mesma frase é o nome acessível do círculo. Toda frase exibida começa
com maiúscula e termina em pontuação (normalização só de exibição: o JSON do questionário não muda;
`domain/sentence.ts`). Acessível: grupo de rádio, teclado (setas, Home e End) e botão "próxima".

- **Nota do eixo** = média das respostas dos itens do eixo, normalizada para -100..100
  (`média / 5 × 100`, arredondada). O polo é o **sinal da soma** (negativo = a).
- **Sem empate** (#211): todo eixo tem número **ímpar** de itens e todo peso é ímpar, então a soma
  nunca é zero. O config que traz eixo com número par de itens é rejeitado na carga (falha
  fechada), e `tieBreakItems` deixou de existir. A chave atual tem 26 perguntas: 7 e 7 nos eixos da
  casa, 7 e 5 nos do totem.
- **Casa** = interseção dos polos dos eixos 1 e 2: `(a,a)` casa 1, `(a,b)` casa 2, `(b,a)` casa 3,
  `(b,b)` casa 4. O mapa vive no config (`houseByPoles`), com as quatro casas distintas.
- **Totem** = uma letra por eixo extra (eixos 3 e 4; as letras de cada polo vêm do config). Dá
  quatro totens.
- **Resultado** (função pura): sempre `{ status: 'ok', houseId, totem, scores }`.
- **A pontuação roda no servidor**, não no navegador (revisão do PR #173). Motivos: o navegador
  que pontua recebe a chave real (o totem deixaria de ser interno) e pode mandar qualquer casa
  e totem direto à API. O navegador manda **só as respostas**; o servidor valida (todas as
  perguntas, só os seis valores da escala), pontua com o arquivo real (`QUESTIONNAIRE_PATH`) e devolve
  só a casa. A chave (eixos e itens de cada eixo) nunca sai do servidor
  (`toPublicQuestionnaire`). **Exceção** (decisão do gestor, #201): o mapa polos → casa (`houseByPoles`) vai à tela
  **só junto do resultado**, para desenhar as zonas das casas no gráfico (abaixo); a página que o navegador
  recebe antes de responder não o traz.
- **O banco só aceita resultado assinado pelo servidor.** O app não tem `service_role` (R6);
  em vez dela, assina cada resultado com HMAC-SHA256 (`QUESTIONNAIRE_SIGNING_KEY`, a mesma chave
  em `app.server_secrets`, sem acesso pela API). A assinatura cobre a pessoa da sessão
  (`auth.uid()`, nunca um parâmetro), a versão do termo, a casa e os valores **cifrados** do totem
  e das notas (ou, no pedido de análise, os eixos e o valor cifrado das respostas) e vale 5 minutos; o pedido de totem tem prefixo próprio (`totem_pending`), que cobre o tipo. O navegador, mesmo chamando
  a API direto com o próprio login, não consegue impor casa nem totem nem abrir pedido.
- As respostas **passam pelo servidor** em todo envio (para a pontuação), mas só são **guardadas**
  no pedido de análise. Não vão para o log (R11).
- O esquema Zod rejeita item em dois eixos, item sem eixo, eixo com número par de itens, casas
  repetidas e letras iguais nos dois polos de um eixo do totem.

### 2. O que a pessoa vê

A pessoa vê a casa ("a casa sugerida para você") e o **gráfico de aranha dos eixos 1 e 2**, os que
definem a casa. O **totem é interno**, e as notas dos eixos 3 e 4 também: não aparecem na tela da
casa. Por serem dados pessoais, aparecem em "Baixar meus dados" (LGPD art. 18).

**Na página inicial da pessoa** (#203): a casa aceita (ou, sem ela, a sugerida pelo questionário) com nome, cor, descrição
curta e o gráfico dos eixos 1 e 2 com as zonas; sem casa nem resultado, um convite para o questionário. O servidor
nunca pede o totem a essa leitura (`readOwnHouseCard`; regra em `domain/home-card.ts`).

**Gráfico de aranha** (SVG próprio, sem biblioteca): os polos "a" de todos os eixos vêm primeiro e
depois os polos "b", na mesma ordem, de modo que os opostos ficam frente a frente (meia volta). Cada
raio vale a intensidade do polo (0 a 100). **Zonas das casas** (#201, protótipo aprovado): o quadrante entre os
polos dos eixos 1 e 2 que formam cada casa é colorido, com o nome da casa dentro, e uma legenda destaca a casa da
pessoa ("sua casa"). Os quadrantes seguem o `houseByPoles`; a cor de cada casa (clara e escura, `light-dark()`)
vem de `houses[].color` em `config/instance.ts`, com contraste de 3:1 ou mais nos dois temas (a casa roxa,
terceira da lista, tem 4,5:1 ou mais, tirada do tom do próprio escudo; nenhuma casa é amarela: vermelho, azul,
roxo e verde). Cada casa tem o escudo em `public/casas/<id>-{512,128}.{webp,png}` (quadrado, WebP com PNG de
reserva, gerado por `scripts/otimizar-escudos.mjs`), mostrado ao lado do nome da casa (início, `/casa`, resultado)
e pequeno nas listas da coordenação, com o nome como alt, tamanho fixo e `loading=lazy`. O escudo do app
(`public/casas/app-logo-*`) é o logo do **app**, não de uma casa: favicon, ícone de toque, cabeçalho das telas e
`/entrar`; ninguém "pertence" a ele. O nome exibido do app vem de `instance.name` e `instance.shortName`: a
config da instância real usa o nome do app, e o repositório público mantém o exemplo genérico. Na visão da
coordenação os raios saem na ordem a1, a3, a2, a4, b1, b3, b2, b4: os eixos da casa em cruz e os do totem nas
diagonais (`crossOrder`, `houseZones` em `domain/chart.ts`). A pessoa vê 4 raios; a coordenação nacional e os
delegados veem os 4 eixos (8 raios) e o totem. Os nomes das dimensões e dos polos vêm do config do
questionário: o exemplo público usa nomes genéricos; no arquivo privado são **provisórios** até o
stakeholder (Ação × Contemplação; Leis × Costumes, decisão do Cortez; Percepção: P·Prático/A·Abstrato;
Ritmo: R·Regrado/A·Adaptável).

A sugestão é só o ponto de partida: a pessoa continua podendo **escolher outra casa** e aceitar
pelo fluxo de sempre (`accept_house`). Trocar de casa depois de aceitar continua sendo com a
coordenação [?] (prazo e regra para a pessoa trocar sozinha).

### 3. Pedido de análise (casos antigos e correção pela coordenação)

> Desde a chave sem empate (#211) as respostas novas sempre dão casa e totem: o app não abre mais pedido de
> análise nem grava totem pendente. A fila, a resolução e o `totem_state` continuam para os casos já abertos e para
> a correção pela coordenação. O que segue vale para esses pedidos.

- O servidor abre um **pedido de análise** para a coordenação nacional, com os eixos empatados
  e as **respostas completas**. Há dois tipos: `full` (resultado inconclusivo: a coordenação decide
  casa e totem) e `totem` (a casa já saiu e foi gravada, com o totem nulo; a coordenação decide só o
  totem, e a casa da resolução tem de ser a do resultado). São os **únicos** casos em que as respostas
  são guardadas; com resultado conclusivo guarda-se só a casa e o totem. A pessoa vê a casa
  normalmente, e o totem pendente não aparece para ela. Os limites são por tipo: o pedido de totem
  renova depois de 10 segundos e o completo depois de 1 hora (a casa já é conclusiva; um tipo não segura o
  outro). O prazo de 30 dias conta da **primeira abertura** (`opened_at`): renovar não estende a guarda das
  respostas. Se o pedido de totem vence ou a pessoa é bloqueada, o resultado fica com `totem_state =
  undecided` ("totem não decidido"), explícito na tela da coordenação e no "Baixar meus dados". Aceitar a
  casa fecha só o pedido `full`. Só o servidor abre o pedido (assinado);
  renovar o pedido aberto só é possível depois de 1 hora.
- **Recusa visível** (#199): se o envio das respostas é recusado, a tela volta à última pergunta e
  mostra o motivo em texto da config da instância; no limite de renovação (1 hora), com os minutos
  que faltam (calculados no servidor a partir da abertura do pedido). Termo não reconhecido pelo banco
  vira "leia o termo de novo". Só o pedido de análise tem limite: o resultado conclusivo nunca esbarra nele.
- A tela diz que a coordenação nacional vai analisar e deixa a pessoa **escolher a casa direto**.
- As respostas ficam guardadas **só enquanto o pedido está aberto** e são apagadas quando:
  a coordenação nacional resolve (e define casa e totem); a pessoa aceita uma casa (só no pedido `full`); ela refaz o
  questionário com resultado conclusivo; ela é bloqueada ou suspensa; ou passam **30 dias** (o
  prazo). Depois do prazo as respostas deixam de ser lidas na hora (a política de leitura
  esconde) e são apagadas na chamada seguinte de qualquer uma das funções do pedido. A linha do
  pedido fica, sem as respostas.
- A resolução também é **assinada pelo servidor** (casa, totem e notas cifrados, o hash das respostas
  lidas, pedido e quem resolve), como o resultado; se o pedido mudou desde a leitura, é recusada: a coordenação não grava um valor qualquer pela API direta.
- Resolve a coordenação nacional **ou quem ela delegou** (§4), este só sobre pedido de pessoa do
  escopo dele. Sempre só pedido de **pessoa ativa** e nunca o **próprio**.
- Abrir e resolver o pedido geram `house_analysis_requested` e `house_analysis_resolved` no
  `audit_log`, sem as respostas.
- O termo do questionário precisa dizer isso: as respostas vão ao servidor para o cálculo e só
  são guardadas se o resultado não for conclusivo [?] (texto jurídico).

### 4. Quem lê o quê

| Dado | Quem lê |
|---|---|
| Casa sugerida e totem (`questionnaire_results`) | A própria pessoa, a coordenação nacional e quem ela delegou (abaixo) |
| Pedido de análise e respostas (`house_analysis_requests`) | A própria pessoa, a coordenação nacional e quem ela delegou |
| Eventos `house_analysis_requested/resolved` do `audit_log` | A coordenação nacional e quem ela delegou sobre aquela pessoa (o gestor territorial comum **não**, nem pelo alvo) |
| Concessões e seus eventos (`questionnaire_access_granted/revoked`) | A coordenação nacional (e cada gestor lê a que recebeu) |
| Casa aceita (`house_members`) | Como antes (ADR 0011); **sem totem** |

"Coordenação nacional" é o gestor da raiz (`app.manages_root()`). Os coordenadores de casa e
de território não leem o totem sem concessão. Quem lê, lê pelo **servidor**, que decifra (§5).

**Delegação (decisão do gestor, 2026-11-27).** A coordenação nacional pode **conceder** a um
gestor de unidade abaixo da raiz (estadual, municipal...) o direito de ver o totem, os pedidos de
análise e os eventos `house_analysis_*` das **pessoas ativas do escopo dele** (vínculo aberto em
`units.path <@` a unidade da concessão). É uma linha em `questionnaire_data_grants`: explícita
(a nacional escolhe o gestor e a unidade), **revogável** (`revoked_at`/`revoked_by`) e **auditada**
(`questionnaire_access_granted/revoked`). Regras:
- só o gestor ativo da raiz concede e revoga; **ninguém concede a si mesmo**; quem recebeu não repassa;
- a concessão é a **uma unidade abaixo da raiz** em que a pessoa é gestora ativa, **amarrada a esse
  papel** (`role_assignment_id`): perdê-lo encerra o efeito, e um papel novo na mesma unidade NÃO
  ressuscita a concessão antiga (a nacional decide de novo);
- os eventos de concessão e revogação guardam a unidade e a concessão (`unit_id`, `grant_id`);
- sem concessão ativa, só a nacional lê; revogada, 0 linhas; nunca lê quem não está ativo;
- a delegação inclui **resolver a fila** (decisão do gestor, 2026-11-27), nas mesmas regras de escopo
  e de papel ativo da leitura; a resolução do delegado também é assinada pelo servidor e auditada
  (ator = o delegado). Regra conservadora (decisão do orquestrador): o delegado **não resolve** o
  pedido de quem é gestor ativo na raiz ou em unidade igual ou acima da unidade da concessão (nem
  de outro delegado nessa condição); esses a coordenação nacional resolve. O escopo é conferido logo
  ao ler o pedido: fora dele, ou de pessoa inativa, o pedido aparece como inexistente.

**Telas da coordenação** (#174), todas com o JWT da pessoa (nada de `service_role`): em
`/coordenacao/casas/`, **resultados** (lista de pessoas ativas do escopo com casa, totem e data, filtro por
casa; abrir mostra o gráfico completo de 4 eixos e o totem, ou "pendente"), **analise** (fila de casos inconclusivos e de totem pendente, esses marcados "só o totem": nome,
data e eixos empatados; abrir mostra as respostas como frases da escala e o gráfico; formulário para
escolher casa e totem e resolver (no pedido de totem, a casa vem fixa e só o totem é escolhido); linhas ilegíveis são contadas e avisadas) e **delegacoes** (só a
nacional: conceder, revogar e listar). A lista de resultados mostra **só nome, casa e data**, sem a
própria pessoa e com no máximo 200 por página (avisa quando trunca; filtre por casa); **totem, notas e
gráfico só no detalhe**, que registra o acesso. A fila mostra nome, data e eixos empatados, sem respostas. Quem não tem permissão recebe **404**, nunca 403. O link no menu da
coordenação só aparece para quem pode (`questionnaire_coordination_access()`, que só alimenta menu e 404:
quem lê e quem resolve segue sendo o banco). **Abrir o resultado ou o caso de alguém gera o evento
`questionnaire_result_viewed`** (ator e alvo, sem conteúdo; o mesmo ator e alvo em 10 minutos valem um só; função `log_questionnaire_view`, só para quem
pode ler os dados do alvo e nunca sobre si), que só a coordenação nacional lê no log; a pessoa vista o
encontra no "Baixar meus dados".

### 5. Dados novos

O totem, as notas dos eixos e as respostas são dado pessoal e ficam **cifrados** com o esquema existente (R13, ADR
0003: AES-256-GCM, `v<n>.<iv>.<ct>`), **sem exceção**:
- `questionnaire_results.totem_enc`, AAD `questionnaire_results.totem_enc.<profile_id>` (nulo enquanto o totem está pendente);
- `questionnaire_results.scores_enc` (JSON das quatro notas, -100..100), AAD
  `questionnaire_results.scores_enc.<profile_id>`; nulo só em resultado antigo, de antes da escala;
- `house_analysis_requests.answers_enc` (JSON das respostas), AAD
  `house_analysis_requests.answers_enc.<profile_id>` (a linha é a da pessoa: só um pedido aberto
  por pessoa, e as respostas só existem com ele aberto).
Quem cifra e decifra é o **servidor do app** (`src/server/crypto`); o banco só guarda o valor e
confere o formato. A assinatura do resultado (§1) cobre o valor cifrado, e é ela que garante que
as respostas são as completas e válidas (o banco não as decifra, então não as valida). A
coordenação lê pelo servidor, que consulta com o JWT dela (a RLS decide quem lê) e decifra. Como o
banco nunca recebe nem devolve o valor em claro, o log do Postgres e o `pg_stat_statements` não
expõem esses dados; ficam as chaves (`FIELD_ENCRYPTION_KEY`, `QUESTIONNAIRE_SIGNING_KEY`) e o
backup cifrado como único ponto de cuidado. A exclusão da conta apaga tudo em cascata. "Baixar
meus dados" decifra e entrega o totem, as notas dos eixos e as respostas (formato 8).

## Alternativas consideradas

- **Guardar o totem junto do vínculo da casa (`house_members`):** a coordenação territorial e
  a da casa leem essa tabela, e o totem ficaria visível a elas.
- **Totem e respostas em texto puro com RLS** (primeira versão do PR): exigiria uma exceção ao
  ADR 0003 e dependeria de `log_statement = none`. Cifrar custa só decifrar no servidor, que já
  é o caminho de quem lê.
- **Decifrar no banco (pgcrypto, chave no banco):** poria a chave de dados no Postgres; o ADR 0003
  a mantém só no servidor do app.
- **Guardar as notas dos eixos cifradas junto do resultado** (decisão do gestor): é o que permite
  o gráfico sem guardar as respostas. As notas são dado pessoal e seguem o ADR 0003 (§5).
- **Guardar sempre as respostas:** formaria um perfil psicológico sem necessidade. Só o caso
  inconclusivo precisa delas.
- **Atribuir a casa por sorteio ou pelo polo "padrão" em empate:** esconderia uma decisão que é
  da coordenação.
- **Pontuar no navegador** (primeira versão): entrega a chave real ao cliente e deixa o
  cliente impor casa e totem pela API.
- **Usar `service_role` no servidor para gravar:** poderes de sobra se a chave vazar, e o app
  não a tem (R6). A assinatura vale só para este fim.

## Consequências

- (+) A regra é um dado do config: trocar a chave não muda o código.
- (+) O navegador não vê a chave nem impõe resultado; o difícil tem fila, prazo e auditoria.
- (−) Uma chave de assinatura a mais para guardar e instalar nos dois lados (app e banco).
- (−) Quando há empate sem desempate, depende de a coordenação nacional (ou de um delegado) resolver os pedidos. A
  tela da fila ainda não existe (acompanha em issue própria); hoje a resolução é a função
  `resolve_house_analysis`.
- (−) O termo do questionário precisa de revisão para cobrir o envio das respostas.
- (−) Ler totem ou pedido exige passar pelo servidor (não há leitura direta útil no banco). A
  rotação de chaves (ADR 0003 §5) precisa recifrar também `totem_enc` e `answers_enc`.
- (+) A delegação dá a quem coordena um estado ou município o que precisa ver, sem abrir o
  dado a todos os gestores, e é revogável e auditada.
