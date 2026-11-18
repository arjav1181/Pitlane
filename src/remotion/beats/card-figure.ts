/**
 * A number a card can draw, taken from the line the narrator speaks.
 *
 * A fact card is the fallback when no stock shot shows the real thing, and a
 * plain headline on a plain background is the thing that makes a fallback look
 * like a placeholder. The year is the one figure automotive history almost
 * always has, and it carries a diagram for free: a timeline with the year on
 * it says more than the words alone, and it cannot be wrong the way an invented
 * chart can.
 *
 * Scripts spell numbers the way they are spoken ("nineteen sixty-nine"), so the
 * parser reads both spoken years and four-digit years.
 */

export interface CardFigure {
  kind: "year";
  /** The year as a plain number, for drawing and for tests. */
  year: number;
  /** Three-letter label shown above the timeline. */
  label: string;
  /** Where the year sits on the drawn range, 0 to 1. */
  position: number;
}

const YEAR_START = 1880;
const YEAR_END = 2030;

const ONES: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const CENTURIES: Record<string, number> = {
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

/** The last two digits of a spoken year: "sixty-nine", "hundred", "oh five". */
function spokenTail(tail: string): number | null {
  const clean = tail.trim().replace(/-/g, " ");
  if (!clean) return null;
  if (clean === "hundred") return 0;
  const oh = /^oh\s+(one|two|three|four|five|six|seven|eight|nine)$/.exec(clean);
  if (oh) return ONES[oh[1]!]!;
  const [tensWord, onesWord] = clean.split(/\s+/);
  if (tensWord && onesWord && TENS[tensWord] != null && ONES[onesWord] != null) {
    return TENS[tensWord]! + ONES[onesWord]!;
  }
  if (tensWord && TENS[tensWord] != null) return TENS[tensWord]!;
  return null;
}

/** Read the first year in a line, whether written as words or as four digits. */
export function cardFigure(scriptLine: string): CardFigure | null {
  const text = (scriptLine ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const digits = /\b(1[89]\d{2}|20\d{2})\b/.exec(text);
  if (digits) {
    const year = Number(digits[1]);
    return figureFor(year);
  }

  const spoken =
    /\b(eighteen|nineteen|twenty)[\s-]+(hundred|oh[\s-]+(?:one|two|three|four|five|six|seven|eight|nine)|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-]+(?:one|two|three|four|five|six|seven|eight|nine))?)/i.exec(
      text,
    );
  if (!spoken) return null;

  const century = CENTURIES[spoken[1]!.toLowerCase()];
  const tail = spokenTail(spoken[2]!);
  if (century == null || tail == null) return null;
  return figureFor(century * 100 + tail);
}

function figureFor(year: number): CardFigure | null {
  if (!Number.isFinite(year)) return null;
  const span = YEAR_END - YEAR_START;
  const position = Math.min(0.97, Math.max(0.03, (year - YEAR_START) / span));
  return { kind: "year", year, label: "THE YEAR", position };
}
