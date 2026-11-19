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
    intro: "Preencha os campos abaixo e toque em salvar. Seu nome, seu WhatsApp e suas redes ficam guardados de forma protegida.",
    nameLabel: "Seu nome",
    nameHint: "Como você quer ser chamado. De 2 a 80 letras.",
    whatsappLabel: "Seu WhatsApp, com DDD",
    whatsappHint: "Só números de celular. Exemplo: (11) 91234-5678",
    municipalityLabel: "Sua cidade",
    municipalityPlaceholder: "Toque para escolher a cidade",
    districtLabel: "Seu distrito",
    districtHint: "Distrito da cidade de São Paulo. Se não souber, pode deixar em branco.",
    districtNone: "Não sei ou prefiro não dizer",
    socialLinksLabel: "Suas redes sociais (se quiser)",
    socialLinksHint: "Até 5 links, como instagram.com/seunome. Pode deixar em branco.",
    socialLinkLabel: "Link",
    addSocialLink: "Pôr mais um link",
    removeSocialLink: "Tirar o link",
    socialLinksUnreadable:
      "Não conseguimos abrir os seus links agora. Eles continuam guardados: salvar os outros dados não apaga os links.",
    replaceSocialLinks: "Trocar os links guardados",
    socialLinksTitle: "Suas redes sociais",
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
      socialLinks:
        "Confira os links: cada um precisa ser um endereço que começa com https://, como https://instagram.com/seunome, sem repetir.",
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
      unavailable: "Esta casa não está disponível no momento. Fale com a coordenação.",
      already_accepted: "Você já aceitou uma casa. Para trocar, fale com a coordenação.",
      not_active: "Complete o seu cadastro antes de escolher a casa.",
      stale_consent: "O termo foi atualizado. Recarregue a página para ler a versão nova.",
      removed_by_coordination: "A coordenação tirou você da sua casa. Para voltar ou trocar de casa, fale com a coordenação.",
      failed: "Não foi possível salvar agora. Tente de novo.",
    },
  },
  // Telas da coordenação (#26, ADR 0008 §1): lista de autorizados e fila de espera.
  coordination: {
    homeLink: "Coordenação",
    title: "Coordenação",
    intro: "Escolha o que você quer fazer.",
    backLink: "Voltar para a coordenação",
    homeBackLink: "Voltar para o início",
    allowlist: {
      menuLink: "Enviar lista de pessoas autorizadas",
      title: "Lista de pessoas autorizadas",
      intro:
        "Envie o arquivo com os e-mails de quem pode entrar. Pode ser uma planilha salva como CSV ou um arquivo de texto com um e-mail por linha. Quem estava esperando com um desses e-mails é liberado na hora.",
      privacyNote:
        "Os e-mails não ficam guardados: o sistema guarda só um código que não dá para transformar de volta em e-mail. Enviar a mesma pessoa duas vezes não tem problema.",
      fileLabel: "Arquivo com os e-mails (.csv ou .txt)",
      fileHint: "Até 1,5 MB e até 35.000 e-mails por arquivo. Lista maior? Divida em partes.",
      sourceLabel: "De onde veio esta lista?",
      sources: {
        academy: "Lista de quem concluiu a formação",
        form: "Lista do formulário de inscrição",
        manual: "Outra lista",
      },
      submitButton: "Enviar lista",
      sending: "Enviando...",
      doneTitle: "Pronto! A lista foi recebida.",
      received: "E-mails recebidos: {count}",
      promoted: "Pessoas que estavam esperando e foram liberadas agora: {count}",
      invalidLines: "Estas linhas do arquivo não têm um e-mail válido e ficaram de fora: {lines}",
      invalidLinesMore: "e mais {count} linhas",
      invalidLinesTotal: "Linhas sem e-mail válido: {count}",
      errors: {
        no_file: "Escolha um arquivo antes de enviar.",
        wrong_type: "O arquivo precisa terminar em .csv ou .txt.",
        too_large: "O arquivo é grande demais. O máximo é 1,5 MB: divida em partes e envie uma de cada vez.",
        too_many: "O arquivo tem mais de 35.000 e-mails. Divida em partes e envie uma de cada vez.",
        empty: "Não encontramos nenhum e-mail no arquivo. Confira se é o arquivo certo.",
        invalid_source: "Escolha de onde veio a lista.",
        forbidden: "Só a coordenação geral pode enviar a lista de pessoas autorizadas.",
        failed: "Não foi possível enviar agora. Nada foi alterado: tente de novo em alguns minutos.",
      },
    },
    waitlist: {
      menuLink: "Pessoas esperando liberação",
      title: "Pessoas esperando liberação",
      intro:
        "Estas pessoas se cadastraram, mas o e-mail delas não estava na lista de autorizados. Libere quem deve participar. Bloqueie quem não deveria entrar.",
      empty: "Ninguém está esperando liberação agora.",
      since: "Cadastro em {date}",
      place: "{city} ({state})",
      approveButton: "Liberar",
      blockButton: "Bloquear",
      confirmApprove: "Liberar o acesso de {name}? A pessoa vai poder entrar e usar a plataforma.",
      confirmBlock: "Bloquear {name}? A pessoa não vai conseguir entrar. Para desfazer, use “Bloquear ou desbloquear acesso”.",
      confirmApproveButton: "Sim, liberar",
      confirmBlockButton: "Sim, bloquear",
      cancelButton: "Não, voltar",
      unknownName: "Nome que não pôde ser lido",
      unknownNameNote: "Não é possível liberar sem identificar a pessoa: o nome não pôde ser lido. Bloquear continua possível.",
      nextPage: "Ver mais pessoas",
      firstPage: "Voltar ao começo da lista",
      done: {
        liberado: "Pronto! O acesso foi liberado.",
        bloqueado: "Pronto! O acesso foi bloqueado.",
        indisponivel: "Não foi possível decidir: outra pessoa da coordenação já decidiu, ou esta pessoa não está mais na sua área.",
        erro: "Não foi possível salvar agora. Tente de novo em alguns minutos.",
      },
    },
    // Bloquear quem já entrou (#26). A resposta é neutra: não diz se o e-mail é de alguém.
    memberBlock: {
      menuLink: "Bloquear ou desbloquear acesso",
      title: "Bloquear ou desbloquear acesso",
      intro:
        "Use quando alguém da sua área não deve mais entrar, por exemplo quem se cadastrou com o e-mail de outra pessoa. Digite o e-mail de login da pessoa. Por segurança, a resposta é a mesma exista ou não uma conta com esse e-mail.",
      emailLabel: "E-mail de login da pessoa",
      actionLabel: "O que fazer?",
      actions: { block: "Bloquear o acesso", unblock: "Desbloquear (volta para a lista de espera)" },
      reasonLabel: "Motivo do bloqueio (opcional)",
      reasonNone: "Não informar",
      reasons: {
        impersonation: "Cadastro com o e-mail de outra pessoa",
        conduct: "Descumpriu as regras de participação",
        other: "Outro motivo",
      },
      continueButton: "Continuar",
      confirm: {
        block: "Bloquear o acesso de {email}? Se for de alguém ativo na sua área, a pessoa sai na hora e não consegue mais entrar.",
        unblock: "Desbloquear {email}? Se for de alguém bloqueado na sua área, a pessoa volta para a lista de espera.",
      },
      confirmReason: "Motivo: {reason}",
      confirmButton: { block: "Sim, bloquear", unblock: "Sim, desbloquear" },
      cancelButton: "Não, voltar",
      done: {
        block: "Pedido concluído. Se o e-mail é de alguém ativo na sua área, o acesso foi bloqueado agora.",
        unblock:
          "Pedido concluído. Se o e-mail é de alguém bloqueado na sua área, a pessoa voltou para a lista de espera. Para liberar, use “Pessoas esperando liberação”.",
      },
      errors: {
        invalid_email: "Digite um e-mail válido.",
        invalid_action: "Escolha se quer bloquear ou desbloquear.",
        invalid_reason: "Escolha um motivo da lista.",
        forbidden: "Só a coordenação pode bloquear ou desbloquear acessos.",
        failed: "Não foi possível concluir agora. Nada foi alterado: tente de novo em alguns minutos.",
      },
    },
  },
  // Casas de formação (ADR 0008 §2), nacionais (ADR 0011). O `id` é a chave da casa no banco
  // (`houses.key`); nome e textos ficam só aqui. O seed tem uma linha para cada casa
  // (tests/house-units.test.ts).
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
