import { describe, expect, it } from 'vitest';
import { CARD_BANK, INTEREST_BANK } from '../src/datenight/card-bank';
import { PROMPTS } from '../src/datenight/library';

const all = [...Object.values(CARD_BANK), ...Object.values(INTEREST_BANK)].flat();

describe('card bank', () => {
  it('is big, with no repeats', () => {
    expect(all.length).toBeGreaterThanOrEqual(180);
    expect(new Set(all.map((c) => c.text.toLowerCase())).size).toBe(all.length);
  });
  it('keeps the content rules: alternatives for physical cards, correct tags, no substances', () => {
    for (const c of all) {
      if (c.tags.some((t) => t === 'touch' || t === 'kissing' || t === 'clothing')) expect(c.alt, c.text).toBeTruthy();
      if (/\bkiss/i.test(c.text)) expect(c.tags, c.text).toContain('kissing');
      expect(c.text, c.text).not.toMatch(/\b(drink|drunk|shot|beer|wine|smoke|smoking|vape)\b/i);
    }
  });
  it('reaches the decks', () => {
    expect(PROMPTS.filter((p) => p.id.startsWith('bank-')).length).toBeGreaterThanOrEqual(150);
    expect(PROMPTS.find((p) => p.id === 'bank-deep-1')?.decks).toEqual(['deep']);
  });
});
