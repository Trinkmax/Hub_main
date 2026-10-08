import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * La ventana gris del ABM de puntos de venta (PV-05): barra de título gris azulada con letras
 * blancas, la cruz para cerrar y el «?» rojo arriba a la derecha.
 */
export function ArcaModal({
  title,
  children,
  footer,
  className,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-[6px] bg-[#f4f4f4] shadow-[0_8px_28px_rgba(0,0,0,0.45)]',
        className,
      )}
      style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
    >
      <div className="flex h-[30px] shrink-0 items-center justify-between bg-gradient-to-b from-[#909ba8] to-[#6b7684] px-3 text-[13px] font-bold text-white">
        <span>{title}</span>
        <X className="size-4" strokeWidth={3} aria-hidden />
      </div>
      <div className="relative flex-1 px-4 pb-2 pt-5">
        <span className="absolute right-4 top-1 text-[15px] font-bold text-[#d11]">?</span>
        {children}
      </div>
      {footer ? (
        <div className="flex shrink-0 justify-end gap-2 border-t border-[#e2e2e2] bg-white px-4 py-2.5">
          {footer}
        </div>
      ) : null}
    </div>
  )
}

/** El fondo cuadriculado gris de las grillas viejas (atrás de la ventana). */
export function GridBackdrop({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('relative h-full bg-[#dcdcdc]', className)}
      style={{
        backgroundImage:
          'linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)',
        backgroundSize: '4px 4px',
        fontFamily: 'Arial, Helvetica, sans-serif',
      }}
    >
      {children}
    </div>
  )
}
