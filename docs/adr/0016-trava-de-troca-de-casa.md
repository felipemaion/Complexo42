# ADR 0016: Trava de 4 meses para trocar de casa

- **Status:** Aceito em 2026-11-27, decisão da coordenação nacional.
- **Data:** 2026-11-27
- **Refs:** issue #209; ADR 0008 §2, ADR 0011, ADR 0014.

## Decisão

1. Definida a casa (aceita, escolhida direto ou decidida pela coordenação), a **pessoa** só a troca
   por conta própria 4 meses depois do **mais tardio** entre o aceite do termo do questionário e o
   aceite da casa (sem termo aceito, o aceite da casa): ninguém entra com a trava já vencida. Antes de definir (tela de sugestão), "Escolher outra casa" é livre.
2. A **coordenação** com alcance de **gestão** sobre a pessoa (`can_manage_house_member`: gestor ou
   monitor da unidade, ou coordenação da casa) troca a casa a qualquer momento, na tela de
   resultado. A delegação de **leitura** dos resultados não vira poder de escrita.
   A troca da coordenação **não** reinicia a trava; a da própria pessoa a reinicia (4 meses
   a partir da troca).
3. Toda troca vai para o `audit_log` (`house_changed`, ator = quem trocou, motivo `self` ou
   `coordination`).
4. A tela do questionário avisa, junto ao botão de aceite, que a casa só poderá ser trocada pela
   pessoa depois de 4 meses (texto da tela, não do termo). `/inicio` e `/casa` mostram a data a
   partir da qual a pessoa poderá trocar; vencido o prazo, `/casa` oferece "Trocar de casa" (escolha
   direta).

5. Na lista e no resultado da coordenação aparecem a casa **sugerida** e a **escolhida** (vínculo aberto;
   vazia se ainda não aceitou), com destaque quando diferem, a data da escolha e se a troca foi da
   coordenação; há o filtro "escolheu outra casa", feito no banco sobre todas as pessoas do alcance
   (`coordination_other_house_results`), não só sobre a página. Lido por `coordination_chosen_houses`, com o
   alcance das telas de resultado; abrir o resultado continua auditado.

## Como é garantido

No banco, não na interface: `house_members.locked_until` é preenchida por gatilho (e pelas funções) com o
relógio do servidor; a pessoa não escreve em `house_members`; `accept_house` (security definer)
recusa outra casa antes do prazo (`C7603`); `coordination_set_house` confere o alcance. As duas
travam o perfil da pessoa e o vínculo aberto (`for update`), então não correm uma contra a outra; se
a troca concorrente ainda atropelar, o erro é `C7604`. Trocas (`moved`) não contam como "tirada pela
coordenação" (`C7602`). "Baixar meus dados" traz `locked_until` e o histórico `house_changed`.

## Consequências

- Vínculos já aceitos ganham a trava na migration (4 meses do aceite do termo ou da casa).
- A pessoa tirada da casa pela coordenação continua sem voltar sozinha (ADR 0011).
- A chave e as perguntas do questionário não mudam aqui.
