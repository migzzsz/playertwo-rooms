import { createRng, type Rng } from '../rng';
import { CARD_BANK, INTEREST_BANK } from './card-bank';
import { allowed, type DateSettings } from './consent';
import { PROMPTS, type Intensity, type Prompt, type Topic } from './library';
import { customToPrompt, type CustomCard } from './session';

/**
 * Guided card generation for the custom deck studio (spec §10, §15.3). Picks at random from the
 * hand-written card bank and curated templates, woven with the couple's own interests. It produces
 * exactly the requested number of distinct drafts that pass the same consent filter as live play.
 * Drafts are always previewed. No AI provider is involved.
 */
export type Vibe = 'romantic' | 'playful' | 'deep' | 'flirty' | 'truth' | 'dare';
export const VIBES: { id: Vibe; name: string }[] = [
  { id: 'romantic', name: 'Romantic' },
  { id: 'playful', name: 'Playful and funny' },
  { id: 'deep', name: 'Deep conversation' },
  { id: 'flirty', name: 'Flirty' },
  { id: 'truth', name: 'Truths' },
  { id: 'dare', name: 'Dares' },
];

export interface GenerateRequest {
  /** Question 1: vibe. */
  vibe: Vibe;
  /** Question 2: agreed intensity range and boundaries (the same settings live play uses). */
  min: Intensity;
  max: Intensity;
  settings: DateSettings;
  /** Question 3: personal interests and inside jokes. */
  interests: string[];
  count: number;
}

type Template = { text: string; alt?: string; min: Intensity; tags: Topic[]; needsInterest?: boolean };

/** {x} = one of the couple's interests. */
const TEMPLATES: Record<Vibe, Template[]> = {
  romantic: [
    { text: 'Tell your partner a favourite memory that involves {x}.', min: 0, tags: [], needsInterest: true },
    { text: 'Plan a surprise date built around {x}. Describe it in one minute.', min: 0, tags: [], needsInterest: true },
    { text: 'What is something about the way your partner loves {x} that you adore?', min: 0, tags: [], needsInterest: true },
    { text: 'Write a two-line love note that mentions {x}.', min: 0, tags: [], needsInterest: true },
    { text: 'Name three moments this year when you felt lucky to have your partner.', min: 0, tags: [] },
    { text: 'Describe your first impression of your partner as a movie trailer.', min: 0, tags: [] },
    { text: 'Hold your partner’s hand while you tell them why {x} reminds you of them, if welcome.', alt: 'Tell them across the table instead.', min: 1, tags: ['touch'], needsInterest: true },
    { text: 'Pick a song for the two of you that fits {x}, and explain your choice.', min: 0, tags: [], needsInterest: true },
  ],
  playful: [
    { text: 'Do a thirty-second infomercial selling {x} to your partner.', min: 0, tags: [], needsInterest: true },
    { text: 'Invent a dance move called “The {x}” and teach it to your partner.', min: 0, tags: [], needsInterest: true },
    { text: 'Narrate your partner enjoying {x} like a nature documentary.', min: 0, tags: [], needsInterest: true },
    { text: 'Rename your partner after {x} for the next three cards.', min: 0, tags: [], needsInterest: true },
    { text: 'Act out {x} without words; your partner has three guesses.', min: 0, tags: [], needsInterest: true },
    { text: 'Give your partner a dramatic award for “Best at {x}”, with a speech.', min: 0, tags: [], needsInterest: true },
    { text: 'Tell the story of your relationship in exactly ten words.', min: 0, tags: [] },
    { text: 'Rate your partner’s best impression out of ten, then do yours.', min: 0, tags: [] },
  ],
  deep: [
    { text: 'What does {x} mean to you, beyond the obvious?', min: 0, tags: [], needsInterest: true },
    { text: 'How would you like {x} to be part of our life in five years?', min: 0, tags: [], needsInterest: true },
    { text: 'What is a lesson {x} has taught you about yourself?', min: 0, tags: [], needsInterest: true },
    { text: 'What is one thing you want your partner to understand about you this year?', min: 0, tags: [] },
    { text: 'When did you last feel truly proud of us as a team?', min: 0, tags: [] },
    { text: 'What is a fear you would like your partner’s help with?', min: 0, tags: [] },
  ],
  flirty: [
    { text: 'Tell your partner what they look best doing when it comes to {x}.', min: 1, tags: [], needsInterest: true },
    { text: 'Offer a kiss as a reward for your partner’s best line about {x}, if welcome.', alt: 'Reward them with a high five and a compliment instead.', min: 1, tags: ['kissing'], needsInterest: true },
    { text: 'Whisper your favourite thing about your partner, if they want; otherwise say it with a wink.', alt: 'Say it out loud with a wink.', min: 1, tags: [] },
    { text: 'Use a pickup line that involves {x}. Your partner scores it.', min: 1, tags: [], needsInterest: true },
    { text: 'Slow dance for one song you both love, if you both want to.', alt: 'Each do a silly solo dance instead.', min: 1, tags: ['touch'] },
    { text: 'Describe your ideal evening of {x} with your partner, in your most romantic voice.', min: 2, tags: [], needsInterest: true },
  ],
  truth: [
    { text: 'What is your honest opinion of your partner’s taste in {x}?', min: 0, tags: ['truth'], needsInterest: true },
    { text: 'What is something about {x} you have never admitted?', min: 0, tags: ['truth'], needsInterest: true },
    { text: 'What is the most fun you have had with your partner around {x}?', min: 0, tags: ['truth'], needsInterest: true },
    { text: 'What is one date idea you have been saving for the right moment?', min: 1, tags: ['truth'] },
    { text: 'What is the last thing your partner did that made you blush?', min: 1, tags: ['truth'] },
  ],
  dare: [
    { text: 'Give a one-minute TED talk on {x}.', min: 0, tags: ['dare'], needsInterest: true },
    { text: 'Sing a made-up song about {x} to your partner.', min: 0, tags: ['dare'], needsInterest: true },
    { text: 'Do your best impression of your partner talking about {x}.', min: 0, tags: ['dare'], needsInterest: true },
    { text: 'Strike your best {x}-themed pose and hold it for ten seconds.', min: 0, tags: ['dare'], needsInterest: true },
    { text: 'Serenade your partner with a chorus of their choosing.', min: 1, tags: ['dare'] },
  ],
};

const VIBE_CATEGORY: Record<Vibe, string> = { romantic: 'romantic', playful: 'funny', deep: 'deep', flirty: 'flirty', truth: 'truth', dare: 'dare' };
const VIBE_DECKS: Record<Vibe, string[]> = { romantic: ['romantic'], playful: ['party'], deep: ['deep'], flirty: ['spicy'], truth: ['truth-or-dare'], dare: ['truth-or-dare'] };

let counter = 0;
const newId = (rng: Rng) => `gen-${Date.now().toString(36)}-${(counter++).toString(36)}-${rng.int(1e6).toString(36)}`;

function fits(card: CustomCard, req: GenerateRequest): boolean {
  if (card.intensity < req.min || card.intensity > req.max) return false;
  // Same filter as live play, at the top of the agreed range.
  return allowed(customToPrompt(card), req.settings, req.max);
}

function fromTemplates(req: GenerateRequest, rng: Rng, avoid: Set<string>): CustomCard | null {
  const interests = req.interests.map((x) => x.trim()).filter(Boolean);
  const bank: Template[] = [...CARD_BANK[req.vibe], ...INTEREST_BANK[req.vibe].map((c) => ({ ...c, needsInterest: true }))];
  const pool = [...TEMPLATES[req.vibe], ...bank].filter((t) => t.min <= req.max && (!t.needsInterest || interests.length));
  for (let tries = 0; tries < 40 && pool.length; tries++) {
    const t = pool[rng.int(pool.length)]!;
    const x = interests.length ? interests[rng.int(interests.length)]! : '';
    const text = t.text.replace('{x}', x);
    if (avoid.has(text.toLowerCase())) continue;
    const card: CustomCard = { id: newId(rng), text, alt: t.alt, category: VIBE_CATEGORY[req.vibe], intensity: Math.max(t.min, req.min) as Intensity, tags: t.tags, provenance: 'generated' };
    if (fits(card, req)) return card;
  }
  return null;
}

/** Fallback when templates run dry: eligible prompts from the curated library in this vibe. */
function fromLibrary(req: GenerateRequest, rng: Rng, avoid: Set<string>): CustomCard | null {
  const decks = VIBE_DECKS[req.vibe];
  const pool = PROMPTS.filter((p: Prompt) => p.pool === 'spark' && p.decks.some((d) => decks.includes(d)) && !avoid.has(p.text.toLowerCase()));
  for (let tries = 0; tries < 60 && pool.length; tries++) {
    const p = pool[rng.int(pool.length)]!;
    const card: CustomCard = { id: newId(rng), text: p.text, alt: p.alt, category: p.category, intensity: Math.max(p.min, req.min) as Intensity, tags: p.tags, provenance: 'generated' };
    if (fits(card, req)) return card;
  }
  return null;
}

/** One new draft, distinct from `existing` texts. Null only if nothing eligible is left. */
export function generateOne(req: GenerateRequest, seed: number, existing: readonly string[] = []): CustomCard | null {
  const rng = createRng(seed);
  const avoid = new Set(existing.map((t) => t.toLowerCase()));
  return fromTemplates(req, rng, avoid) ?? fromLibrary(req, rng, avoid);
}

/**
 * Exactly `count` distinct, eligible drafts (bounded retries; falls back to the library). Returns
 * fewer only if the settings leave fewer eligible cards than requested, and says so.
 */
export function generateCards(req: GenerateRequest, seed: number, existing: readonly string[] = []): { cards: CustomCard[]; short: boolean } {
  const count = Math.max(1, Math.min(20, Math.floor(req.count)));
  const rng = createRng(seed);
  const texts = [...existing];
  const cards: CustomCard[] = [];
  for (let attempt = 0; cards.length < count && attempt < count * 6; attempt++) {
    const card = generateOne(req, rng.int(2 ** 31), texts);
    if (!card) break;
    cards.push(card);
    texts.push(card.text);
  }
  return { cards, short: cards.length < count };
}
