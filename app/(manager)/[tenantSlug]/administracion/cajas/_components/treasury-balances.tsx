import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import {
  CheckedStatus,
  TreasuryBalance,
  TreasuryIcon,
} from '@/components/administracion/cajas-ventas/treasury-display'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
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
  active: boolean
  /** Alias o banco, debajo del nombre. */
  detail: string | null
}

/**
 * Los saldos de cada caja o cuenta (H.11): ícono · nombre · alias · saldo ·
 * «+ $ X por acreditar» · «Ajustada el 28/09» · [Movimientos] [Mover]
 * [Ajustar]. Tabla en la compu, tarjetas en el celular. Server-safe: los
 * botones de carga no se dibujan para la contadora (`ActionButton`).
 */
export function TreasuryBalances({
  items,
  availableCents,
  today,
  base,
  exportHref,
  exportFileName,
}: {
  items: readonly TreasuryBalanceItem[]
  availableCents: number
  today: string
  base: string
  exportHref: string
  exportFileName: string
}) {
  const header = (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
      <div>
        <h2 className="font-serif text-lg font-semibold tracking-tight">Saldos de hoy</h2>
        <p className="text-xs text-muted-foreground">
          Lo que hay en cada caja, banco y billetera según lo cargado.
        </p>
      </div>
      <ExportButton href={exportHref} fileName={exportFileName} size="sm" className="h-11 md:h-8" />
    </header>
  )

  return (
    <>
      {/* Compu y tablet */}
      <DataTableShell className="hidden sm:block">
        {header}
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">Saldos de cajas y cuentas</caption>
            <DataTableHead>
              <tr>
                <DataTableHeader>Caja o cuenta</DataTableHeader>
                <DataTableHeader>Último ajuste</DataTableHeader>
                <DataTableHeader className="text-right">Saldo</DataTableHeader>
                <DataTableHeader className="w-0">
                  <span className="sr-only">Acciones</span>
                </DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {items.map((t) => (
                <tr
                  key={t.id}
                  className="group transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint"
                >
                  <DataTableCell>
                    <Link
                      href={`${base}/cajas/${t.id}`}
                      className="flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <TreasuryIcon kind={t.kind} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium group-hover:text-primary">
                          {t.name}
                          {t.active ? null : (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              (desactivada)
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[TREASURY_KIND_LABELS[t.kind] ?? null, t.detail]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </Link>
                  </DataTableCell>
                  <DataTableCell>
                    <CheckedStatus lastCheckedOn={t.lastCheckedOn} today={today} />
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <TreasuryBalance kind={t.kind} balanceCents={t.balanceCents} />
                    {t.pendingWalletCents > 0 ? (
                      <span className="block text-xs tabular-nums text-muted-foreground">
                        + {formatCents(t.pendingWalletCents)} por acreditar
                      </span>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex items-center justify-end gap-1">
                      <ActionButton
                        action="mover"
                        params={{ caja: t.id }}
                        variant="ghost"
                        size="sm"
                        aria-label={`Mover plata de ${t.name}`}
                      >
                        Mover
                      </ActionButton>
                      <ActionButton
                        action="ajustar"
                        params={{ caja: t.id }}
                        variant="ghost"
                        size="sm"
                        aria-label={`Ajustar saldo de ${t.name}`}
                      >
                        Ajustar
                      </ActionButton>
                      <Button asChild variant="ghost" size="sm" className="gap-1">
                        <Link
                          href={`${base}/cajas/${t.id}`}
                          aria-label={`Movimientos de ${t.name}`}
                        >
                          Movimientos
                          <ChevronRight className="size-3.5" aria-hidden />
                        </Link>
                      </Button>
                    </div>
                  </DataTableCell>
                </tr>
              ))}
            </DataTableBody>
          </DataTableRoot>
        </DataTableScroll>
        <DataTableFooter>
          <span>Plata disponible (cajas, bancos y billeteras)</span>
          <strong className="tabular-nums text-foreground">
            <TreasuryBalance kind="cash" balanceCents={availableCents} />
          </strong>
        </DataTableFooter>
      </DataTableShell>

      {/* Celular: tarjetas */}
      <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card sm:hidden">
        {header}
        <ul aria-label="Saldos de cajas y cuentas" className="divide-y divide-border/60">
          {items.map((t) => (
            <li key={t.id} className="space-y-3 px-4 py-4">
              <Link
                href={`${base}/cajas/${t.id}`}
                className="flex items-start gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <TreasuryIcon kind={t.kind} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[TREASURY_KIND_LABELS[t.kind] ?? null, t.detail].filter(Boolean).join(' · ')}
                  </span>
                  {t.pendingWalletCents > 0 ? (
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      + {formatCents(t.pendingWalletCents)} por acreditar
                    </span>
                  ) : null}
                  <CheckedStatus lastCheckedOn={t.lastCheckedOn} today={today} className="mt-1" />
                </span>
                <span className="shrink-0 text-right">
                  <TreasuryBalance kind={t.kind} balanceCents={t.balanceCents} />
                </span>
              </Link>
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm" className="h-11 flex-1">
                  <Link href={`${base}/cajas/${t.id}`}>Movimientos</Link>
                </Button>
                <ActionButton
                  action="mover"
                  params={{ caja: t.id }}
                  variant="outline"
                  size="sm"
                  className="h-11 flex-1"
                >
                  Mover
                </ActionButton>
                <ActionButton
                  action="ajustar"
                  params={{ caja: t.id }}
                  variant="outline"
                  size="sm"
                  className="h-11 flex-1"
                >
                  Ajustar
                </ActionButton>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-secondary/30 px-4 py-3 text-sm">
          <span className="text-muted-foreground">Plata disponible</span>
          <TreasuryBalance kind="cash" balanceCents={availableCents} className="font-semibold" />
        </div>
      </div>
    </>
  )
}
