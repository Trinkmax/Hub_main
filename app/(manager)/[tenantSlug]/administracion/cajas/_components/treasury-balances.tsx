import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import {
  CheckedStatus,
  TreasuryBalance,
  TreasuryIcon,
} from '@/components/administracion/cajas-ventas/treasury-display'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
} from '@/components/ui/data-table'
import { TREASURY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import type { TreasuryKind } from '@/lib/accounting/types'
import { formatCents } from '@/lib/money'

export type TreasuryBalanceItem = {
  id: string
  name: string
  kind: TreasuryKind
  /** Debe − Haber (en la tarjeta de la empresa, negativo = deuda). */
  balanceCents: number
  pendingWalletCents: number
  lastCheckedOn: string | null
  lastMovementDate: string | null
  active: boolean
  /** Alias o banco, debajo del nombre. */
  detail: string | null
}

/**
 * Los saldos de cada caja EN TABLA: lo que queda detrás de «Ver como tabla y
 * exportar». La billetera de arriba es para el dueño; esto es para quien
 * quiere la lista con sus centavos y el archivo (la contadora lo ve abierto).
 *
 * No lleva botones de carga: contar y mover se hacen desde las tarjetas y la
 * fila de acciones. Cada fila lleva a los movimientos de su caja.
 */
export function TreasuryBalances({
  items,
  availableCents,
  today,
  since,
  base,
  exportHref,
  exportFileName,
}: {
  items: readonly TreasuryBalanceItem[]
  /** La misma «Plata disponible» de arriba (las activas que no son tarjeta). */
  availableCents: number
  today: string
  /** El día en que arrancan los libros (para saber si ya toca contar). */
  since: string | null
  base: string
  exportHref: string
  exportFileName: string
}) {
  const sub = (t: TreasuryBalanceItem) =>
    [TREASURY_KIND_LABELS[t.kind] ?? null, t.detail].filter(Boolean).join(' · ')
  const status = (t: TreasuryBalanceItem, className?: string) =>
    t.active ? (
      <CheckedStatus
        lastCheckedOn={t.lastCheckedOn}
        today={today}
        hasMovements={t.lastMovementDate !== null}
        since={since}
        className={className}
      />
    ) : (
      <span className="text-xs text-muted-foreground">Desactivada: no suma</span>
    )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground text-pretty">
          Lo que dice el sistema de cada caja, al centavo, según lo cargado.
        </p>
        <ExportButton href={exportHref} fileName={exportFileName} className="h-11 md:h-9" />
      </div>

      {/* Compu y tablet */}
      <div className="hidden overflow-hidden rounded-xl border border-border/60 sm:block">
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">Saldos de cajas y cuentas</caption>
            <DataTableHead>
              <tr>
                <DataTableHeader>Caja o cuenta</DataTableHeader>
                <DataTableHeader>Último conteo</DataTableHeader>
                <DataTableHeader className="text-right">Saldo</DataTableHeader>
                <DataTableHeader className="w-0">
                  <span className="sr-only">Movimientos</span>
                </DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {items.map((t) => (
                <tr
                  key={t.id}
                  className="group transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-cream-tint"
                >
                  <DataTableCell>
                    <span className="flex items-center gap-3">
                      <TreasuryIcon kind={t.kind} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{t.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {sub(t)}
                        </span>
                      </span>
                    </span>
                  </DataTableCell>
                  <DataTableCell>{status(t)}</DataTableCell>
                  <DataTableCell className="text-right">
                    <TreasuryBalance kind={t.kind} balanceCents={t.balanceCents} />
                    {t.pendingWalletCents > 0 ? (
                      <span className="block text-xs tabular-nums text-muted-foreground">
                        + {formatCents(t.pendingWalletCents)} en camino
                      </span>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell>
                    <Link
                      href={`${base}/cajas/${t.id}`}
                      aria-label={`Movimientos de ${t.name}`}
                      className="inline-flex h-11 items-center gap-1 rounded-md px-2 md:h-9 text-sm font-medium whitespace-nowrap text-foreground outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Movimientos
                      <ChevronRight className="size-3.5" aria-hidden />
                    </Link>
                  </DataTableCell>
                </tr>
              ))}
            </DataTableBody>
            {/* El total va debajo de la columna «Saldo», no contra el borde. */}
            <tfoot className="border-t border-border/60 bg-secondary/30">
              <tr>
                <DataTableCell colSpan={2} className="py-2.5 text-xs text-muted-foreground">
                  Plata disponible (las cajas, bancos y billeteras activas)
                </DataTableCell>
                <DataTableCell className="py-2.5 text-right font-semibold">
                  <TreasuryBalance kind="cash" balanceCents={availableCents} />
                </DataTableCell>
                <DataTableCell className="py-2.5">{null}</DataTableCell>
              </tr>
            </tfoot>
          </DataTableRoot>
        </DataTableScroll>
      </div>

      {/* Celular: un renglón por caja (la tabla no entra) */}
      <div className="overflow-hidden rounded-xl border border-border/60 sm:hidden">
        <ul aria-label="Saldos de cajas y cuentas" className="divide-y divide-border/60">
          {items.map((t) => (
            <li key={t.id}>
              <Link
                href={`${base}/cajas/${t.id}`}
                className="flex items-start gap-3 px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <TreasuryIcon kind={t.kind} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{sub(t)}</span>
                  <span className="mt-1.5 block">{status(t)}</span>
                </span>
                <span className="shrink-0 text-right text-sm">
                  <TreasuryBalance kind={t.kind} balanceCents={t.balanceCents} />
                  {t.pendingWalletCents > 0 ? (
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      + {formatCents(t.pendingWalletCents)} en camino
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-secondary/30 px-3 py-3 text-sm">
          <span className="text-muted-foreground">Plata disponible</span>
          <TreasuryBalance kind="cash" balanceCents={availableCents} className="font-semibold" />
        </div>
      </div>
    </div>
  )
}
