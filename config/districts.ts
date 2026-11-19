/*
 * Distritos por município (issue #12; `profiles.district` em docs/MODELO_DADOS.md). O formulário
 * do perfil só mostra a escolha de distrito para os municípios desta lista, e o servidor só
 * aceita um nome daqui. Município fora da lista grava `district` nulo.
 *
 * Hoje: os 96 distritos da capital paulista (código IBGE 3550308), copiados como estão (inclusive
 * a grafia sem acento de "Cangaiba" e "Cidade Lider") da API pública de localidades do IBGE,
 * consultada em 2026-11-19:
 *   https://servicodados.ibge.gov.br/api/v1/localidades/municipios/3550308/distritos
 * Outro município entra aqui com a mesma conferência, citando a fonte.
 */
export const districtsByMunicipality: Readonly<Record<number, readonly string[]>> = {
  3550308: [
    "Alto de Pinheiros", "Anhanguera", "Aricanduva", "Artur Alvim", "Barra Funda", "Bela Vista",
    "Belém", "Bom Retiro", "Brasilândia", "Brás", "Butantã", "Cachoeirinha", "Cambuci", "Campo Belo",
    "Campo Grande", "Campo Limpo", "Cangaiba", "Capão Redondo", "Carrão", "Casa Verde",
    "Cidade Ademar", "Cidade Dutra", "Cidade Lider", "Cidade Tiradentes", "Consolação", "Cursino",
    "Ermelino Matarazzo", "Freguesia do Ó", "Grajaú", "Guaianases", "Iguatemi", "Ipiranga",
    "Itaim Bibi", "Itaim Paulista", "Itaquera", "Jabaquara", "Jaguara", "Jaguaré", "Jaraguá",
    "Jardim Helena", "Jardim Paulista", "Jardim São Luís", "Jardim Ângela", "Jaçanã",
    "José Bonifácio", "Lajeado", "Lapa", "Liberdade", "Limão", "Mandaqui", "Marsilac", "Moema",
    "Mooca", "Morumbi", "Parelheiros", "Pari", "Parque do Carmo", "Pedreira", "Penha", "Perdizes",
    "Perus", "Pinheiros", "Pirituba", "Ponte Rasa", "Raposo Tavares", "República", "Rio Pequeno",
    "Sacomã", "Santa Cecília", "Santana", "Santo Amaro", "Sapopemba", "Saúde", "Socorro",
    "São Domingos", "São Lucas", "São Mateus", "São Miguel", "São Rafael", "Sé", "Tatuapé",
    "Tremembé", "Tucuruvi", "Vila Andrade", "Vila Curuçá", "Vila Formosa", "Vila Guilherme",
    "Vila Jacuí", "Vila Leopoldina", "Vila Maria", "Vila Mariana", "Vila Matilde", "Vila Medeiros",
    "Vila Prudente", "Vila Sônia", "Água Rasa",
  ],
};
