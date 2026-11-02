/**
 * Date Night prompt library: original, hand-authored launch copy shared by the Date Night decks
 * and After Hours (spec Part III §6, §15.2). Content is non-explicit and every prompt can be
 * declined: anything involving touch, kissing or clothing carries a non-contact alternative.
 * No prompt makes drinking or smoking a reward, penalty or condition.
 *
 * Intensity: 0 = Mild, 1 = Flirty, 2 = Spicy (descriptive levels; filters enforce them).
 */
import { CARD_BANK, type BankVibe } from './card-bank';

export type Intensity = 0 | 1 | 2;
export const INTENSITY_NAMES = ['Mild', 'Flirty', 'Spicy'] as const;

/** Topics a player can switch off. A prompt carrying a disabled topic is never selected. */
export type Topic = 'truth' | 'dare' | 'kissing' | 'touch' | 'clothing';
export const TOPICS: Topic[] = ['truth', 'dare', 'kissing', 'touch', 'clothing'];

/** The physical Date Night decks (spec C). */
export type DeckId = 'romantic' | 'spicy' | 'truth-or-dare' | 'deep' | 'party';
export const DECKS: { id: DeckId; name: string; blurb: string }[] = [
  { id: 'romantic', name: 'Romantic', blurb: 'Memories, compliments and sweet moments.' },
  { id: 'spicy', name: 'Spicy', blurb: 'Flirty and bold, always optional, always with an alternative.' },
  { id: 'truth-or-dare', name: 'Truth or Dare', blurb: 'Answer honestly or play it out.' },
  { id: 'deep', name: 'Deep Conversations', blurb: 'Bigger questions, slower answers.' },
  { id: 'party', name: 'Party / Wildcard', blurb: 'Silly, loud and quick.' },
];

/** After Hours decks plus the checkpoint and safe-forfeit pools. */
export type Pool = 'spark' | 'surprise' | 'checkpoint' | 'forfeit';

export interface GameEffect {
  credits?: number;
  /** Spaces to move (negative = back). */
  move?: number;
  points?: number;
  /** Offer a property swap (both must agree in the UI); falls back to `credits`. */
  swap?: boolean;
}

export interface Prompt {
  id: string;
  pool: Pool;
  category: string;
  min: Intensity;
  max: Intensity;
  text: string;
  /** Non-contact / substance-free alternative the player can choose instead. */
  alt?: string;
  tags: Topic[];
  decks: DeckId[];
  effect?: GameEffect;
}

type Row = [id: string, pool: Pool, category: string, min: Intensity, max: Intensity, tags: Topic[], decks: DeckId[], text: string, alt?: string, effect?: GameEffect];

const R: Row[] = [
  // ---------- Romantic ----------
  ['rom-01', 'spark', 'romantic', 0, 2, [], ['romantic'], 'Tell your partner your favourite memory of the two of you.'],
  ['rom-02', 'spark', 'romantic', 0, 2, [], ['romantic'], 'Describe the moment you knew you liked your partner.'],
  ['rom-03', 'spark', 'romantic', 0, 2, [], ['romantic'], 'Name a song that reminds you of your partner, and say why.'],
  ['rom-04', 'spark', 'romantic', 0, 2, [], ['romantic', 'deep'], 'What is something small your partner does that makes your day better?'],
  ['rom-05', 'spark', 'romantic', 0, 2, [], ['romantic'], 'Plan your perfect lazy Sunday together, out loud, in under a minute.'],
  ['rom-06', 'spark', 'romantic', 0, 2, [], ['romantic'], 'Share the funniest memory from your first few dates.'],
  ['rom-07', 'spark', 'romantic', 0, 2, [], ['romantic'], 'Tell your partner one thing you are proud of them for this year.'],
  ['rom-08', 'spark', 'romantic', 0, 2, [], ['romantic'], 'If you could relive one day together, which would it be?'],
  ['rom-09', 'spark', 'romantic', 0, 2, [], ['romantic'], 'Write your partner a three-line poem on the spot. It does not have to rhyme.'],
  ['rom-10', 'spark', 'romantic', 0, 2, [], ['romantic'], 'Describe your partner to a stranger in five words.'],
  ['rom-11', 'spark', 'romantic', 0, 2, [], ['romantic'], 'What is a place you want to visit together, and what would you do first?'],
  ['rom-12', 'spark', 'romantic', 1, 2, ['touch'], ['romantic'], 'Hold hands for the next two turns, if you both want to.', 'Sit a little closer for the next two turns instead.'],
  ['rom-13', 'spark', 'romantic', 1, 2, ['touch'], ['romantic'], 'Give your partner a slow, one-minute shoulder rub, if welcome.', 'Tell your partner what you would put in a care package for them.'],
  ['rom-14', 'spark', 'romantic', 0, 2, [], ['romantic'], 'Recreate the first message you ever sent each other, as best you remember.'],
  ['rom-15', 'spark', 'romantic', 0, 2, [], ['romantic'], 'Choose a song for the two of you to slow dance to later.'],
  // ---------- Compliments ----------
  ['cmp-01', 'spark', 'compliment', 0, 2, [], ['romantic'], 'Give your partner three compliments, each about something different.'],
  ['cmp-02', 'spark', 'compliment', 0, 2, [], ['romantic'], 'Compliment your partner’s laugh as specifically as you can.'],
  ['cmp-03', 'spark', 'compliment', 0, 2, [], ['romantic', 'party'], 'Hype your partner up like a sports commentator for twenty seconds.'],
  ['cmp-04', 'spark', 'compliment', 0, 2, [], ['romantic'], 'Tell your partner a skill of theirs you secretly admire.'],
  ['cmp-05', 'spark', 'compliment', 1, 2, [], ['romantic', 'spicy'], 'Tell your partner what you find most attractive about them tonight.'],
  ['cmp-06', 'spark', 'compliment', 0, 2, [], ['romantic'], 'Finish the sentence: “I feel safest with you when…”'],
  ['cmp-07', 'spark', 'compliment', 1, 2, [], ['spicy'], 'Describe the outfit of theirs you like best, and why.'],
  // ---------- Flirty / kissing ----------
  ['flt-01', 'spark', 'flirty', 1, 2, ['kissing'], ['spicy'], 'Offer a kiss on the cheek, if welcomed.', 'Blow a theatrical air kiss instead.'],
  ['flt-02', 'spark', 'flirty', 1, 2, ['kissing'], ['spicy'], 'Kiss your partner’s hand like it is a royal ball, if welcomed.', 'Bow deeply and pay them a royal compliment.'],
  ['flt-03', 'spark', 'flirty', 1, 2, [], ['spicy'], 'Use your best pickup line on your partner. They rate it out of ten.'],
  ['flt-04', 'spark', 'flirty', 1, 2, [], ['spicy'], 'Wink at your partner until they laugh.'],
  ['flt-05', 'spark', 'flirty', 1, 2, ['kissing'], ['spicy'], 'Ask for a kiss, and take no for an answer gracefully.', 'Ask for a high five instead.'],
  ['flt-06', 'spark', 'flirty', 1, 2, [], ['spicy'], 'Describe your ideal date night using only three words.'],
  ['flt-07', 'spark', 'flirty', 1, 2, ['touch'], ['spicy'], 'Sit back to back for the next turn, if you both want to.', 'Swap seats for the next turn.'],
  ['flt-08', 'spark', 'flirty', 1, 2, [], ['spicy'], 'Whisper something nice in your partner’s ear. Keep it sweet or make it bold.', 'Say it out loud across the table instead.'],
  ['flt-09', 'spark', 'flirty', 1, 2, ['kissing'], ['spicy'], 'Offer a kiss on the forehead, if welcomed.', 'Give a heartfelt compliment instead.'],
  ['flt-10', 'spark', 'flirty', 1, 2, [], ['spicy', 'party'], 'Do your most dramatic “come here” look. Your partner scores it.'],
  ['flt-11', 'spark', 'flirty', 2, 2, ['kissing'], ['spicy'], 'Offer your partner a ten-second kiss, if you both want to.', 'Hold eye contact for ten seconds instead.'],
  ['flt-12', 'spark', 'flirty', 2, 2, ['touch'], ['spicy'], 'Trace a word on your partner’s palm; they have to guess it.', 'Write the word in the air for them to guess.'],
  ['flt-13', 'spark', 'flirty', 2, 2, [], ['spicy'], 'Tell your partner the moment tonight you most wanted to kiss them.'],
  ['flt-14', 'spark', 'flirty', 2, 2, ['touch'], ['spicy'], 'Give a playful lap dance for up to 20 seconds, if both want; otherwise perform a ridiculous seated dance.', 'Perform a ridiculous seated dance.'],
  ['flt-15', 'spark', 'flirty', 2, 2, [], ['spicy'], 'Describe your partner’s best feature like a romance-novel narrator.'],
  // ---------- Optional clothing (outer layers only) ----------
  ['clo-01', 'spark', 'clothing', 2, 2, ['clothing'], ['spicy'], 'Optionally remove one outer layer of clothing.', 'Swap an accessory with your partner instead.'],
  ['clo-02', 'spark', 'clothing', 2, 2, ['clothing'], ['spicy'], 'Optionally take off a shoe or sock with maximum drama.', 'Model your shoe like it is on a runway instead.'],
  ['clo-03', 'spark', 'clothing', 2, 2, ['clothing'], ['spicy'], 'Optionally swap one outer layer with your partner for the next round.', 'Swap seats for the next round instead.'],
  ['clo-04', 'spark', 'clothing', 1, 2, ['clothing'], ['spicy', 'party'], 'Style your partner using one item of your own clothing, like an accessory.', 'Style them with a cushion or blanket instead.'],
  // ---------- Truth ----------
  ['tru-01', 'spark', 'truth', 0, 2, ['truth'], ['truth-or-dare'], 'What is one date you wish we would plan?'],
  ['tru-02', 'spark', 'truth', 0, 2, ['truth'], ['truth-or-dare'], 'What was your first impression of your partner, honestly?'],
  ['tru-03', 'spark', 'truth', 0, 2, ['truth'], ['truth-or-dare'], 'What is a habit of yours you think your partner secretly finds cute?'],
  ['tru-04', 'spark', 'truth', 0, 2, ['truth'], ['truth-or-dare'], 'What is the most embarrassing thing you have done to impress someone?'],
  ['tru-05', 'spark', 'truth', 0, 2, ['truth'], ['truth-or-dare'], 'Which of your partner’s friends do you like most, and why?'],
  ['tru-06', 'spark', 'truth', 1, 2, ['truth'], ['truth-or-dare', 'spicy'], 'What is a date-night idea you have been too shy to suggest?'],
  ['tru-07', 'spark', 'truth', 1, 2, ['truth'], ['truth-or-dare', 'spicy'], 'When did you last catch yourself staring at your partner?'],
  ['tru-08', 'spark', 'truth', 1, 2, ['truth'], ['truth-or-dare', 'spicy'], 'What is the most attractive thing your partner did this week?'],
  ['tru-09', 'spark', 'truth', 0, 2, ['truth'], ['truth-or-dare'], 'What is a song you would be embarrassed to have on repeat?'],
  ['tru-10', 'spark', 'truth', 2, 2, ['truth'], ['truth-or-dare', 'spicy'], 'What is one thing you would like more of in our relationship?'],
  ['tru-11', 'spark', 'truth', 2, 2, ['truth'], ['truth-or-dare', 'spicy'], 'Describe your favourite kiss we have had, without naming the date.'],
  ['tru-12', 'spark', 'truth', 0, 2, ['truth'], ['truth-or-dare'], 'What is the pettiest thing that has ever annoyed you about me?'],
  ['tru-13', 'spark', 'truth', 1, 2, ['truth'], ['truth-or-dare'], 'What is a compliment you have received that you still think about?'],
  ['tru-14', 'spark', 'truth', 0, 2, ['truth'], ['truth-or-dare'], 'What is one thing you have never told me about your childhood?'],
  // ---------- Dare ----------
  ['dar-01', 'spark', 'dare', 0, 2, ['dare'], ['truth-or-dare', 'party'], 'Recreate how you flirted on your first date, for thirty seconds.'],
  ['dar-02', 'spark', 'dare', 0, 2, ['dare'], ['truth-or-dare', 'party'], 'Speak only in questions until your next turn.'],
  ['dar-03', 'spark', 'dare', 0, 2, ['dare'], ['truth-or-dare', 'party'], 'Do your best impression of your partner ordering at a restaurant.'],
  ['dar-04', 'spark', 'dare', 0, 2, ['dare'], ['truth-or-dare', 'party'], 'Perform a 20-second overdramatic runway walk; your partner scores the pose.'],
  ['dar-05', 'spark', 'dare', 0, 2, ['dare'], ['truth-or-dare', 'party'], 'Sing the chorus of any love song, badly and proudly.'],
  ['dar-06', 'spark', 'dare', 1, 2, ['dare'], ['truth-or-dare', 'spicy'], 'Serenade your partner with a made-up song about their eyes.'],
  ['dar-07', 'spark', 'dare', 1, 2, ['dare', 'touch'], ['truth-or-dare', 'spicy'], 'Slow dance for one song, if you both want to.', 'Do a silly solo dance instead.'],
  ['dar-08', 'spark', 'dare', 0, 2, ['dare'], ['truth-or-dare', 'party'], 'Let your partner choose your phone wallpaper until tomorrow.'],
  ['dar-09', 'spark', 'dare', 1, 2, ['dare'], ['truth-or-dare', 'spicy'], 'Give your partner your most convincing “I’ve missed you” speech.'],
  ['dar-10', 'spark', 'dare', 2, 2, ['dare', 'kissing'], ['truth-or-dare', 'spicy'], 'Kiss your partner somewhere they choose: cheek, hand or lips, if welcomed.', 'Let them choose a silly pose for you to hold instead.'],
  ['dar-11', 'spark', 'dare', 0, 2, ['dare'], ['truth-or-dare', 'party'], 'Do ten seconds of your best robot dance.'],
  ['dar-12', 'spark', 'dare', 1, 2, ['dare'], ['truth-or-dare'], 'Text a friend one nice thing about your partner, right now.'],
  ['dar-13', 'spark', 'dare', 2, 2, ['dare', 'touch'], ['truth-or-dare', 'spicy'], 'Give your partner a slow hand massage for one minute, if welcome.', 'Describe the massage you would give, in detail, instead.'],
  // ---------- Deep conversations ----------
  ['dep-01', 'spark', 'deep', 0, 2, [], ['deep'], 'What does a good life look like to you in ten years?'],
  ['dep-02', 'spark', 'deep', 0, 2, [], ['deep'], 'What is something you are still learning about yourself?'],
  ['dep-03', 'spark', 'deep', 0, 2, [], ['deep'], 'When do you feel most understood by me?'],
  ['dep-04', 'spark', 'deep', 0, 2, [], ['deep'], 'What is a belief you have changed your mind about?'],
  ['dep-05', 'spark', 'deep', 0, 2, [], ['deep'], 'What is a tradition you would like us to start?'],
  ['dep-06', 'spark', 'deep', 0, 2, [], ['deep'], 'What is something you worry about that you rarely say out loud?'],
  ['dep-07', 'spark', 'deep', 0, 2, [], ['deep'], 'Who taught you the most about love, and what did they teach you?'],
  ['dep-08', 'spark', 'deep', 0, 2, [], ['deep'], 'What does feeling cared for look like on a bad day?'],
  ['dep-09', 'spark', 'deep', 0, 2, [], ['deep'], 'What is a dream you have put on hold?'],
  ['dep-10', 'spark', 'deep', 0, 2, [], ['deep'], 'What is a small way I could support you this month?'],
  ['dep-11', 'spark', 'deep', 0, 2, [], ['deep'], 'What do you think we are best at as a team?'],
  ['dep-12', 'spark', 'deep', 0, 2, [], ['deep'], 'What would you tell your younger self about relationships?'],
  // ---------- Funny / party ----------
  ['fun-01', 'spark', 'funny', 0, 2, [], ['party'], 'Narrate the last five minutes like a nature documentary.'],
  ['fun-02', 'spark', 'funny', 0, 2, [], ['party'], 'Invent a name for your partner’s signature dance move.'],
  ['fun-03', 'spark', 'funny', 0, 2, [], ['party'], 'Do your best impression of a celebrity your partner names.'],
  ['fun-04', 'spark', 'funny', 0, 2, [], ['party'], 'Tell a joke. If your partner laughs, you score.'],
  ['fun-05', 'spark', 'funny', 0, 2, [], ['party'], 'Pitch a terrible business idea in thirty seconds.'],
  ['fun-06', 'spark', 'funny', 0, 2, [], ['party'], 'Talk in an accent of your partner’s choosing until your next turn.'],
  ['fun-07', 'spark', 'funny', 0, 2, [], ['party'], 'Describe your partner as if they were a new flavour of crisps.'],
  ['fun-08', 'spark', 'funny', 0, 2, [], ['party'], 'Act out your morning routine without words; your partner guesses.'],
  ['fun-09', 'spark', 'funny', 0, 2, [], ['party'], 'Give a dramatic award-acceptance speech for “Best Partner”.'],
  ['fun-10', 'spark', 'funny', 0, 2, [], ['party'], 'Rename every item on the table with a fancy title.'],
  ['fun-11', 'spark', 'funny', 1, 2, [], ['party', 'spicy'], 'Rate your partner’s outfit like a fashion show judge.'],
  ['fun-12', 'spark', 'funny', 0, 2, [], ['party'], 'Rock, paper, scissors: best of three. Loser does a victory dance for the winner.'],
  // ---------- After Hours: Surprise (gameplay effects) ----------
  ['sur-01', 'surprise', 'economy', 0, 2, [], [], 'You found a forgotten gift card. Collect 30 credits.', undefined, { credits: 30 }],
  ['sur-02', 'surprise', 'movement', 0, 2, [], [], 'Take the scenic route. Move forward two spaces.', undefined, { move: 2 }],
  ['sur-03', 'surprise', 'challenge', 0, 2, [], [], 'Both players name three things they appreciate about each other. Gain 2 game points.', undefined, { points: 2 }],
  ['sur-04', 'surprise', 'economy', 0, 2, [], [], 'Collect 25 credits for making your partner laugh. No laugh, no credits.', undefined, { credits: 25 }],
  ['sur-05', 'surprise', 'trade', 0, 2, [], [], 'Swap one un-upgraded property with your partner if both agree; otherwise collect 10 credits.', undefined, { swap: true, credits: 10 }],
  ['sur-06', 'surprise', 'economy', 0, 2, [], [], 'Date-night splurge: pay 20 credits.', undefined, { credits: -20 }],
  ['sur-07', 'surprise', 'movement', 0, 2, [], [], 'Missed the turn-off. Move back three spaces.', undefined, { move: -3 }],
  ['sur-08', 'surprise', 'economy', 0, 2, [], [], 'Your playlist went viral. Collect 40 credits.', undefined, { credits: 40 }],
  ['sur-09', 'surprise', 'challenge', 0, 2, [], [], 'Quick draw: both sketch each other in twenty seconds. Best likeness gains 1 point.', undefined, { points: 1 }],
  ['sur-10', 'surprise', 'economy', 0, 2, [], [], 'Parking fine. Pay 15 credits.', undefined, { credits: -15 }],
  ['sur-11', 'surprise', 'movement', 0, 2, [], [], 'Shortcut through the park. Move forward four spaces.', undefined, { move: 4 }],
  ['sur-12', 'surprise', 'economy', 0, 2, [], [], 'Anniversary bonus. Collect 50 credits.', undefined, { credits: 50 }],
  ['sur-13', 'surprise', 'challenge', 0, 2, [], [], 'Name five of your partner’s favourite foods. Each one right is a point, up to 3.', undefined, { points: 3 }],
  ['sur-14', 'surprise', 'economy', 0, 2, [], [], 'Tickets sold out. Pay 10 credits for the next show.', undefined, { credits: -10 }],
  ['sur-15', 'surprise', 'movement', 0, 2, [], [], 'Wrong bus. Move back one space.', undefined, { move: -1 }],
  ['sur-16', 'surprise', 'challenge', 1, 2, [], [], 'Both share a flirty text you would send right now. Gain 1 point each for sharing.', undefined, { points: 1 }],
  ['sur-17', 'surprise', 'economy', 0, 2, [], [], 'Lucky find in a coat pocket. Collect 15 credits.', undefined, { credits: 15 }],
  ['sur-18', 'surprise', 'economy', 0, 2, [], [], 'Treat your partner: pay 25 credits to them.', undefined, { credits: -25 }],
  ['sur-19', 'surprise', 'movement', 0, 2, [], [], 'Dance your way forward three spaces.', undefined, { move: 3 }],
  ['sur-20', 'surprise', 'challenge', 0, 2, [], [], 'Thumb war, best of three. Winner collects 20 credits.', undefined, { credits: 20 }],
  // ---------- Checkpoint challenges (every tenth resolved card, when scoring) ----------
  ['chk-01', 'checkpoint', 'checkpoint', 0, 2, [], [], 'Quick quiz: each of you asks three questions about yourself. Most right answers gains 3 points.', undefined, { points: 3 }],
  ['chk-02', 'checkpoint', 'checkpoint', 0, 2, [], [], 'Memory game: name the first five places you went together, in order.', undefined, { points: 3 }],
  ['chk-03', 'checkpoint', 'checkpoint', 0, 2, [], [], 'Together, write a four-line poem about tonight, one line each in turns.', undefined, { points: 3 }],
  ['chk-04', 'checkpoint', 'checkpoint', 0, 2, [], [], 'Each of you guesses the other’s favourite film, colour and snack.', undefined, { points: 3 }],
  ['chk-05', 'checkpoint', 'checkpoint', 0, 2, [], [], 'Design a dream holiday together in sixty seconds: where, how, and the first meal.', undefined, { points: 3 }],
  ['chk-06', 'checkpoint', 'checkpoint', 0, 2, [], [], 'Tell the story of how you met in exactly six words each.', undefined, { points: 3 }],
  ['chk-07', 'checkpoint', 'checkpoint', 0, 2, [], [], 'Name your top three couple moments of the past year, together.', undefined, { points: 3 }],
  ['chk-08', 'checkpoint', 'checkpoint', 1, 2, [], [], 'Each say one thing you would love to try together this year.', undefined, { points: 3 }],
  ['chk-09', 'checkpoint', 'checkpoint', 0, 2, [], [], 'Mirror game: copy each other’s movements for thirty seconds without laughing.', undefined, { points: 3 }],
  ['chk-10', 'checkpoint', 'checkpoint', 0, 2, [], [], 'Make up a secret handshake together and perform it twice.', undefined, { points: 3 }],
  ['chk-11', 'checkpoint', 'checkpoint', 0, 2, [], [], 'Each guess how the other would answer: “Beach or mountains?”, “Night in or night out?”, “Sweet or savoury?”', undefined, { points: 3 }],
  ['chk-12', 'checkpoint', 'checkpoint', 0, 2, [], [], 'Plan your next real date together, down to the time and place.', undefined, { points: 3 }],
  // ---------- Safe forfeits (never substances) ----------
  ['for-01', 'forfeit', 'forfeit', 0, 2, [], [], 'Tell a funny story from your week.'],
  ['for-02', 'forfeit', 'forfeit', 0, 2, [], [], 'Surrender 10 in-game credits.', undefined, { credits: -10 }],
  ['for-03', 'forfeit', 'forfeit', 0, 2, [], [], 'Perform a silly impression of your partner’s choosing.'],
  ['for-04', 'forfeit', 'forfeit', 0, 2, [], [], 'Draw another non-intimate card instead.'],
  ['for-05', 'forfeit', 'forfeit', 0, 2, [], [], 'Do five star jumps while saying something nice about your partner.'],
  ['for-06', 'forfeit', 'forfeit', 0, 2, [], [], 'Hum a song; your partner has three guesses to name it.'],
  ['for-07', 'forfeit', 'forfeit', 0, 2, [], [], 'Give your partner a dramatic, sincere thank-you speech for nothing in particular.'],
  ['for-08', 'forfeit', 'forfeit', 0, 2, [], [], 'Let your partner pick the next song.'],
  ['for-09', 'forfeit', 'forfeit', 0, 2, [], [], 'Lose 1 game point.', undefined, { points: -1 }],
  ['for-10', 'forfeit', 'forfeit', 0, 2, [], [], 'Tell your partner a fact they don’t know about you.'],
];

const BANK_PLACES: Record<BankVibe, { category: string; decks: DeckId[] }> = {
  romantic: { category: 'romantic', decks: ['romantic'] },
  playful: { category: 'funny', decks: ['party'] },
  deep: { category: 'deep', decks: ['deep'] },
  flirty: { category: 'flirty', decks: ['spicy'] },
  truth: { category: 'truth', decks: ['truth-or-dare'] },
  dare: { category: 'dare', decks: ['truth-or-dare'] },
};
const BANK_PROMPTS: Prompt[] = (Object.keys(CARD_BANK) as BankVibe[]).flatMap((vibe) =>
  CARD_BANK[vibe].map((c, i) => ({ id: `bank-${vibe}-${i + 1}`, pool: 'spark' as const, category: BANK_PLACES[vibe].category, min: c.min, max: 2 as const, text: c.text, alt: c.alt, tags: c.tags, decks: BANK_PLACES[vibe].decks })),
);

export const PROMPTS: Prompt[] = R.map(([id, pool, category, min, max, tags, decks, text, alt, effect]) => ({ id, pool, category, min, max, tags, decks, text, alt, effect }));
PROMPTS.push(...BANK_PROMPTS);

const byId = new Map(PROMPTS.map((p) => [p.id, p]));
export const promptById = (id: string) => byId.get(id);
