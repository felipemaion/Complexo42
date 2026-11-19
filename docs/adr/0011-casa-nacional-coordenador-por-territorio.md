# ADR 0011: A casa é nacional; o coordenador de casa tem casa e território

- **Status:** Aceito (pelo gestor, em 2026-11-19)
- **Data:** 2026-11-19
- **Substitui:** o modelo de "casa como unidade dentro de cada região" do ADR 0008 §2. O
  restante do ADR 0008 continua valendo: escolha, questionário, aceite e avaliação dupla.

## Contexto

O gestor esclareceu que:
- a casa é a **trilha de formação** (Atenas, Esparta, Alexandria, Siracusa) e **não tem relação
  com o município**;
- pode haver **coordenador de casa em qualquer nível**: regional, municipal, estadual ou nacional;
- **uma casa pode ter mais de um coordenador**, inclusive no mesmo nível.

O modelo da #76 criava uma unidade de casa dentro de cada região e fazia do coordenador de casa
o `monitor` dessa unidade. Esse modelo não atende o coordenador estadual nem o nacional, e
obrigava a pessoa a ter região antes de escolher a casa.

## Decisão

1. **A casa é uma entidade nacional**, fora da árvore de território:
   `houses(key, name, active)`. Os nomes e os textos vêm de `config/` (R17).
2. **A pessoa escolhe e aceita a casa sem depender de região:** um vínculo de casa por
   pessoa, com `join_method`, `accepted_at` e a versão do termo do questionário. As regras de
   aceite, de consentimento e de remoção pela coordenação da #76 continuam iguais.
3. **O papel de coordenador de casa tem casa e território:** um `role_assignment` com
   `role = 'house_coordinator'`, `unit_id` (o território) e `house_key`.
   - **Quem ele vê:** as pessoas **ativas** da casa `house_key`, com vínculo aceito, cujo
     vínculo de território esteja em `unit_id` ou abaixo dele.
   - **Exemplo:** o coordenador de Esparta em SP vê os membros de Esparta de todo o estado de
     SP. O de Esparta no ABC vê só os do ABC.
   - **Quantos:** pode haver vários por casa e por território.
   - **Contato:** ele conta como "coordenação do escopo" no ADR 0010 só para os membros da sua
     casa, dentro do seu território.
4. **A coordenação territorial não muda:** `monitor` e `manager` de uma unidade veem todos dessa
   unidade e abaixo, de qualquer casa.
5. **Quem concede:** o papel de coordenador de casa é concedido pelas mesmas regras do ADR
   0002, ou seja, por um `manager` acima do território. Ninguém concede papel a si mesmo.

## Consequências

- (+) A escolha da casa acontece logo no cadastro, sem esperar a coordenação definir a região.
- (+) Coordenadores de casa em qualquer nível, sem criar uma unidade para cada combinação de
  casa e região.
- (−) As funções de escopo (`app.can_view_*`) ganham um segundo caminho, "casa dentro do
  território". Isso pede uma matriz de permissões nova e revisão adversarial (R16).
- (−) Refazer o banco da #76. Nada está em produção, então não há dado a migrar.
