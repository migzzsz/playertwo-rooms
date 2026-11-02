import { createRng } from '../rng';
import type { Seat } from '../types';
import { isInt, isObj } from '../util';
import { allowed, drawFrom, levelAt, settingsProblems, type DateSettings } from './consent';
import { PROMPTS, type GameEffect, type Intensity, type Prompt } from './library';

/**
 * After Hours (spec Part III): an original roll–move–buy–trade board game for couples. Pure,
 * seeded and serialisable. Every intimate prompt is optional: the standard in-game fee or an
 * agreed substitute always resolves the turn.
 */

/* ---------- Configuration (tunable without touching the engine) ---------- */

/** Signature properties: landing always offers this category, never forces it (§15.1). */
export type Signature = 'balcony' | 'dance' | 'wardrobe' | 'compliment' | 'truth' | 'dare' | 'kisstell' | 'penthouse';

export type Tile =
  | { kind: 'start'; name: string }
  | { kind: 'property'; id: string; name: string; group: string; price: number; signature?: Signature }
  | { kind: 'spark'; name: string }
  | { kind: 'surprise'; name: string }
  | { kind: 'checkpoint'; name: string }
  | { kind: 'rest'; name: string }
  | { kind: 'bonus'; name: string; credits: number };

export interface AfterHoursConfig {
  title: string;
  board: Tile[];
  startingCredits: number;
  passStart: number;
  /** Base fee as a share of price; doubled for a full set; +upgradeRent per upgrade. */
  rentRate: number;
  upgradeRate: number;
  maxUpgrades: number;
  /** Turns each (the timed finish). */
  rounds: number;
  /** Fee multiplier when both agree to an affectionate substitute (§5). */
  affectionFactor: number;
}

const P = (id: string, name: string, group: string, price: number, signature?: Signature): Tile => ({ kind: 'property', id, name, group, price, signature });

export const DEFAULT_CONFIG: AfterHoursConfig = {
  title: 'After Hours',
  board: [
    { kind: 'start', name: 'First Date' },
    P('corner-cafe', 'Corner Café', 'cafe', 60),
    P('kiss-tell', 'Kiss & Tell Café', 'cafe', 70, 'kisstell'),
    { kind: 'spark', name: 'Spark' },
    P('midnight-bakery', 'Midnight Bakery', 'cafe', 80),
    P('picnic-lawn', 'Picnic Lawn', 'park', 90),
    { kind: 'surprise', name: 'Surprise' },
    P('compliment-corner', 'Compliment Corner', 'park', 100, 'compliment'),
    P('sunset-boardwalk', 'Sunset Boardwalk', 'park', 110),
    { kind: 'rest', name: 'Cosy Corner' },
    P('gallery-steps', 'Gallery Steps', 'arts', 120),
    P('bookshop-nook', 'Bookshop Nook', 'arts', 120),
    P('truth-terrace', 'Truth Terrace', 'arts', 130, 'truth'),
    { kind: 'spark', name: 'Spark' },
    P('karaoke-booth', 'Karaoke Booth', 'night', 140),
    P('dare-den', 'Dare Den', 'night', 150, 'dare'),
    { kind: 'checkpoint', name: 'Date Checkpoint' },
    P('jazz-cellar', 'Jazz Cellar', 'dance', 160),
    P('dance-floor', 'Dance Floor', 'dance', 170, 'dance'),
    { kind: 'surprise', name: 'Surprise' },
    P('vintage-arcade', 'Vintage Arcade', 'style', 180),
    P('wardrobe-walk', 'Wardrobe Walk', 'style', 180, 'wardrobe'),
    { kind: 'bonus', name: 'Payday', credits: 50 },
    P('rooftop-garden', 'Rooftop Garden', 'sky', 200),
    P('moonlight-balcony', 'Moonlight Balcony', 'sky', 210, 'balcony'),
    { kind: 'spark', name: 'Spark' },
    P('starlight-pier', 'Starlight Pier', 'lux', 230),
    { kind: 'surprise', name: 'Surprise' },
    P('velvet-lounge', 'Velvet Lounge', 'lux', 240),
    P('wildcard-penthouse', 'Wildcard Penthouse', 'lux', 260, 'penthouse'),
  ],
  startingCredits: 600,
  passStart: 60,
  rentRate: 0.2,
  upgradeRate: 0.5,
  maxUpgrades: 2,
  rounds: 20,
  affectionFactor: 0.5,
};

/** Which prompt category each signature guarantees, with its always-available substitute. */
export const SIGNATURE_THEMES: Record<Exclude<Signature, 'penthouse'>, { categories: string[]; text: string; alt: string }> = {
  balcony: { categories: ['flirty'], text: 'Offer your partner a kiss to halve the fee, if you both want to.', alt: 'Pay the standard fee instead.' },
  dance: { categories: ['flirty', 'dare'], text: 'Give a short, silly lap dance, if both want; or a ridiculous non-contact dance.', alt: 'Do a non-contact seated dance.' },
  wardrobe: { categories: ['clothing'], text: 'Optionally remove one outer clothing item. Never mandatory.', alt: 'Do an equal non-clothing challenge: a twenty-second runway walk.' },
  compliment: { categories: ['compliment'], text: 'Give your partner three different, specific compliments.', alt: 'Give one compliment and pay half the fee.' },
  truth: { categories: ['truth'], text: 'Answer a truth question from your agreed range.', alt: 'Answer a lighter question instead.' },
  dare: { categories: ['dare'], text: 'Take a dare from your agreed boundaries.', alt: 'Choose a lighter dare instead.' },
  kisstell: { categories: ['flirty', 'romantic'], text: 'Share a kiss or a funny story; the owner gets a bonus if you both choose one.', alt: 'Tell a funny story instead.' },
};

/* ---------- State ---------- */

export interface Pending {
  kind: 'roll' | 'buy' | 'fee' | 'card' | 'checkpoint' | 'end';
  /** For fee: the amount owed and to whom. */
  fee?: number;
  to?: Seat;
  tile?: number;
  /** For card / signature / checkpoint: the prompt being offered. */
  prompt?: { id: string; text: string; alt?: string; category: string; deck: 'spark' | 'surprise' | 'signature' | 'checkpoint'; effect?: GameEffect };
}

export interface AfterHoursState {
  config: AfterHoursConfig;
  settings: DateSettings;
  seed: number;
  turn: Seat;
  turnCount: number;
  pos: [number, number];
  money: [number, number];
  points: [number, number];
  /** Tile index → owner. */
  owners: Record<number, Seat>;
  upgrades: Record<number, number>;
  history: string[];
  checkpointHistory: string[];
  resolvedCards: number;
  dice: [number, number] | null;
  pending: Pending;
  paused: boolean;
  status: 'playing' | 'finished';
  /** Automatic suggestion (net worth, plus points when scoring); players may override. */
  leader: Seat | -1 | null;
  /** Declared together at the end. */
  winner: Seat | -1 | null;
  bankrupt: Seat | null;
  log: string[];
}

export type AfterHoursAction =
  | { type: 'ROLL' }
  | { type: 'BUY' }
  | { type: 'DECLINE_BUY' }
  | { type: 'PAY_FEE' }
  | { type: 'CHOOSE_ALTERNATIVE'; agreed: boolean }
  | { type: 'COMPLETE_CARD'; agreed?: boolean; winners?: Seat[] }
  | { type: 'ALTERNATE_CARD' }
  | { type: 'REPLACE_CARD' }
  | { type: 'SKIP_CARD' }
  | { type: 'UPGRADE'; tile: number }
  | { type: 'TRADE'; give: number[]; take: number[]; credits: number; agreed: boolean }
  | { type: 'END_TURN' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'UPDATE_SETTINGS'; settings: DateSettings }
  | { type: 'FINISH' }
  | { type: 'DECLARE_WINNER'; winner: Seat | -1 };

/* ---------- Helpers ---------- */

const other = (s: Seat) => (1 - s) as Seat;
export const CHECKPOINT_EVERY_CARDS = 10;

export function tileAt(s: AfterHoursState, i: number): Tile {
  return s.config.board[i]!;
}

export function groupComplete(s: AfterHoursState, tile: number): boolean {
  const t = tileAt(s, tile);
  if (t.kind !== 'property') return false;
  const owner = s.owners[tile];
  if (owner === undefined) return false;
  return s.config.board.every((x, i) => x.kind !== 'property' || x.group !== t.group || s.owners[i] === owner);
}

export function feeFor(s: AfterHoursState, tile: number): number {
  const t = tileAt(s, tile);
  if (t.kind !== 'property') return 0;
  const base = Math.round(t.price * s.config.rentRate);
  const ups = s.upgrades[tile] ?? 0;
  return (groupComplete(s, tile) ? base * 2 : base) + ups * base;
}

export function netWorth(s: AfterHoursState, seat: Seat): number {
  let worth = s.money[seat];
  for (const [i, owner] of Object.entries(s.owners)) {
    if (owner !== seat) continue;
    const t = tileAt(s, Number(i));
    if (t.kind === 'property') worth += t.price + (s.upgrades[Number(i)] ?? 0) * Math.round(t.price * s.config.upgradeRate);
  }
  return worth;
}

function leaderOf(s: AfterHoursState): Seat | -1 {
  const score = (seat: Seat) => netWorth(s, seat) + (s.settings.scoring ? s.points[seat] * 10 : 0);
  const [a, b] = [score(0), score(1)];
  return a > b ? 0 : b > a ? 1 : -1;
}

function level(s: AfterHoursState): Intensity {
  return levelAt(s.settings, s.turnCount / (s.config.rounds * 2));
}

function finish(s: AfterHoursState): AfterHoursState {
  return { ...s, status: 'finished', pending: { kind: 'end' }, paused: false, leader: leaderOf(s) };
}

function drawPrompt(s: AfterHoursState, filter: (p: Prompt) => boolean, deck: 'spark' | 'surprise' | 'signature', avoid?: string): AfterHoursState | null {
  const lvl = level(s);
  const candidates = PROMPTS.filter((p) => filter(p) && p.id !== avoid && allowed(p, s.settings, lvl));
  const r = drawFrom(candidates, s.history, s.seed);
  if (!r.prompt) return null;
  const p = r.prompt;
  return { ...s, history: r.history, seed: r.seed, pending: { ...s.pending, kind: 'card', prompt: { id: p.id, text: p.text, alt: p.alt, category: p.category, deck, effect: p.effect } } };
}

function sparkOrSurprise(s: AfterHoursState, which: 'spark' | 'surprise', avoid?: string): AfterHoursState {
  const drawn = drawPrompt(s, (p) => p.pool === which, which, avoid) ?? drawPrompt(s, (p) => p.pool === 'forfeit' && !p.effect, which, avoid);
  return drawn ?? { ...s, pending: { kind: 'end' } };
}

/** Pay a fee; if short, hand over properties (cheapest first). Unable to cover it: bankrupt, game over. */
function pay(s: AfterHoursState, from: Seat, to: Seat | null, amount: number): AfterHoursState {
  const money: [number, number] = [s.money[0], s.money[1]];
  const owners = { ...s.owners };
  const upgrades = { ...s.upgrades };
  let owed = amount;
  const log = [...s.log];
  const take = Math.min(money[from], owed);
  money[from] -= take;
  owed -= take;
  if (to !== null) money[to] += take;
  if (owed > 0) {
    const mine = Object.keys(owners)
      .map(Number)
      .filter((i) => owners[i] === from)
      .sort((a, b) => (tileAt(s, a) as { price: number }).price - (tileAt(s, b) as { price: number }).price);
    for (const i of mine) {
      if (owed <= 0) break;
      const value = (tileAt(s, i) as { price: number }).price;
      if (to !== null) owners[i] = to;
      else delete owners[i];
      delete upgrades[i];
      owed -= value;
      log.push(`Handed over ${(tileAt(s, i) as { name: string }).name} to cover the fee.`);
    }
  }
  const next = { ...s, money, owners, upgrades, log };
  if (owed > 0) return { ...finish(next), bankrupt: from, leader: to ?? other(from) };
  return next;
}

function landOn(s: AfterHoursState, tile: number, fromCard = false): AfterHoursState {
  const t = tileAt(s, tile);
  const me = s.turn;
  switch (t.kind) {
    case 'start':
    case 'rest':
      return { ...s, pending: { kind: 'end' } };
    case 'bonus':
      return { ...s, money: s.money.map((m, i) => (i === me ? m + t.credits : m)) as [number, number], pending: { kind: 'end' }, log: [...s.log, `${t.name}: +${t.credits} credits.`] };
    case 'spark':
    case 'surprise':
      // No chained draw when a card itself moved you here.
      return fromCard ? { ...s, pending: { kind: 'end' } } : sparkOrSurprise({ ...s, pending: { kind: 'card', tile } }, t.kind);
    case 'checkpoint':
      return s.settings.scoring ? checkpoint(s) : { ...s, pending: { kind: 'end' } };
    case 'property': {
      const owner = s.owners[tile];
      if (owner === undefined) return { ...s, pending: { kind: 'buy', tile } };
      if (owner === me) return { ...s, pending: { kind: 'end' } };
      const fee = feeFor(s, tile);
      if (t.signature === 'penthouse') {
        // Guaranteed card draw; the owner's fee is still due first.
        const paid = pay(s, me, owner, fee);
        if (paid.status === 'finished') return paid;
        return sparkOrSurprise({ ...paid, pending: { kind: 'card', tile }, log: [...paid.log, `Paid ${fee} credits for the Penthouse.`] }, s.seed % 2 ? 'spark' : 'surprise');
      }
      if (t.signature) {
        const theme = SIGNATURE_THEMES[t.signature];
        const drawn = drawPrompt({ ...s, pending: { kind: 'fee', fee, to: owner, tile } }, (p) => p.pool === 'spark' && theme.categories.includes(p.category), 'signature');
        // If the boundaries rule out every prompt of this category, the theme's own safe text stands in.
        const prompt = drawn?.pending.prompt ?? { id: `sig-${t.signature}`, text: theme.text, alt: theme.alt, category: theme.categories[0]!, deck: 'signature' as const };
        return { ...(drawn ?? s), pending: { kind: 'fee', fee, to: owner, tile, prompt: { ...prompt, alt: prompt.alt ?? theme.alt } } };
      }
      return { ...s, pending: { kind: 'fee', fee, to: owner, tile } };
    }
  }
}

function checkpoint(s: AfterHoursState): AfterHoursState {
  const lvl = level(s);
  const pool = PROMPTS.filter((p) => p.pool === 'checkpoint' && allowed(p, s.settings, lvl));
  const r = drawFrom(pool, s.checkpointHistory, s.seed);
  if (!r.prompt) return { ...s, pending: { kind: 'end' } };
  return { ...s, checkpointHistory: r.history, seed: r.seed, pending: { kind: 'checkpoint', prompt: { id: r.prompt.id, text: r.prompt.text, category: 'checkpoint', deck: 'checkpoint', effect: r.prompt.effect } } };
}

/** A card was resolved: count it, and every tenth card brings a checkpoint challenge when scoring. */
function afterCard(s: AfterHoursState): AfterHoursState {
  const resolvedCards = s.resolvedCards + 1;
  const next = { ...s, resolvedCards };
  if (s.settings.scoring && resolvedCards % CHECKPOINT_EVERY_CARDS === 0) return checkpoint(next);
  return { ...next, pending: next.pending.kind === 'card' || next.pending.kind === 'fee' ? { kind: 'end' } : next.pending };
}

function applyEffect(s: AfterHoursState, effect: GameEffect | undefined): AfterHoursState {
  if (!effect) return { ...s, pending: { kind: 'end' } };
  const me = s.turn;
  let next: AfterHoursState = { ...s, pending: { kind: 'end' } };
  if (effect.points && s.settings.scoring) next.points = next.points.map((p, i) => (i === me ? p + effect.points! : p)) as [number, number];
  if (effect.credits) {
    if (effect.credits > 0) next.money = next.money.map((m, i) => (i === me ? m + effect.credits! : m)) as [number, number];
    else next = pay(next, me, null, -effect.credits);
  }
  if (effect.move && next.status === 'playing') {
    const len = s.config.board.length;
    const to = (((next.pos[me] + effect.move) % len) + len) % len;
    const passed = effect.move > 0 && to < next.pos[me];
    next.pos = next.pos.map((p, i) => (i === me ? to : p)) as [number, number];
    if (passed) next.money = next.money.map((m, i) => (i === me ? m + s.config.passStart : m)) as [number, number];
    next = landOn(next, to, true);
  }
  return next;
}

/* ---------- Engine ---------- */

export function newAfterHours(settings: DateSettings, seed: number, config: AfterHoursConfig = DEFAULT_CONFIG): AfterHoursState | null {
  if (settingsProblems(settings).length) return null;
  return {
    config,
    settings,
    seed,
    turn: 0,
    turnCount: 0,
    pos: [0, 0],
    money: [config.startingCredits, config.startingCredits],
    points: [0, 0],
    owners: {},
    upgrades: {},
    history: [],
    checkpointHistory: [],
    resolvedCards: 0,
    dice: null,
    pending: { kind: 'roll' },
    paused: false,
    status: 'playing',
    leader: null,
    winner: null,
    bankrupt: null,
    log: [],
  };
}

/** Pure reducer. Every transition checks the phase; returns null when an action isn't valid now. */
export function reduceAfterHours(s: AfterHoursState, a: AfterHoursAction): AfterHoursState | null {
  if (!isObj(a)) return null;
  if (s.status === 'finished') {
    if (a.type === 'DECLARE_WINNER' && (a.winner === 0 || a.winner === 1 || a.winner === -1)) return { ...s, winner: a.winner };
    return null;
  }
  if (a.type === 'PAUSE') return s.paused ? null : { ...s, paused: true };
  if (a.type === 'RESUME') return s.paused && !settingsProblems(s.settings).length ? { ...s, paused: false } : null;
  if (a.type === 'UPDATE_SETTINGS') return { ...s, settings: a.settings, paused: settingsProblems(a.settings).length > 0 || s.paused };
  if (a.type === 'FINISH') return finish(s);
  if (s.paused) return null;
  const me = s.turn;
  const pd = s.pending;
  switch (a.type) {
    case 'ROLL': {
      if (pd.kind !== 'roll') return null;
      const rng = createRng(s.seed);
      const dice: [number, number] = [1 + rng.int(6), 1 + rng.int(6)];
      const len = s.config.board.length;
      const to = (s.pos[me] + dice[0] + dice[1]) % len;
      const passed = to < s.pos[me];
      const next: AfterHoursState = {
        ...s,
        seed: rng.state,
        dice,
        pos: s.pos.map((p, i) => (i === me ? to : p)) as [number, number],
        money: passed ? (s.money.map((m, i) => (i === me ? m + s.config.passStart : m)) as [number, number]) : s.money,
      };
      return landOn(next, to);
    }
    case 'BUY': {
      if (pd.kind !== 'buy' || pd.tile === undefined) return null;
      const t = tileAt(s, pd.tile);
      if (t.kind !== 'property' || s.money[me] < t.price) return null;
      return { ...s, money: s.money.map((m, i) => (i === me ? m - t.price : m)) as [number, number], owners: { ...s.owners, [pd.tile]: me }, pending: { kind: 'end' }, log: [...s.log, `Bought ${t.name}.`] };
    }
    case 'DECLINE_BUY':
      return pd.kind === 'buy' ? { ...s, pending: { kind: 'end' } } : null;
    case 'PAY_FEE': {
      if (pd.kind !== 'fee' || pd.fee === undefined || pd.to === undefined) return null;
      const paid = pay(s, me, pd.to, pd.fee);
      if (paid.status === 'finished') return paid;
      const next = { ...paid, pending: { kind: 'end' as const }, log: [...paid.log, `Paid ${pd.fee} credits.`] };
      // Declining a signature prompt (paying instead) still counts that card as resolved.
      return pd.prompt ? afterCard({ ...next, pending: { ...pd, kind: 'fee' } }) : next;
    }
    case 'CHOOSE_ALTERNATIVE': {
      // An affectionate substitute on any property: only if both agree right now.
      if (pd.kind !== 'fee' || pd.fee === undefined || pd.to === undefined || a.agreed !== true) return null;
      const reduced = Math.round(pd.fee * s.config.affectionFactor);
      const paid = pay(s, me, pd.to, reduced);
      return paid.status === 'finished' ? paid : { ...paid, pending: { kind: 'end' }, log: [...paid.log, `Agreed substitute: paid ${reduced} instead of ${pd.fee}.`] };
    }
    case 'COMPLETE_CARD':
    case 'ALTERNATE_CARD': {
      if (pd.kind === 'checkpoint' && a.type === 'COMPLETE_CARD') {
        const winners = Array.isArray(a.winners) ? a.winners.filter((w): w is Seat => w === 0 || w === 1) : [];
        const pts = pd.prompt?.effect?.points ?? 0;
        const points = s.points.map((p, i) => (winners.includes(i as Seat) ? p + pts : p)) as [number, number];
        return { ...s, points, pending: { kind: 'end' } };
      }
      if (pd.kind === 'fee' && pd.prompt && pd.tile !== undefined && pd.to !== undefined) {
        // Signature prompt done (or its substitute): both must agree; the fee is waived or reduced.
        if (a.type === 'COMPLETE_CARD' && a.agreed !== true) return null;
        const sig = (tileAt(s, pd.tile) as { signature?: Signature }).signature;
        let next: AfterHoursState = s;
        if (sig === 'balcony' || (sig === 'compliment' && a.type === 'ALTERNATE_CARD')) next = pay(s, me, pd.to, Math.round(pd.fee! * 0.5));
        if (sig === 'kisstell' && a.type === 'COMPLETE_CARD') next = { ...next, points: next.points.map((p, i) => (i === pd.to && s.settings.scoring ? p + 1 : p)) as [number, number] };
        if (next.status === 'finished') return next;
        return afterCard({ ...next, pending: { ...pd, kind: 'fee' }, log: [...next.log, `${(tileAt(s, pd.tile) as { name: string }).name}: ${a.type === 'COMPLETE_CARD' ? 'prompt done' : 'alternative done'}.`] });
      }
      if (pd.kind !== 'card' || !pd.prompt) return null;
      if (a.type === 'ALTERNATE_CARD' && !pd.prompt.alt) return null;
      const scored = s.settings.scoring && pd.prompt.deck === 'spark' ? (s.points.map((p, i) => (i === me ? p + 1 : p)) as [number, number]) : s.points;
      const effected = pd.prompt.deck === 'surprise' ? applyEffect({ ...s, points: scored }, pd.prompt.effect) : { ...s, points: scored, pending: { kind: 'end' as const } };
      if (effected.status === 'finished') return effected;
      return afterCard({ ...effected, pending: effected.pending.kind === 'end' ? { ...pd, kind: 'card' } : effected.pending });
    }
    case 'REPLACE_CARD': {
      if (pd.kind !== 'card' || !pd.prompt || pd.prompt.deck === 'signature') return null;
      return sparkOrSurprise(s, pd.prompt.deck === 'surprise' ? 'surprise' : 'spark', pd.prompt.id);
    }
    case 'SKIP_CARD': {
      if (pd.kind === 'checkpoint') return { ...s, pending: { kind: 'end' } };
      if (pd.kind !== 'card' || !pd.prompt) return null;
      return afterCard({ ...s, pending: { ...pd } });
    }
    case 'UPGRADE': {
      if (pd.kind !== 'roll' && pd.kind !== 'end') return null;
      if (!isInt(a.tile, 0, s.config.board.length - 1) || s.owners[a.tile] !== me || !groupComplete(s, a.tile)) return null;
      const t = tileAt(s, a.tile);
      if (t.kind !== 'property') return null;
      const ups = s.upgrades[a.tile] ?? 0;
      const cost = Math.round(t.price * s.config.upgradeRate);
      if (ups >= s.config.maxUpgrades || s.money[me] < cost) return null;
      return { ...s, money: s.money.map((m, i) => (i === me ? m - cost : m)) as [number, number], upgrades: { ...s.upgrades, [a.tile]: ups + 1 }, log: [...s.log, `Upgraded ${t.name}.`] };
    }
    case 'TRADE': {
      // Both players are at the same device and agree in the trade dialog.
      if ((pd.kind !== 'roll' && pd.kind !== 'end') || a.agreed !== true || !Array.isArray(a.give) || !Array.isArray(a.take) || !isInt(a.credits, -100000, 100000)) return null;
      const them = other(me);
      if (a.give.some((i) => s.owners[i] !== me || (s.upgrades[i] ?? 0) > 0)) return null;
      if (a.take.some((i) => s.owners[i] !== them || (s.upgrades[i] ?? 0) > 0)) return null;
      if (!a.give.length && !a.take.length && !a.credits) return null;
      // Positive credits: I pay them; negative: they pay me.
      if ((a.credits > 0 && s.money[me] < a.credits) || (a.credits < 0 && s.money[them] < -a.credits)) return null;
      const owners = { ...s.owners };
      for (const i of a.give) owners[i] = them;
      for (const i of a.take) owners[i] = me;
      const money = s.money.slice() as [number, number];
      money[me] -= a.credits;
      money[them] += a.credits;
      return { ...s, owners, money, log: [...s.log, 'Trade agreed.'] };
    }
    case 'END_TURN': {
      if (pd.kind !== 'end') return null;
      const turnCount = s.turnCount + 1;
      const next: AfterHoursState = { ...s, turn: other(me), turnCount, pending: { kind: 'roll' }, dice: null };
      return turnCount >= s.config.rounds * 2 ? finish(next) : next;
    }
    default:
      return null;
  }
}
