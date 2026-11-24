/** A reply from Help (Ask, or a playbook card), as it goes into the composer. */

/** The names a reply leaves open, filled in when we know them. */
export function fillNames(text: string, { first, rep }: { first?: string | null; rep?: string | null }) {
  return text
    .replace(/\[First name\]/gi, first || '[First name]')
    .replace(/\[Your name\]/gi, rep || '[Your name]')
}

/** Only the middle: the composer already has its own greeting and sign-off. */
export function bodyOnly(text: string) {
  return text
    .replace(/^\s*(Hey|Hi)\b[^\n]{0,60},[ \t]*\n+/i, '')
    .replace(/\n+Thanks,?[ \t]*\n[^\n]*\s*$/i, '')
    .trim()
}
