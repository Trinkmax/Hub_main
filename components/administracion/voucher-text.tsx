/** «0003-00001234», «30-71234567-8»: números con guiones. */
const DASHED_NUMBER = /\d+(?:-\d+)+/g

export type VoucherTextPart = { text: string; keep: boolean; start: number }

/**
 * Parte un texto en tramos para que los números con guion (punto de venta y
 * número de un comprobante, un CUIT) no se corten en el guion al final de una
 * línea («Factura A 0003-» / «00001234»). El resto del texto parte normal. Puro.
 */
export function splitVoucherText(text: string): VoucherTextPart[] {
  const parts: VoucherTextPart[] = []
  let last = 0
  for (const match of text.matchAll(DASHED_NUMBER)) {
    const start = match.index ?? 0
    if (start > last) parts.push({ text: text.slice(last, start), keep: false, start: last })
    parts.push({ text: match[0], keep: true, start })
    last = start + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), keep: false, start: last })
  return parts
}

/**
 * Un texto con comprobantes o CUITs adentro, con esos números enteros: si no
 * entra en la línea, baja el número completo. Server-safe.
 */
export function VoucherText({ text }: { text: string }) {
  const parts = splitVoucherText(text)
  if (!parts.some((part) => part.keep)) return text
  return parts.map((part) =>
    part.keep ? (
      <span key={part.start} className="whitespace-nowrap">
        {part.text}
      </span>
    ) : (
      part.text
    ),
  )
}
