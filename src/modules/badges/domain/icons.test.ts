import { describe, expect, it } from "vitest";
import { BADGE_ICONS } from "../types";
import { badgeEmoji } from "./icons";

describe("badgeEmoji", () => {
  it("mapeia todos os 8 ícones para emojis definidos", () => {
    expect(BADGE_ICONS).toHaveLength(8);

    for (const icon of BADGE_ICONS) {
      const emoji = badgeEmoji(icon);
      expect(emoji).toBeDefined();
      expect(typeof emoji).toBe("string");
      expect(emoji.length).toBeGreaterThan(0);
    }
  });

  it("não possui emojis repetidos entre os ícones", () => {
    const emojis = BADGE_ICONS.map((icon) => badgeEmoji(icon));
    const uniqueEmojis = new Set(emojis);

    expect(uniqueEmojis.size).toBe(BADGE_ICONS.length);
  });
});
