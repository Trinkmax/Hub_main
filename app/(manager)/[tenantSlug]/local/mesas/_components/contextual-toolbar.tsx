'use client'

import {
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  QrCode,
  RotateCw,
  Trash2,
} from 'lucide-react'
import type { AlignKind } from '@/lib/floor-plan/snap'
import { cn } from '@/lib/utils'

export type ContextualToolbarProps = {
  count: number
  /** El único elemento es una mesa con QR (muestra acción QR + duplicar). */
  singleTable: boolean
  onRotate90: () => void
  onBringFront: () => void
  onBringBack: () => void
  onDuplicate: () => void
  onQr: () => void
  onAlign: (kind: AlignKind) => void
  onDelete: () => void
}

function ToolBtn({
  onClick,
  label,
  children,
  danger,
}: {
  onClick: () => void
  label: string
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        danger && 'hover:bg-destructive/10 hover:text-destructive',
      )}
    >
      {children}
    </button>
  )
}

const Sep = () => <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />

/**
 * Barra flotante de acciones sobre la selección (centrada arriba del lienzo).
 * 1 elemento → rotar/orden/duplicar/QR/eliminar. >1 → alinear + eliminar.
 */
export function ContextualToolbar({
  count,
  singleTable,
  onRotate90,
  onBringFront,
  onBringBack,
  onDuplicate,
  onQr,
  onAlign,
  onDelete,
}: ContextualToolbarProps) {
  if (count === 0) return null
  const multi = count > 1

  return (
    <div className="-translate-x-1/2 absolute top-3 left-1/2 z-40 flex items-center gap-0.5 rounded-xl border border-border/60 bg-popover/95 p-1 shadow-lg backdrop-blur-sm">
      {multi ? (
        <>
          <span className="px-2 text-xs font-medium text-muted-foreground tabular-nums">
            {count} sel.
          </span>
          <Sep />
          <ToolBtn onClick={() => onAlign('left')} label="Alinear izquierda">
            <span className="text-sm font-semibold">⇤</span>
          </ToolBtn>
          <ToolBtn onClick={() => onAlign('hcenter')} label="Centrar horizontal">
            <AlignHorizontalJustifyCenter className="size-4" aria-hidden />
          </ToolBtn>
          <ToolBtn onClick={() => onAlign('right')} label="Alinear derecha">
            <span className="text-sm font-semibold">⇥</span>
          </ToolBtn>
          <Sep />
          <ToolBtn onClick={() => onAlign('top')} label="Alinear arriba">
            <span className="text-sm font-semibold">⤒</span>
          </ToolBtn>
          <ToolBtn onClick={() => onAlign('vcenter')} label="Centrar vertical">
            <AlignVerticalJustifyCenter className="size-4" aria-hidden />
          </ToolBtn>
          <ToolBtn onClick={() => onAlign('bottom')} label="Alinear abajo">
            <span className="text-sm font-semibold">⤓</span>
          </ToolBtn>
        </>
      ) : (
        <>
          <ToolBtn onClick={onRotate90} label="Rotar 90°">
            <RotateCw className="size-4" aria-hidden />
          </ToolBtn>
          <ToolBtn onClick={onDuplicate} label="Duplicar (⌘D)">
            <Copy className="size-4" aria-hidden />
          </ToolBtn>
          {singleTable ? (
            <ToolBtn onClick={onQr} label="Imprimir QR">
              <QrCode className="size-4" aria-hidden />
            </ToolBtn>
          ) : null}
          <Sep />
          <ToolBtn onClick={onBringFront} label="Traer al frente">
            <ArrowUpToLine className="size-4" aria-hidden />
          </ToolBtn>
          <ToolBtn onClick={onBringBack} label="Enviar al fondo">
            <ArrowDownToLine className="size-4" aria-hidden />
          </ToolBtn>
        </>
      )}
      <Sep />
      <ToolBtn onClick={onDelete} label={multi ? 'Eliminar seleccionados' : 'Eliminar'} danger>
        <Trash2 className="size-4" aria-hidden />
      </ToolBtn>
    </div>
  )
}
