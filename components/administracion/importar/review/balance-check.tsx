import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { Panel, StatusPill } from '@/components/administracion/kit'
import { ActionButton } from '@/components/administracion/quick-actions'
import { formatDayMonth } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * «¿Coincide?»: lo que dice el banco (o Mercado Pago) al final del archivo
 * contra lo que quedó en el sistema. Antes era un aviso suelto que aparecía
 * solo al final; ahora está siempre arriba: mientras queda algo por contestar o
 * cargar dice cuánto había según el archivo, y al terminar pone los dos números
 * lado a lado, cada uno con su rótulo adentro, con «=» o «≠» en el medio.
 *
 * Si no coincide, el botón es «Contar {caja}» (la hoja «¿Coincide la caja?»):
 * una sola palabra para efectivo, banco y billetera. Quien solo lee no lo ve
 * (`ActionButton` no se dibuja en solo lectura). Server-safe.
 */
export function BalanceCheck({
  who,
  periodTo,
  reportCents,
  book,
  movementsHref,
  warnings = [],
}: {
  /** «el banco» / «Mercado Pago». */
  who: string
  /** Hasta qué día llega el archivo. */
  periodTo: string
  /** El saldo final que dice el archivo. */
  reportCents: number
  /** La caja en el sistema a esa fecha; `null` = todavía no se compara (queda algo pendiente). */
  book: { treasuryId: string; name: string; balanceCents: number } | null
  /** Los movimientos de esa caja. */
  movementsHref: string | null
  /** Avisos del archivo (un saldo que no cierra adentro del propio reporte). */
  warnings?: readonly string[]
}) {
  const day = formatDayMonth(periodTo)
  const notes =
    warnings.length > 0 ? (
      <div className="mt-3 space-y-1">
        {warnings.map((w) => (
          <p key={w} className="text-sm text-warning-text text-pretty">
            {w}
          </p>
        ))}
      </div>
    ) : null

  if (!book) {
    return (
      <div className="rounded-xl bg-secondary/50 px-4 py-3">
        <p className="text-sm text-pretty">
          Según {who}, al {day} había{' '}
          <strong className="font-semibold tabular-nums">{formatCents(reportCents)}</strong>. Cuando
          cargues todo te digo si tu sistema coincide.
        </p>
        {notes}
      </div>
    )
  }

  const match = book.balanceCents === reportCents
  const diff = Math.abs(book.balanceCents - reportCents)
  // El título va en pesos sin centavos (los dos números de abajo los llevan); una
  // diferencia de menos de un peso sí los muestra: «$ 0 de diferencia» no sería cierto.
  const diffWords = diff < 100 ? formatCents(diff) : formatCentsShort(diff)
  return (
    <Panel
      title={match ? '¿Coincide?' : `Hay ${diffWords} de diferencia con ${who}`}
      action={
        match ? (
          <StatusPill tone="ok">Coincide</StatusPill>
        ) : (
          <StatusPill tone="warn">No coincide</StatusPill>
        )
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <Figure label="En tu sistema" cents={book.balanceCents} />
        <p
          aria-hidden
          className={cn(
            'flex items-center justify-center font-serif text-3xl font-semibold leading-none',
            match ? 'text-success' : 'text-warning-text',
          )}
        >
          {match ? '=' : '≠'}
        </p>
        <Figure label={`Según ${who}`} cents={reportCents} />
      </div>
      <p className="mt-3 text-sm text-muted-foreground text-pretty">
        {match
          ? `${book.name} coincide con el archivo al ${day}.`
          : 'Suele ser algo cargado dos veces o un movimiento que falta.'}
      </p>
      {notes}
      {!match ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {movementsHref ? (
            <Link
              href={movementsHref}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium shadow-xs outline-none transition-colors hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring"
            >
              Ver los movimientos de {book.name}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          ) : null}
          <ActionButton
            action="ajustar"
            params={{ caja: book.treasuryId }}
            variant="outline"
            className="h-11"
          >
            Contar {book.name}
          </ActionButton>
        </div>
      ) : null}
    </Panel>
  )
}

/** Un número con su rótulo adentro (dos números sueltos no dicen cuál es cuál). */
function Figure({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-secondary/50 p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-serif text-2xl font-semibold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere] sm:text-3xl">
        {formatCents(cents)}
      </p>
    </div>
  )
}
