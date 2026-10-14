import type { UiImportSource } from '@/lib/imports/ui/labels'
import { cn } from '@/lib/utils'

/**
 * El dibujo de cada origen: una hoja con sello (ARCA), un celular con un QR
 * (Mercado Pago) y un banco con columnas. Son dibujos de trazo, con el color
 * del texto, y a propósito NO son los logos de ninguna marca: dicen «qué clase
 * de papel es», que es lo que el dueño reconoce. Decorativo (el nombre va
 * escrito al lado). Server-safe.
 */
export function SourceMark({
  source,
  className,
}: {
  source: UiImportSource
  /** El tamaño y el color (por defecto 40 px, verde de la marca). */
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('size-10 shrink-0 text-primary', className)}
    >
      {source === 'arca_recibidos' ? (
        <>
          {/* La hoja, con la esquina doblada. */}
          <path d="M9 5h14l8 8v22H9z" />
          <path d="M23 5v8h8" />
          <path d="M13.5 17h8M13.5 21.5h5" />
          {/* El sello. */}
          <circle cx="24" cy="27" r="5.5" />
          <path d="m21.6 27 1.7 1.8 3.3-3.6" />
        </>
      ) : source === 'mp_release' ? (
        <>
          {/* El celular. */}
          <rect x="11" y="4" width="18" height="32" rx="3.5" />
          <path d="M18 7.5h4" />
          {/* El QR. */}
          <rect x="15" y="13" width="4.5" height="4.5" rx="0.8" />
          <rect x="20.5" y="13" width="4.5" height="4.5" rx="0.8" />
          <rect x="15" y="18.5" width="4.5" height="4.5" rx="0.8" />
          <path d="M21 19.5h1.5M24.5 19.5v2M21 22.5h3.5" />
          <path d="M16 29.5h8" />
        </>
      ) : (
        <>
          {/* El frente del banco: frontón, columnas y escalón. */}
          <path d="M5 15 20 6l15 9z" />
          <path d="M9 19v10M16.5 19v10M23.5 19v10M31 19v10" />
          <path d="M6 33h28M8 29h24" />
        </>
      )}
    </svg>
  )
}
