# ADR 0008: Lista de autorizados, casas de formação e avaliação dupla

- **Status:** Proposto. São definições da reunião com o stakeholder de 2026-11-17; os itens
  marcados com [?] ainda dependem de confirmação.
- **Data:** 2026-11-18
- **Complementa:** ADR 0002 (permissões), ADR 0005 (hierarquia genérica) e ADR 0007
  (equipes e avaliação).

## Contexto

Na segunda reunião com o stakeholder, ficou definido:

1. **O link de cadastro será divulgado nos grupos da Academia e vai vazar.** Mesmo assim,
   só deve ter acesso quem concluiu a Academia. Quem não concluiu fica numa lista de espera.
2. **Ao entrar, cada pessoa é direcionada a uma "casa" de formação.** São trilhas como
   porta-vozes, coordenação de equipe, produção intelectual e produção de conteúdo. A
   instância piloto tem **quatro** casas. A pessoa escolhe a casa se já sabe o que quer
   fazer; se não sabe, responde a um questionário. Depois vê uma apresentação da casa e
   **aceita** a casa.
3. **A hierarquia tem dois eixos.** Pelo território: nacional → estado → região (a
   "incubadora" regional). Dentro de cada região há **coordenadores de casa** e **equipes**.
   Uma equipe mistura pessoas de casas diferentes.
4. **Cada membro recebe duas avaliações:** a do coordenador da **equipe**, pelas missões da
   equipe, e a do coordenador da **casa**, pelas missões da casa. **Todos são avaliados**,
   inclusive o porta-voz e os coordenadores, cada um por quem está acima dele.

Isso substitui a hierarquia provisória do kickoff (condutor regional, coordenador municipal e
coordenadores por área), registrada no ADR 0007 §1.

## Decisão

### 1. Lista de autorizados e lista de espera

```
access_allowlist(id, email_hmac, source, added_by, added_at)
  source: 'form' | 'academy' | 'manual'
profiles.access_status: 'pending' | 'active' | 'waitlisted' | 'blocked'
```

- **A lista guarda só o HMAC do e-mail normalizado** (minúsculas e sem espaços, com a mesma
  chave HMAC e o domínio `em` do ADR 0003). Não guarda o nome nem o e-mail em claro: a planilha de origem fica
  com a coordenação, fora da plataforma.
- **No primeiro login, o servidor compara o HMAC do e-mail de login com a lista.**
  - Se o e-mail está na lista, o perfil fica `active`.
  - Se não está, o perfil fica `waitlisted`: a pessoa vê só a mensagem de espera e o próprio
    perfil, e não aparece em busca nem em painel.
- **Quem já está na espera é liberado pela importação** (aprovado pelo gestor em
  2026-11-19). Ao mandar alguém para a espera, o servidor guarda o HMAC apresentado no
  primeiro login em `access_waitlist_hmac` (privada: sem acesso pela API, e nenhuma função
  devolve o HMAC). Quando uma importação traz esse HMAC, a pessoa em `waitlisted` (nunca
  `blocked`, nem com a conta `suspended`) vira `active`, a linha é apagada e cada liberação
  gera `access_granted` com motivo `import`. Guardar esse HMAC não expõe nada novo: o e-mail
  da conta já está em `auth.users`.
- **A coordenação pode aprovar alguém da espera manualmente**, e cada aprovação gera
  `access_granted` no `audit_log`. A importação da lista é feita só pelo gestor e também fica
  auditada (`allowlist_imported`, com a quantidade de e-mails, nunca os e-mails).
- **Não há integração com sistemas externos.** O caso de alguém se cadastrar com o e-mail de
  outra pessoa é resolvido por reclamação: o gestor bloqueia o perfil (`blocked`).
- **Testes obrigatórios:**
  - quem está `waitlisted` não lê nenhuma tabela além do próprio perfil;
  - um e-mail fora da lista nunca vira `active` sem aprovação;
  - o HMAC não é reversível pela interface.

### 2. Casas como segundo eixo de vínculo

As casas são **unidades** do ADR 0005, com um tipo próprio. O vínculo com a casa é separado do
vínculo com a equipe:

```
unit_types.membership_axis: 'team' | 'house'    -- novo campo; configuração da instância
  ex.: national > state > region > { house (axis=house), team (axis=team) }
```

- **Índice único parcial:** cada pessoa tem **um vínculo aberto por eixo**, ou seja, uma casa
  e uma equipe ao mesmo tempo. Isso substitui a regra de "um vínculo aberto por pessoa" do
  ADR 0007 §2.
- **Os coordenadores usam os papéis que já existem:**
  - o coordenador de casa tem `monitor` na unidade da casa e enxerga os membros dela,
    qualquer que seja a equipe;
  - o coordenador de equipe tem `monitor` na unidade da equipe;
  - a coordenação regional e a estadual têm `manager` no nó correspondente.

  A regra única de escopo do ADR 0005 continua valendo.
- **A escolha da casa** fica em `unit_members` (`axis = house`), com `join_method`
  (`self` ou `questionnaire`) e `accepted_at`. Sem aceite, o vínculo não conta.
- **O questionário** vem do stakeholder, que o enviou em 2026-11-18 (detalhes no §2.1). A
  plataforma guarda **só a casa sugerida**, e não as respostas, que formariam um perfil
  psicológico desnecessário (coleta mínima, LGPD).
- **Os nomes das casas e o texto de "primeiros passos"** (história e objetivos, com links de
  vídeo) também ficam em `config/`. Não há nomes fixos no código (R17).

### 2.1 Questionário das casas

**Formato recebido:**
- **26 perguntas** de escolha entre duas alternativas (a/b). A pessoa pode marcar **as duas**
  quando estiver indecisa.
- **Quatro eixos** de temperamento, no modelo de Keirsey: extroversão × introversão,
  sensação × intuição, pensamento × sentimento e julgamento × percepção.
- **Um termo de consentimento** próprio.

A chave de correção e a correspondência entre temperamento e casa ainda vão ser confirmadas
[?] (PERGUNTAS_STAKEHOLDER 75–79).

**Decisões de implementação:**
- **A pontuação roda no navegador.** O servidor recebe só a casa sugerida, e as respostas
  nunca saem do dispositivo: não vão para a rede, para logs nem para o `localStorage`. Não é
  uma questão de segurança, porque a pessoa pode escolher qualquer casa de qualquer forma.
- **A pontuação é uma função pura,** configurável e coberta por testes: quais itens contam
  para cada eixo, qual alternativa corresponde a cada polo, o critério de desempate, o
  tratamento de "as duas" e a correspondência entre temperamento e casa.
- **Interface:**
  - uma pergunta por tela, com o progresso visível ("3 de 26") e botões grandes "a", "b" e
    "as duas";
  - o botão de voltar aparece sempre;
  - o resultado mostra a casa sugerida e o botão **"escolher outra casa"**.
- **O aceite do termo** é registrado com a versão do texto e a data, sem assinatura nem
  e-mail, porque a conta já identifica a pessoa. Quem recusar o termo escolhe a casa
  diretamente (`join_method = self`).
- **O texto das perguntas e do termo não entra no repositório público** enquanto a licença
  não for confirmada (pergunta 73).
  - Em `config/` fica um **questionário fictício** com o mesmo formato, usado no
    desenvolvimento e nos testes.
  - O questionário real é um arquivo instalado só no servidor (`data/config/`), validado pelo
    mesmo esquema Zod na inicialização do app.

### 3. Avaliação dupla (complementa o ADR 0007 §4)

- `member_evaluations` ganha dois campos:
  - `axis` (`team` ou `house`), que diz se a avaliação foi feita pela equipe ou pela casa;
  - `mission_id` null, a missão a que a avaliação se refere.
- **Quem avalia:**
  - quem tem papel na equipe ou na casa avalia os membros daquela unidade;
  - o coordenador de equipe avalia também o porta-voz da equipe;
  - quem tem papel num nível acima avalia os coordenadores do nível de baixo.
- **A regra de leitura do ADR 0007 §4 não muda:** quem avaliou vê o que deu, a hierarquia vê
  só por pedido auditado, e a funcionalidade continua desligada até o parecer jurídico.
- **O coordenador de casa tem um painel de desempenho da sua casa,** com missões cumpridas e
  pendentes por pessoa. O painel não mostra as notas de avaliação.

### 4. Prioridade de janeiro

A prioridade continua sendo cadastro + habilidades + busca, agora com a **lista de
autorizados** e a **escolha da casa** dentro do cadastro. Missões, avaliação e montagem das
equipes ficam para março, quando as equipes começam [?].

## Alternativas consideradas

- **Guardar o e-mail em claro na lista:** seria mais simples conferir, mas guardaria um dado
  pessoal de quem talvez nunca se cadastre. O HMAC basta para comparar.
- **Validar o vínculo com a Academia por um identificador do aluno:** qualquer pessoa poderia
  usar o identificador de outra antes do dono. Também exigiria integração externa, o que o
  stakeholder descartou por ora.
- **Casa como atributo do perfil (`profiles.house`), e não como unidade:** não daria escopo de
  visão ao coordenador de casa, que precisaria de outra regra de permissão (contraria a R15).

## Consequências

- (+) Quem recebe o link vazado não acessa nada nem aparece para ninguém.
- (+) O coordenador de casa e o de equipe usam o mesmo mecanismo de escopo, sem permissão
  especial.
- (−) O índice de "um vínculo aberto" passa a considerar o eixo, e a matriz
  `supabase/tests/permissions_matrix.test.sql` ganha os casos de casa e de espera.
- (−) A importação da lista depende de a coordenação conseguir os e-mails a tempo. O plano B
  é a aprovação manual da fila de espera.
