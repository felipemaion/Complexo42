# ADR 0012: Questionário das casas por eixos, totem e fila de análise

- **Status:** Proposto. Cria dois dados novos (o totem e, só no caso inconclusivo, as respostas),
  o que pede aprovação do gestor (R4). Os itens marcados com [?] dependem do stakeholder.
- **Data:** 2026-11-26
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
ordem 1..n) e, em todo item, "a" marca o polo "a" do eixo e "b" marca o polo "b".

- **Casa** = interseção dos polos dos eixos 1 e 2: `(a,a)` casa 1, `(a,b)` casa 2, `(b,a)` casa 3,
  `(b,b)` casa 4. O mapa vive no config (`houseByPoles`), com as quatro casas distintas.
- **Totem** = uma letra por eixo extra (eixos 3 e 4; as letras de cada polo vêm do config). Dá
  quatro totens.
- **"As duas"** conta um ponto para cada polo do item.
- **Empate no eixo:** desempata pelos `tieBreakItems` do eixo (subconjunto dos itens do próprio
  eixo, indicados pelo stakeholder; vale por eixo e pode ser vazio). Se ainda empatar, ou se o
  eixo não tem desempate, o resultado é **inconclusivo**.
- **Resultado** (função pura, no aparelho): `{ status: 'ok', houseId, totem }` ou
  `{ status: 'inconclusive', axes }`, com a lista dos eixos empatados. Inconclusivo não atribui
  casa nem totem.
- O esquema Zod rejeita item em dois eixos, item sem eixo, desempate fora do eixo, casas
  repetidas e letras iguais nos dois polos de um eixo do totem.

### 2. O que a pessoa vê

A pessoa vê **só a casa** ("a casa sugerida para você"). O **totem é interno**: não aparece na
tela da casa. Por ser dado pessoal, aparece em "Baixar meus dados" (LGPD art. 18).

A sugestão é só o ponto de partida: a pessoa continua podendo **escolher outra casa** e aceitar
pelo fluxo de sempre (`accept_house`). Trocar de casa depois de aceitar continua sendo com a
coordenação [?] (prazo e regra para a pessoa trocar sozinha).

### 3. Resultado inconclusivo: pedido de análise

- O aparelho abre um **pedido de análise** para a coordenação nacional, com os eixos empatados
  e as **respostas**. Esse é o **único** caso em que as respostas saem do aparelho; com
  resultado conclusivo vão só a casa e o totem.
- A tela diz que a coordenação nacional vai analisar e deixa a pessoa **escolher a casa direto**.
- As respostas ficam guardadas **só enquanto o pedido está aberto** e são apagadas quando:
  a coordenação nacional resolve (e define casa e totem); a pessoa aceita uma casa; ou ela
  refaz o questionário com resultado conclusivo. A linha do pedido fica, sem as respostas.
- Abrir e resolver o pedido geram `house_analysis_requested` e `house_analysis_resolved` no
  `audit_log`, sem as respostas.
- O termo do questionário precisa dizer isso: as respostas só saem do aparelho se o resultado
  não for conclusivo [?] (texto jurídico).

### 4. Quem lê o quê

| Dado | Quem lê |
|---|---|
| Casa sugerida e totem (`questionnaire_results`) | A própria pessoa e a coordenação nacional |
| Pedido de análise e respostas (`house_analysis_requests`) | A própria pessoa e a coordenação nacional |
| Casa aceita (`house_members`) | Como antes (ADR 0011); **sem totem** |

"Coordenação nacional" é o gestor da raiz (`app.manages_root()`). Os coordenadores de casa e
de território não leem o totem [?] (padrão conservador; se alguém mais precisar ver, é decisão
do stakeholder).

### 5. Dados novos

O totem é gravado em texto puro, em tabela de leitura restrita (RLS), por ser um código de
duas letras que só identifica a pessoa junto com o perfil; as respostas, enquanto abertas, também.
Cifrá-los (R13) exigiria decifrar no servidor para a coordenação ler; fica como evolução se o
jurídico pedir. A exclusão da conta apaga tudo em cascata.

## Alternativas consideradas

- **Guardar o totem junto do vínculo da casa (`house_members`):** a coordenação territorial e
  a da casa leem essa tabela, e o totem ficaria visível a elas.
- **Guardar sempre as respostas:** formaria um perfil psicológico sem necessidade. Só o caso
  inconclusivo precisa delas.
- **Atribuir a casa por sorteio ou pelo polo "padrão" em empate:** esconderia uma decisão que é
  da coordenação.
- **Pontuar no servidor:** as respostas passariam a trafegar sempre. Não é necessário.

## Consequências

- (+) A regra é um dado do config: trocar a chave não muda o código.
- (+) O caso comum não envia respostas; o difícil tem fila e auditoria.
- (−) Quando há empate sem desempate, depende de a coordenação nacional resolver os pedidos. A
  tela da fila ainda não existe (acompanha em issue própria); hoje a resolução é a função
  `resolve_house_analysis`.
- (−) O termo do questionário precisa de revisão para cobrir o envio das respostas.
