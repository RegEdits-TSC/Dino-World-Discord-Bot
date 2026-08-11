/**
 * Neuter Discord's masked-link syntax in player-supplied free text.
 *
 * An embed DESCRIPTION renders `[text](url)` as a clickable link whose visible text is
 * arbitrary, so a park motto's 80 characters are ample for `[Free Nitro](https://evil.tld)`
 * — and a dino nickname reaches public battle embeds the same way. Mention injection is
 * already dead (`src/index.ts` sets `allowedMentions: { parse: [] }` client-wide) but
 * markdown never was.
 *
 * Defang rather than reject: splitting the `](` sequence breaks the link construct and
 * leaves every character the player typed visible, so ordinary text carrying a lone `[`,
 * a lone `(`, or plain parentheses is returned untouched.
 *
 * Call it AFTER trimming and BEFORE the length check at every call site: defanging only
 * ever lengthens a string, so a guard that ran first would no longer govern what is
 * actually stored.
 */
export function defangLinks(text: string): string {
  return text.replaceAll('](', '] (');
}
