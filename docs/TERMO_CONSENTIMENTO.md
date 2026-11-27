# Termo de consentimento: rascunho para o jurídico (versão `v1`)

> **Rascunho.** Precisa ser validado pelo jurídico que já cuida da LGPD da organização antes
> do lançamento (#7). Os trechos entre colchetes são preenchidos pela instância. Os itens
> marcados **[jurídico]** pedem decisão. Linguagem simples de propósito: o público inclui
> pessoas mais velhas, e o stakeholder pediu clareza acima de tudo.
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
| Município e bairro | Para organizar as equipes por região |
| Redes sociais (opcional) | Para mostrar seu trabalho, se você quiser |
| Habilidades e formação | Para encontrar quem pode ajudar em cada atividade |
| Casa sugerida pelo questionário | Para indicar sua casa de formação. **As suas respostas não ficam guardadas** |
| Missões, pontos, medalhas e avaliações | Para acompanhar sua participação |

**Não pedimos:** CPF, RG, endereço completo, data de nascimento nem foto de documento.

### Quem vê

- **A coordenação responsável pela sua região** vê seu nome, suas habilidades e sua
  participação. Ela vê seu **WhatsApp, e-mail e redes** só quando clica em "ver contato", e
  cada clique fica registrado.
- **Sua equipe e sua casa** veem seu contato **só se você autorizar**, em "Quem vê meu
  contato". Você pode mudar isso quando quiser.
- **As avaliações** são internas: não aparecem para os colegas.
- **Ninguém de fora** da organização tem acesso.
- **[decidir]** A coordenação pode gerar listas das pessoas da sua região para organizar as
  atividades da organização.

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
3. **Questionário das casas:** o termo próprio do questionário (#91) é separado. Só a casa
   sugerida e o totem são guardados; as respostas só são guardadas se o resultado for
   inconclusivo, e são apagadas ao resolver ou em 30 dias (ADR 0014). O texto do termo precisa dizer isso.
4. **Exportação de listas pela coordenação:** o item **[decidir]** está no texto para não
   ser preciso pedir novo aceite depois. Se não for usado, remova antes do `v1`.
