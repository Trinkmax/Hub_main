import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * La ventana del navegador de las maquetas: tres puntos y la barra de dirección. Ocupa todo
 * el lienzo (alto fijo del dibujo) y el contenido va abajo, recortado.
 */
export function BrowserFrame({
  url = 'arca.gob.ar',
  children,
  className,
}: {
  url?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('flex h-full flex-col bg-white text-[#111]', className)}
      style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
    >
      <div className="flex h-[26px] shrink-0 items-center gap-2 border-b border-[#d6dae0] bg-[#eceff3] px-3">
        <span className="flex gap-[5px]">
          <span className="size-[9px] rounded-full bg-[#ff5f57]" />
          <span className="size-[9px] rounded-full bg-[#febc2e]" />
          <span className="size-[9px] rounded-full bg-[#28c840]" />
        </span>
        <span className="ml-2 flex h-[17px] min-w-0 flex-1 items-center gap-1 rounded-full bg-white px-3 text-[10px] text-[#5f6b7a] ring-1 ring-[#d6dae0]">
          <Lock className="size-[9px] shrink-0" aria-hidden />
          <span className="truncate">{url}</span>
        </span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
