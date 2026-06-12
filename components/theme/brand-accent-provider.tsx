import type { CSSProperties } from 'react'

/** Contraste accesible (YIQ) para el texto sobre el acento. */
function contrastText(hex: string): string {
  const h = hex.replace('#', '')
  const r = Number.parseInt(h.slice(0, 2), 16)
  const g = Number.parseInt(h.slice(2, 4), 16)
  const b = Number.parseInt(h.slice(4, 6), 16)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 140 ? '#0a0a0a' : '#ffffff'
}

/**
 * Inyecta el acento de marca del bar como CSS custom properties en un subtree
 * público (carta / wallet / reseña). NO toca el theme global light/dark: sólo
 * setea `--brand-accent` y `--brand-accent-foreground` en este contenedor.
 * Si el bar no configuró acento, no setea nada y los hijos usan `--primary`.
 */
export function BrandAccent({
  accent,
  children,
  className,
}: {
  accent: string | null | undefined
  children: React.ReactNode
  className?: string
}) {
  const style: CSSProperties | undefined =
    accent && /^#[0-9a-fA-F]{6}$/.test(accent)
      ? ({
          '--brand-accent': accent,
          '--brand-accent-foreground': contrastText(accent),
        } as CSSProperties)
      : undefined

  return (
    <div style={style} className={className}>
      {children}
    </div>
  )
}
