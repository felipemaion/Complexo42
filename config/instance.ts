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
  // "Excluir minha conta" (#18, LGPD art. 18, VI). A palavra da confirmação é CONFIRMATION_WORD
  // (src/modules/privacy): os textos que a citam precisam usar a mesma.
  deleteAccount: {
    homeLink: "Excluir minha conta",
    title: "Excluir minha conta",
    warnings: [
      "Vamos apagar a sua conta e tudo o que guardamos sobre você: nome, WhatsApp, redes, cidade, equipe, casa e papéis.",
      "Não dá para desfazer. Se quiser uma cópia dos seus dados, baixe antes na página inicial.",
      "Fica só uma contagem anônima das atividades, sem nada que identifique você. As cópias de segurança são apagadas sozinhas em até 35 dias.",
    ],
    reauthMessage:
      "Para proteger a sua conta, a exclusão só vale nos 10 minutos depois de você entrar. Saia, entre de novo e volte para esta página.",
    reauthButton: "Sair e entrar de novo",
    confirmLabel: "Para confirmar, escreva EXCLUIR no campo abaixo",
    confirmButton: "Excluir minha conta para sempre",
    cancelLink: "Voltar sem excluir",
    invalidConfirmation: "Escreva EXCLUIR no campo para confirmar.",
    reauthRequired: "Já faz mais de 10 minutos que você entrou. Saia e entre de novo para excluir.",
    failed: "Não foi possível excluir agora. Nada foi apagado: tente de novo em alguns minutos.",
    goodbyeTitle: "Sua conta foi excluída",
    goodbyeMessage:
      "Apagamos a sua conta e os seus dados. Obrigado por ter participado. Se quiser voltar um dia, é só se cadastrar de novo.",
    goodbyeLink: "Ir para a página inicial",
  },
  // "Quem vê meu contato" (#119, ADR 0010): a escolha de cada pessoa e a lista de quem viu.
  contactVisibility: {
    title: "Quem vê meu contato",
    homeLink: "Quem vê meu contato",
    intro:
      "A coordenação da sua equipe e da sua casa sempre pode ver seu contato, para falar com você. Aqui você escolhe se os seus colegas também podem ver. Toque numa opção: a mudança vale na hora.",
    kinds: { whatsapp: "Seu WhatsApp", social: "Suas redes sociais", email: "Seu e-mail de login" },
    scopes: { none: "Só a coordenação", team: "Minha equipe", team_house: "Minha equipe e minha casa" },
    explain: {
      none: "Agora: só a coordenação vê.",
      team: "Agora: a coordenação e quem está na mesma equipe que você veem.",
      team_house: "Agora: a coordenação e quem está na mesma equipe ou na mesma casa que você veem.",
    },
    leaveNote: "Quem sai da sua equipe ou da sua casa deixa de ver na hora. Toda vez que alguém vê o seu contato, fica registrado.",
    saved: "Pronto! Sua escolha foi salva e já vale.",
    failed: "Não foi possível salvar agora. Tente de novo em alguns minutos.",
    viewsTitle: "Quem viu seu contato",
    viewsEmpty: "Ninguém viu seu contato até agora.",
    viewsLine: "{name} viu {kind} em {date}",
    viewsKinds: { whatsapp: "seu WhatsApp", social: "suas redes sociais", email: "seu e-mail" },
    viewsUnknownPerson: "Uma pessoa que saiu da plataforma",
    viewsNote: "Aqui aparecem os 200 acessos mais recentes. A lista completa vem no arquivo de \"Baixar meus dados\".",
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
      region_undefined: "Sua região ainda não foi definida. A coordenação vai incluir você numa região; depois disso, volte aqui.",
      removed_by_coordination: "A coordenação tirou você da sua casa. Para voltar ou trocar de casa, fale com a coordenação.",
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
