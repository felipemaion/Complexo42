import { describe, expect, it } from "vitest";
import { answerSentence, intensitySentence, toDisplaySentence } from "./sentence";

describe("toDisplaySentence (frase exibida: maiúscula no começo, pontuação no fim)", () => {
  it("põe a primeira letra em maiúscula", () => {
    expect(toDisplaySentence("conversar com muita gente.")).toBe("Conversar com muita gente.");
  });

  it("troca o ';' do fim por '.'", () => {
    expect(toDisplaySentence("conversar com muita gente e conhecer novas pessoas;")).toBe(
      "Conversar com muita gente e conhecer novas pessoas.",
    );
  });

  it("troca vírgula e dois-pontos finais por '.'", () => {
    expect(toDisplaySentence("seguir o manual,")).toBe("Seguir o manual.");
    expect(toDisplaySentence("seguir o manual:")).toBe("Seguir o manual.");
  });

  it("acrescenta '.' quando não termina com pontuação", () => {
    expect(toDisplaySentence("ficar em casa com um livro")).toBe("Ficar em casa com um livro.");
  });

  it("mantém '.', '!', '?' e reticências finais, sem duplicar", () => {
    expect(toDisplaySentence("já conhecidos.")).toBe("Já conhecidos.");
    expect(toDisplaySentence("viva!")).toBe("Viva!");
    expect(toDisplaySentence("quem sabe?")).toBe("Quem sabe?");
    expect(toDisplaySentence("depende…")).toBe("Depende…");
    expect(toDisplaySentence("depende...")).toBe("Depende...");
  });

  it("tira espaços das pontas e colapsa o espaço antes da pontuação", () => {
    expect(toDisplaySentence("  sair com amigos ;  ")).toBe("Sair com amigos.");
  });

  it("capitaliza letra acentuada e ignora aspas e parênteses iniciais", () => {
    expect(toDisplaySentence("às vezes sair.")).toBe("Às vezes sair.");
    expect(toDisplaySentence("“ficar” em casa")).toBe("“Ficar” em casa.");
    expect(toDisplaySentence("(talvez) sair")).toBe("(Talvez) sair.");
  });

  it("não mexe no que já está certo e é idempotente", () => {
    const once = toDisplaySentence("conversar com muita gente;");
    expect(toDisplaySentence(once)).toBe(once);
    expect(toDisplaySentence("Já está certo.")).toBe("Já está certo.");
  });

  it("texto vazio continua vazio", () => {
    expect(toDisplaySentence("")).toBe("");
    expect(toDisplaySentence("   ")).toBe("");
  });
});

describe("intensitySentence (intensidade + texto da alternativa)", () => {
  it("compõe 'Intensidade: texto da alternativa.' com o texto no meio da frase em minúscula", () => {
    expect(intensitySentence("Totalmente", "conversar com muita gente e conhecer novas pessoas;")).toBe(
      "Totalmente: conversar com muita gente e conhecer novas pessoas.",
    );
    expect(intensitySentence("Na maior parte das vezes", "ficar em casa com um livro")).toBe(
      "Na maior parte das vezes: ficar em casa com um livro.",
    );
  });

  it("a intensidade também começa com maiúscula, mesmo vinda minúscula da config", () => {
    expect(intensitySentence("um pouco mais", "sair com amigos.")).toBe("Um pouco mais: sair com amigos.");
  });

  it("não troca a caixa do texto da alternativa (nomes próprios e siglas ficam como estão)", () => {
    expect(intensitySentence("Totalmente", "falar com o João;")).toBe("Totalmente: falar com o João.");
  });

  it("alternativa vazia: só a intensidade, com ponto", () => {
    expect(intensitySentence("Totalmente", "")).toBe("Totalmente.");
  });
});

describe("answerSentence (a resposta de um item como frase, para a coordenação)", () => {
  const item = { id: "q1", text: "Numa festa, você prefere:", a: { text: "conversar com muita gente;" }, b: { text: "conversar com poucos" } };
  const intensities = ["Totalmente", "Na maior parte das vezes", "Um pouco mais", "Um pouco mais", "Na maior parte das vezes", "Totalmente"] as const;

  it("respostas negativas usam o texto da alternativa a, e as positivas, o da b", () => {
    expect(answerSentence(item, -5, intensities)).toBe("Totalmente: conversar com muita gente.");
    expect(answerSentence(item, -1, intensities)).toBe("Um pouco mais: conversar com muita gente.");
    expect(answerSentence(item, 1, intensities)).toBe("Um pouco mais: conversar com poucos.");
    expect(answerSentence(item, 3, intensities)).toBe("Na maior parte das vezes: conversar com poucos.");
    expect(answerSentence(item, 5, intensities)).toBe("Totalmente: conversar com poucos.");
  });

  it("valor fora da escala: sem frase (nunca inventa uma intensidade)", () => {
    expect(answerSentence(item, 0, intensities)).toBeNull();
    expect(answerSentence(item, 4, intensities)).toBeNull();
    expect(answerSentence(item, 1.5, intensities)).toBeNull();
    expect(answerSentence(item, 2, intensities)).toBeNull();
  });
});
