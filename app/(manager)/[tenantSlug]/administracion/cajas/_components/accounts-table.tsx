'use client'

import { MoreHorizontal, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { MoneyTicker } from '@/components/administracion/kit/money-ticker'
import {
  CELL_INPUT,
  Planilla,
  PlanillaFoot,
  PTable,
  PTd,
  PTh,
  PTotalRow,
  ROW_ACTION,
} from '@/components/administracion/planilla'
import { toastUndo } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { saveTreasuryAccount } from '@/lib/accounting/actions/master'
import { setTreasuryBankTax } from '@/lib/accounting/actions/taxes'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useMasterAction } from '../../ajustes/_components/use-master-action'
import {
  treasuryDraftOf,
  treasuryRenamePayload,
  treasurySavePayload,
  treasuryTogglePayload,
} from '../../ajustes/_lib/payloads'
import type { CajaAccountRow, CajaView } from '../_lib/wallet-view'
import { AccountSheet } from './account-sheet'

/** El parámetro que abre el panel lateral de una cuenta: «atrás» lo cierra y el link lo abre. */
export const ACCOUNT_PARAM = 'cuenta'

/** Los mismos renglones que `PRow`, con el clic que abre el panel lateral. */
const ROW =
  'group/row cursor-pointer border-b border-border/60 transition-colors last:border-b-0 hover:bg-primary/[0.04] motion-reduce:transition-none'

const FOOT_LINK =
  'inline-flex min-h-10 items-center rounded-sm text-[13px] font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0'

/** Lo que se puede elegir al agregar una cuenta ahí mismo. La tarjeta de la empresa, en Ajustes. */
export const ADD_ACCOUNT_KINDS = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'bank', label: 'Banco' },
  { value: 'wallet', label: 'Billetera' },
] as const
type AddableKind = (typeof ADD_ACCOUNT_KINDS)[number]['value']

/**
 * El panel lateral vive en la URL (`?cuenta=<id>`), así «atrás» lo cierra y se puede compartir. Sin
 * pedir la página de nuevo: Next sincroniza `pushState` con `useSearchParams` (docs «Native History
 * API») si el estado no es el suyo; por eso va `null`.
 */
function useAccountPanel(accounts: readonly CajaAccountRow[]) {
  const requested = useSearchParams().get(ACCOUNT_PARAM)
  const pushed = useRef(false)
  const selected = accounts.find((account) => account.id === requested) ?? null
  // Se conserva al cerrar: la salida del panel no muestra uno vacío.
  const last = useRef<CajaAccountRow | null>(null)
  if (selected) last.current = selected

  const open = (id: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set(ACCOUNT_PARAM, id)
    window.history.pushState(null, '', `${url.pathname}${url.search}`)
    pushed.current = true
  }
  const close = () => {
    if (pushed.current) {
      pushed.current = false
      window.history.back()
      return
    }
    const url = new URL(window.location.href)
    url.searchParams.delete(ACCOUNT_PARAM)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }
  return { open, close, isOpen: selected !== null, account: selected ?? last.current }
}

/** Lo que dice la celda del saldo: nunca un menos pelado, y sin saldo inicial, ningún «$ 0». */
function BalanceCell({ account }: { account: CajaAccountRow }) {
  const { money, unknown, pendingCents } = account
  if (unknown) return <span className="text-muted-foreground">¿cuánto hay?</span>
  if (money.words) return <span className="text-muted-foreground">{money.words}</span>
  const overdrawn = money.label === 'Descubierto'
  return (
    <>
      {money.label ? (
        <span
          className={cn('mr-1 text-xs', overdrawn ? 'text-destructive' : 'text-muted-foreground')}
        >
          {money.label}
        </span>
      ) : null}
      <span className={cn('font-semibold', overdrawn && 'text-destructive')}>{money.amount}</span>
      {pendingCents > 0 ? (
        <span className="block text-xs text-muted-foreground">
          + {formatCentsShort(pendingCents)} en camino
        </span>
      ) : null}
    </>
  )
}

/** Cambiar el nombre ahí mismo: Enter o salir guarda; Esc lo deja como estaba. */
function RenameField({
  name,
  onDone,
}: {
  name: string
  /** `null`: se canceló. */
  onDone: (next: string | null) => void
}) {
  const [text, setText] = useState(name)
  const input = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <input
      ref={input}
      value={text}
      maxLength={60}
      autoComplete="off"
      aria-label={`Nombre de ${name}`}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => finish(text)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(text)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finish(null)
        }
      }}
      className={cn(CELL_INPUT, 'w-full max-w-64 text-left max-sm:h-10')}
    />
  )
}

/** El «⋯» de una cuenta: lo que se hace de vez en cuando con ella. */
function AccountMenu({
  account,
  bankTax,
  onRename,
  onTransfer,
  onBankTax,
  onActive,
}: {
  account: CajaAccountRow
  /** El interruptor, con el valor que se ve (`null`: esta cuenta no lo tiene). */
  bankTax: boolean | null
  onRename: () => void
  onTransfer: () => void
  onBankTax: (value: boolean) => void
  onActive: (active: boolean) => void
}) {
  // «Cambiar el nombre» deja el cursor en su campo: al cerrarse, el foco no vuelve al «⋯».
  const keepFocus = useRef(false)
  const editable = account.updatedAt !== null
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Más opciones de ${account.name}`}
          className={cn(
            ROW_ACTION,
            'px-2 max-sm:size-10 [@media(hover:hover)]:data-[state=open]:opacity-100',
          )}
        >
          <MoreHorizontal aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-56"
        onCloseAutoFocus={(event) => {
          if (!keepFocus.current) return
          keepFocus.current = false
          event.preventDefault()
        }}
      >
        {editable ? (
          <DropdownMenuItem
            className="max-sm:min-h-11"
            onSelect={() => {
              keepFocus.current = true
              onRename()
            }}
          >
            Cambiar el nombre
          </DropdownMenuItem>
        ) : null}
        {account.active ? (
          <DropdownMenuItem className="max-sm:min-h-11" onSelect={onTransfer}>
            Transferir a otra cuenta
          </DropdownMenuItem>
        ) : null}
        {bankTax !== null ? (
          <DropdownMenuItem
            role="menuitemcheckbox"
            aria-checked={bankTax}
            className="justify-between gap-4 max-sm:min-h-11"
            onSelect={(event) => {
              // El menú queda abierto: se ve cómo cambió.
              event.preventDefault()
              onBankTax(!bankTax)
            }}
          >
            Cobra impuesto al cheque
            <Switch checked={bankTax} tabIndex={-1} aria-hidden className="pointer-events-none" />
          </DropdownMenuItem>
        ) : null}
        {editable ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="max-sm:min-h-11"
              onSelect={() => onActive(!account.active)}
            >
              {account.active ? 'Desactivar' : 'Volver a usar'}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** «+ Agregar cuenta», en el lugar: nombre, tipo y Crear, sin irse de la pantalla. */
function AddAccountRow({
  tenantSlug,
  base,
  columns,
  openingPending,
  onCreated,
}: {
  tenantSlug: string
  base: string
  columns: number
  openingPending: boolean
  onCreated: (id: string) => void
}) {
  const router = useRouter()
  const { pending, run } = useMasterAction()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AddableKind>('cash')
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
  }, [])

  const create = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    // Mismo envío que el alta de Ajustes › Cajas y cuentas (un banco se suma como proveedor).
    const payload = treasurySavePayload({ ...treasuryDraftOf(null), name, kind })
    run(() => saveTreasuryAccount(tenantSlug, payload), {
      quiet: true,
      onSuccess: (row, message) => {
        toast.success(
          message,
          openingPending
            ? {
                description: 'Arranca en $ 0: lo que tiene hoy se carga con los saldos iniciales.',
                action: {
                  label: 'Cargar los saldos iniciales',
                  onClick: () => router.push(`${base}/configurar`),
                },
              }
            : { description: 'Arranca en $ 0.' },
        )
        onCreated(row.id)
      },
      onFailure: (state) => setError(state.fieldErrors?.name ?? state.message),
    })
  }

  return (
    <tr className="border-b border-border/60 bg-secondary/30">
      <td colSpan={columns} className="px-3 py-2">
        <form onSubmit={create} className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            value={name}
            maxLength={60}
            autoComplete="off"
            placeholder="Nombre"
            aria-label="Nombre de la cuenta"
            aria-invalid={error ? true : undefined}
            onChange={(event) => setName(event.target.value)}
            className={cn(CELL_INPUT, 'h-8 min-w-40 flex-1 bg-card text-left max-sm:h-10')}
          />
          <Select value={kind} onValueChange={(value) => setKind(value as AddableKind)}>
            <SelectTrigger size="sm" aria-label="Tipo de cuenta" className="bg-card max-sm:h-10">
              <SelectValue>
                {ADD_ACCOUNT_KINDS.find((option) => option.value === kind)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ADD_ACCOUNT_KINDS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" size="sm" disabled={pending} className="max-sm:h-10">
            {pending ? 'Creando…' : 'Crear'}
          </Button>
        </form>
        {error ? (
          <p role="alert" className="mt-1.5 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </td>
    </tr>
  )
}

/**
 * Caja: «cuánto hay en cada cuenta». Una sola tabla con el total de doble raya (el pedido de Luciano:
 * «un totalizador de cuánto dinero hay en cada cuenta»).
 *
 * - Tocar una fila abre sus movimientos en un panel lateral.
 * - Al pasar por la fila, [Contar] y [⋯] (en táctil, siempre). Una cuenta a la que le toca contarse
 *   deja su botón a la vista.
 * - El «⋯» tiene lo que se hace de vez en cuando; «Transferir a otra cuenta» es la hoja `?accion=mover`.
 * - «+ Agregar cuenta» se resuelve ahí mismo: hay veces que se agrega una y se saca otra.
 *
 * Quien solo lee ve lo mismo sin ningún control: las filas igual abren los movimientos.
 */
export function AccountsTable({
  tenantSlug,
  base,
  view,
  exportHref,
  exportFileName,
}: {
  tenantSlug: string
  /** `/<bar>/administracion`. */
  base: string
  view: CajaView
  exportHref: string
  exportFileName: string
}) {
  const { readOnly, openAction } = useAccounting()
  const { run } = useMasterAction()
  const canWrite = !readOnly
  const all = [...view.accounts, ...view.apart]
  const panel = useAccountPanel(all)
  // Sin ninguna cuenta, el paso que sigue es agregar la primera: el renglón ya está abierto.
  const [adding, setAdding] = useState(canWrite && view.status === 'no_treasuries')
  const [renaming, setRenaming] = useState<string | null>(null)
  // Lo que se ve al toque, mientras la base contesta.
  const [renamed, setRenamed] = useState<Readonly<Record<string, string>>>({})
  const [bankTaxes, setBankTaxes] = useState<Readonly<Record<string, boolean>>>({})
  const [justCreated, setJustCreated] = useState<string | null>(null)

  // Cuenta · (Tipo · Último movimiento, desde `sm`) · Saldo · (acciones, si puede cargar).
  const columns = canWrite ? 5 : 4

  const rename = (account: CajaAccountRow, next: string | null) => {
    setRenaming(null)
    const name = next?.trim() ?? ''
    if (name === '' || name === account.name || account.updatedAt === null) return
    const { id, kind, updatedAt } = account
    setRenamed((before) => ({ ...before, [id]: name }))
    run(
      () => saveTreasuryAccount(tenantSlug, treasuryRenamePayload({ id, kind, updatedAt }, name)),
      {
        quiet: true,
        onFailure: (state) => {
          setRenamed(({ [id]: _gone, ...rest }) => rest)
          toast.error(state.message)
        },
      },
    )
  }

  const setBankTax = (account: CajaAccountRow, value: boolean) => {
    const { id } = account
    setBankTaxes((before) => ({ ...before, [id]: value }))
    run(() => setTreasuryBankTax(tenantSlug, { treasuryId: id, value }), {
      quiet: true,
      onFailure: (state) => {
        setBankTaxes(({ [id]: _gone, ...rest }) => rest)
        toast.error(state.message)
      },
    })
  }

  const setActive = (account: CajaAccountRow, active: boolean) => {
    const { updatedAt: expected } = account
    if (expected === null) return
    const facts = { id: account.id, name: account.name, kind: account.kind }
    run(
      () =>
        saveTreasuryAccount(
          tenantSlug,
          treasuryTogglePayload({ ...facts, updatedAt: expected }, active),
        ),
      {
        quiet: true,
        onSuccess: (saved, message) => {
          // Se revierte en un toque; lo que no se puede deshacer (tiene saldo) lo frena la base.
          if (!active && saved.updatedAt) {
            const updatedAt = saved.updatedAt
            toastUndo(message, {
              onUndo: () =>
                run(() =>
                  saveTreasuryAccount(
                    tenantSlug,
                    treasuryTogglePayload({ ...facts, updatedAt }, true),
                  ),
                ),
            })
          } else {
            toast.success(active ? `«${account.name}» volvió a estar en uso.` : message)
          }
        },
      },
    )
  }

  const row = (account: CajaAccountRow): ReactNode => {
    const name = renamed[account.id] ?? account.name
    const isRenaming = renaming === account.id
    const bankTax = bankTaxes[account.id] ?? account.bankTax
    const kindText = account.active ? account.kindLabel : `${account.kindLabel} · desactivada`
    return (
      // El clic en la fila es un atajo del mouse y del dedo; con teclado está el botón del nombre.
      <tr
        key={account.id}
        className={cn(ROW, justCreated === account.id && 'adm-flash')}
        onClick={(event) => {
          const target = event.target as Element
          // Lo que viene de un menú (en un portal), de un botón o de un campo no abre el panel.
          if (!event.currentTarget.contains(target)) return
          if (isRenaming || target.closest('a,button,input,[role="combobox"]')) return
          panel.open(account.id)
        }}
      >
        <PTd>
          {isRenaming ? (
            <RenameField name={name} onDone={(next) => rename(account, next)} />
          ) : (
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => panel.open(account.id)}
              className="max-w-full rounded-sm text-left underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-10"
            >
              {name}
            </button>
          )}
          <span className="block text-xs text-muted-foreground sm:hidden">
            {kindText} · {account.lastMovement}
          </span>
        </PTd>
        <PTd className="text-[13px] text-muted-foreground max-sm:hidden">{kindText}</PTd>
        <PTd className="text-[13px] text-muted-foreground max-sm:hidden">
          {account.lastMovement}
        </PTd>
        <PTd align="right">
          <BalanceCell account={account} />
        </PTd>
        {canWrite ? (
          <PTd align="right" className="w-px">
            <span className="flex items-center justify-end gap-1">
              {account.action ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  title={account.countText ?? undefined}
                  aria-label={account.action.ariaLabel}
                  onClick={() => {
                    const sheet = account.action?.sheet
                    if (sheet) openAction(sheet, { caja: account.id })
                  }}
                  className={cn(account.action.due ? undefined : ROW_ACTION, 'max-sm:h-10')}
                >
                  {account.action.label}
                </Button>
              ) : null}
              <AccountMenu
                account={account}
                bankTax={bankTax}
                onRename={() => setRenaming(account.id)}
                onTransfer={() => openAction('mover', { caja: account.id })}
                onBankTax={(value) => setBankTax(account, value)}
                onActive={(active) => setActive(account, active)}
              />
            </span>
          </PTd>
        ) : null}
      </tr>
    )
  }

  const showTable = all.length > 0 || adding

  return (
    <>
      <Planilla>
        {view.notice ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/70 px-3 py-2.5">
            <div className="min-w-0 flex-1 basis-64 text-sm">
              <p className="font-semibold">{view.notice.title}</p>
              <p className="text-muted-foreground text-pretty">{view.notice.sentence}</p>
            </div>
            {view.notice.action ? (
              <Button asChild size="sm" className="max-sm:h-10">
                <Link href={view.notice.action.href}>{view.notice.action.label}</Link>
              </Button>
            ) : null}
          </div>
        ) : null}

        {showTable ? (
          <PTable label="Cuánto hay en cada cuenta" minWidth={0}>
            <thead>
              <tr>
                <PTh>Cuenta</PTh>
                <PTh className="max-sm:hidden">Tipo</PTh>
                <PTh className="max-sm:hidden">Último movimiento</PTh>
                <PTh align="right">Saldo</PTh>
                {canWrite ? (
                  <PTh>
                    <span className="sr-only">Acciones</span>
                  </PTh>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {view.accounts.map(row)}
              {adding ? (
                <AddAccountRow
                  tenantSlug={tenantSlug}
                  base={base}
                  columns={columns}
                  openingPending={view.openingPending}
                  onCreated={(id) => {
                    setAdding(false)
                    setJustCreated(id)
                  }}
                />
              ) : null}
            </tbody>
            {view.accounts.length > 0 ? (
              <tbody>
                <PTotalRow>
                  <PTd>Total</PTd>
                  <PTd colSpan={2} className="max-sm:hidden" />
                  <PTd align="right">
                    {view.total === null ? (
                      <span className="font-normal text-muted-foreground">
                        <span aria-hidden>—</span>
                        <span className="sr-only">Sin dato</span>
                      </span>
                    ) : (
                      <>
                        {view.total.overdrawn ? (
                          <span className="mr-1 text-xs font-normal text-destructive">
                            Descubierto
                          </span>
                        ) : null}
                        <MoneyTicker cents={view.total.cents} align="end" />
                      </>
                    )}
                  </PTd>
                  {canWrite ? <PTd /> : null}
                </PTotalRow>
              </tbody>
            ) : null}
            {view.apart.length > 0 ? (
              <tbody>
                <tr className="border-b border-border/60">
                  <td
                    colSpan={columns}
                    className="px-3 pt-3 pb-1.5 text-xs font-medium text-muted-foreground"
                  >
                    Aparte: no suman
                  </td>
                </tr>
                {view.apart.map(row)}
              </tbody>
            ) : null}
          </PTable>
        ) : null}

        <PlanillaFoot>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href={`${base}/cajas?tab=flujo`} className={FOOT_LINK}>
              Ver el detalle
            </Link>
            {canWrite ? (
              <Link href={`${base}/ajustes?tab=cajas`} className={FOOT_LINK}>
                Datos de las cuentas
              </Link>
            ) : null}
            <ExportButton
              href={exportHref}
              fileName={exportFileName}
              variant="ghost"
              size="sm"
              className="-ml-2 text-[13px] font-medium max-sm:h-10"
            />
          </div>
          {canWrite ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={adding}
              onClick={() => setAdding((open) => !open)}
              className="gap-1 max-sm:h-10"
            >
              {adding ? (
                'Cancelar'
              ) : (
                <>
                  <Plus aria-hidden className="size-3.5" />
                  Agregar cuenta
                </>
              )}
            </Button>
          ) : null}
        </PlanillaFoot>
      </Planilla>

      <AccountSheet
        tenantSlug={tenantSlug}
        base={base}
        account={panel.account}
        open={panel.isOpen}
        openingPending={view.openingPending}
        onClose={panel.close}
      />
    </>
  )
}
