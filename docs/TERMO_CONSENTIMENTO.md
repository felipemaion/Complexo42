# Termo de consentimento: rascunho para o jurídico (versão `v2` proposta; a `v1` segue em vigor)

> **Rascunho.** Precisa ser validado pelo jurídico que já cuida da LGPD da organização antes
> do lançamento (#7). Os trechos entre colchetes são preenchidos pela instância. Os itens
> marcados **[jurídico]** pedem decisão. Linguagem simples de propósito: o público inclui
> pessoas mais velhas, e o stakeholder pediu clareza acima de tudo.
>
> **v2 (proposta de 2026-11-28):** cobre o que mudou depois da `v1`: respostas do questionário
> guardadas cifradas (#257), medalha do totem visível aos membros (ADR 0014, revisão de 2026-11-28),
> perfil público entre membros, formação e atividade profissional, habilidades (até 10) e a
> miniatura do rosto (ADR 0006, revisão de 2026-11-28). **Não entra no app antes da aprovação do
> jurídico**: a troca de `version` em `config/consent.ts` e a migration de `app.current_consent_version()`
> vão junto dos PRs das funções (#303, #304, #308). Enquanto isso o texto da `v1` no app diz que as
> respostas não ficam guardadas, o que já não é verdade.
>
> A versão do texto vai para `profiles.consent_version` (hoje `v1`). Mudar o texto exige
> nova versão e novo aceite. **Na tela (#11):** o texto mora em `config/consent.ts`. Para trocar o texto e a
> versão (ex.: `v2`), edite a config **e** acrescente uma migration que redefine
> `app.current_consent_version()` (o banco só aceita a vigente; um teste confere que os dois
> batem). Todos aceitam de novo. Os
> itens **[jurídico]** e **[decidir]** não aparecem (o app recusa subir com eles); entram quando
> o jurídico decidir. Faltam hoje: controladora e encarregado, região do servidor e
> transferência internacional, idade mínima (e a caixa de 18 anos), as listas da coordenação, o
> prazo das cópias de segurança, o responsável técnico e o provedor de e-mail.

---

## Seus dados no [NOME DA PLATAFORMA]

**Quem cuida dos seus dados:** [NOME DA ORGANIZAÇÃO], que decide como eles são usados
(controladora). Para qualquer dúvida ou pedido sobre seus dados, fale com [NOME E E-MAIL DO
ENCARREGADO]. **[jurídico: definir controladora e encarregado]**

**Para que usamos:** para organizar quem concluiu a formação em casas, equipes e
atividades; para a coordenação encontrar pessoas por habilidade e região; e para acompanhar as
missões e o desempenho de cada um. Não vendemos nem cedemos seus dados a ninguém.

### O que guardamos

| Dado | Por quê |
|---|---|
| Nome | Para a coordenação e sua equipe saberem quem é você |
| E-mail | Para você entrar na plataforma e para a coordenação falar com você |
| WhatsApp | Para a coordenação falar com você |
| Município, distrito e bairro (opcional) | Para organizar as equipes por região |
| Redes sociais (opcional) | Para mostrar seu trabalho, se você quiser |
| Habilidades (até 10, sem nível) | Para encontrar quem pode ajudar em cada atividade |
| Formação acadêmica (nível mais alto) e atividade profissional | Para encaixar você num eixo da sua casa e encontrar quem pode ajudar |
| Foto do rosto (miniatura, opcional ou obrigatória [decidir]) | Para a coordenação e os colegas reconhecerem você pessoalmente |
| Casa sugerida e medalha do totem (pelo questionário) | Para indicar sua casa e dar a você as duas medalhas de entrada |
| Suas respostas do questionário | Guardamos **só a última resposta, cifrada**, para você comparar as casas e trocar de casa na janela de transferência. A coordenação não vê respostas individuais |
| Missões, pontos, medalhas e avaliações | Para acompanhar sua participação |

**Não pedimos:** CPF, RG, endereço completo, data de nascimento nem foto de documento. A única foto é a do seu rosto, descrita abaixo.

### Quem vê

- **A coordenação responsável pela sua região** vê seu nome, suas habilidades e sua
  participação. Ela vê seu **WhatsApp, e-mail e redes** só quando clica em "ver contato", e
  cada clique fica registrado.
- **Sua equipe e sua casa** veem seu contato **só se você autorizar**, em "Quem vê meu
  contato". Você pode mudar isso quando quiser.
- **Todos os membros logados** veem o seu **perfil público**: nome [decidir], casa, **medalha da casa e medalha do totem**, as medalhas que você escolher mostrar, suas habilidades e sua foto. Seu contato (WhatsApp, e-mail, redes) só aparece para quem você autorizar. Quem não é membro não vê nada.
- **As avaliações** e as **notas** das medalhas são internas: não aparecem para os colegas. As notas do questionário por dimensão ficam só com a coordenação nacional e quem ela delegar.
- **A descrição de uma medalha** que você recebe é pública para os membros: quem concede escreve como você a ganhou, e a tela avisa disso.
- **Ninguém de fora** da organização tem acesso.
- **[decidir]** A coordenação pode gerar listas das pessoas da sua região para organizar as
  atividades da organização.

### Sua foto

Guardamos só uma **miniatura** do seu rosto (pequena, sem os dados escondidos da câmera); o arquivo original é descartado. A foto deve ser **sua, real, no estilo 3x4**, **sem anime e sem imagem feita por inteligência artificial**; a coordenação pode pedir outra. Só membros logados a veem. Você troca ou remove quando quiser, e ela some junto da sua conta. Não usamos a foto para reconhecimento automático.

### Como protegemos

Nome, WhatsApp e redes ficam **cifrados**: mesmo quem tiver acesso ao banco de dados não
consegue lê-los sem a chave, que fica só com os responsáveis técnicos. Toda a comunicação é
protegida (HTTPS). Avisaremos você e a autoridade (ANPD) se houver um incidente de segurança.

### Por quanto tempo

Enquanto sua conta existir. Quando você excluir a conta, apagamos seus dados na hora. As
cópias de segurança são apagadas automaticamente em até [35] dias. Só fica uma contagem
anônima das atividades, sem nada que identifique você.

### Seus direitos

A qualquer momento, na própria plataforma, você pode:

- **ver e corrigir** seus dados;
- **baixar** uma cópia dos seus dados;
- **excluir** sua conta;
- **retirar** este consentimento, o que exclui a conta.

Para qualquer outro pedido, fale com [E-MAIL DO ENCARREGADO].

### Serviços que usamos

- **Hospedagem:** em servidor próprio, operado por [RESPONSÁVEL TÉCNICO].
  **[jurídico: região do servidor e eventual transferência internacional, art. 33]**
- **Proteção de acesso:** Cloudflare, que protege o site contra ataques.
- **Login:** Google, se você entrar com Google.
- **Envio de e-mail:** [PROVEDOR SMTP], para o link de entrada.

Esses serviços só tratam o necessário para funcionar e não usam seus dados para outros fins.

### Idade

A plataforma é só para maiores de 18 anos. **[jurídico: confirmar; menores exigem consentimento
dos responsáveis, art. 14]**

---

☐ **Li e concordo** com o uso dos meus dados como descrito acima.

[Continuar] (botão grande, só habilita depois de marcar)

---

## Notas para o jurídico

1. **Dado sensível (art. 5º, II e art. 11):** participar desta plataforma pode indicar a
   ligação da pessoa com a organização. Se isso for considerado dado sensível, o
   consentimento precisa ser **específico e destacado**. O texto acima tenta cumprir isso com
   a caixa de aceite própria, sem vir marcada.
2. **Base legal:** consentimento (art. 7º, I). Avaliar se alguma finalidade, como as listas
   da coordenação, cabe melhor em outra base.
3. **Questionário das casas:** o termo próprio do questionário (#91) é separado (texto do Cortez, privado). Guardam-se a casa sugerida, o totem e as notas por dimensão (cifrados) e, desde o #257, **a última resposta cifrada**; a **medalha do totem é vista por todos os membros** (as notas não). O termo do questionário precisa dizer isso; a proposta de redação está no repositório privado.
4. **Exportação de listas pela coordenação:** o item **[decidir]** está no texto para não
   ser preciso pedir novo aceite depois. Se não for usado, remova antes do `v1`.
5. **Foto do rosto (ADR 0006, revisão de 2026-11-28):** confirmar a base legal (consentimento do art. 7º, I), que a miniatura sem uso de reconhecimento automático **não** é dado biométrico (art. 5º, II) e se a foto pode ser obrigatória.
6. **Perfil público entre membros:** confirmar que mostrar nome, casa, medalha do totem, habilidades e foto a todos os membros logados cabe no consentimento, ou se precisa de caixa própria.
