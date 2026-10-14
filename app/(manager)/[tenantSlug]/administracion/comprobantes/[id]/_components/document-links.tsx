import {
  ArrowDown,
  ArrowUp,
  Banknote,
  BookOpen,
  CalendarClock,
  Camera,
  ChevronRight,
  FileDown,
  Files,
  Landmark,
  Link2,
  Lock,
  type LucideIcon,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { DocumentAttachments } from '@/components/administracion/adjuntos/document-attachments'
import { Amount } from '@/components/administracion/amount'
import { Panel } from '@/components/administracion/kit/panel'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { ActionButton } from '@/components/administracion/quick-actions'
import { VoucherText } from '@/components/administracion/voucher-text'
import { GUIDE_PATHS, linkAnchor } from '@/lib/accounting/guides'
import type { DocumentAttachment } from '@/lib/accounting/queries/attachments'
import type { QueryOutcome } from '@/lib/accounting/queries/shared'
import type { ArcaVoucherCard } from '@/lib/arca/emit-form'
import { formatIsoDay } from '@/lib/dates'
import { importBatchHref } from '@/lib/imports/ui/labels'
import { cn } from '@/lib/utils'
import { gastosFijosHref, supplierHref } from '../../../compras/_lib/links'
import type {
  AllocationRow,
  IvaVoucherView,
  LinkNode as LinkNodeData,
  LinkNodeId,
  TreasuryRow,
} from '../../_lib/document-story'
import { ArcaAuthorizationCard } from './arca-card'
import { RichLine } from './document-hero'
import { LinkLegend, LinkNode, LinkRail } from './link-rail'
import { SeparateButton } from './separate-button'

/**
 * ③ «Con qué está unido»: el mapa de vínculos de este comprobante. Cada nodo
 * dice qué tiene unido (con un link para seguirlo), en qué estado está y, donde
 * se puede, la acción: «Separar» un pago, «Ya llegó» en un cierre, «Agregar
 * foto o PDF». Lo que falta se ve como falta, con su oración; lo que no aplica
 * y vale decirlo (una compra sin factura no entra al Libro IVA), en gris.
 *
 * Qué nodos hay, en qué orden y con qué textos lo arma `documentLinks()`; acá
 * se dibujan y se montan las islas que escriben. Ninguna de esas islas se
 * dibuja para quien solo mira (la contadora): la historia no manda la acción y
 * cada isla vuelve a mirar `readOnly`.
 */

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const LIST = 'divide-y divide-border/60'
const SUB_LABEL = 'text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase'

const ICONS: Readonly<Record<LinkNodeId, LucideIcon>> = {
  caja: Wallet,
  pago: Banknote,
  aplicado: Link2,
  'en-camino': Wallet,
  'gasto-fijo': CalendarClock,
  foto: Camera,
  importado: FileDown,
  'libro-iva': BookOpen,
  arca: ShieldCheck,
  otros: Files,
  libros: Landmark,
}

/** Un link para seguir una unión: el nombre de la cosa y «›». */
function Go({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-w-0 items-center gap-0.5 rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground pointer-coarse:min-h-11',
        FOCUS,
      )}
    >
      <span className="min-w-0 text-pretty">{children}</span>
      <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </Link>
  )
}

/** Un pliegue callado dentro de un nodo («y 4 más», «Ver los importes»). */
function Fold({
  label,
  open = false,
  children,
}: {
  label: string
  open?: boolean
  children: ReactNode
}) {
  return (
    <details className="group/fold mt-2" open={open}>
      <summary
        className={cn(
          'inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden',
          FOCUS,
        )}
      >
        <ChevronRight
          aria-hidden
          className="size-3.5 transition-transform duration-(--duration-fast) ease-(--ease-out) group-open/fold:rotate-90 motion-reduce:transition-none"
        />
        {label}
      </summary>
      <div className="mt-1.5">{children}</div>
    </details>
  )
}

/** Un renglón de un nodo: la cosa, un dato en gris, el importe y, si hay, su acción. */
function Row({
  title,
  meta,
  cents,
  action,
  note,
}: {
  title: ReactNode
  meta?: ReactNode
  cents?: number
  action?: ReactNode
  note?: ReactNode
}) {
  return (
    <div className="py-2 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {/* El dato va entero: si no entra al lado, baja completo (nunca un «·» colgando). */}
        <div className="flex min-w-0 flex-1 basis-44 flex-wrap items-center gap-x-2">
          {title}
          {meta ? <span className="whitespace-nowrap text-muted-foreground">{meta}</span> : null}
        </div>
        {cents !== undefined ? <Amount cents={cents} className="shrink-0 font-medium" /> : null}
        {action}
      </div>
      {note ? <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{note}</p> : null}
    </div>
  )
}

function TreasuryRows({ rows, base }: { rows: readonly TreasuryRow[]; base: string }) {
  return rows.map((row) => {
    const Arrow = row.direction === 'in' ? ArrowUp : ArrowDown
    return (
      <Row
        key={row.key}
        title={
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {/* La dirección va con su palabra al lado («Salió de…»), nunca sola. */}
            <Arrow
              aria-hidden
              className={cn(
                'size-4 shrink-0',
                row.direction === 'in' ? 'text-adm-in' : 'text-adm-out',
              )}
            />
            {row.treasuryId ? (
              <Go href={`${base}/cajas/${row.treasuryId}`}>{row.text}</Go>
            ) : (
              <span className="font-medium">{row.text}</span>
            )}
          </span>
        }
        cents={row.cents}
        note={row.reference}
      />
    )
  })
}

function AllocationRows({
  rows,
  base,
  tenantSlug,
}: {
  rows: readonly AllocationRow[]
  base: string
  tenantSlug: string
}) {
  return rows.map((row) => (
    <Row
      key={row.key}
      title={
        row.documentId ? (
          <Go href={`${base}/comprobantes/${row.documentId}`}>
            <VoucherText text={row.label} />
          </Go>
        ) : (
          <span className="font-medium">{row.label}</span>
        )
      }
      meta={row.meta}
      cents={row.cents}
      note={row.note}
      action={row.separate ? <SeparateButton tenantSlug={tenantSlug} {...row.separate} /> : null}
    />
  ))
}

/** Las uniones que se separaron: quedan a la vista de quien las busca, plegadas. */
function Separated({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null
  return (
    <Fold label={items.length === 1 ? '1 unión separada' : `${items.length} uniones separadas`}>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {items.map((text) => (
          <li key={text} className="text-pretty">
            <VoucherText text={text} />
          </li>
        ))}
      </ul>
    </Fold>
  )
}

function Empty({ title, hint }: { title: string; hint?: string | null }) {
  return (
    <>
      <p className="font-medium text-pretty">{title}</p>
      {hint ? <p className="mt-0.5 text-muted-foreground text-pretty">{hint}</p> : null}
    </>
  )
}

function IvaFacts({ voucher }: { voucher: IvaVoucherView }) {
  const rows: Array<[string, number]> = [
    ['Neto gravado', voucher.netCents],
    ['IVA', voucher.vatCents],
  ]
  if (voucher.perceptionsCents !== 0) rows.push(['Percepciones', voucher.perceptionsCents])
  if (voucher.otherCents !== 0) rows.push(['No gravado, exento y otros', voucher.otherCents])
  return (
    <div className={cn('py-2 first:pt-0 last:pb-0', voucher.voided && 'opacity-70')}>
      <p className="text-xs text-pretty">
        <span className="font-medium">
          <VoucherText text={voucher.label} />
        </span>
        {voucher.reversal ? ' · anulación' : ''}
        {voucher.voided ? ' · Anulado' : ''}
        <span className="text-muted-foreground">
          {' '}
          · {formatIsoDay(voucher.date)} · {voucher.counterparty}
        </span>
      </p>
      <dl className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 text-xs">
        {rows.map(([label, cents]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right">
              <Amount cents={cents} />
            </dd>
          </div>
        ))}
        <dt className="font-medium">Total</dt>
        <dd className="text-right font-medium">
          <Amount cents={voucher.totalCents} />
        </dd>
      </dl>
    </div>
  )
}

function NodeBody({
  node,
  base,
  tenantSlug,
  documentId,
  canWrite,
  attachments,
  arcaOutcome,
}: {
  node: LinkNodeData
  base: string
  tenantSlug: string
  documentId: string
  canWrite: boolean
  attachments: QueryOutcome<DocumentAttachment[]>
  arcaOutcome: QueryOutcome<ArcaVoucherCard | null> | null
}) {
  switch (node.id) {
    case 'caja':
      return (
        <div className={LIST}>
          <TreasuryRows rows={node.rows} base={base} />
        </div>
      )

    case 'pago':
      return (
        <>
          {node.empty ? (
            <Empty {...node.empty} />
          ) : (
            <div className={LIST}>
              <AllocationRows rows={node.rows} base={base} tenantSlug={tenantSlug} />
            </div>
          )}
          {node.footer ? <p className="mt-2 font-medium tabular-nums">{node.footer}</p> : null}
          <Separated items={node.separated} />
          {node.note ? (
            <p className="mt-2 text-xs text-muted-foreground text-pretty">{node.note}</p>
          ) : null}
        </>
      )

    case 'aplicado':
      return (
        <>
          {node.corrects ? (
            <p className="pb-2 text-pretty">
              Corrige a{' '}
              <Go href={`${base}/comprobantes/${node.corrects.id}`}>
                <VoucherText text={node.corrects.text} />
              </Go>
            </p>
          ) : null}
          {node.empty ? <Empty {...node.empty} /> : null}
          {node.rows.length > 0 ? (
            <div className={LIST}>
              <AllocationRows rows={node.rows} base={base} tenantSlug={tenantSlug} />
            </div>
          ) : null}
          {node.more.length > 0 ? (
            <Fold label={`y ${node.more.length} más`}>
              <div className={LIST}>
                <AllocationRows rows={node.more} base={base} tenantSlug={tenantSlug} />
              </div>
            </Fold>
          ) : null}
          {node.rest ? (
            <div className="mt-2 rounded-xl bg-secondary/50 px-3 py-2.5">
              <p className="font-medium tabular-nums">{node.rest.title}</p>
              <p className="mt-0.5 text-muted-foreground text-pretty">{node.rest.hint}</p>
              {node.rest.partyId && node.rest.side ? (
                <p className="mt-1">
                  <Go
                    href={
                      node.rest.side === 'supplier'
                        ? supplierHref(tenantSlug, node.rest.partyId)
                        : `${base}/ventas/clientes/${node.rest.partyId}`
                    }
                  >
                    Ver la cuenta{node.rest.partyName ? ` de ${node.rest.partyName}` : ''}
                  </Go>
                </p>
              ) : null}
            </div>
          ) : null}
          <Separated items={node.separated} />
        </>
      )

    case 'en-camino':
      return (
        <>
          {node.cash.length > 0 ? (
            <div className={LIST}>
              <TreasuryRows rows={node.cash} base={base} />
            </div>
          ) : null}
          {node.rows.length > 0 ? (
            <>
              <p className={cn(SUB_LABEL, node.cash.length > 0 && 'mt-3', 'mb-1')}>
                Lo que quedó en camino
              </p>
              <ul className={LIST}>
                {node.rows.map((row) => (
                  // Dos columnas: a la izquierda qué es y cómo viene; a la derecha cuánto y,
                  // si falta, su botón. Así el botón queda siempre en el mismo lugar.
                  <li
                    key={row.key}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5 first:pt-1 last:pb-0"
                  >
                    <p className="min-w-0 text-pretty">
                      <span className="font-medium">{row.medium}</span>
                      {row.partyName && row.partyName !== row.medium ? (
                        <span className="text-muted-foreground max-sm:block max-sm:text-xs">
                          <span className="max-sm:hidden"> · </span>
                          {row.partyName}
                        </span>
                      ) : null}
                    </p>
                    <Amount cents={row.cents} className="justify-self-end font-medium" />
                    <div className="min-w-0">
                      <StatusPill
                        tone={row.tone}
                        className="h-auto min-h-6 max-w-full shrink py-1 leading-tight whitespace-normal"
                      >
                        {row.status}
                      </StatusPill>
                    </div>
                    {row.action ? (
                      <ActionButton
                        action="cobrar"
                        params={row.action.params}
                        variant="outline"
                        className="h-11 justify-self-end px-3 md:h-8"
                        aria-label={`${row.action.label}: ${row.medium}`}
                      >
                        {row.action.label}
                      </ActionButton>
                    ) : (
                      <span />
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {node.arrivals.length > 0 ? (
            <>
              <p className={cn(SUB_LABEL, 'mt-4 mb-1')}>Con qué llegó</p>
              <div className={LIST}>
                <AllocationRows rows={node.arrivals} base={base} tenantSlug={tenantSlug} />
              </div>
            </>
          ) : null}
        </>
      )

    case 'gasto-fijo':
      return (
        <>
          <p className="text-pretty">
            {node.recurringId ? (
              <Go href={gastosFijosHref(tenantSlug, { abrir: node.recurringId })}>{node.title}</Go>
            ) : (
              <span className="font-medium">{node.title}</span>
            )}
          </p>
          {node.text ? (
            <p className="mt-0.5 text-muted-foreground text-pretty">{node.text}</p>
          ) : null}
          {node.listLink ? (
            <p className="mt-1">
              <Go href={gastosFijosHref(tenantSlug)}>Ir a Gastos fijos</Go>
            </p>
          ) : null}
        </>
      )

    case 'foto':
      return (
        <DocumentAttachments
          bare
          tenantSlug={tenantSlug}
          documentId={documentId}
          attachments={attachments.ok ? attachments.data : []}
          canEdit={node.canEdit}
          loadError={attachments.ok ? null : attachments.message}
          emptyText={node.emptyText}
        />
      )

    case 'importado':
      return (
        <>
          <p>
            <Go href={importBatchHref(tenantSlug, node.batchId)}>{node.title}</Go>
          </p>
          <p className="mt-0.5 text-muted-foreground text-pretty">{node.text}</p>
          {node.note ? <p className="mt-1 text-muted-foreground text-pretty">{node.note}</p> : null}
        </>
      )

    case 'libro-iva':
      if (node.off) {
        return (
          <>
            <Empty title={node.off.title} hint={node.off.hint} />
            {node.off.guide ? (
              <p className="mt-1">
                <Go href={`${base}${GUIDE_PATHS.invoice}`}>¿Qué cambia con y sin factura?</Go>
              </p>
            ) : null}
          </>
        )
      }
      return (
        <>
          {node.groups.map((group) => (
            <div key={group.key} className="pb-2 last:pb-0">
              <p>
                <Go
                  href={`${base}/libros/${group.book === 'purchases' ? 'iva-compras' : 'iva-ventas'}?mes=${group.month}`}
                >
                  {group.title}
                </Go>
              </p>
              <ul className="mt-0.5 space-y-1 text-muted-foreground">
                {group.vouchers.map((voucher) => (
                  <li key={voucher.id} className={cn(voucher.voided && 'opacity-70')}>
                    <span className="block text-pretty">
                      <VoucherText text={voucher.label} />
                      {voucher.reversal ? ' · anulación' : ''}
                      {voucher.voided ? ' · Anulado' : ''}
                    </span>
                    <span className="flex flex-wrap gap-x-3">
                      {voucher.summary.map((item) => (
                        <span key={item.label} className="whitespace-nowrap">
                          {item.label} <Amount cents={item.cents} className="text-foreground" />
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {/* La contadora viene a esto: le llega abierto. */}
          <Fold label="Ver los importes" open={!canWrite}>
            <div className={cn(LIST, 'rounded-xl bg-secondary/50 px-3 py-2.5')}>
              {node.groups.flatMap((group) =>
                group.vouchers.map((voucher) => <IvaFacts key={voucher.id} voucher={voucher} />),
              )}
            </div>
          </Fold>
        </>
      )

    case 'arca':
      return arcaOutcome ? (
        <ArcaAuthorizationCard slug={tenantSlug} outcome={arcaOutcome} canWrite={canWrite} />
      ) : null

    case 'otros':
      return (
        // En el celular cada renglón deja lugar para tocar su link sin pisar el de al lado.
        <ul className="space-y-1.5 pointer-coarse:space-y-6">
          {node.rows.map((row) => (
            <li key={row.key} className="text-pretty">
              <RichLine rich={row.rich} base={base} />
            </li>
          ))}
        </ul>
      )

    case 'libros':
      return (
        <>
          <p>
            <Go href={`${base}/asientos/${node.entryId}`}>{node.title}</Go>
          </p>
          {node.period ? (
            <p className="mt-0.5 text-muted-foreground text-pretty">
              {node.period.closed ? (
                <Lock aria-hidden className="mr-1 inline size-3 align-[-0.05em]" />
              ) : null}
              {node.period.text}
            </p>
          ) : null}
          {node.detail ? <p className="mt-0.5 text-muted-foreground">{node.detail}</p> : null}
          {node.facts.map((fact) => (
            <p key={fact} className="mt-0.5 text-muted-foreground text-pretty">
              {fact}
            </p>
          ))}
        </>
      )
  }
}

export function DocumentLinks({
  tenantSlug,
  base,
  documentId,
  title,
  nodes,
  canWrite,
  attachments,
  arcaOutcome,
}: {
  tenantSlug: string
  /** `/<bar>/administracion`. */
  base: string
  documentId: string
  /** Dice qué falta («Le faltan el pago y la foto») o «Con qué está unido». */
  title: string
  nodes: readonly LinkNodeData[]
  canWrite: boolean
  attachments: QueryOutcome<DocumentAttachment[]>
  arcaOutcome: QueryOutcome<ArcaVoucherCard | null> | null
}) {
  if (nodes.length === 0) return null
  const guideHref = `${base}${GUIDE_PATHS.links}`
  const guide = (
    <Link
      href={guideHref}
      className={cn(
        'inline-flex min-h-11 items-center gap-0.5 rounded-sm text-sm whitespace-nowrap text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:min-h-0',
        FOCUS,
      )}
    >
      ¿Cómo se vincula cada cosa?
      <ChevronRight aria-hidden className="size-3.5" />
    </Link>
  )
  return (
    <Panel
      id="vinculos"
      title={title}
      action={<span className="hidden sm:inline-flex">{guide}</span>}
      footer={<span className="sm:hidden">{guide}</span>}
      className="sm:[&>footer]:hidden"
    >
      <LinkRail
        label="Con qué está unido este comprobante"
        origin="Este papel"
        aside={<LinkLegend />}
      >
        {nodes.map((node) => (
          <LinkNode
            key={node.id}
            id={node.id === 'foto' || node.id === 'arca' ? node.id : undefined}
            what={node.what}
            icon={ICONS[node.id]}
            how={node.how}
            state={node.state}
            limitHref={node.limit ? `${guideHref}#${linkAnchor(node.limit)}` : undefined}
          >
            <NodeBody
              node={node}
              base={base}
              tenantSlug={tenantSlug}
              documentId={documentId}
              canWrite={canWrite}
              attachments={attachments}
              arcaOutcome={arcaOutcome}
            />
          </LinkNode>
        ))}
      </LinkRail>
    </Panel>
  )
}
