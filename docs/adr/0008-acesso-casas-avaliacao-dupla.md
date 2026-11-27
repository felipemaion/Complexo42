# ADR 0008: Lista de autorizados, casas de formação e avaliação dupla

- **Status:** Proposto. São definições da reunião com o stakeholder de 2026-11-17; os itens
  marcados com [?] ainda dependem de confirmação.
- **Data:** 2026-11-18
- **Complementa:** ADR 0002 (permissões), ADR 0005 (hierarquia genérica) e ADR 0007
  (equipes e avaliação). O §2.1 foi reescrito pelo ADR 0012.

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
  outra pessoa é resolvido por reclamação: o gestor no escopo bloqueia o perfil já ativo pelo
  e-mail de login (`blocked`, efeito imediato, auditado). Nunca a si nem quem tem papel no seu
  nível ou acima (o gestor da raiz alcança os papéis de sistema e de casa na raiz), com resposta
  neutra no retorno e limite de tentativas por hora. Desbloquear devolve a pessoa à lista de
  espera; a importação da lista não a libera sozinha (o HMAC dela não fica guardado), só a fila.
- **Testes obrigatórios:**
  - quem está `waitlisted` não lê nenhuma tabela além do próprio perfil;
  - um e-mail fora da lista nunca vira `active` sem aprovação;
  - o HMAC não é reversível pela interface.

### 2. Casas

**O modelo de casa está no ADR 0011.** A casa é nacional, e o coordenador de casa tem casa e
território. Daqui continuam valendo:

- **Uma casa e uma equipe por pessoa ao mesmo tempo.**
- **A escolha da casa**, com `join_method` (`self` ou `questionnaire`) e `accepted_at`. Sem
  aceite, o vínculo não conta.
- **O questionário** (§2.1 e ADR 0012). A plataforma guarda **a casa sugerida e o totem**, e
  não as respostas, que formariam um perfil psicológico desnecessário (coleta mínima, LGPD).
  A exceção é o resultado inconclusivo, em que a coordenação nacional precisa das respostas e
  elas ficam só até o pedido ser resolvido.
- **Os nomes das casas e o texto de "primeiros passos"** (história e objetivos, com links de
  vídeo), que ficam em `config/`. Não há nomes fixos no código (R17).

### 2.1 Questionário das casas

**A chave, os eixos, o totem, o desempate e o resultado inconclusivo estão no ADR 0012**, que
substitui o formato de 26 perguntas e quatro eixos de temperamento recebido em 2026-11-18. O
questionário atual tem 28 perguntas de escolha entre duas alternativas (a/b), com a opção de
marcar **as duas**, e um termo de consentimento próprio.

**Decisões que continuam valendo:**
- **A pontuação roda no navegador,** é uma função pura, configurável e coberta por testes. Com
  resultado conclusivo, o servidor recebe só a casa sugerida e o totem; as respostas não vão
  para a rede, para logs nem para o `localStorage`. Só no resultado inconclusivo elas vão, para
  a coordenação nacional (ADR 0012 §3).
- **Interface:**
  - uma pergunta por tela, com o progresso visível ("3 de 28") e botões grandes "a", "b" e
    "as duas";
  - o botão de voltar aparece sempre;
  - o resultado mostra a casa sugerida e o botão **"escolher outra casa"**.
- **O aceite do termo** é registrado com a versão do texto e a data, sem assinatura nem
  e-mail, porque a conta já identifica a pessoa. Quem recusar o termo escolhe a casa
  diretamente (`join_method = self`).
- **O texto das perguntas, a chave e o termo não entram no repositório público** enquanto a
  licença não for confirmada (pergunta 73).
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
