/**
 * Turn a written script into text a narrator can read.
 *
 * Every TTS engine reads symbols and abbreviations differently, and most of
 * them read them badly: `%` becomes "percent sign", `km/h` becomes "k m slash
 * h", an em dash becomes a pause or the word "dash", and a 40-word sentence
 * comes out as one exhausted breath. The fix belongs before the engine, not
 * inside it, so this runs for every provider: ElevenLabs, Inworld, Kokoro,
 * Piper, Gemini, OpenAI.
 *
 * The rules are deliberately conservative. Years, decimals and proper nouns
 * are left alone because every modern engine says them correctly, and a
 * rewrite that mangles a car name is worse than one that leaves a symbol.
 */

const UNIT_RULES: Array<[RegExp, string]> = [
  [/\bkm\s*\/\s*h\b/gi, "kilometres per hour"],
  [/\bkph\b/gi, "kilometres per hour"],
  [/\bmph\b/gi, "miles per hour"],
  [/\bbhp\b/gi, "brake horsepower"],
  [/\bhp\b/gi, "horsepower"],
  [/\bcc\b/gi, "cubic centimetres"],
  [/\bkg\b/gi, "kilograms"],
  [/\blbs\b/gi, "pounds"],
  [/\blb\b/gi, "pounds"],
  [/\bmm\b/gi, "millimetres"],
  [/\bcm\b/gi, "centimetres"],
  [/\bkm\b/gi, "kilometres"],
  [/\bft\b/gi, "feet"],
];

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\be\.g\./gi, "for example"],
  [/\bi\.e\./gi, "that is"],
  [/\bvs\.?(?=\s|$)/gi, "versus"],
  [/\betc\./gi, "and so on"],
  [/\bapprox\./gi, "approximately"],
  [/\bNo\.\s*(?=\d)/g, "number "],
];

/**
 * Adverbs that add emphasis and no information.
 *
 * A model writes them to sound emphatic and they are the clearest tell of a
 * machine: "he firmly set out", "a truly legendary rivalry". The sentence is
 * stronger without them, and the narrator has less to chew through.
 */
const FILLER_ADVERBS = new Set([
  "truly",
  "firmly",
  "really",
  "very",
  "completely",
  "absolutely",
  "actually",
  "simply",
  "suddenly",
  "ultimately",
  "essentially",
  "literally",
  "basically",
  "extremely",
  "incredibly",
  "remarkably",
]);

/** How many words a sentence may run before it is broken at a comma. */
export const MAX_SENTENCE_WORDS = 28;

/**
 * Delete the adverbs that carry no meaning.
 *
 * The word is kept after "not" or "never", because removing it there changes
 * what the sentence says ("not very fast" is not "not fast"). A line too short
 * to spare a word is left alone.
 */
export function cutFiller(input: string): string {
  const words = input.split(/\s+/).filter(Boolean);
  if (words.length < 4) return input;

  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const bare = word.toLowerCase().replace(/[^a-z']/g, "");
    const previous = kept[kept.length - 1]?.toLowerCase().replace(/[^a-z']/g, "");
    const isLast = i === words.length - 1;
    const protectedByNegation = previous === "not" || previous === "never";

    if (FILLER_ADVERBS.has(bare) && !isLast && !protectedByNegation) continue;
    kept.push(word);
  }

  return kept.join(" ");
}

/**
 * Join scene lines into one narration script without losing the sentence
 * boundaries between them. A line that does not end in punctuation would
 * otherwise run into the next scene's line as one long breath.
 */
export function joinScriptLines(lines: readonly string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/[.!?]$/.test(line) ? line : `${line}.`))
    .join(" ");
}

/** Normalize a script for a narrator. */
export function normalizeNarration(input: string): string {
  if (!input.trim()) return "";

  let text = cutFiller(input);

  // Quotes and dashes: a dash is a pause, not a word.
  text = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  text = text.replace(/\s*[—–]\s*/g, ", ");
  text = text.replace(/\s+--+\s+/g, ", ");
  text = text.replace(/…/g, ", ").replace(/\.\.\./g, ", ");

  // Symbols first, because several of these rules depend on the digits.
  text = text.replace(/(\d)\s*%/g, "$1 percent");
  text = text.replace(/%/g, " percent");
  text = text.replace(/(?:US)?\$\s?(\d[\d,.]*)/g, "$1 dollars");
  text = text.replace(/£\s?(\d[\d,.]*)/g, "$1 pounds");
  text = text.replace(/€\s?(\d[\d,.]*)/g, "$1 euros");
  text = text.replace(/(\d)\s*[×x]\s*(\d)/gi, "$1 by $2");
  text = text.replace(/\s*×\s*/g, " by ");
  text = text.replace(/°\s*C\b/g, " degrees Celsius");
  text = text.replace(/°\s*F\b/g, " degrees Fahrenheit");
  text = text.replace(/°/g, " degrees");

  // `and/or` is a phrase; other slashes are left to the engine.
  text = text.replace(/\band\s*\/\s*or\b/gi, "and or");

  for (const [pattern, replacement] of ABBREVIATIONS) text = text.replace(pattern, replacement);
  for (const [pattern, replacement] of UNIT_RULES) text = text.replace(pattern, replacement);

  // Parentheses are a stage whisper; a comma is a pause.
  text = text.replace(/[()]/g, ", ");
  text = text.replace(/&/g, " and ");

  // Tidy the punctuation the rules above can leave behind.
  text = text.replace(/,\s*,/g, ",");
  text = text.replace(/\s+([,.;:!?])/g, "$1");
  text = text.replace(/,\s*([.!?])/g, "$1");
  text = text.replace(/^[\s,;:]+/, "");
  text = text.replace(/\s+/g, " ").trim();

  // A narrator needs a full stop to land on.
  if (!/[.!?]$/.test(text)) text = `${text}.`;

  return splitLongSentences(text);
}

/**
 * Break sentences that are too long to say in one breath.
 *
 * The split lands on a comma or semicolon near the limit, so the pause is one
 * the writer already asked for rather than an arbitrary word boundary.
 */
export function splitLongSentences(text: string, maxWords = MAX_SENTENCE_WORDS): string {
  // A boundary is punctuation followed by whitespace, so a decimal point
  // ("4.5") and an initialism ("U.S.") are not mistaken for a full stop.
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences
    .map((sentence) => splitOne(sentence.trim(), maxWords))
    .filter(Boolean)
    .join(" ");
}

function splitOne(sentence: string, maxWords: number): string {
  const words = sentence.split(" ").filter(Boolean);
  if (words.length <= maxWords) return sentence;

  const pieces: string[] = [];
  let start = 0;

  while (words.length - start > maxWords) {
    const limit = start + maxWords;
    let cut = -1;
    // Prefer the last natural pause in the second half of the window.
    for (let i = limit; i > start + Math.floor(maxWords / 2); i--) {
      if (/[,;:]$/.test(words[i] ?? "")) {
        cut = i;
        break;
      }
    }
    if (cut === -1) cut = limit - 1;
    pieces.push(words.slice(start, cut + 1).join(" "));
    start = cut + 1;
  }
  pieces.push(words.slice(start).join(" "));

  return pieces
    .map((piece, index) => {
      const text = piece.trim();
      if (!text) return "";
      // A cut on a plain word would run into the next chunk; a comma is the
      // pause the split was for.
      const paused =
        index === pieces.length - 1 || /[,;:.!?]$/.test(text) ? text : `${text},`;
      return index === 0 ? paused : capitalize(paused);
    })
    .filter(Boolean)
    .join(" ");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
