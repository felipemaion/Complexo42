export type FakePerson = {
  index: number;
  email: string;
  name: string;
  whatsapp: string;
  municipalityIndex: number;
  skillIndexes: number[];
};
export const fakePeopleCount: number;
export function buildFakePeople(count: number, catalog: { municipalityCount: number; skillCount: number }): FakePerson[];
