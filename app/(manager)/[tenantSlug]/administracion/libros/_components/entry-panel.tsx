'use client'

import { ExternalLink, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import type { AccountOption } from '@/components/administracion/account-combobox'
import { DocumentAttachments } from '@/components/administracion/adjuntos/document-attachments'
import { Amount } from '@/components/administracion/amount'
import { PRow, PTable, PTd, PTh, PTotalRow } from '@/components/administracion/planilla'
import { Stamp } from '@/components/administracion/planilla/stamp'
import { VoucherText } from '@/components/administracion/voucher-text'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { entryKindLabel } from '@/lib/accounting/queries/labels'
import { imputationFlagText } from '@/lib/accounting/reimpute'
import { formatDateTime, formatIsoDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { VoidDocumentButton } from '../../comprobantes/[id]/_components/document-actions'
import type { EntryPanelData } from '../_lib/entry-panel'
import { loadEntryPanel } from '../_lib/entry-panel-actions'
import { ReimputationList, ReimputeClosedNotice, ReimputeForm } from './reimpute-form'

/**
 * El panel lateral del asiento: tocar una fila del Mayor o del Diario lo abre sin salir de la
 * pantalla (la fila y el período siguen ahí abajo). Es el camino de Silvia, min. 12: del mayor al
 * asiento, del asiento al comprobante y a su foto, y de ahí a cambiarle la cuenta.
 *
 * Los datos se piden al abrir (`loadEntryPanel`): un Mayor con doscientas filas no los trae por
 * adelantado. El plan de cuentas viene una sola vez por pantalla. Se cierra con Esc y el foco vuelve a
 * la fila desde donde se abrió.
 */

type PanelContextValue = {
  /** Abre el panel de un asiento; `origin` recibe el foco al cerrar. */
  open: (entryId: string, origin?: HTMLElement | null) => void
  /** Una fila se fue de la tabla (se reimputó): si tenía el foco, sigue en la que quedó en su lugar. */
  rowLeft: () => void
}

const PanelContext = createContext<PanelContextValue | null>(null)

/** A dónde vuelve el foco: la fila que abrió el panel, o la de al lado si esa ya no está. */
function focusCandidates(origin: HTMLElement | null): HTMLElement[] {
  if (!origin) return []
  const row = origin.closest('tr')
  const actionOf = (sibling: Element | null | undefined) =>
    sibling?.querySelector<HTMLElement>('[data-row-action]') ?? null
  return [origin, actionOf(row?.nextElementSibling), actionOf(row?.previousElementSibling)].filter(
    (el): el is HTMLElement => el !== null,
  )
}

function focusFirstConnected(candidates: readonly HTMLElement[]) {
  candidates.find((el) => el.isConnected)?.focus()
}

export function useEntryPanel(): PanelContextValue {
  const value = useContext(PanelContext)
  if (!value) throw new Error('useEntryPanel va adentro de EntryPanelProvider')
  return value
}

export function EntryPanelProvider({
  tenantSlug,
  canWrite,
  children,
}: {
  tenantSlug: string
  /** Los botones que cargan (Anular, Reabrir) son de quien tiene acceso de escritura. */
  canWrite: boolean
  children: ReactNode
}) {
  const base = `/${tenantSlug}/administracion`
  const [entryId, setEntryId] = useState<string | null>(null)
  const [data, setData] = useState<EntryPanelData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, startLoading] = useTransition()
  const accountsRef = useRef<AccountOption[] | null>(null)
  const originRef = useRef<HTMLElement[]>([])
  /** Lo último que se pidió: si se abre otro mientras tanto, la respuesta vieja no pisa nada. */
  const requestRef = useRef(0)

  const load = useCallback(
    (id: string) => {
      requestRef.current += 1
      const request = requestRef.current
      setError(null)
      startLoading(async () => {
        try {
          const result = await loadEntryPanel(tenantSlug, {
            entryId: id,
            withAccounts: accountsRef.current === null,
          })
          if (request !== requestRef.current) return
          if (!result.ok) {
            setError(result.message)
            return
          }
          if (result.data.accounts) accountsRef.current = result.data.accounts
          setData(result.data)
        } catch {
          if (request === requestRef.current) {
            setError('Sin conexión: no pudimos abrir el asiento. Probá de nuevo.')
          }
        }
      })
    },
    [tenantSlug],
  )

  const open = useCallback(
    (id: string, origin?: HTMLElement | null) => {
      originRef.current = focusCandidates(origin ?? null)
      setEntryId(id)
      setData(null)
      load(id)
    },
    [load],
  )

  const close = useCallback(() => {
    requestRef.current += 1
    setEntryId(null)
  }, [])

  const rowLeft = useCallback(() => {
    // Después de que la fila salió del DOM. Con el panel abierto todavía, el foco está adentro de él y
    // lo devuelve `onCloseAutoFocus`.
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (!active || active === document.body) focusFirstConnected(originRef.current)
    })
  }, [])

  const value = useMemo(() => ({ open, rowLeft }), [open, rowLeft])
  const shown = data && data.entry.id === entryId ? data : null

  return (
    <PanelContext.Provider value={value}>
      {children}
      <Sheet
        open={entryId !== null}
        onOpenChange={(next) => {
          if (!next) close()
        }}
      >
        <SheetContent
          side="right"
          className="w-full gap-0 sm:max-w-[30rem]"
          onCloseAutoFocus={(event) => {
            // Abierto a mano no tiene disparador: sin esto, el foco se pierde en el fondo.
            event.preventDefault()
            focusFirstConnected(originRef.current)
          }}
        >
          {shown ? (
            <PanelBody
              data={shown}
              base={base}
              tenantSlug={tenantSlug}
              canWrite={canWrite}
              accounts={accountsRef.current ?? []}
              onClose={close}
            />
          ) : error ? (
            <>
              <SheetHeader className="pr-12">
                <SheetTitle>Asiento</SheetTitle>
                <SheetDescription className="sr-only">No se pudo abrir.</SheetDescription>
              </SheetHeader>
              <div className="grid justify-items-start gap-3 px-4 pb-4">
                <p role="alert" className="text-sm text-destructive text-pretty">
                  {error}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 gap-2 md:h-9"
                  disabled={loading}
                  onClick={() => {
                    if (entryId) load(entryId)
                  }}
                >
                  <RotateCcw className="size-4" aria-hidden />
                  Reintentar
                </Button>
              </div>
            </>
          ) : (
            <PanelSkeleton />
          )}
        </SheetContent>
      </Sheet>
    </PanelContext.Provider>
  )
}

/** El botón de la fila que abre el panel: lo que se alcanza con el teclado. */
export function OpenEntryButton({
  entryId,
  className,
  children,
  'aria-label': ariaLabel,
}: {
  entryId: string
  className?: string
  children: ReactNode
  'aria-label'?: string
}) {
  const { open } = useEntryPanel()
  return (
    <button
      type="button"
      data-row-action=""
      aria-label={ariaLabel}
      className={cn(
        'rounded-sm font-mono text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:px-1',
        className,
      )}
      onClick={(event) => open(entryId, event.currentTarget)}
    >
      {children}
    </button>
  )
}

function PanelSkeleton() {
  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle className="sr-only">Abriendo el asiento</SheetTitle>
        <SheetDescription className="sr-only">Un momento.</SheetDescription>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-5 w-64 max-w-full" />
        <Skeleton className="h-3 w-40" />
      </SheetHeader>
      <div className="grid gap-3 px-4 pb-4">
        {['a', 'b', 'c'].map((k) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-44 max-w-[60%]" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
        <Skeleton className="mt-2 h-28 w-full rounded-lg" />
      </div>
    </>
  )
}

function entryTitle(entry: EntryPanelData['entry']): ReactNode {
  if (entry.number === null) return 'Asiento'
  return (
    <>
      Asiento <span className={entry.provisional ? 'italic' : undefined}>#{entry.number}</span>
      {entry.provisional ? <span className="sr-only"> (provisorio)</span> : null}
    </>
  )
}

function PanelBody({
  data,
  base,
  tenantSlug,
  canWrite,
  accounts,
  onClose,
}: {
  data: EntryPanelData
  base: string
  tenantSlug: string
  canWrite: boolean
  accounts: readonly AccountOption[]
  onClose: () => void
}) {
  const { entry, document: doc, lines, targets } = data
  const flagged = targets.some((t) => t.usual)
  const [reimputing, setReimputing] = useState(flagged)
  const posted = entry.status === 'posted'
  const balanced = entry.debitCents === entry.creditCents
  const canReimpute = posted && targets.length > 0
  const heading = [doc.title, doc.partyName].filter(Boolean).join(' · ')

  return (
    <>
      <SheetHeader className="border-b border-border/70 pr-12">
        <p className="text-xs text-muted-foreground">{entryTitle(entry)}</p>
        <SheetTitle className="text-base leading-snug text-pretty">
          <VoucherText text={heading} />
        </SheetTitle>
        <SheetDescription className="text-xs tabular-nums">
          {formatIsoDay(entry.date)}
          {entry.createdByName ? ` · Cargó ${entry.createdByName}` : ''}
          {entry.kind !== 'standard' ? ` · ${entryKindLabel(entry.kind)}` : ''}
        </SheetDescription>
      </SheetHeader>

      <div className="grid flex-1 content-start gap-4 overflow-y-auto p-4">
        {!posted ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive text-pretty">
            Anulado
            {entry.voidedAt ? ` el ${formatDateTime(entry.voidedAt)}` : ''}
            {entry.voidedByName ? ` por ${entry.voidedByName}` : ''}. No cuenta en los libros.
            {entry.voidReason ? ` Motivo: ${entry.voidReason}` : ''}
          </p>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-border/70">
          <PTable minWidth={320} label="Los renglones del asiento">
            <thead>
              <tr>
                <PTh>Cuenta</PTh>
                <PTh align="right">Debe</PTh>
                <PTh align="right">Haber</PTh>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <PRow key={line.id} flagged={line.usual !== null}>
                  <PTd className={cn('min-w-0', line.side === 'credit' && 'pl-6')}>
                    <span className="block">{line.accountName}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      {line.accountCode}
                    </span>
                    {line.partyName ? (
                      <span className="block text-xs text-muted-foreground">{line.partyName}</span>
                    ) : null}
                    {line.memo && line.memo !== line.accountName && line.memo !== doc.notes ? (
                      <span className="block text-xs text-muted-foreground">{line.memo}</span>
                    ) : null}
                    {line.usual ? (
                      <span className="block text-xs font-medium text-destructive text-pretty">
                        {imputationFlagText(
                          {
                            partyName: line.usual.partyName,
                            usualAccountName: line.usual.accountName,
                          },
                          { open: doc.periodOpen },
                        )}
                      </span>
                    ) : null}
                  </PTd>
                  <PTd align="right" className="align-top">
                    {line.side === 'debit' ? (
                      <Amount cents={line.amountCents} currency={false} />
                    ) : null}
                  </PTd>
                  <PTd align="right" className="align-top">
                    {line.side === 'credit' ? (
                      <Amount cents={line.amountCents} currency={false} />
                    ) : null}
                  </PTd>
                </PRow>
              ))}
            </tbody>
            <tfoot>
              <PTotalRow>
                <PTd className="font-semibold">
                  <span className="flex flex-wrap items-center gap-2">
                    Totales
                    {balanced ? <Stamp>Debe = Haber</Stamp> : <Stamp tone="bad">No cuadra</Stamp>}
                  </span>
                </PTd>
                <PTd align="right" className="font-semibold">
                  <Amount cents={entry.debitCents} currency={false} />
                </PTd>
                <PTd align="right" className="font-semibold">
                  <Amount cents={entry.creditCents} currency={false} />
                </PTd>
              </PTotalRow>
            </tfoot>
          </PTable>
        </div>

        {doc.notes ? (
          <p className="text-sm text-pretty">
            <span className="text-muted-foreground">{doc.notesLabel}: </span>
            {doc.notes}
          </p>
        ) : null}

        <DocumentAttachments
          bare
          tenantSlug={tenantSlug}
          documentId={doc.id}
          attachments={data.attachments}
          canEdit={false}
          loadError={data.attachmentsError}
          emptyText="Sin foto del comprobante."
        />

        {canReimpute && !doc.periodOpen ? (
          <ReimputeClosedNotice
            base={base}
            month={doc.month}
            documentId={doc.id}
            canWrite={canWrite}
          />
        ) : null}

        {canReimpute && doc.periodOpen && reimputing ? (
          <ReimputeForm
            tenantSlug={tenantSlug}
            targets={targets}
            accounts={accounts}
            autoFocus
            onDone={onClose}
          />
        ) : null}

        <ReimputationList items={data.reimputations} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 p-3">
        {canReimpute && doc.periodOpen && !reimputing ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-9"
            onClick={() => setReimputing(true)}
          >
            Reimputar
          </Button>
        ) : null}
        {data.voidable ? (
          <VoidDocumentButton
            tenantSlug={tenantSlug}
            documentId={doc.id}
            title={data.voidable.title}
            siblings={data.voidable.siblings}
            appliedCents={data.voidable.appliedCents}
            appliedWord={data.voidable.appliedWord}
            extraNotes={data.voidable.notes}
            onDone={onClose}
          />
        ) : null}
        <Button asChild variant="outline" className="h-11 gap-1.5 md:h-9">
          <Link href={`${base}/comprobantes/${doc.id}`}>
            Abrir comprobante
            <ExternalLink className="size-3.5" aria-hidden />
          </Link>
        </Button>
      </div>
    </>
  )
}
