import { cn } from '@/lib/utils'

/**
 * Paleta de avatares estilo WhatsApp: color estable por contacto
 * (hash del nombre/teléfono). Funciona en light y dark.
 */
const AVATAR_COLORS = [
  'oklch(0.62 0.11 25)', // terracota
  'oklch(0.6 0.1 165)', // verde
  'oklch(0.6 0.1 250)', // azul
  'oklch(0.62 0.12 310)', // violeta
  'oklch(0.65 0.12 65)', // ámbar
  'oklch(0.6 0.11 200)', // cian
  'oklch(0.62 0.12 350)', // rosa
  'oklch(0.58 0.09 130)', // oliva
] as const

function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export function avatarColorFor(seed: string): string {
  return AVATAR_COLORS[hashString(seed) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]
}

export function WaAvatar({
  seed,
  label,
  className,
  textClassName,
}: {
  /** Clave estable del contacto (nombre o teléfono). */
  seed: string
  /** Texto a mostrar (normalmente la inicial). */
  label: string
  className?: string
  textClassName?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        className,
      )}
      style={{ backgroundColor: avatarColorFor(seed) }}
    >
      <span className={textClassName}>{label}</span>
    </span>
  )
}
