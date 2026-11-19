# ADR 0010: Quem vê o contato de cada pessoa

- **Status:** Aceito (pelo gestor, em 2026-11-19)
- **Data:** 2026-11-19
- **Altera:** a R4 do AGENTS.md (o e-mail deixa de ser proibido de exibir) e a coluna "Quem
  vê" do `docs/MODELO_DADOS.md`.

## Contexto

- A coordenação precisa falar com as pessoas do seu escopo. Hoje ela vê só o WhatsApp e as
  redes, ao clicar em "ver contato", com registro na auditoria.
- Colegas de equipe e de casa também precisam se falar. O "colegas de equipe [?]" estava em
  aberto.
- O e-mail de login era proibido de exibir.

## Decisão

| Contato | Coordenação do escopo | Equipe e casa |
|---|---|---|
| WhatsApp | Vê, ao clicar em "ver contato" | Só se a pessoa autorizar |
| Redes sociais | Vê, ao clicar em "ver contato" | Só se a pessoa autorizar |
| E-mail de login | Vê, ao clicar em "ver contato" | Só se a pessoa autorizar |

- **"Coordenação do escopo"** é quem passa no `app.can_view_contact` (ADR 0002):
  - o monitor ou gestor com papel na unidade da pessoa ou acima dela;
  - **não** inclui o porta-voz nem o administrador técnico.
- **Autorização da pessoa:** ela escolhe, **para cada contato**, entre `ninguém` (padrão),
  `minha equipe` ou `minha equipe e minha casa`.
  - Pode mudar a escolha quando quiser, e a mudança vale na hora.
  - A tela explica, em linguagem simples, quem vai ver.
- **Vale só enquanto o vínculo existir:** quem sai da equipe ou da casa deixa de ver na hora.
- **Pessoas que não estão ativas** (em espera, bloqueadas ou suspensas) não veem nem são vistas
  (ADR 0008 §1).
- **Todo acesso ao contato é registrado** no `audit_log` (`contact_viewed`), com quem viu,
  de quem e quando, mas não o quê. Isso vale também para os colegas. A pessoa pode ver quem
  acessou o contato dela.
- **Onde está cada contato:**
  - WhatsApp e redes continuam cifrados (ADR 0003).
  - O e-mail continua em `auth.users`, gerenciado pelo Supabase. Ele é lido por uma função
    `security definer` que só devolve o valor quando `app.can_view_contact` permite, e sempre
    registra o acesso.
- **Exportação em massa** de contatos fica fora deste ADR. Se for preciso, exige um ADR
  próprio e base no termo de consentimento.

## Alternativas consideradas

- **Equipe vendo o contato por padrão:** é mais simples, mas expõe o celular de quem não
  quer. O consentimento por pessoa e por contato é o que a LGPD prefere.
- **Manter o e-mail proibido:** a coordenação ficaria sem o canal do link de login e das
  comunicações formais.

## Consequências

- (+) Cada pessoa controla o próprio contato, e há rastro de quem viu.
- (+) Resolve o "colegas de equipe [?]" sem pedir decisão caso a caso.
- (−) Mais uma regra em `app.can_view_contact`, com testes de matriz para equipe, casa e
  fora do vínculo (R16).
- (−) O termo de consentimento (#7) precisa citar que a coordenação vê o e-mail.
