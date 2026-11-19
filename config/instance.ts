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
