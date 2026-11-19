# Diagramas: estrutura, papéis e fluxo do pedido

Visão geral para quem chega. A fonte da verdade continua sendo os ADRs
([0002](adr/0002-permissoes-hierarquicas.md), [0005](adr/0005-framework-e-hierarquia-generica.md),
[0007](adr/0007-equipes-rotativas-medalhas-avaliacao.md), [0008](adr/0008-acesso-casas-avaliacao-dupla.md),
[0010](adr/0010-visibilidade-do-contato.md), [0011](adr/0011-casa-nacional-coordenador-por-territorio.md))
e as funções `app.can_*` das migrations. Os diagramas mostram o que está decidido; o que ainda é
intenção do stakeholder vem marcado.

> Revisão com o stakeholder: **pendente** (issue #67).

## 1. Unidades e hierarquia (ADR 0005, 0008, 0011)

Há **dois eixos independentes**. O território é uma árvore (`units`, com `ltree`); a casa é uma
trilha nacional, fora da árvore (`houses`). Cada pessoa tem **um vínculo de território aberto**
(`unit_members`) e **um vínculo de casa aberto** (`house_members`).

```mermaid
flowchart TB
  subgraph T["Eixo do território (units)"]
    direction TB
    BR["Nacional (raiz)"] --> SP["Estado"]
    SP --> RG["Região (incubadora)"]
    RG --> EQ["Equipe"]
    SP --> TR["Turma sem região"]
  end
  subgraph C["Eixo da casa (houses, nacional)"]
    direction LR
    H1["Casa 1"]
    H2["Casa 2"]
    H3["Casa 3"]
    H4["Casa 4"]
  end
  P(("Pessoa")) -- "unit_members: 1 vínculo aberto" --> EQ
  P -- "house_members: 1 vínculo aberto, com aceite" --> H1
```

- A regra de escopo é uma só: quem tem papel na unidade **U** enxerga **U e tudo abaixo**
  (`path <@`). A região e a turma sem região são opcionais por instância.
- A casa não tem relação com o município. O **coordenador de casa** tem casa **e** território
  (`unit_id` + `house_key`): vê as pessoas ativas daquela casa cujo vínculo de território está
  nele ou abaixo.
- Quem ainda está em `waitlisted` não aparece em nenhum dos dois eixos (ADR 0008 §1).

## 2. Papéis e quem concede quem

```mermaid
flowchart TB
  TA["tech_admin<br/>(sistema, sem dados pessoais)"] -- "concede só o 1º manager da raiz" --> MR
  MR["manager da raiz (nacional)"] -- "concede, em unidade abaixo" --> MG["manager de unidade"]
  MR -- "exceção: na raiz" --> HCN["house_coordinator nacional"]
  MG -- "concede, em unidade estritamente abaixo" --> MO["monitor (coordenador da equipe)"]
  MG --> SPK["spokesperson (porta-voz do ciclo)"]
  MG --> HC["house_coordinator (casa + território)"]
```

`monitor` e `spokesperson` nunca concedem. Regras (`app.can_grant_role`, `app.can_revoke_role`):

- Só um `manager` **ativo** concede, em unidade **estritamente abaixo** da sua. Ninguém concede a si
  mesmo.
- Revoga quem concedeu ou um `manager` acima da unidade. Na raiz, o `manager` ativo da raiz revoga
  também o coordenador nacional de casa, mesmo sem tê-lo concedido (ADR 0011 §5).
- A pessoa comum (membro) não tem linha em `role_assignments`: é só o vínculo.

## 3. O que cada papel vê

```mermaid
flowchart LR
  subgraph Papéis
    M["Membro"]
    MO["Monitor / coordenador da equipe"]
    SP["Porta-voz"]
    GE["Manager"]
    HC["Coordenador de casa"]
    TA["tech_admin"]
  end
  subgraph Dados
    PF["Perfil: nome, habilidades, região<br/>can_view_profile"]
    CT["Contato: WhatsApp, redes, e-mail<br/>can_view_contact"]
    UN["Estrutura de unidades<br/>can_view_unit"]
    AU["Auditoria<br/>can_read_audit"]
    AC["Aprovar a lista de espera<br/>can_decide_access"]
    AL["Importar a lista de autorizados<br/>can_import_allowlist"]
    HM["Encerrar vínculo de casa<br/>can_manage_house_member"]
  end
  M -->|"só o próprio"| PF
  M -->|"o próprio; colega só se autorizou"| CT
  M -->|"a sua cadeia até a raiz"| UN
  MO -->|"unidade e abaixo"| PF
  MO -->|"unidade e abaixo, auditado"| CT
  MO --> UN
  MO -->|"unidade e abaixo"| HM
  SP -->|"unidade e abaixo"| PF
  SP -.->|"não vê contato"| CT
  SP --> UN
  GE -->|"unidade e abaixo"| PF
  GE -->|"unidade e abaixo, auditado"| CT
  GE --> UN
  GE -->|"membros do escopo"| AU
  GE --> AC
  GE -->|"só o manager da raiz"| AL
  GE --> HM
  HC -->|"da sua casa, no seu território"| PF
  HC -->|"da sua casa, no seu território, auditado"| CT
  HC -->|"território e cadeia até a raiz"| UN
  HC -->|"a sua casa, no território"| HM
  HC -->|"house_accepted da sua casa"| AU
  TA -->|"estrutura, sem pessoas"| UN
```

Resumo em tabela (o que as funções permitem hoje):

| Papel | Perfil | Contato | Auditoria | Concede papéis |
|---|---|---|---|---|
| Membro | o próprio | o próprio; colegas se ele autorizou (equipe; casa há 7 dias no mesmo território, ADR 0010) | os próprios eventos de casa | não |
| Monitor | escopo | escopo | não | não |
| Porta-voz | escopo | **não** | não | não |
| Manager | escopo | escopo | membros do escopo | monitor, manager, porta-voz e coordenador de casa, abaixo |
| Coordenador de casa | membros da casa no território | idem | `house_accepted` da casa | não |
| tech_admin | **nenhum** | **nenhum** | não | só o 1º manager da raiz |

"Escopo" é a unidade do papel e tudo abaixo. Todo acesso a contato gera `contact_viewed`.
Pessoas que não estão ativas não veem nem são vistas.

## 4. Fluxo do pedido: porta-voz → coordenador da equipe → membros

> **Intenção do stakeholder (reunião de kickoff), ainda sem tabela nem função no banco.** Missões
> e pedidos entram em março. Serve para alinhar a ordem de quem decide, não para implementar.

```mermaid
sequenceDiagram
  autonumber
  participant PV as Porta-voz
  participant CE as Coordenador da equipe
  participant ME as Membros da equipe
  participant CC as Coordenador de casa
  PV->>CE: Pede o trabalho (conteúdo, edição, evento)
  Note over CE: Diretrizes vêm da coordenação.<br/>Decide como executar.
  CE->>ME: Distribui as missões
  ME-->>CE: Entregam
  CE-->>PV: Entrega o resultado
  Note over PV,CE: Fim do ciclo: o porta-voz concede a medalha "trabalhou com"
  PV->>ME: Avaliação reservada
  CE->>ME: Avaliação da equipe
  CC->>ME: Avaliação da casa
```

- O membro **roda** entre porta-vozes: a equipe é da organização, não do porta-voz (ADR 0007 §2).
- O porta-voz só vê o perfil (nome, habilidades, portfólio, medalhas) de quem está na unidade do
  seu papel; não vê contato.
- As avaliações ficam desligadas até o parecer jurídico. Cada uma só é lida por quem avaliou; a
  hierarquia lê por pedido auditado (ADR 0007 §4).

## O que ainda não existe

- Colegas verem o perfil uns dos outros: hoje não veem; decisão de produto na pergunta 80 de
  [`PERGUNTAS_STAKEHOLDER.md`](PERGUNTAS_STAKEHOLDER.md).
- Porta-voz do ciclo e avaliação (dupla): sem código ainda, nas issues #69 e #72. O painel da casa
  (ADR 0008 §3) e as funções `app.can_*` dele ainda não têm issue própria.
