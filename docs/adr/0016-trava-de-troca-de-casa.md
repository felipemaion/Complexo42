# ADR 0016: Trava de 4 meses para trocar de casa

- **Status:** Aceito em 2026-11-27, decisão da coordenação nacional.
- **Data:** 2026-11-27
- **Refs:** issue #209; ADR 0008 §2, ADR 0011, ADR 0014.

## Decisão

1. Definida a casa (aceita, escolhida direto ou decidida pela coordenação), a **pessoa** só a troca
   por conta própria 4 meses depois do aceite do termo do questionário (sem termo aceito, 4 meses
   depois do aceite da casa). Antes de definir (tela de sugestão), "Escolher outra casa" é livre.
2. A **coordenação** com alcance sobre a pessoa (o de `can_manage_house_member` ou o das telas de
   resultado, `can_read_questionnaire_data`) troca a casa a qualquer momento, na tela de resultado.
   A troca da coordenação **não** reinicia a trava; a da própria pessoa a reinicia (4 meses
   a partir da troca).
3. Toda troca vai para o `audit_log` (`house_changed`, ator = quem trocou, motivo `self` ou
   `coordination`).
4. A tela do questionário avisa, junto ao botão de aceite, que a casa só poderá ser trocada pela
   pessoa depois de 4 meses (texto da tela, não do termo). `/inicio` e `/casa` mostram a data a
   partir da qual a pessoa poderá trocar; vencido o prazo, `/casa` oferece "Trocar de casa" (escolha
   direta).

## Como é garantido

No banco, não na interface: `house_members.locked_until` é preenchida por gatilho (e pelas funções) com o
relógio do servidor; a pessoa não escreve em `house_members`; `accept_house` (security definer)
recusa outra casa antes do prazo (`C7603`); `coordination_set_house` confere o alcance. Trocas
(`moved`) não contam como "tirada pela coordenação" (`C7602`).

## Consequências

- Vínculos já aceitos ganham a trava na migration (4 meses do aceite do termo ou da casa).
- A pessoa tirada da casa pela coordenação continua sem voltar sozinha (ADR 0011).
- A chave e as perguntas do questionário não mudam aqui.
