# ADR 0017: Casa antes de tudo

- **Status:** Aceito em 2026-11-27, decisão da coordenação nacional.
- **Data:** 2026-11-27
- **Refs:** ADR 0008 §2, ADR 0011, ADR 0014, ADR 0016.

## Decisão

1. A ordem de quem tem acesso liberado é: **link mágico, termo geral (LGPD), termo do questionário
   (com o aviso da trava de 4 meses), questionário (26 perguntas), casa aceita ou escolhida direto, e só
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
- **Banco:** `save_own_profile` recusa (42501, `house_required`) quem não tem vínculo de casa aberto, além do que já
  exigia (termo vigente, permissão de edição). A UI não é a única barreira.

## Consequências

- (+) Ninguém usa a plataforma sem casa; o perfil só aparece depois.
- (−) Todo teste que cria uma pessoa para usar o perfil ou a coordenação precisa dar a ela uma casa.
- (−) A página inicial de quem entra pela primeira vez é `/casa`, não `/inicio`.
