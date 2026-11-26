// Helpers compartidos por la carta pública (read-only). Sin imports server-only:
// todo esto corre en el cliente.

/** Formatea centavos a ARS sin decimales: 1500_00 → "$1.500". */
export function formatARS(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}

/**
 * Decide si sobre un color hex `#RRGGBB` conviene texto claro u oscuro,
 * usando luminancia YIQ. Para colores no-hex asume texto claro (más seguro
 * sobre tintes saturados). Se usa para que los chips de tag tengan contraste AA.
 */
export function pickContrastText(bgHex: string): 'light' | 'dark' {
  if (!bgHex.startsWith('#') || bgHex.length !== 7) return 'light'
  const r = Number.parseInt(bgHex.slice(1, 3), 16)
  const g = Number.parseInt(bgHex.slice(3, 5), 16)
  const b = Number.parseInt(bgHex.slice(5, 7), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 'light'
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 150 ? 'dark' : 'light'
}

/** Iniciales de un nombre para el monograma de fallback (máx. 2 letras). */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '·'
  if (words.length === 1) return (words[0]?.slice(0, 2) ?? '·').toUpperCase()
  return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase()
}
