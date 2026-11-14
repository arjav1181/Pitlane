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
