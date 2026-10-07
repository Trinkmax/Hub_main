'use client'

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  QrCode,
  RotateCw,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AlignKind } from '@/lib/floor-plan/snap'

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

/** Botón de ícono de la barra: el tooltip nombra el ícono; el lector lo lee del `aria-label`. */
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
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant={danger ? 'danger-ghost' : 'ghost'}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

const Sep = () => <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />

/**
 * Barra flotante de acciones sobre la selección (centrada arriba del lienzo).
 * 1 elemento → rotar/orden/duplicar/QR/quitar. >1 → alinear + quitar.
 *
 * Flota (popover + `shadow-float`, sin vidrio). Los íconos de alinear son los
 * de lucide: Inter no tiene las flechas ⇤ ⇥ ⤒ ⤓ que se usaban antes.
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
    <fieldset
      aria-label={multi ? `Acciones para ${count} elementos` : 'Acciones del elemento'}
      className="-translate-x-1/2 absolute top-3 left-1/2 z-40 flex max-w-[calc(100%-1.5rem)] items-center gap-0.5 overflow-x-auto rounded-xl border border-border bg-popover p-1 shadow-float pointer-coarse:gap-2"
    >
      {multi ? (
        <>
          <span className="shrink-0 whitespace-nowrap px-2 type-caption font-medium text-muted-foreground tabular-nums">
            {count} elegidos
          </span>
          <Sep />
          <ToolBtn onClick={() => onAlign('left')} label="Alinear a la izquierda">
            <AlignStartVertical aria-hidden />
          </ToolBtn>
          <ToolBtn onClick={() => onAlign('hcenter')} label="Centrar en horizontal">
            <AlignCenterVertical aria-hidden />
          </ToolBtn>
          <ToolBtn onClick={() => onAlign('right')} label="Alinear a la derecha">
            <AlignEndVertical aria-hidden />
          </ToolBtn>
          <Sep />
          <ToolBtn onClick={() => onAlign('top')} label="Alinear arriba">
            <AlignStartHorizontal aria-hidden />
          </ToolBtn>
          <ToolBtn onClick={() => onAlign('vcenter')} label="Centrar en vertical">
            <AlignCenterHorizontal aria-hidden />
          </ToolBtn>
          <ToolBtn onClick={() => onAlign('bottom')} label="Alinear abajo">
            <AlignEndHorizontal aria-hidden />
          </ToolBtn>
        </>
      ) : (
        <>
          <ToolBtn onClick={onRotate90} label="Rotar 90°">
            <RotateCw aria-hidden />
          </ToolBtn>
          <ToolBtn onClick={onDuplicate} label="Duplicar">
            <Copy aria-hidden />
          </ToolBtn>
          {singleTable ? (
            <ToolBtn onClick={onQr} label="Imprimir QR">
              <QrCode aria-hidden />
            </ToolBtn>
          ) : null}
          <Sep />
          <ToolBtn onClick={onBringFront} label="Traer al frente">
            <ArrowUpToLine aria-hidden />
          </ToolBtn>
          <ToolBtn onClick={onBringBack} label="Enviar al fondo">
            <ArrowDownToLine aria-hidden />
          </ToolBtn>
        </>
      )}
      <Sep />
      <ToolBtn onClick={onDelete} label={multi ? 'Quitar los elegidos' : 'Quitar'} danger>
        <Trash2 aria-hidden />
      </ToolBtn>
    </fieldset>
  )
}
