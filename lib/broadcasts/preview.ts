export function renderTemplateBodyPreview(components: unknown, values: string[]): string {
  if (!Array.isArray(components)) return ''
  const body = components.find(
    (c) =>
      typeof c === 'object' &&
      c !== null &&
      String((c as { type?: string }).type).toUpperCase() === 'BODY',
  ) as { text?: string } | undefined
  let text = body?.text ?? ''
  text = text.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, n) => {
    const idx = Number(n) - 1
    return values[idx] !== undefined && values[idx] !== '' ? values[idx] : match
  })
  return text
}
