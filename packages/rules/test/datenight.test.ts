import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_EVERY,
  DECKS,
  DEFAULT_CONFIG,
  PROMPTS,
  SIGNATURE_THEMES,
  allowed,
  createRng,
  defaultSettings,
  drawFrom,
  eligibleCards,
  feeFor,
  generateCards,
  generateOne,
  levelAt,
  newAfterHours,
  reduceAfterHours,
  reduceSession,
  settingsProblems,
  startSession,
  type AfterHoursAction,
  type AfterHoursState,
  type DateSettings,
  type Intensity,
  type Seat,
} from '../src';

function ready(patch: (s: DateSettings) => void = () => undefined): DateSettings {
  const s = defaultSettings();
  s.players[0].adult = true;
  s.players[1].adult = true;
  s.players[0].ceiling = 2;
  s.players[1].ceiling = 2;
  s.end = 2;
  s.approved = [true, true];
  patch(s);
  return s;
}

describe('prompt library', () => {
  it('has at least 120 hand-authored prompts with unique ids, valid ranges and the five decks covered', () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(120);
    expect(new Set(PROMPTS.map((p) => p.id)).size).toBe(PROMPTS.length);
    for (const p of PROMPTS) {
      expect(p.min).toBeLessThanOrEqual(p.max);
      expect(p.text.length).toBeGreaterThan(10);
    }
    for (const d of DECKS) expect(PROMPTS.filter((p) => p.decks.includes(d.id)).length).toBeGreaterThanOrEqual(8);
  });

  it('every prompt involving touch, kissing or clothing offers a non-contact alternative', () => {
    for (const p of PROMPTS) if (p.tags.some((t) => t === 'touch' || t === 'kissing' || t === 'clothing')) expect(p.alt, p.id).toBeTruthy();
  });

  it('never makes drinking or smoking part of a prompt', () => {
    for (const p of PROMPTS) expect(`${p.text} ${p.alt ?? ''}`.toLowerCase()).not.toMatch(/\b(drink|shot|sip|beer|wine|alcohol|smoke|puff|joint|cannabis)\b/);
  });
});

describe('consent and intensity', () => {
  it('needs both players 18+, approval from both, and end ≥ start', () => {
    const s = defaultSettings();
    expect(settingsProblems(s)).toHaveLength(2);
    expect(startSession(s, 'romantic', 1)).toBeNull();
    const ok = ready();
    expect(settingsProblems(ok)).toEqual([]);
    expect(settingsProblems({ ...ok, start: 2, end: 1 })).toContain('The ending intensity can’t be lower than the starting one.');
  });

  it('escalates gradually from start to end, never past either player’s ceiling', () => {
    const s = ready((x) => {
      x.start = 0;
      x.end = 2;
    });
    expect(levelAt(s, 0)).toBe(0);
    expect(levelAt(s, 0.5)).toBe(1);
    expect(levelAt(s, 1)).toBe(2);
    const capped = ready((x) => {
      x.end = 2;
      x.players[1].ceiling = 1;
    });
    for (const p of [0, 0.5, 1]) expect(levelAt(capped, p)).toBeLessThanOrEqual(1);
  });

  it('a topic switched off by either player is never selected; personal exclusions are honoured', () => {
    const s = ready((x) => {
      x.players[1].topics.kissing = false;
      x.players[0].exclusions = ['dance'];
    });
    for (const p of PROMPTS) {
      if (!allowed(p, s, 2)) continue;
      expect(p.tags).not.toContain('kissing');
      expect(`${p.text} ${p.alt ?? ''}`.toLowerCase()).not.toContain('dance');
    }
    // Clothing prompts are off by default.
    expect(PROMPTS.filter((p) => p.tags.includes('clothing')).some((p) => allowed(p, ready((x) => (x.players[0].topics.clothing = false)), 2))).toBe(false);
  });

  it('draws without repeats until the eligible set is exhausted, then reshuffles', () => {
    const pool = PROMPTS.slice(0, 5);
    let history: string[] = [];
    let seed = 7;
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = drawFrom(pool, history, seed);
      seen.push(r.prompt!.id);
      history = r.history;
      seed = r.seed;
    }
    expect(new Set(seen).size).toBe(5);
    const again = drawFrom(pool, history, seed);
    expect(again.prompt).not.toBeNull();
    expect(again.history).toHaveLength(1);
  });
});

describe('Date Night deck session', () => {
  it('runs draw → complete / alternate / replace / skip, alternating turns', () => {
    let s = startSession(ready(), 'romantic', 3)!;
    s = reduceSession(s, { type: 'draw' })!;
    expect(s.current).not.toBeNull();
    expect(reduceSession(s, { type: 'draw' })).toBeNull(); // one card at a time
    const first = s.current!.id;
    s = reduceSession(s, { type: 'replace' })!;
    expect(s.current!.id).not.toBe(first);
    s = reduceSession(s, { type: 'complete' })!;
    expect(s).toMatchObject({ resolved: 1, turn: 1, points: [1, 0] });
    s = reduceSession(reduceSession(s, { type: 'draw' })!, { type: 'skip' })!;
    expect(s.points).toEqual([1, 0]); // skipping costs nothing and earns nothing
  });

  it('a checkpoint challenge arrives every tenth card when scoring is on, and not when it is off', () => {
    let s = startSession(ready(), 'party', 9)!;
    for (let i = 0; i < CHECKPOINT_EVERY; i++) s = reduceSession(reduceSession(s, { type: 'draw' })!, { type: 'complete' })!;
    expect(s.current?.checkpoint).toBe(true);
    s = reduceSession(s, { type: 'checkpoint-done', winners: [1] })!;
    expect(s.points[1]).toBeGreaterThan(5);
    let off = startSession(ready((x) => (x.scoring = false)), 'party', 9)!;
    for (let i = 0; i < CHECKPOINT_EVERY; i++) off = reduceSession(reduceSession(off, { type: 'draw' })!, { type: 'complete' })!;
    expect(off.current).toBeNull();
    expect(off.points).toEqual([0, 0]);
  });

  it('pause blocks play; changing boundaries needs both approvals again and withdraws a card the new limits rule out', () => {
    let s = startSession(ready(), 'spicy', 4)!;
    s = reduceSession(s, { type: 'pause' })!;
    expect(reduceSession(s, { type: 'draw' })).toBeNull();
    s = reduceSession(s, { type: 'resume' })!;
    const tighter = ready((x) => {
      x.approved = [false, false];
      x.players[0].ceiling = 0;
    });
    s = reduceSession(s, { type: 'update-settings', settings: tighter })!;
    expect(s.paused).toBe(true);
    expect(reduceSession({ ...s, paused: false }, { type: 'draw' })).toBeNull(); // not re-approved
    s = reduceSession(s, { type: 'update-settings', settings: { ...tighter, approved: [true, true] } })!;
    s = reduceSession(s, { type: 'resume' })!;
    for (let i = 0; i < 5; i++) {
      s = reduceSession(s, { type: 'draw' })!;
      if (!s.current) break;
      expect(s.current.min).toBe(0);
      s = reduceSession(s, { type: 'complete' })!;
    }
  });

  it('players choose the winner together at the end, whatever the points say', () => {
    let s = startSession(ready(), 'romantic', 1)!;
    s = reduceSession(reduceSession(s, { type: 'draw' })!, { type: 'complete' })!;
    s = reduceSession(s, { type: 'finish' })!;
    expect(reduceSession(s, { type: 'draw' })).toBeNull();
    expect(reduceSession(s, { type: 'declare-winner', winner: 1 })!.winner).toBe(1);
  });

  it('eligible cards respect the current level', () => {
    const s = startSession(ready((x) => (x.start = 0)), 'spicy', 1)!;
    expect(eligibleCards(s).every((p) => p.min === 0)).toBe(true);
  });
});

describe('custom deck generator', () => {
  const req = (count: number, patch: Partial<Parameters<typeof generateCards>[0]> = {}) => ({
    vibe: 'playful' as const,
    min: 0 as Intensity,
    max: 1 as Intensity,
    settings: ready(),
    interests: ['hiking', 'jazz', 'our dog Biscuit'],
    count,
    ...patch,
  });

  it('has plenty to draw on without interests, and honours switched-off topics', () => {
    const settings = ready((x) => {
      x.players[0].topics.kissing = false;
      x.players[1].topics.touch = false;
    });
    const { cards, short } = generateCards(req(20, { vibe: 'flirty', max: 2, interests: [], settings }), 11);
    expect(short).toBe(false);
    expect(cards).toHaveLength(20);
    for (const c of cards) expect(c.tags.some((t) => t === 'kissing' || t === 'touch')).toBe(false);
  });

  it('generates exactly N distinct, eligible drafts', () => {
    for (const n of [1, 5, 10]) {
      const { cards, short } = generateCards(req(n), 42);
      expect(cards).toHaveLength(n);
      expect(short).toBe(false);
      expect(new Set(cards.map((c) => c.text)).size).toBe(n);
      for (const c of cards) {
        expect(c.provenance).toBe('generated');
        expect(c.intensity).toBeLessThanOrEqual(1);
      }
    }
  });

  it('respects boundaries: no kissing drafts when kissing is off', () => {
    const settings = ready((x) => (x.players[0].topics.kissing = false));
    const { cards } = generateCards(req(8, { vibe: 'flirty', min: 1, max: 2, settings }), 9);
    expect(cards.every((c) => !c.tags.includes('kissing'))).toBe(true);
  });

  it('regenerates one draft without repeating the others, and falls back to the library when templates run dry', () => {
    const { cards } = generateCards(req(5), 3);
    const one = generateOne(req(1), 77, cards.map((c) => c.text))!;
    expect(cards.map((c) => c.text)).not.toContain(one.text);
    const many = generateCards(req(18, { vibe: 'deep', interests: [] }), 5);
    expect(many.cards.length).toBeGreaterThan(6); // templates without interests are few; the library tops it up
  });
});

/* ---------- After Hours ---------- */

describe('After Hours board', () => {
  it('is an original 28–32 space board with every signature property', () => {
    const b = DEFAULT_CONFIG.board;
    expect(b.length).toBeGreaterThanOrEqual(28);
    expect(b.length).toBeLessThanOrEqual(32);
    const sigs = b.flatMap((t) => (t.kind === 'property' && t.signature ? [t.signature] : []));
    expect(new Set(sigs)).toEqual(new Set([...Object.keys(SIGNATURE_THEMES), 'penthouse']));
    expect(b.filter((t) => t.kind === 'spark').length).toBeGreaterThan(0);
    expect(b.filter((t) => t.kind === 'surprise').length).toBeGreaterThan(0);
  });
});

/** A random but legal player: tries likely actions in a shuffled order until one applies. */
function randomStep(s: AfterHoursState, rng: ReturnType<typeof createRng>): AfterHoursState {
  const options: AfterHoursAction[] = [
    { type: 'ROLL' },
    { type: 'BUY' },
    { type: 'DECLINE_BUY' },
    { type: 'PAY_FEE' },
    { type: 'CHOOSE_ALTERNATIVE', agreed: true },
    { type: 'COMPLETE_CARD', agreed: true, winners: [0] },
    { type: 'ALTERNATE_CARD' },
    { type: 'REPLACE_CARD' },
    { type: 'SKIP_CARD' },
    { type: 'END_TURN' },
  ];
  for (let i = options.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [options[i], options[j]] = [options[j]!, options[i]!];
  }
  for (const a of options) {
    const n = reduceAfterHours(s, a);
    if (n) return n;
  }
  throw new Error(`no legal action in phase ${s.pending.kind}`);
}

describe('After Hours rules', () => {
  const game = (seed = 1, patch?: (s: DateSettings) => void) => newAfterHours(ready(patch), seed)!;

  it('needs the age gate and approvals before it starts', () => {
    expect(newAfterHours(defaultSettings(), 1)).toBeNull();
  });

  it('turn order and phases are enforced; rolls are deterministic for a seed', () => {
    const a = reduceAfterHours(game(5), { type: 'ROLL' })!;
    const b = reduceAfterHours(game(5), { type: 'ROLL' })!;
    expect(a.dice).toEqual(b.dice);
    expect(reduceAfterHours(a, { type: 'ROLL' })).toBeNull(); // no second roll
    expect(reduceAfterHours(game(5), { type: 'END_TURN' })).toBeNull(); // must roll first
  });

  it('buying, fees for the owner, a doubled fee for a full set, and insufficient funds', () => {
    let s = game(2);
    s = { ...s, pos: [0, 0], pending: { kind: 'buy', tile: 1 } };
    s = reduceAfterHours(s, { type: 'BUY' })!;
    expect(s.owners[1]).toBe(0);
    expect(s.money[0]).toBe(DEFAULT_CONFIG.startingCredits - 60);
    const base = feeFor(s, 1);
    s = { ...s, owners: { 1: 0, 2: 0, 4: 0 } };
    expect(feeFor(s, 1)).toBe(base * 2);
    // Seat 1 owes a fee it can't cover in cash: properties go over, cheapest first, else bankrupt.
    let broke: AfterHoursState = { ...s, turn: 1, money: [0, 5], owners: { 1: 0, 2: 0, 4: 0 }, pending: { kind: 'fee', fee: 50, to: 0, tile: 1 } };
    broke = reduceAfterHours(broke, { type: 'PAY_FEE' })!;
    expect(broke.status).toBe('finished');
    expect(broke.bankrupt).toBe(1);
    const covered = reduceAfterHours({ ...broke, status: 'playing', bankrupt: null, money: [0, 5], owners: { 1: 0, 5: 1 }, pending: { kind: 'fee', fee: 50, to: 0, tile: 1 }, turn: 1 }, { type: 'PAY_FEE' })!;
    expect(covered.owners[5]).toBe(0); // Picnic Lawn handed over
    expect(covered.status).toBe('playing');
  });

  it('each signature property always offers its category, and standard rent always resolves the turn', () => {
    for (const sig of ['balcony', 'dance', 'wardrobe', 'compliment', 'truth', 'dare', 'kisstell'] as const) {
      const tile = DEFAULT_CONFIG.board.findIndex((t) => t.kind === 'property' && t.signature === sig);
      let s = game(11, (x) => (x.players.forEach((p) => (p.topics.clothing = true)), (x.start = 2)));
      // Land seat 0 on seat 1's signature property.
      s = { ...s, owners: { [tile]: 1 }, pos: [(tile - 2 + 30) % 30, 0], seed: 1 };
      let landed: AfterHoursState | null = null;
      for (let seed = 1; seed < 400 && !landed; seed++) {
        const r = reduceAfterHours({ ...s, seed }, { type: 'ROLL' })!;
        if (r.pos[0] === tile) landed = r;
      }
      expect(landed, sig).not.toBeNull();
      expect(landed!.pending.kind).toBe('fee');
      expect(landed!.pending.prompt, sig).toBeTruthy();
      expect(landed!.pending.prompt!.alt, sig).toBeTruthy();
      const cats = SIGNATURE_THEMES[sig].categories;
      expect(cats.includes(landed!.pending.prompt!.category) || landed!.pending.prompt!.id.startsWith('sig-')).toBe(true);
      // Declining in favour of the ordinary fee resolves the turn.
      const paid = reduceAfterHours(landed!, { type: 'PAY_FEE' })!;
      expect(paid.pending.kind === 'end' || paid.pending.kind === 'checkpoint').toBe(true);
      expect(paid.money[1]).toBeGreaterThan(landed!.money[1]);
      // Completing needs both to agree.
      expect(reduceAfterHours(landed!, { type: 'COMPLETE_CARD' })).toBeNull();
      expect(reduceAfterHours(landed!, { type: 'COMPLETE_CARD', agreed: true })!.pending.kind).not.toBe('fee');
    }
  });

  it('Wardrobe Walk never forces clothing: with clothing off it still offers a non-clothing prompt', () => {
    const tile = DEFAULT_CONFIG.board.findIndex((t) => t.kind === 'property' && t.signature === 'wardrobe');
    const s0 = game(3, (x) => (x.players[0].topics.clothing = false));
    for (let seed = 1; seed < 400; seed++) {
      const r = reduceAfterHours({ ...s0, owners: { [tile]: 1 }, pos: [(tile - 6 + 30) % 30, 0], seed }, { type: 'ROLL' })!;
      if (r.pos[0] !== tile) continue;
      expect(r.pending.prompt!.text.toLowerCase()).not.toMatch(/remove one outer layer of clothing\.$/);
      expect(r.pending.prompt!.alt).toBeTruthy();
      return;
    }
    throw new Error('never landed');
  });

  it('cards: replace and skip work, surprise effects apply, and every tenth card brings a checkpoint', () => {
    let s = game(8);
    s = { ...s, pending: { kind: 'card', prompt: { id: 'sur-01', text: 'x', category: 'economy', deck: 'surprise', effect: { credits: 30 } } } };
    const done = reduceAfterHours(s, { type: 'COMPLETE_CARD' })!;
    expect(done.money[0]).toBe(s.money[0] + 30);
    const replaced = reduceAfterHours(s, { type: 'REPLACE_CARD' })!;
    expect(replaced.pending.prompt!.id).not.toBe('sur-01');
    expect(reduceAfterHours(s, { type: 'SKIP_CARD' })!.pending.kind).toBe('end');
    const nine = { ...s, resolvedCards: 9 };
    expect(reduceAfterHours(nine, { type: 'SKIP_CARD' })!.pending.kind).toBe('checkpoint');
    const noScore = { ...nine, settings: ready((x) => (x.scoring = false)) };
    expect(reduceAfterHours(noScore, { type: 'SKIP_CARD' })!.pending.kind).toBe('end');
  });

  it('intensity caps hold for cards drawn in play', () => {
    let s = game(13, (x) => {
      x.players[1].ceiling = 0;
    });
    for (let i = 0; i < 400 && s.status === 'playing'; i++) {
      s = randomStep(s, createRng(i));
      const id = s.pending.prompt?.id;
      const p = id && PROMPTS.find((x) => x.id === id);
      if (p) expect(p.min).toBe(0);
    }
  });

  it('trades need agreement, upgrades need a full set, and players declare the winner together', () => {
    let s = game(4);
    s = { ...s, owners: { 1: 0, 2: 0, 4: 0, 5: 1 }, pending: { kind: 'end' } };
    expect(reduceAfterHours(s, { type: 'TRADE', give: [1], take: [5], credits: 0, agreed: false })).toBeNull();
    const traded = reduceAfterHours(s, { type: 'TRADE', give: [1], take: [5], credits: 10, agreed: true })!;
    expect(traded.owners[1]).toBe(1);
    expect(traded.owners[5]).toBe(0);
    expect(reduceAfterHours(s, { type: 'UPGRADE', tile: 1 })!.upgrades[1]).toBe(1);
    expect(reduceAfterHours({ ...s, owners: { 1: 0 } }, { type: 'UPGRADE', tile: 1 })).toBeNull();
    const ended = reduceAfterHours(s, { type: 'FINISH' })!;
    expect(ended.leader).not.toBeNull();
    expect(reduceAfterHours(ended, { type: 'DECLARE_WINNER', winner: 1 })!.winner).toBe(1);
  });

  it('save and restore: the state is plain JSON that resumes exactly', () => {
    let s = game(21);
    for (let i = 0; i < 30; i++) s = randomStep(s, createRng(100 + i));
    const restored = JSON.parse(JSON.stringify(s)) as AfterHoursState;
    expect(reduceAfterHours(restored, { type: 'ROLL' })).toEqual(reduceAfterHours(s, { type: 'ROLL' }));
  });

  it('1,000 seeded simulated games end with no illegal actions or infinite loops', () => {
    const outcomes = { finished: 0, bankrupt: 0 };
    for (let seed = 1; seed <= 1000; seed++) {
      let s = newAfterHours(ready(), seed)!;
      const rng = createRng(seed);
      for (let steps = 0; s.status === 'playing'; steps++) {
        if (steps > 3000) throw new Error(`loop (seed ${seed})`);
        s = randomStep(s, rng);
        expect(s.money[0]).toBeGreaterThanOrEqual(0);
        expect(s.money[1]).toBeGreaterThanOrEqual(0);
      }
      outcomes.finished++;
      if (s.bankrupt !== null) outcomes.bankrupt++;
    }
    expect(outcomes.finished).toBe(1000);
  }, 120_000);
});

describe('pause and boundaries in After Hours', () => {
  it('pausing blocks play; resuming needs the settings to still be approved', () => {
    let s = newAfterHours(ready(), 1)!;
    s = reduceAfterHours(s, { type: 'PAUSE' })!;
    expect(reduceAfterHours(s, { type: 'ROLL' })).toBeNull();
    s = reduceAfterHours(s, { type: 'UPDATE_SETTINGS', settings: { ...s.settings, approved: [true, false] } })!;
    expect(reduceAfterHours(s, { type: 'RESUME' })).toBeNull();
    s = reduceAfterHours(s, { type: 'UPDATE_SETTINGS', settings: { ...s.settings, approved: [true, true] } })!;
    expect(reduceAfterHours(s, { type: 'RESUME' })!.paused).toBe(false);
  });
});

