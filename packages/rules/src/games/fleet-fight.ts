import type { Rng } from '../rng';
import type { BotLevel, GameDef, Outcome, Seat } from '../types';
import { firstSeat, isInt, isObj, pick } from '../util';

/**
 * Fleet Fight: hidden-information naval duel on two 8×8 grids. Fleet: Carrier 4, Cruiser 3,
 * Sub 3, Patrol 2. Ships are straight and may touch but not overlap. Setup (placement + Ready)
 * then alternating single shots. Ported from prototype/games.js, with manual placement added.
 */
export const SHIP_LENGTHS = [4, 3, 3, 2] as const;
export const SHIP_NAMES = ['Carrier', 'Cruiser', 'Sub', 'Patrol'] as const;
export const GRID = 8;

/** One fleet: each ship is its list of cell indices (row*8+col), in SHIP_LENGTHS order. */
export type Fleet = number[][];

export interface FleetFightState {
  phase: 'setup' | 'play';
  f: [Fleet, Fleet];
  ready: [boolean, boolean];
  /** Shots each seat has fired at the other's grid: 0 untried, 1 miss, 2 hit. */
  sh: [number[], number[]];
  t: Seat;
  w: Outcome;
  last: { s: Seat; i: number; hit: boolean; sunk: number } | null;
}

export type FleetFightAction = { type: 'fleet'; ships: Fleet } | { type: 'ready' } | { type: 'fire'; i: number };

/** What one seat may see: their own fleet, and only enemy ships that are sunk (or all, once the game ends). */
export interface FleetFightView extends Omit<FleetFightState, 'f'> {
  f: [(number[] | null)[], (number[] | null)[]];
}

export function randomFleet(rng: Rng): Fleet {
  for (;;) {
    const taken = new Set<number>();
    const ships: Fleet = [];
    for (const len of SHIP_LENGTHS) {
      for (let tries = 0; tries < 200; tries++) {
        const hor = rng.next() < 0.5;
        const r = rng.int(hor ? GRID : GRID + 1 - len);
        const c = rng.int(hor ? GRID + 1 - len : GRID);
        const cells = Array.from({ length: len }, (_, k) => (r + (hor ? 0 : k)) * GRID + c + (hor ? k : 0));
        if (cells.some((i) => taken.has(i))) continue;
        cells.forEach((i) => taken.add(i));
        ships.push(cells);
        break;
      }
    }
    if (ships.length === SHIP_LENGTHS.length) return ships;
  }
}

/** A fleet is valid if every ship has the right length, lies in a straight unbroken line on the grid, and none overlap. */
export function isValidFleet(ships: unknown): ships is Fleet {
  if (!Array.isArray(ships) || ships.length !== SHIP_LENGTHS.length) return false;
  const taken = new Set<number>();
  for (let k = 0; k < SHIP_LENGTHS.length; k++) {
    const cells = ships[k];
    if (!Array.isArray(cells) || cells.length !== SHIP_LENGTHS[k]) return false;
    if (!cells.every((i) => isInt(i, 0, GRID * GRID - 1))) return false;
    const sorted = [...(cells as number[])].sort((a, b) => a - b);
    const row = Math.floor(sorted[0]! / GRID);
    const across = sorted.every((i, j) => i === sorted[0]! + j && Math.floor(i / GRID) === row);
    const down = sorted.every((i, j) => i === sorted[0]! + j * GRID);
    if (!across && !down) return false;
    for (const i of sorted) {
      if (taken.has(i)) return false;
      taken.add(i);
    }
  }
  return true;
}

/** Ship cells for a ship placed with its first cell at (r, c). Null if it would leave the grid. */
export function shipCells(len: number, r: number, c: number, horizontal: boolean): number[] | null {
  if (r < 0 || c < 0 || (horizontal ? c + len > GRID || r >= GRID : r + len > GRID || c >= GRID)) return null;
  return Array.from({ length: len }, (_, k) => (r + (horizontal ? 0 : k)) * GRID + c + (horizontal ? k : 0));
}

/** Which ships are sunk. Accepts a redacted fleet too: a hidden (null) ship isn't sunk. */
export function sunkShips(ships: readonly (number[] | null)[], shots: number[]): boolean[] {
  return ships.map((cells) => Boolean(cells && cells.every((i) => shots[i] === 2)));
}

/* ---------- Bots ---------- */

const inGrid = (r: number, c: number) => r >= 0 && r < GRID && c >= 0 && c < GRID;

/** Hits that don't yet belong to a sunk ship: the bot is still chasing those. */
function openHits(shots: number[], enemy: Fleet): number[] {
  const sunk = sunkShips(enemy, shots);
  const sunkCells = new Set<number>();
  enemy.forEach((cells, k) => sunk[k] && cells.forEach((i) => sunkCells.add(i)));
  const out: number[] = [];
  for (let i = 0; i < GRID * GRID; i++) if (shots[i] === 2 && !sunkCells.has(i)) out.push(i);
  return out;
}

/** Prototype hunt/target: extend aligned hits, else hit neighbours, else checkerboard hunt. */
function huntTarget(shots: number[], enemy: Fleet, rng: Rng, parity: boolean): number {
  const open = openHits(shots, enemy);
  const unknown = (r: number, c: number) => inGrid(r, c) && shots[r * GRID + c] === 0;
  if (open.length) {
    const cand: number[] = [];
    if (open.length >= 2) {
      const rows = open.map((x) => Math.floor(x / GRID));
      const cols = open.map((x) => x % GRID);
      if (rows.every((x) => x === rows[0])) {
        const lo = Math.min(...cols);
        const hi = Math.max(...cols);
        if (unknown(rows[0]!, lo - 1)) cand.push(rows[0]! * GRID + lo - 1);
        if (unknown(rows[0]!, hi + 1)) cand.push(rows[0]! * GRID + hi + 1);
      }
      if (cols.every((x) => x === cols[0])) {
        const lo = Math.min(...rows);
        const hi = Math.max(...rows);
        if (unknown(lo - 1, cols[0]!)) cand.push((lo - 1) * GRID + cols[0]!);
        if (unknown(hi + 1, cols[0]!)) cand.push((hi + 1) * GRID + cols[0]!);
      }
    }
    if (!cand.length)
      for (const x of open) {
        const r = Math.floor(x / GRID);
        const c = x % GRID;
        for (const [rr, cc] of [
          [r - 1, c],
          [r + 1, c],
          [r, c - 1],
          [r, c + 1],
        ] as const)
          if (unknown(rr, cc)) cand.push(rr * GRID + cc);
      }
    if (cand.length) return pick(cand, rng);
  }
  const hunt: number[] = [];
  const any: number[] = [];
  for (let j = 0; j < GRID * GRID; j++)
    if (shots[j] === 0) {
      any.push(j);
      if ((Math.floor(j / GRID) + j) % 2 === 0) hunt.push(j);
    }
  return pick(parity && hunt.length ? hunt : any, rng);
}

/**
 * Hard: probability density. Count every placement of each unsunk ship that fits the known
 * misses and sunk cells; placements through open hits count heavily. Fire at the likeliest square.
 */
function density(shots: number[], enemy: Fleet, rng: Rng): number {
  const sunk = sunkShips(enemy, shots);
  const blocked = new Set<number>();
  enemy.forEach((cells, k) => sunk[k] && cells.forEach((i) => blocked.add(i)));
  for (let i = 0; i < GRID * GRID; i++) if (shots[i] === 1) blocked.add(i);
  const open = new Set(openHits(shots, enemy));
  const heat = new Array<number>(GRID * GRID).fill(0);
  SHIP_LENGTHS.forEach((len, k) => {
    if (sunk[k]) return;
    for (const hor of [true, false])
      for (let r = 0; r < GRID; r++)
        for (let c = 0; c < GRID; c++) {
          const cells = shipCells(len, r, c, hor);
          if (!cells || cells.some((i) => blocked.has(i))) continue;
          const through = cells.filter((i) => open.has(i)).length;
          const weight = through ? 1 + through * 20 : 1;
          for (const i of cells) if (shots[i] === 0) heat[i]! += weight;
        }
  });
  let best: number[] = [];
  let top = -1;
  for (let i = 0; i < GRID * GRID; i++) {
    if (shots[i] !== 0) continue;
    if (heat[i]! > top) {
      top = heat[i]!;
      best = [i];
    } else if (heat[i] === top) best.push(i);
  }
  return pick(best, rng);
}

function chooseShot(s: FleetFightState, me: Seat, level: BotLevel, rng: Rng): number {
  const shots = s.sh[me];
  const enemy = s.f[(1 - me) as Seat];
  if (level === 'hard') return density(shots, enemy, rng);
  if (level === 'easy') {
    if (rng.next() < 0.5) {
      const any = shots.flatMap((v, i) => (v === 0 ? [i] : []));
      return pick(any, rng);
    }
    return huntTarget(shots, enemy, rng, false);
  }
  return huntTarget(shots, enemy, rng, true);
}

/* ---------- Game ---------- */

export const fleetFight: GameDef<FleetFightState, FleetFightAction> = {
  id: 'fleet-fight',
  name: 'Fleet Fight',
  hiddenInfo: true,
  init(rng, opts) {
    const empty = () => new Array<number>(GRID * GRID).fill(0);
    return { phase: 'setup', f: [randomFleet(rng), randomFleet(rng)], ready: [false, false], sh: [empty(), empty()], t: firstSeat(opts), w: null, last: null };
  },
  turnOf: (s) => (s.phase === 'setup' || s.w !== null ? null : s.t),
  canAct: (s, seat) => (s.phase === 'setup' ? !s.ready[seat] : s.w === null && s.t === seat),
  apply(s, a, seat) {
    if (!this.canAct(s, seat) || !isObj(a)) return null;
    if (s.phase === 'setup') {
      if (a.type === 'fleet') {
        if (!isValidFleet(a.ships)) return null;
        const f: [Fleet, Fleet] = [s.f[0], s.f[1]];
        f[seat] = a.ships.map((cells) => cells.slice());
        return { ...s, f };
      }
      if (a.type === 'ready') {
        const ready: [boolean, boolean] = [s.ready[0], s.ready[1]];
        ready[seat] = true;
        return { ...s, ready, phase: ready[0] && ready[1] ? 'play' : 'setup' };
      }
      return null;
    }
    if (a.type !== 'fire' || !isInt(a.i, 0, GRID * GRID - 1) || s.sh[seat][a.i] !== 0) return null;
    const opp = (1 - seat) as Seat;
    const hit = s.f[opp].some((cells) => cells.includes(a.i as number));
    const sh: [number[], number[]] = [s.sh[0].slice(), s.sh[1].slice()];
    sh[seat][a.i] = hit ? 2 : 1;
    const before = sunkShips(s.f[opp], s.sh[seat]);
    const after = sunkShips(s.f[opp], sh[seat]);
    let sunk = -1;
    for (let k = 0; k < after.length; k++) if (after[k] && !before[k]) sunk = k;
    return { ...s, sh, t: opp, w: after.every(Boolean) ? seat : null, last: { s: seat, i: a.i, hit, sunk } };
  },
  result: (s) => s.w,
  bot(s, seat, level, rng) {
    if (s.phase === 'setup') return { type: 'ready' };
    return { type: 'fire', i: chooseShot(s, seat, level, rng) };
  },
  view(s, seat): FleetFightView {
    const opp = (1 - seat) as Seat;
    const sunk = sunkShips(s.f[opp], s.sh[seat]);
    // Safe to call on a view again (the client re-reads what the server sent): null stays null.
    const theirs = (s.f[opp] as (number[] | null)[]).map((cells, k) => (cells && (sunk[k] || s.w !== null) ? cells.slice() : null));
    const mine = (s.f[seat] as (number[] | null)[]).map((cells) => cells?.slice() ?? null);
    const f: FleetFightView['f'] = seat === 0 ? [mine, theirs] : [theirs, mine];
    return { ...s, f, sh: [s.sh[0].slice(), s.sh[1].slice()] };
  },
  score(s) {
    return [sunkShips(s.f[1], s.sh[0]).filter(Boolean).length, sunkShips(s.f[0], s.sh[1]).filter(Boolean).length];
  },
};
