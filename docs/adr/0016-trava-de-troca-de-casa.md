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
3. A **trava individual de 4 meses deixa de existir** (removida do código pela #302). Antes de definir a
   casa (tela de sugestão), "Escolher outra casa" continua livre.
4. A **coordenação nacional** troca a casa de qualquer pessoa a qualquer momento (decisão do Felipe,
   2026-11-28: **só a nacional**, não mais a coordenação com alcance de gestão sobre a pessoa;
   ajustado na #302: `coordination_set_house`). A delegação de **leitura** não vira poder de escrita.
5. Toda troca vai para o `audit_log` (`house_changed`, motivo `self` ou `coordination`); abrir e
   fechar a janela também.
6. Na lista e no resultado da coordenação aparecem a casa **sugerida** e a **escolhida** (vínculo
   aberto; vazia se ainda não aceitou), com destaque quando diferem, a data da escolha e se a troca
   foi da coordenação; filtro "escolheu outra casa" no banco (`coordination_other_house_results`),
   sobre todas as pessoas do alcance. Abrir o resultado continua auditado.

A **coordenação nacional abre e fecha a janela quando quiser, sem prazo fixo**.

## Estado do código (a partir da #302)

A janela é uma tabela de uma linha (`house_transfer_window`), **aberta ou fechada, sem datas nem
duração**; só a coordenação nacional (gestor da raiz) a muda, por `set_house_transfer_window`, e cada
abertura e fechamento vai para o `audit_log` (`house_window_opened`, `house_window_closed`). Uso
previsto: fica aberta no período inicial, até as atividades começarem, e depois a nacional fecha.
`accept_house` recusa a troca de quem já tem casa aceita com a janela fechada (`C7605`; `C7604` se a
casa mudou no meio da troca); a primeira escolha é livre. Saíram `house_members.locked_until`, o
gatilho, o `C7603` e os avisos de 4 meses (nenhuma data na tela). `coordination_set_house` passou a
exigir a coordenação nacional. Trocas (`moved`) não contam como "tirada pela coordenação" (`C7602`).
O item da área de novidades fica para a issue própria.

## Consequências

- Troca em massa, num período combinado pela coordenação nacional, em vez de trocas a qualquer
  hora; a pessoa precisa esperar a próxima abertura. Sem prazo fixo, a nacional pode esquecer a
  janela aberta: a tela da coordenação mostra o estado e o `audit_log` guarda quem mudou e quando.
- A pessoa tirada da casa pela coordenação continua sem voltar sozinha (ADR 0011).
- A chave e as perguntas do questionário não mudam aqui.
