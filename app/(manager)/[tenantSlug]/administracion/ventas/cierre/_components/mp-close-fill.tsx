'use client'

import { FileUp, Info } from 'lucide-react'
import Link from 'next/link'
import { type ChangeEvent, useRef, useState } from 'react'
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
import {
  describeMpDay,
  type MpCloseChannel,
  mpDayFailureText,
  mpDayFills,
  readMpDay,
} from '@/lib/imports/mercadopago/daily-close'
import { openImportFile } from '@/lib/imports/ui/upload'
import { defaultInflateRaw } from '@/lib/imports/zip'

/** Lo que arma la página para «Completar con Mercado Pago». */
export type CloseMercadoPago = {
  /** El medio del cierre donde va lo cobrado con QR (`null`: el bar no tiene). */
  qrMethodId: string | null
  /** El medio de las transferencias que entran a Mercado Pago (`null`: el bar no tiene). */
  transferMethodId: string | null
  /** Corte del día de Importar › Mercado Pago (0 = calendario, 5 = día de servicio). */
  cutoffHour: number
  /** CUIT de la SAS: una transferencia desde ella es plata propia, no una venta. */
  sasCuit: string | null
  /** Importar › Mercado Pago: ahí se elige el medio de cada cobro y qué día cuenta. */
  settingsHref: string
}

type Summary = {
  headline: string
  notes: readonly string[]
  missing: readonly MpCloseChannel[]
  /** La persona eligió dejar sus importes. */
  kept: boolean
}

type Change = { id: string; name: string; from: number; to: number | null }

type Pending = {
  fills: Readonly<Record<string, number | null>>
  changes: Change[]
  summary: Summary
}

const READ_FAILED = 'No pudimos leer el archivo. Probá de nuevo o bajalo otra vez.'

/**
 * «Completar con Mercado Pago» (Lo vendido del cierre del día): lee EN EL
 * NAVEGADOR el reporte que bajó la persona (nada se sube ni se guarda), suma lo
 * cobrado con QR y por transferencia ese día y completa esos dos medios. Si ya
 * tenían otro importe, pregunta antes de pisarlo. Queda un resumen chico para
 * revisar antes de guardar.
 */
export function MpCloseFill({
  config,
  date,
  dayLabel,
  methodNames,
  amounts,
  onApply,
}: {
  config: CloseMercadoPago
  /** El día del cierre (`yyyy-MM-dd`). */
  date: string
  /** «lunes 05/10». */
  dayLabel: string
  methodNames: ReadonlyMap<string, string>
  /** Lo cargado hoy en cada medio (para no pisarlo sin preguntar). */
  amounts: Readonly<Record<string, number | null>>
  onApply: (fills: Readonly<Record<string, number | null>>) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  if (config.qrMethodId === null && config.transferMethodId === null) {
    return (
      <p className="text-xs text-muted-foreground text-pretty">
        Para completar QR y transferencias con el reporte de Mercado Pago, elegí cuál es cada medio
        en{' '}
        <Link href={config.settingsHref} className="font-medium underline underline-offset-2">
          Importar › Mercado Pago
        </Link>
        .
      </p>
    )
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Que se pueda volver a elegir el mismo archivo.
    event.target.value = ''
    if (!file) return
    setError(null)
    setSummary(null)
    setReading(true)
    try {
      // Que se vea «Leyendo…» antes de que el lector ocupe el hilo.
      await new Promise((resolve) => setTimeout(resolve, 0))
      const bytes = new Uint8Array(await file.arrayBuffer())
      const opened = await openImportFile({
        bytes,
        fileName: file.name,
        inflateRaw: defaultInflateRaw,
      })
      if (!opened.ok) {
        setError(opened.message)
        return
      }
      const result = readMpDay(opened.table.rows, {
        date,
        cutoffHour: config.cutoffHour,
        sasCuit: config.sasCuit,
      })
      if (!result.ok) {
        setError(mpDayFailureText(result))
        return
      }
      const fill = mpDayFills(result, {
        qr: config.qrMethodId,
        transfer_in: config.transferMethodId,
      })
      const described = describeMpDay(result, fill)
      const next: Summary = {
        headline: described.headline,
        notes: described.notes,
        missing: fill.missing,
        kept: false,
      }
      const changes: Change[] = []
      for (const [id, to] of Object.entries(fill.fills)) {
        const from = amounts[id] ?? null
        if (from !== null && from !== to) {
          changes.push({ id, name: methodNames.get(id) ?? 'Ese medio', from, to })
        }
      }
      if (changes.length > 0) {
        setPending({ fills: fill.fills, changes, summary: next })
        return
      }
      onApply(fill.fills)
      setSummary(next)
    } catch {
      setError(READ_FAILED)
    } finally {
      setReading(false)
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 gap-1.5 md:h-8"
          disabled={reading}
          onClick={() => inputRef.current?.click()}
        >
          <FileUp className="size-4" aria-hidden />
          {reading ? 'Leyendo el archivo…' : 'Completar con Mercado Pago'}
        </Button>
        <p className="min-w-0 flex-1 basis-60 text-xs text-muted-foreground text-pretty">
          Con el reporte que bajás de Mercado Pago completamos QR y transferencias del {dayLabel}.
          Se lee en tu compu: no se sube nada.
          {config.cutoffHour > 0
            ? ` Lo cobrado hasta las ${config.cutoffHour} a. m. del día siguiente cuenta para este cierre.`
            : ''}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,.zip,.xlsx"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => void onFile(event)}
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="text-pretty">{error}</p>
        </div>
      ) : null}

      {summary ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm"
        >
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <div className="min-w-0 space-y-2">
            <p className="text-pretty">{summary.headline}</p>
            {summary.kept ? (
              <p className="text-pretty text-muted-foreground">
                No cambiamos nada: quedaron los importes que habías cargado.
              </p>
            ) : null}
            {summary.notes.length > 0 ? (
              <ul className="grid gap-1 text-xs text-muted-foreground">
                {summary.notes.map((note) => (
                  <li key={note} className="text-pretty">
                    {note}
                  </li>
                ))}
              </ul>
            ) : null}
            {summary.missing.length > 0 ? (
              <Link
                href={config.settingsHref}
                className="inline-block text-xs font-medium underline underline-offset-2"
              >
                Elegir el medio en Importar › Mercado Pago
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          // Cancelar o Escape: quedan los importes de la persona.
          if (open || !pending) return
          setSummary({ ...pending.summary, kept: true })
          setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Reemplazás lo que ya cargaste?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>El reporte de Mercado Pago dice otra cosa:</p>
                <ul className="grid gap-1 tabular-nums">
                  {pending?.changes.map((c) => (
                    <li key={c.id}>
                      <span className="font-medium text-foreground">{c.name}</span>: tenías{' '}
                      {moneyLabel(c.from)} y el reporte dice{' '}
                      {c.to === null ? `${moneyLabel(0)} (se devolvió todo)` : moneyLabel(c.to)}.
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
              onClick={(event) => {
                // Sin esto, el cierre del diálogo pasa por `onOpenChange` y lo toma como «Dejar lo mío».
                event.preventDefault()
                if (!pending) return
                onApply(pending.fills)
                setSummary(pending.summary)
                setPending(null)
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
