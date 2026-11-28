# ADR 0016: Troca de casa (trava de 4 meses, substituída pela janela de transferência)

- **Status:** Aceito em 2026-11-27 (trava de 4 meses). **Revisado em 2026-11-28:** a janela de
  transferência substitui a trava (decisão do Felipe, a partir da reunião com o Cortez).
- **Data:** 2026-11-27; revisão 2026-11-28
- **Refs:** issues #209 e #302; ADR 0008 §2, ADR 0011, ADR 0014.

## Decisão (vale desde 2026-11-28)

1. A troca de casa vem **de cima para baixo**: a **coordenação nacional abre uma janela de
   transferência**. Enquanto ela está aberta, o perfil mostra "Trocar de casa" a quem quiser
   (a tela de comparação das casas, #268). Fora da janela, a pessoa não troca sozinha.
2. A troca **não depende** da data do aceite do termo, do questionário nem da casa.
3. A **trava individual de 4 meses deixa de existir** (a #302 remove do código). Antes de definir a
   casa (tela de sugestão), "Escolher outra casa" continua livre.
4. A **coordenação** com alcance de **gestão** sobre a pessoa (`can_manage_house_member`) continua
   trocando a casa a qualquer momento. A delegação de **leitura** não vira poder de escrita.
   [?] A ata de 28/11 não confirma este ponto; mantido até o Cortez dizer o contrário.
5. Toda troca vai para o `audit_log` (`house_changed`, motivo `self` ou `coordination`); abrir e
   fechar a janela também.
6. Na lista e no resultado da coordenação aparecem a casa **sugerida** e a **escolhida** (vínculo
   aberto; vazia se ainda não aceitou), com destaque quando diferem, a data da escolha e se a troca
   foi da coordenação; filtro "escolheu outra casa" no banco (`coordination_other_house_results`),
   sobre todas as pessoas do alcance. Abrir o resultado continua auditado.

**Em aberto:** quanto tempo a janela fica aberta e se só a nacional a abre.

## Estado do código até a #302

Ainda vale a trava anterior: `house_members.locked_until` preenchida por gatilho (4 meses do
**mais tardio** entre o aceite do termo do questionário e o da casa), `accept_house` recusa outra
casa antes do prazo (`C7603`; `C7604` se a casa mudou no meio da troca), a troca da pessoa a
reinicia e a da coordenação não, o aviso de 4 meses aparece na tela do questionário e `/inicio` e
`/casa` mostram a data. Trocas (`moved`) não contam como "tirada pela coordenação" (`C7602`).
A #302 troca isso por uma tabela de janelas, remove `locked_until`, o gatilho, o `C7603` e os
avisos, e `accept_house` passa a recusar a troca fora da janela.

## Consequências

- Troca em massa, num período combinado pela coordenação nacional, em vez de trocas a qualquer
  hora; a pessoa precisa esperar a próxima janela.
- A pessoa tirada da casa pela coordenação continua sem voltar sozinha (ADR 0011).
- A chave e as perguntas do questionário não mudam aqui.
