'use client'

import { X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { PTable, PTd, PTh } from '@/components/administracion/planilla'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import type { QueryOutcome } from '@/lib/accounting/queries/shared'
import { formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { fetchAccountMovements } from '../_lib/account-movements-action'
import {
  ACCOUNT_SHEET_DAYS,
  ACCOUNT_SHEET_ROWS,
  type AccountMovement,
  type AccountMovements,
  type CajaAccountRow,
  cajaEmpty,
} from '../_lib/wallet-view'

const SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e'] as const

/** «Saldo $ X» · «Debés $ X» · «Descubierto $ X» · «Sin deuda», como en la fila. */
export function accountBalanceLine(account: CajaAccountRow): string {
  if (account.unknown) return 'Todavía no se cargó cuánto hay'
  const { money } = account
  if (money.words) return money.words
  return `${money.label ?? 'Saldo'} ${money.amount ?? ''}`.trim()
}

/** La tabla del panel: Fecha · Concepto · Entró · Salió. Cada renglón lleva a su comprobante. */
export function MovementsTable({
  movements,
  card,
  base,
}: {
  movements: readonly AccountMovement[]
  /** En la tarjeta de la empresa lo que entra son pagos y lo que sale, consumos. */
  card: boolean
  base: string
}) {
  return (
    <PTable label="Movimientos" minWidth={0} className="text-[13px]">
      <thead>
        <tr>
          <PTh className="px-2">Fecha</PTh>
          <PTh className="px-2">Concepto</PTh>
          <PTh align="right" className="px-2">
            {card ? 'Pagos' : 'Entró'}
          </PTh>
          <PTh align="right" className="px-2">
            {card ? 'Consumos' : 'Salió'}
          </PTh>
        </tr>
      </thead>
      <tbody>
        {movements.map((row) => (
          <tr key={row.key} className="border-b border-border/60 last:border-b-0">
            <PTd className="px-2 whitespace-nowrap text-muted-foreground">
              {formatDayMonth(row.date)}
            </PTd>
            <PTd className="min-w-0 px-2">
              {row.path ? (
                <Link
                  href={`${base}${row.path}`}
                  className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {row.title}
                </Link>
              ) : (
                row.title
              )}
              <span className="block text-xs text-muted-foreground">{row.sub}</span>
            </PTd>
            <PTd align="right" className="px-2">
              {row.inCents > 0 ? formatCentsShort(row.inCents) : ''}
            </PTd>
            <PTd align="right" className="px-2">
              {row.outCents > 0 ? formatCentsShort(row.outCents) : ''}
            </PTd>
          </tr>
        ))}
      </tbody>
    </PTable>
  )
}

/**
 * El cuerpo del panel. Pide los movimientos al abrirse: una cuenta que nunca se movió no pide nada
 * (no hay nada que traer, y enseña qué la mueve). Si la lectura falla, lo dice con «Reintentar».
 */
function SheetBody({
  tenantSlug,
  base,
  account,
  openingPending,
}: {
  tenantSlug: string
  base: string
  account: CajaAccountRow
  openingPending: boolean
}) {
  const moved = account.lastMovementDate !== null
  const [outcome, setOutcome] = useState<QueryOutcome<AccountMovements> | null>(null)
  const [attempt, setAttempt] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` no se lee, es lo que dispara «Reintentar»
  useEffect(() => {
    if (!moved) return
    let alive = true
    setOutcome(null)
    fetchAccountMovements(tenantSlug, { treasuryId: account.id, kind: account.kind })
      .then((result) => {
        if (alive) setOutcome(result)
      })
      .catch(() => {
        if (alive) {
          setOutcome({
            ok: false,
            code: 'error',
            message: 'Sin conexión: no pudimos cargar esto. Probá de nuevo.',
          })
        }
      })
    return () => {
      alive = false
    }
  }, [tenantSlug, account.id, account.kind, moved, attempt])

  if (!moved) {
    const empty = cajaEmpty({
      kind: account.kind,
      name: account.name,
      methods: [],
      openingPending,
    })
    return (
      <div className="space-y-1 text-sm">
        <p className="font-medium">{empty.title}</p>
        <p className="text-muted-foreground text-pretty">{empty.text}</p>
      </div>
    )
  }

  if (outcome === null) {
    return (
      <div aria-busy className="space-y-3">
        <span className="sr-only">Cargando los movimientos…</span>
        {SKELETON_ROWS.map((key) => (
          <div key={key} className="flex items-center gap-3">
            <Skeleton className="h-4 w-10 shrink-0" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16 shrink-0" />
          </div>
        ))}
      </div>
    )
  }

  if (!outcome.ok) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-pretty">{outcome.message}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          Reintentar
        </Button>
      </div>
    )
  }

  const { movements, tooMany } = outcome.data
  if (tooMany) {
    return (
      <p className="text-sm text-muted-foreground text-pretty">
        Hubo muchos movimientos estos días: miralos en «Ver todo».
      </p>
    )
  }
  if (movements.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-pretty">
        No hubo movimientos en los últimos {ACCOUNT_SHEET_DAYS} días.
        {account.lastMovementDate
          ? ` El último fue el ${formatDayMonth(account.lastMovementDate)}.`
          : ''}
      </p>
    )
  }
  const shown = movements.slice(0, ACCOUNT_SHEET_ROWS)
  return (
    <div className="space-y-2">
      <MovementsTable movements={shown} card={account.kind === 'credit_card'} base={base} />
      {movements.length > shown.length ? (
        <p className="text-xs text-muted-foreground">
          Los últimos {shown.length} de {movements.length}: el resto, en «Ver todo».
        </p>
      ) : null}
    </div>
  )
}

/**
 * El panel lateral de una cuenta: «¿qué pasó acá?» sin irse de la tabla. Lo de los últimos 30 días,
 * con lo más nuevo arriba; «Ver todo» lleva a su ficha (`/cajas/[id]`), con el período que se quiera.
 */
export function AccountSheet({
  tenantSlug,
  base,
  account,
  open,
  openingPending,
  onClose,
}: {
  tenantSlug: string
  base: string
  /** La cuenta: se conserva al cerrar, para que la salida no muestre un panel vacío. */
  account: CajaAccountRow | null
  open: boolean
  openingPending: boolean
  onClose: () => void
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <SheetContent
        side="right"
        // La X la dibuja el panel: la del primitivo mide 32 px y en el celular no llega a 44.
        showClose={false}
        className="w-full gap-0 overflow-hidden p-0 ease-(--ease-out) data-[state=closed]:duration-200 data-[state=open]:duration-300 sm:max-w-[30rem] motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none"
      >
        {account ? (
          <>
            <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b border-border/70 py-3 pr-12 pl-4">
              <div className="min-w-0">
                <SheetTitle className="text-base">{account.name}</SheetTitle>
                <SheetDescription className="tabular-nums">
                  {accountBalanceLine(account)}
                </SheetDescription>
              </div>
              <Button asChild variant="outline" size="sm" className="max-sm:h-10">
                <Link href={`${base}/cajas/${account.id}`}>Ver todo</Link>
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
              {/* Con `key`, cambiar de cuenta arranca limpio: nunca los movimientos de la anterior. */}
              <SheetBody
                key={account.id}
                tenantSlug={tenantSlug}
                base={base}
                account={account}
                openingPending={openingPending}
              />
            </div>
            {/* Después del cuerpo en el DOM: al abrir, el foco no cae en «Cerrar». */}
            <SheetClose className="absolute top-1 right-1 flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none sm:top-2 sm:right-2 sm:size-9">
              <X className="size-5 sm:size-4" aria-hidden="true" />
              <span className="sr-only">Cerrar</span>
            </SheetClose>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
