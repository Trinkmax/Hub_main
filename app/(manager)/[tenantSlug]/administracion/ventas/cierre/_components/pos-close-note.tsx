'use client'

import { Store } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { moneyLabel } from '@/components/administracion/cajas-ventas/money'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { type PosCloseFill, posCloseChanges, posCloseWords } from '@/lib/accounting/pos-close'

/** Lo que arma la página para precargar el cierre con el punto de venta. */
export type ClosePos = PosCloseFill & {
  /** «Hoy en vivo» parado en ese día: de dónde salen los números. */
  dayHref: string
}

/**
 * La nota que va arriba de los importes cuando el cierre arranca precargado con lo que cobró el punto
 * de venta (en un bar que lo usa, es el primer cierre del día). Dice de dónde salen los números y qué
 * quedó afuera a propósito (señas, propinas, un medio sin par), y deja empezar en blanco o volver a
 * traerlos. No guarda nada: guardar es el botón de siempre, con sus validaciones.
 *
 * Antes de pisar un importe que la persona escribió, pregunta (igual que «Completar con Mercado Pago»).
 */
export function PosCloseNote({
  pos,
  methodNames,
  amounts,
  onApply,
  onClear,
}: {
  pos: ClosePos
  methodNames: ReadonlyMap<string, string>
  /** Lo cargado ahora en cada medio. */
  amounts: Readonly<Record<string, number | null>>
  /** Pone los importes del punto de venta en sus medios. */
  onApply: (fills: Readonly<Record<string, number>>) => void
  /** Deja en blanco los medios que se habían precargado. */
  onClear: (methodIds: readonly string[]) => void
}) {
  const [confirm, setConfirm] = useState(false)
  const words = posCloseWords(pos)
  const ids = Object.keys(pos.fills)
  // ¿Los importes de ahora son los del punto de venta? Si alguien tocó uno, ya no.
  const untouched = ids.length > 0 && ids.every((id) => amounts[id] === pos.fills[id])
  const blank = ids.every((id) => amounts[id] === null || amounts[id] === undefined)
  const changes = posCloseChanges(pos.fills, amounts)

  function bring() {
    if (changes.length > 0) setConfirm(true)
    else onApply(pos.fills)
  }

  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-border/70 bg-info/5 px-3 py-2.5 text-sm"
    >
      <Store className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-pretty">
          {untouched || ids.length === 0
            ? words.headline
            : blank
              ? 'Empezaste en blanco: lo del punto de venta no está cargado.'
              : 'Cambiaste algún importe: ya no es tal cual lo que cobró el punto de venta.'}
        </p>
        {untouched || ids.length === 0 ? (
          <ul className="grid gap-1 text-xs text-muted-foreground">
            {words.notes.map((note) => (
              <li key={note} className="text-pretty">
                {note}
              </li>
            ))}
            <li className="text-pretty">
              Revisá los importes y guardá: recién ahí va a los libros.
            </li>
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-0.5">
          {ids.length > 0 && !untouched ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 pointer-coarse:h-10"
              onClick={bring}
            >
              Traer lo del punto de venta
            </Button>
          ) : null}
          {untouched ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 px-2 text-muted-foreground pointer-coarse:h-10"
              onClick={() => onClear(ids)}
            >
              Empezar en blanco
            </Button>
          ) : null}
          <Link
            href={pos.dayHref}
            prefetch={false}
            className="rounded-sm text-xs font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Ver ese día en el punto de venta
          </Link>
        </div>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Reemplazás lo que ya cargaste?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>El punto de venta dice otra cosa:</p>
                <ul className="grid gap-1 tabular-nums">
                  {changes.map((c) => (
                    <li key={c.id}>
                      <span className="font-medium text-foreground">
                        {methodNames.get(c.id) ?? 'Ese medio'}
                      </span>
                      : tenías {moneyLabel(c.from)} y el punto de venta cobró {moneyLabel(c.to)}.
                    </li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 md:h-9">Dejar lo mío</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              onClick={() => {
                onApply(pos.fills)
                setConfirm(false)
              }}
            >
              Reemplazar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
