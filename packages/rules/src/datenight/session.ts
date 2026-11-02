import type { Seat } from '../types';
import { allowed, drawFrom, levelAt, settingsProblems, type DateSettings } from './consent';
import { PROMPTS, type DeckId, type Intensity, type Prompt, type Topic } from './library';

/**
 * A Date Night deck session (spec C): both players at one device, taking turns to draw. Every
 * card can be completed, swapped for its alternative, replaced with another, or skipped, with
 * no real-world consequence. Optional scoring with a checkpoint challenge every tenth card.
 */
export const CHECKPOINT_EVERY = 10;
/** Cards over which intensity rises from start to end. */
export const SESSION_LENGTH = 30;

/** A card in a private custom deck (manual or generated, provenance kept per card). */
export interface CustomCard {
  id: string;
  title?: string;
  text: string;
  category: string;
  intensity: Intensity;
  alt?: string;
  tags: Topic[];
  provenance: 'manual' | 'generated';
}

export interface CustomDeck {
  id: string;
  name: string;
  cards: CustomCard[];
  /** Incremented on every save, so a stale tab can't overwrite newer edits. */
  version: number;
  updatedAt: number;
}

export function customToPrompt(c: CustomCard): Prompt {
  return { id: c.id, pool: 'spark', category: c.category, min: c.intensity, max: 2, text: c.text, alt: c.alt, tags: c.tags, decks: [] };
}

export interface DrawnCard {
  id: string;
  text: string;
  alt?: string;
  category: string;
  min: Intensity;
  /** A checkpoint challenge rather than a deck card. */
  checkpoint: boolean;
  points?: number;
}

export interface DateSessionState {
  settings: DateSettings;
  deck: DeckId | 'custom';
  custom: Prompt[];
  /** Extra library cards (the Plus expansion), joined into the built-in decks they belong to. */
  extra: Prompt[];
  current: DrawnCard | null;
  /** Whose turn it is to read and resolve the card. */
  turn: Seat;
  history: string[];
  checkpointHistory: string[];
  seed: number;
  resolved: number;
  points: [number, number];
  paused: boolean;
  status: 'playing' | 'finished';
  winner: Seat | -1 | null;
  /** The deck ran out of eligible cards under the current settings. */
  empty: boolean;
  log: { seat: Seat; card: string; outcome: 'complete' | 'alternate' | 'replace' | 'skip' }[];
}

export type DateSessionAction =
  | { type: 'draw' }
  | { type: 'complete' }
  | { type: 'alternate' }
  | { type: 'replace' }
  | { type: 'skip' }
  | { type: 'checkpoint-done'; winners: Seat[] }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'update-settings'; settings: DateSettings }
  | { type: 'finish' }
  | { type: 'declare-winner'; winner: Seat | -1 };

export function startSession(settings: DateSettings, deck: DeckId | 'custom', seed: number, custom: CustomCard[] = [], extra: Prompt[] = []): DateSessionState | null {
  if (settingsProblems(settings).length) return null;
  return {
    settings,
    deck,
    custom: custom.map(customToPrompt),
    extra,
    current: null,
    turn: 0,
    history: [],
    checkpointHistory: [],
    seed,
    resolved: 0,
    points: [0, 0],
    paused: false,
    status: 'playing',
    winner: null,
    empty: false,
    log: [],
  };
}

export function currentLevel(s: DateSessionState): Intensity {
  return levelAt(s.settings, s.resolved / SESSION_LENGTH);
}

export function eligibleCards(s: DateSessionState): Prompt[] {
  const level = currentLevel(s);
  const pool = s.deck === 'custom' ? s.custom : [...PROMPTS, ...(s.extra ?? [])].filter((p) => p.pool === 'spark' && p.decks.includes(s.deck as DeckId));
  const now = pool.filter((p) => allowed(p, s.settings, level));
  if (now.length) return now;
  // Some decks have nothing at the gentlest level (Spicy starts at Flirty). Rather than calling the
  // deck empty, start from the lowest level it does have, never past what both players allow.
  const top = levelAt(s.settings, 1);
  const within = pool.filter((p) => allowed(p, s.settings, top));
  if (!within.length) return [];
  const lowest = Math.min(...within.map((p) => p.min));
  return within.filter((p) => p.min === lowest);
}

function toDrawn(p: Prompt, checkpoint: boolean): DrawnCard {
  return { id: p.id, text: p.text, alt: p.alt, category: p.category, min: p.min, checkpoint, points: p.effect?.points };
}

function drawCard(s: DateSessionState, avoid?: string): DateSessionState {
  const candidates = eligibleCards(s).filter((p) => p.id !== avoid);
  const r = drawFrom(candidates, s.history, s.seed);
  if (!r.prompt) return { ...s, current: null, empty: true, seed: r.seed };
  return { ...s, current: toDrawn(r.prompt, false), history: r.history, seed: r.seed, empty: false };
}

function checkpointDue(s: DateSessionState): boolean {
  return s.settings.scoring && s.resolved > 0 && s.resolved % CHECKPOINT_EVERY === 0;
}

function drawCheckpoint(s: DateSessionState): DateSessionState {
  const level = currentLevel(s);
  const pool = PROMPTS.filter((p) => p.pool === 'checkpoint' && allowed(p, s.settings, level));
  const r = drawFrom(pool, s.checkpointHistory, s.seed);
  if (!r.prompt) return s;
  return { ...s, current: toDrawn(r.prompt, true), checkpointHistory: r.history, seed: r.seed };
}

function resolveCard(s: DateSessionState, outcome: 'complete' | 'alternate' | 'skip'): DateSessionState {
  const card = s.current!;
  const points: [number, number] = [s.points[0], s.points[1]];
  if (s.settings.scoring && outcome !== 'skip') points[s.turn]++;
  const next: DateSessionState = {
    ...s,
    current: null,
    points,
    resolved: s.resolved + 1,
    turn: (1 - s.turn) as Seat,
    log: [...s.log, { seat: s.turn, card: card.id, outcome }],
  };
  return checkpointDue(next) ? drawCheckpoint(next) : next;
}

/** Pure reducer. Returns null for an action that isn't allowed right now. */
export function reduceSession(s: DateSessionState, a: DateSessionAction): DateSessionState | null {
  if (s.status === 'finished') {
    if (a.type === 'declare-winner' && (a.winner === 0 || a.winner === 1 || a.winner === -1)) return { ...s, winner: a.winner };
    return null;
  }
  if (a.type === 'pause') return s.paused ? null : { ...s, paused: true };
  if (a.type === 'resume') return s.paused ? { ...s, paused: false } : null;
  if (a.type === 'update-settings') {
    // Changing boundaries needs both players to approve again before play continues.
    if (settingsProblems(a.settings).length) return { ...s, settings: a.settings, paused: true };
    // A card already on the table that the new limits rule out is withdrawn.
    const level = levelAt(a.settings, s.resolved / SESSION_LENGTH);
    const pool = s.deck === 'custom' ? s.custom : [...PROMPTS, ...(s.extra ?? [])];
    const cur = s.current && !s.current.checkpoint ? pool.find((p) => p.id === s.current!.id) : undefined;
    const keep = !s.current || s.current.checkpoint || (cur && allowed(cur, a.settings, level));
    // New limits may let cards back in, so "no cards left" is re-checked on the next draw.
    return { ...s, settings: a.settings, current: keep ? s.current : null, empty: false };
  }
  if (a.type === 'finish') return { ...s, status: 'finished', current: null, paused: false };
  if (s.paused || settingsProblems(s.settings).length) return null;
  switch (a.type) {
    case 'draw':
      return s.current ? null : drawCard(s);
    case 'complete':
    case 'alternate':
      if (!s.current || s.current.checkpoint) return null;
      if (a.type === 'alternate' && !s.current.alt) return null;
      return resolveCard(s, a.type);
    case 'skip':
      if (!s.current) return null;
      if (s.current.checkpoint) return { ...s, current: null };
      return resolveCard(s, 'skip');
    case 'replace':
      if (!s.current || s.current.checkpoint) return null;
      return { ...drawCard({ ...s, current: null }, s.current.id), log: [...s.log, { seat: s.turn, card: s.current.id, outcome: 'replace' }] };
    case 'checkpoint-done': {
      if (!s.current?.checkpoint || !Array.isArray(a.winners)) return null;
      const points: [number, number] = [s.points[0], s.points[1]];
      for (const w of new Set(a.winners)) if (w === 0 || w === 1) points[w] += s.current.points ?? 0;
      return { ...s, current: null, points };
    }
    default:
      return null;
  }
}
