# ADR 0017: Casa antes de tudo

- **Status:** Aceito em 2026-11-27, decisão da coordenação nacional.
- **Data:** 2026-11-27
- **Refs:** ADR 0008 §2, ADR 0011, ADR 0014, ADR 0016.

## Decisão

1. A ordem de quem tem acesso liberado é: **link mágico, termo geral (LGPD), termo do questionário
   (a troca de casa só na janela de transferência, ADR 0016), questionário (26 perguntas), casa aceita ou escolhida direto, e só
   então o perfil** (nome, WhatsApp, localidade) e o resto da plataforma. O termo geral continua primeiro:
   nenhum dado é coletado antes dele.
2. Até a casa estar definida (vínculo aberto em `house_members`), a pessoa só pode **sair, ver/baixar os
   próprios dados e excluir a conta**. Qualquer outra rota leva a `/casa`, o próximo passo pendente.
3. Vale para **todo militante**, inclusive gestores e a coordenação: quem administra também tem casa. Contas
   técnicas só existem em teste e recebem a casa por fixture.
4. Quem já está dentro sem casa cai em `/casa` no próximo acesso. Nada é apagado; quem já tinha perfil o mantém.

## Motivo

A coordenação: "o primeiro passo de tudo é definir a casa"; "nenhum militante dentro da plataforma poderá ficar
sem casa"; "quem ainda não respondeu nada nem perfil tem, nem poderá ver coisa alguma".

## Como é garantido

- **Aplicação:** `requireUser` (usado por toda página e ação protegida) confere o termo geral e, depois, a casa
  aceita; sem ela redireciona para `/casa`. Só `/casa` e as ações da escolha da casa usam a variante que não
  exige casa (`requireUserBeforeHouse`); termo, `/meus-dados` e excluir conta usam `requireAccessUser`.
  A falha na checagem falha fechada (encerra a sessão).
- **Base (perfil incompleto, #226):** a casa vem antes do perfil, mas `house_members` e o resto referenciam `profiles`. A linha de `profiles` passa a nascer no **primeiro login de quem está na lista de autorizados**, sem nome, município, UF nem versão do termo (`profile_completed_at` nulo). Os nulos só valem enquanto incompleto (CHECK); `save_own_profile` completa e marca; ninguém volta a incompleto (trigger). Quem não está na lista não ganha linha: segue o caminho de hoje (perfil, depois espera). **Dois predicados** (revisão do #227): `app.is_onboarding_member()` (linha liberada) vale só para o que vem antes da casa (ver as casas, aceitar o termo do questionário, o questionário, aceitar a casa: `accept_house`, `record_questionnaire_consent`, `lock_active_caller`, políticas `houses_select` e `house_members_select` da própria linha); `app.is_active_member()` é o membro de verdade (liberado + termo vigente + perfil completo + **casa aceita**, #236) e segue em todo o resto (dados de outras pessoas, unidades, coordenação, auditoria, delegação, bloqueio). Ver/baixar os próprios dados e excluir a conta não usam predicado de membro. O HMAC do e-mail passado a `resolve_access` nasce só no servidor (`src/modules/access/server/access.ts`, `resolveAccessAfterSignIn`: e-mail verificado da sessão via `auth.getUser()` + `emailBlindIndex` com a chave do servidor); o navegador não o recebe nem o calcula. Leituras (perfil, nomes na coordenação, "Baixar meus dados", formato 9) toleram perfil incompleto.
- **Ninguém vê nada sem casa (#236):** `is_active_member` exige o vínculo de casa aberto e aceito; a própria pessoa lê, ANTES de ter casa, só o que gerou na entrada (resultado e pedidos do questionário, os próprios eventos de casa e de termo, o próprio vínculo e as casas) por `is_onboarding_member` (`can_read_questionnaire_data` e `can_read_audit`, ramo da própria pessoa).
- **Quem coordena também precisa de casa (#236):** gestor, monitor, coordenador de casa ou de estado sem casa aceita **perde a coordenação** (e o acesso de membro) até ter casa; o papel não é apagado, só deixa de valer. Fixado em `house_required.test.sql`. A tela de resultado da coordenação só **troca** a casa (a pessoa segue com casa e com o papel); não há tela que remova a casa de alguém. Se uma tela de remoção vier, deve avisar "esta pessoa perde a coordenação até ter casa" quando a pessoa removida tiver papel ativo, sem bloquear.
- **Banco:** `save_own_profile` recusa (42501, `house_required`) quem não tem vínculo de casa aberto, além do que já
  exigia (termo vigente, permissão de edição). A UI não é a única barreira.

## Consequências

- **Trocar a versão do termo geral suspende o acesso de membro de todos até o re-aceite** (`is_active_member` exige o
  termo vigente), inclusive coordenação e delegação: só a tela do termo, os próprios dados e a exclusão da conta
  seguem abertos. Nada é apagado. Por isso a troca de versão deve ser **comunicada antes** (checklist de deploy
  em `docs/OPERACAO.md`).
- (+) Ninguém usa a plataforma sem casa; o perfil só aparece depois.
- (−) Todo teste que cria uma pessoa para usar o perfil ou a coordenação precisa dar a ela uma casa.
- (−) A página inicial de quem entra pela primeira vez é `/casa`, não `/inicio`.
