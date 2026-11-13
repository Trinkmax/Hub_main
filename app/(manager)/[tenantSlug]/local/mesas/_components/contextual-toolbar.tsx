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
import type { AlignKind } from '@/lib/floor-plan/snap'
import { cn } from '@/lib/utils'

export type ContextualToolbarProps = {
  count: number
  /** Cómo se llama lo elegido cuando es uno solo: «Mesa 12», «Barra». */
  name: string
  /** Lo elegido es una mesa con QR y el bar tiene los QR de mesa prendidos. */
  canPrintQr: boolean
  onRotate90: () => void
  onBringFront: () => void
  onBringBack: () => void
  onDuplicate: () => void
  onQr: () => void
  onAlign: (kind: AlignKind) => void
  onDelete: () => void
}

function Tool({
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
      className={cn(danger && 'is-danger')}
    >
      {children}
    </button>
  )
}

const Sep = () => <span aria-hidden className="fpe-selbar-sep" />

/**
 * Lo que se puede hacer con lo elegido, flotando arriba del plano.
 * Uno → girar, duplicar, QR, orden, quitar. Varios → alinear y quitar.
 */
export function ContextualToolbar({
  count,
  name,
  canPrintQr,
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
    // biome-ignore lint/a11y/useSemanticElements: un grupo de botones con nombre, no un formulario
    <div className="fpe-selbar fpe-ui" role="group" aria-label="Acciones sobre lo elegido">
      <span className="fpe-selbar-what">{multi ? `${count} elegidos` : name}</span>
      <Sep />
      {multi ? (
        <>
          <Tool onClick={() => onAlign('left')} label="Alinear a la izquierda">
            <AlignStartVertical aria-hidden />
          </Tool>
          <Tool onClick={() => onAlign('hcenter')} label="Centrar en una columna">
            <AlignCenterVertical aria-hidden />
          </Tool>
          <Tool onClick={() => onAlign('right')} label="Alinear a la derecha">
            <AlignEndVertical aria-hidden />
          </Tool>
          <Sep />
          <Tool onClick={() => onAlign('top')} label="Alinear arriba">
            <AlignStartHorizontal aria-hidden />
          </Tool>
          <Tool onClick={() => onAlign('vcenter')} label="Centrar en una fila">
            <AlignCenterHorizontal aria-hidden />
          </Tool>
          <Tool onClick={() => onAlign('bottom')} label="Alinear abajo">
            <AlignEndHorizontal aria-hidden />
          </Tool>
        </>
      ) : (
        <>
          <Tool onClick={onRotate90} label="Girar un cuarto de vuelta (R)">
            <RotateCw aria-hidden />
          </Tool>
          <Tool onClick={onDuplicate} label="Duplicar (Ctrl D)">
            <Copy aria-hidden />
          </Tool>
          {canPrintQr ? (
            <Tool onClick={onQr} label="Imprimir el QR de esta mesa">
              <QrCode aria-hidden />
            </Tool>
          ) : null}
          <Sep />
          <Tool onClick={onBringFront} label="Traer al frente ( ] )">
            <ArrowUpToLine aria-hidden />
          </Tool>
          <Tool onClick={onBringBack} label="Mandar al fondo ( [ )">
            <ArrowDownToLine aria-hidden />
          </Tool>
        </>
      )}
      <Sep />
      <Tool onClick={onDelete} label={multi ? 'Quitar lo elegido (Supr)' : 'Quitar (Supr)'} danger>
        <Trash2 aria-hidden />
      </Tool>
    </div>
  )
}
