import { instance } from "@config/instance";
import { parseConsentTerm } from "@/modules/privacy";

/*
 * Termo de consentimento (#11). O texto mora aqui. Versão nova = mudar `version` e o texto aqui E
 * redefinir `app.current_consent_version()` numa migration (o banco só aceita a vigente;
 * tests/consent-version.test.ts confere que os dois batem). Todos veem o termo e aceitam de novo.
 *
 * Fonte: docs/TERMO_CONSENTIMENTO.md (rascunho `v1`, ainda sem validação do jurídico, #7).
 * Os itens marcados [jurídico] ou [decidir] no rascunho NÃO entram aqui (o parse recusa): a
 * controladora e o encarregado, a transferência internacional, a idade mínima e as listas da
 * coordenação voltam quando o jurídico decidir. Quando o texto definitivo chegar, troque o
 * conteúdo abaixo, a `version` (ex.: "v2") e a migration. Validado na carga do app, como o config/instance.ts.
 */
const platform = instance.name;

export const consentTerm = parseConsentTerm({
  version: "v1",
  title: `Seus dados em ${platform}`,
  intro: "Antes de preencher o seu perfil, leia com calma como usamos os seus dados. Se concordar, marque a caixa no fim da página.",
  sections: [
    {
      heading: "Para que usamos",
      paragraphs: [
        "Para organizar quem concluiu a formação em casas, equipes e atividades; para a coordenação encontrar pessoas por habilidade e região; e para acompanhar as missões e o desempenho de cada um. Não vendemos nem cedemos seus dados a ninguém.",
      ],
    },
    {
      heading: "O que guardamos",
      rows: [
        { label: "Nome", text: "Para a coordenação e sua equipe saberem quem é você." },
        { label: "E-mail", text: "Para você entrar na plataforma e para a coordenação falar com você." },
        { label: "WhatsApp", text: "Para a coordenação falar com você." },
        { label: "Município, distrito e bairro (opcional)", text: "Para organizar as equipes por região." },
        { label: "Redes sociais (opcional)", text: "Para mostrar seu trabalho, se você quiser." },
        { label: "Habilidades e formação", text: "Para encontrar quem pode ajudar em cada atividade." },
        {
          label: "Casa sugerida pelo questionário",
          text: "Para indicar sua casa de formação. As suas respostas não ficam guardadas.",
        },
        { label: "Missões, pontos, medalhas e avaliações", text: "Para acompanhar sua participação." },
      ],
      paragraphs: ["Não pedimos CPF, RG, endereço completo, data de nascimento nem foto de documento."],
    },
    {
      heading: "Quem vê",
      bullets: [
        "A coordenação responsável pela sua região vê seu nome, suas habilidades e sua participação. Ela vê seu WhatsApp, e-mail e redes só quando clica em “ver contato”, e cada clique fica registrado.",
        "Sua equipe e sua casa veem seu contato só se você autorizar, em “Quem vê meu contato”. Você pode mudar isso quando quiser.",
        "As avaliações são internas: não aparecem para os colegas.",
        "Ninguém de fora da organização tem acesso.",
      ],
    },
    {
      heading: "Como protegemos",
      paragraphs: [
        "Nome, WhatsApp e redes ficam cifrados: mesmo quem tiver acesso ao banco de dados não consegue lê-los sem a chave, que fica só com os responsáveis técnicos. Toda a comunicação é protegida (HTTPS). Avisaremos você e a autoridade (ANPD) se houver um incidente de segurança.",
      ],
    },
    {
      heading: "Por quanto tempo",
      paragraphs: [
        "Enquanto sua conta existir. Quando você excluir a conta, apagamos seus dados na hora. Só fica uma contagem anônima das atividades, sem nada que identifique você.",
      ],
    },
    {
      heading: "Seus direitos",
      paragraphs: ["A qualquer momento, na própria plataforma, você pode:"],
      bullets: [
        "ver e corrigir seus dados;",
        "baixar uma cópia dos seus dados;",
        "excluir sua conta;",
        "retirar este consentimento, o que exclui a conta.",
      ],
    },
    {
      heading: "Serviços que usamos",
      bullets: [
        "Hospedagem: em servidor próprio.",
        "Proteção de acesso: Cloudflare, que protege o site contra ataques.",
        "Login: Google, se você entrar com Google.",
        "Envio de e-mail: para o link de entrada.",
      ],
      paragraphs: ["Esses serviços só tratam o necessário para funcionar e não usam seus dados para outros fins."],
    },
  ],
  checkboxLabel: "Li e concordo com o uso dos meus dados como descrito acima.",
  continueButton: "Continuar",
  uncheckedHint: "Marque a caixa acima para poder continuar.",
  declineButton: "Não concordo e quero sair",
  rightsTitle: "Seus direitos, mesmo sem concordar",
  errors: {
    unchecked: "Para continuar, marque a caixa dizendo que leu e concorda.",
    failed: "Não foi possível registrar o seu aceite agora. Tente de novo em instantes.",
  },
});
