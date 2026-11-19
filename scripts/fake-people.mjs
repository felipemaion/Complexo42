// Pessoas 100% fictícias para o seed local (issue #8). Puro e determinístico: sem
// `Math.random` nem `Date.now`, então rodar de novo gera as mesmas pessoas.
// Nomes combinam um prenome comum com um sobrenome inventado que deixa claro ser teste, e os
// telefones seguem a convenção deste projeto para dados de teste: +55119000000xx (não é faixa
// reservada pela Anatel; só é fictício por convenção, então nunca use em dado real).

const givenNames = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio", "Gabriela", "Hugo", "Isabela", "João"];
const fictionalSurnames = ["Exemplo", "Teste", "Modelo", "Demo", "Fictício"];

export const fakePeopleCount = 50;
const skillsPerPersonRange = { min: 2, max: 6 };

/**
 * @param {number} count quantidade de perfis (até 100: o telefone usa dois dígitos)
 * @param {{ municipalityCount: number, skillCount: number }} catalog tamanhos do que existe no banco
 * @returns {{ index: number, email: string, name: string, whatsapp: string, municipalityIndex: number, skillIndexes: number[] }[]}
 */
export function buildFakePeople(count, { municipalityCount, skillCount }) {
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new RangeError("count: entre 1 e 100");
  if (municipalityCount < 1 || skillCount < skillsPerPersonRange.max) throw new RangeError("catálogo pequeno demais");
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    const skillTotal = skillsPerPersonRange.min + (index % (skillsPerPersonRange.max - skillsPerPersonRange.min + 1));
    // Passo 7 e 11 são primos com os tamanhos usuais: espalha sem repetir dentro da pessoa.
    const skillIndexes = Array.from({ length: skillTotal }, (_, k) => (index * 7 + k * 11) % skillCount);
    return {
      index,
      email: `perfil-ficticio-${number}@example.com`,
      name: `${givenNames[index % givenNames.length]} ${fictionalSurnames[Math.floor(index / givenNames.length) % fictionalSurnames.length]} ${number}`,
      whatsapp: `+55119000000${number}`,
      municipalityIndex: (index * 5) % municipalityCount,
      skillIndexes: [...new Set(skillIndexes)],
    };
  });
}
