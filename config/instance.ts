import { parseInstanceConfig } from "@/modules/instance";

/*
 * Configuração da instância (ADR 0005 §3, ADR 0008 §2). O código em `src/` é genérico: nome,
 * cores, rótulos de papéis, casas e textos exibidos vêm daqui (R17).
 *
 * [PREENCHER PELO STAKEHOLDER] Os valores abaixo são marcadores neutros, só para
 * desenvolvimento e testes. Trocar nome, cores, rótulos e casas pelos da instância real. O
 * formato é validado na carga do app (src/modules/instance): um campo inválido derruba o build
 * citando o nome do campo.
 *
 * Os tipos de unidade e seus rótulos não ficam aqui: vêm de `unit_types.label` no banco (#46).
 */
export const instance = parseInstanceConfig({
  name: "Organização Exemplo",
  shortName: "OrgExemplo",
  colors: {
    primary: "#1f4e79",
    secondary: "#f2a900",
  },
  roleLabels: {
    member: "Participante",
    monitor: "Monitor",
    manager: "Coordenador",
    spokesperson: "Porta-voz",
    tech_admin: "Administrador técnico",
  },
  home: {
    title: "Em construção",
    message: "A plataforma está sendo preparada. Volte em breve.",
  },
  waitlist: {
    title: "Seu cadastro está em análise",
    message:
      "Recebemos o seu cadastro, mas o seu e-mail ainda não está na lista de pessoas autorizadas. A coordenação vai analisar e liberar o seu acesso. Você não precisa fazer nada agora: quando o acesso for liberado, é só entrar de novo.",
  },
  auth: {
    title: "Entrar",
    intro: "Escolha um jeito de entrar. Os dois são gratuitos e não pedem senha.",
    googleButton: "Entrar com Google",
    emailLabel: "Seu e-mail",
    emailButton: "Receber link por e-mail",
    // Sem JavaScript, a verificação anti-robô (Turnstile, #116) não roda e o e-mail não sai.
    emailNeedsScript: "Para receber o link por e-mail, ative o JavaScript do navegador. Ou entre com Google.",
    // Mesma resposta para qualquer e-mail (não revela quem tem conta).
    emailSent: "Se este e-mail puder entrar, você vai receber um link. Abra a mensagem e toque no botão para entrar.",
    signedOut: "Você saiu da sua conta.",
    signOutButton: "Sair",
    signedInTitle: "Você entrou",
    signedInMessage: "Seu acesso está funcionando. As próximas telas chegam em breve.",
    connectedAs: "Conectado como",
    confirmTitle: "Entrar",
    confirmMessage: "Toque no botão abaixo para concluir a entrada.",
    confirmButton: "Entrar",
    errors: {
      invalid_email: "Confira o e-mail digitado e tente de novo.",
      rate_limited: "Muitas tentativas em pouco tempo. Espere alguns minutos ou entre com Google.",
      unavailable: "O login está indisponível agora. Tente de novo em alguns minutos.",
      failed: "Não foi possível entrar. Tente de novo.",
      blocked: "Seu acesso está bloqueado. Fale com a coordenação.",
    },
  },
  profile: {
    title: "Seus dados",
    intro: "Preencha os campos abaixo e toque em salvar. Seu nome e seu WhatsApp ficam guardados de forma protegida.",
    nameLabel: "Seu nome",
    nameHint: "Como você quer ser chamado. De 2 a 80 letras.",
    whatsappLabel: "Seu WhatsApp, com DDD",
    whatsappHint: "Só números de celular. Exemplo: (11) 91234-5678",
    municipalityLabel: "Sua cidade",
    municipalityPlaceholder: "Toque para escolher a cidade",
    districtLabel: "Seu distrito",
    districtHint: "Distrito da cidade de São Paulo. Se não souber, pode deixar em branco.",
    districtNone: "Não sei ou prefiro não dizer",
    saveButton: "Salvar meus dados",
    saving: "Salvando...",
    saved: "Pronto! Seus dados foram salvos.",
    editLink: "Ver ou mudar meus dados",
    errorSummary: "Falta arrumar alguns campos:",
    fieldErrors: {
      displayName: "Escreva seu nome, com 2 a 80 letras.",
      whatsapp: "Confira o WhatsApp: DDD e celular com 9 dígitos, como (11) 91234-5678.",
      municipalityCode: "Escolha a sua cidade na lista.",
      district: "Escolha o distrito na lista ou deixe em branco.",
    },
    duplicateWhatsapp:
      "Este WhatsApp já está em outro cadastro. Confira o número. Se ele é mesmo seu, fale com a coordenação.",
    failed: "Não foi possível salvar agora. Seus dados não foram perdidos: tente de novo em alguns minutos.",
  },
  houses: [
    {
      id: "casa-exemplo-1",
      name: "Casa Exemplo Um",
      description: "[PREENCHER] Descrição curta da casa.",
      firstSteps: {
        text: "[PREENCHER] História e objetivos da casa e os primeiros passos de quem chega.",
        videoUrls: [],
      },
    },
    {
      id: "casa-exemplo-2",
      name: "Casa Exemplo Dois",
      description: "[PREENCHER] Descrição curta da casa.",
      firstSteps: {
        text: "[PREENCHER] História e objetivos da casa e os primeiros passos de quem chega.",
        videoUrls: [],
      },
    },
  ],
});
