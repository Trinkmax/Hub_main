import { normalizeText } from '@/lib/salon/operativo'

/**
 * Resalta las partes del texto que coinciden con la búsqueda (sin tildes ni
 * mayúsculas), palabra por palabra. Sin animación: es lectura, no feedback.
 */
export function HighlightText({ text, query }: { text: string; query: string }) {
  const words = normalizeText(query)
    .split(/\s+/)
    .filter((w) => w.length > 0)
  if (words.length === 0) return <>{text}</>

  // Trabajamos sobre el texto normalizado para encontrar posiciones, pero
  // pintamos el original: NFD no cambia la longitud de las letras base salvo
  // por las marcas combinadas, así que mapeamos índice a índice.
  const chars = Array.from(text)
  const norm = chars.map((c) => normalizeText(c) || c)
  const flags = new Array<boolean>(chars.length).fill(false)
  const joined = norm.join('')
  // Cada `norm[i]` es un carácter (las tildes se descartan), así que el índice
  // en `joined` coincide con el índice en `chars`.
  for (const w of words) {
    let from = 0
    while (from <= joined.length - w.length) {
      const idx = joined.indexOf(w, from)
      if (idx === -1) break
      for (let i = idx; i < idx + w.length; i++) flags[i] = true
      from = idx + w.length
    }
  }
  if (!flags.some(Boolean)) return <>{text}</>

  const out: Array<{ mark: boolean; text: string }> = []
  chars.forEach((c, i) => {
    const last = out[out.length - 1]
    if (last && last.mark === flags[i]) last.text += c
    else out.push({ mark: Boolean(flags[i]), text: c })
  })
  return (
    <>
      {out.map((part, i) =>
        part.mark ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segmentos derivados, sin identidad propia
          <mark key={i} className="rounded-sm bg-warning/35 text-inherit">
            {part.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: idem
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}
