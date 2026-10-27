/**
 * What a sound-effect generator may be asked for (LIBRARIES.md §5.3, DEPLOY
 * S5.5): a plain description of a sound, a length set every time, a prompt
 * influence that repeats well, and nothing that names somebody else's work
 * (a brand, an artist, a film or a game), whose output would not be ours to
 * use. The generator is for cues the recorded kit lacks; the kit comes
 * first. Pure.
 */

export const SFX_GENERATION_SECONDS = [0.5, 30] as const;
export const DEFAULT_PROMPT_INFLUENCE = 0.7;

/**
 * Names that make a prompt ask for someone else's sound. Not a complete
 * list: the provider refuses more, and the receipt says so; this catches
 * the common ones before anything is paid for.
 */
const PROTECTED = [
  "star wars", "lightsaber", "jedi", "marvel", "avengers", "batman", "superman", "pixar", "disney", "netflix", "hbo", "thx", "imax", "dolby",
  "harry potter", "pokemon", "pikachu", "mario", "zelda", "nintendo", "playstation", "xbox", "minecraft", "fortnite", "call of duty", "sonic the hedgehog",
  "iphone", "macos", "windows xp", "microsoft", "skype", "whatsapp", "tiktok", "instagram", "facebook", "youtube", "snapchat", "twitter",
  "coca cola", "pepsi", "mcdonalds", "intel inside", "nokia", "samsung", "law and order", "inception", "transformers", "james bond", "007", "jurassic park", "terminator",
  "hans zimmer", "john williams", "daft punk", "skrillex", "beyonce", "taylor swift", "drake",
];
const STYLE_OF = /\b(in the style of|sounds? like (?:the )?[A-Z]|as heard in|from the (?:movie|film|game|show))\b/;

export interface SfxGenerationArgs {
  prompt: string;
  seconds: number;
  promptInfluence?: number;
}

/** Why a generation request is refused (an `Error:` line), or undefined. */
export function sfxGenerationRefusal(args: SfxGenerationArgs): string | undefined {
  const prompt = args.prompt.trim();
  if (prompt.length < 3) return "Error: describe the sound in a few words (e.g. 'deep cinematic boom with a long tail').";
  if (prompt.length > 450) return "Error: the prompt is too long: describe one sound in at most 450 characters.";
  const [min, max] = SFX_GENERATION_SECONDS;
  if (!(args.seconds >= min && args.seconds <= max)) return `Error: duration_seconds must be ${min}..${max} s.`;
  if (args.promptInfluence !== undefined && !(args.promptInfluence >= 0 && args.promptInfluence <= 1)) return "Error: prompt_influence must be 0..1.";
  const lower = ` ${prompt.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const named = PROTECTED.find((name) => lower.includes(` ${name} `));
  if (named) return `Error: the prompt names '${named}': a generated sound must not imitate a brand, artist, film or game. Describe the sound itself (its material, motion, pitch, length).`;
  if (STYLE_OF.test(prompt)) return "Error: describe the sound itself, not what it should sound like from somewhere else (no 'in the style of', 'as heard in').";
  return undefined;
}

/** The canonical request a cache key is made from: equal requests, equal keys. */
export function sfxGenerationKeyText(provider: string, model: string, format: string, args: { prompt: string; durationSeconds: number; promptInfluence: number; loop: boolean }): string {
  return JSON.stringify([provider, model, format, args.prompt.trim().replace(/\s+/g, " "), Math.round(args.durationSeconds * 100) / 100, Math.round(args.promptInfluence * 100) / 100, args.loop]);
}
