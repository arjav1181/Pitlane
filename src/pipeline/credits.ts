import type { Attribution } from "../schema/providers.js";

/**
 * How much of a description the credit line may take.
 *
 * YouTube allows 5000 characters. The credits are the least interesting part
 * of a description, so they get a generous but bounded slice and never push
 * the source or the hashtags out.
 */
const MAX_CREDIT_LINE = 900;

/**
 * Turn the licence records into one line a description can carry.
 *
 * A CC BY or CC BY-SA work asks for four things: the title, the author, the
 * licence and a link to the source. Commons files are routinely attributed as
 * "Photo: Wikimedia" and that satisfies nobody, so the line names the work
 * and the person and links the file page where the licence is stated.
 *
 * The same file can be used in two scenes; it is credited once.
 */
export function formatCreditLine(credits: Attribution[] | null | undefined): string {
  if (!credits?.length) return "";

  const seen = new Set<string>();
  const parts: string[] = [];

  for (const credit of credits) {
    const sourceUrl = (credit.sourceUrl ?? "").trim();
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);

    const author = (credit.author ?? "").trim() || "Unknown author";
    const license = (credit.license ?? "").trim() || "see source";
    const title = (credit.label ?? "").trim();
    const work = title ? `"${title}"` : "Footage";
    parts.push(`${work}, ${author} (${license}) ${sourceUrl}`);
  }

  if (!parts.length) return "";

  const line = `Credits: ${parts.join(" · ")}`;
  if (line.length <= MAX_CREDIT_LINE) return line;
  return `${line.slice(0, MAX_CREDIT_LINE - 1).trimEnd()}…`;
}

/**
 * The credit a viewer can read on the frame itself.
 *
 * The description carries the full record (work, author, licence, file page),
 * but a viewer who never opens the description has still seen a free-licensed
 * photograph. The chip stays short enough to read at phone size: author,
 * library and licence, with "Photo:" naming what is being credited. Public
 * domain files keep their credit too, because a visible credit costs nothing
 * and a missing one is the thing that causes trouble.
 */
export function formatOnScreenCredit(
  credit: Attribution | null | undefined,
  kind: "photo" | "video" = "photo",
): string {
  if (!credit) return "";
  const label = kind === "video" ? "Footage:" : "Photo:";
  const author = (credit.author ?? "").trim();
  const license = (credit.license ?? "").trim();
  const sourceUrl = credit.sourceUrl ?? "";
  const library = sourceUrl.includes("commons.wikimedia.org")
    ? "Wikimedia Commons"
    : sourceUrl.includes("pexels.com")
      ? "Pexels"
      : sourceUrl.includes("pixabay.com")
        ? "Pixabay"
        : "";

  const named = author && author.toLowerCase() !== "unknown author" ? author : "";
  const shortened = named.length > 42 ? `${named.slice(0, 41).trimEnd()}…` : named;
  const who = [shortened, library].filter(Boolean).join(" / ");

  const base = `${label} ${who || "Wikimedia Commons"}`;
  // "Pexels License" beside "/ Pexels" says the same thing twice. The exact
  // licence and its URL stay in the description.
  const redundant = library.length > 0 && license.toLowerCase().startsWith(library.toLowerCase());
  return license && !redundant ? `${base} · ${license}` : base;
}
