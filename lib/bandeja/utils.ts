/**
 * Build the href for paginating the conversation list while preserving
 * the active filters (?c and ?tag) and bumping the page size (?n).
 */
export function buildListHref(
  tenantSlug: string,
  opts: { n: number; c?: string | null; tag?: string | null },
): string {
  const params = new URLSearchParams()
  if (opts.c) params.set('c', opts.c)
  if (opts.tag) params.set('tag', opts.tag)
  params.set('n', String(opts.n))
  return `/${tenantSlug}/mensajeria/inbox?${params.toString()}`
}
