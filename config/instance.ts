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
    tooManyAttempts: "Muitas tentativas. Tente de novo mais tarde.",
    failed: "Não foi possível salvar agora. Seus dados não foram perdidos: tente de novo em alguns minutos.",
  },
  myData: {
    downloadButton: "Baixar meus dados",
    downloadHint: "Um arquivo com tudo o que guardamos sobre você. Guarde em lugar seguro: ele tem seu nome e seu WhatsApp.",
    rateLimited: "Você já baixou seus dados várias vezes na última hora. Tente de novo mais tarde.",
    failed: "Não foi possível gerar o arquivo agora. Tente de novo em alguns minutos.",
    fileDescription:
      "Cópia dos dados que a plataforma guarda sobre você (Lei Geral de Proteção de Dados, art. 18). Nome e WhatsApp ficam cifrados no banco e foram decifrados só para gerar este arquivo.",
  },
  // Escolha da casa (#76): "Você sabe o que quer fazer?" → lista de atividades ou questionário.
  houseSelection: {
    title: "Sua casa de formação",
    knowsQuestion: "Você sabe o que quer fazer?",
    knowsYes: "Sim, já sei",
    knowsNo: "Ainda não",
    activitiesTitle: "O que você quer fazer?",
    consentTitle: "Antes do questionário",
    consentAccept: "Aceito e quero responder",
    consentDecline: "Não aceito, prefiro escolher a casa",
    progress: "{current} de {total}",
    bothButton: "as duas",
    backButton: "Voltar",
    suggestedTitle: "Sugerimos esta casa para você",
    chosenTitle: "Conheça a casa",
    firstStepsTitle: "Primeiros passos",
    videosTitle: "Vídeos",
    acceptButton: "Aceitar",
    chooseOtherButton: "Escolher outra casa",
    acceptedTitle: "Sua casa",
    homeLink: "Escolher sua casa",
    errors: {
      unavailable: "Esta casa ainda não está disponível na sua região. Fale com a coordenação.",
      already_accepted: "Você já aceitou uma casa. Para trocar, fale com a coordenação.",
      not_active: "Complete o seu cadastro antes de escolher a casa.",
      stale_consent: "O termo foi atualizado. Recarregue a página para ler a versão nova.",
      failed: "Não foi possível salvar agora. Tente de novo.",
    },
  },
  // Casas de formação (ADR 0008 §2). O `id` liga a casa à unidade do eixo `house`: o `slug` da
  // unidade é o id com `_` no lugar de `-` (casa-exemplo-1 ↔ casa_exemplo_1). A região piloto do
  // seed tem uma unidade para cada casa (tests/house-units.test.ts).
  houses: [
    {
      id: "casa-exemplo-1",
      name: "Casa Exemplo Um",
      description: "[PREENCHER] Descrição curta da casa.",
      activities: ["[PREENCHER] Atividade exemplo 1A", "[PREENCHER] Atividade exemplo 1B"],
      firstSteps: {
        text: "[PREENCHER] História e objetivos da casa e os primeiros passos de quem chega.",
        videoUrls: [],
      },
    },
    {
      id: "casa-exemplo-2",
      name: "Casa Exemplo Dois",
      description: "[PREENCHER] Descrição curta da casa.",
      activities: ["[PREENCHER] Atividade exemplo 2A", "[PREENCHER] Atividade exemplo 2B"],
      firstSteps: {
        text: "[PREENCHER] História e objetivos da casa e os primeiros passos de quem chega.",
        videoUrls: [],
      },
    },
    {
      id: "casa-exemplo-3",
      name: "Casa Exemplo Três",
      description: "[PREENCHER] Descrição curta da casa.",
      activities: ["[PREENCHER] Atividade exemplo 3A"],
      firstSteps: {
        text: "[PREENCHER] História e objetivos da casa e os primeiros passos de quem chega.",
        videoUrls: [],
      },
    },
    {
      id: "casa-exemplo-4",
      name: "Casa Exemplo Quatro",
      description: "[PREENCHER] Descrição curta da casa.",
      activities: ["[PREENCHER] Atividade exemplo 4A"],
      firstSteps: {
        text: "[PREENCHER] História e objetivos da casa e os primeiros passos de quem chega.",
        videoUrls: [],
      },
    },
  ],
});
