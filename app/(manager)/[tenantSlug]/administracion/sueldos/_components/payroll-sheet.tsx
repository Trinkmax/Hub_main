'use client'

import { SplitSquareHorizontal } from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useId, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { documentHref } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import {
  AMOUNT_ALIGN,
  CellMoney,
  type CellSave,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/cell-money'
import { SaveMark } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/save-mark'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { PosCashTray } from '@/components/administracion/caja-salon/pos-cash-tray'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import {
  PHONE_FIT,
  PHONE_HIDDEN,
  Planilla,
  PlanillaFoot,
  PRow,
  PTable,
  PTd,
  PTh,
  PTotalRow,
  ROW_ACTION,
} from '@/components/administracion/planilla'
import { Stamp } from '@/components/administracion/planilla/stamp'
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
import { Input } from '@/components/ui/input'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { saveEmployee, saveEmployeeSalary } from '@/lib/accounting/actions/payroll'
import {
  accrualOffer,
  employeeBalanceCents,
  employeeParts,
  monthWord,
  movementWords,
  PAY_FREQUENCY_LABELS,
  PAYROLL_KIND_LABELS,
  PAYROLL_KIND_OF_PURPOSE,
  type PayFrequency,
  type PayrollEmployee,
  type PayrollKind,
  type PayrollPendingCash,
  type PayrollReport,
  payrollExtras,
  payrollHref,
  payrollTotals,
  pendingCashMonth,
  pendingCashSums,
  periodWords,
} from '@/lib/accounting/payroll'
import {
  isPayrollPurpose,
  POS_CASH_PURPOSE_LABELS,
  type PosCashPending,
} from '@/lib/accounting/pos-cash'
import { formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { SalaryPartsDialog, salaryPartsWords } from './salary-parts'

/** Traen el motor contable: bajan recién cuando se abre uno. */
const MovementDialog = dynamic(() => import('./payroll-dialogs').then((m) => m.MovementDialog))
const AccrualDialog = dynamic(() => import('./payroll-dialogs').then((m) => m.AccrualDialog))

const TEXT_LINK =
  'rounded-sm font-medium text-foreground underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring'
const QUIET_BUTTON =
  'inline-flex min-h-8 cursor-pointer items-center rounded-sm text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 pointer-coarse:min-h-11'

const dash = (
  <span className="text-muted-foreground">
    <span aria-hidden>–</span>
    <span className="sr-only">Nada</span>
  </span>
)

/** Un importe de la tabla: «–» si no hay nada, nunca «$ 0» en una columna llena de ceros. */
function Money({ cents }: { cents: number }) {
  return cents === 0 ? dash : formatCentsShort(cents)
}

type MovementTarget = { kind: PayrollKind; employee: PayrollEmployee }

/** Los retiros de la caja que se están pasando a los libros, uno atrás del otro. */
type Passing = { ids: string[]; position: number }

/** Lo que salió de la caja: una marca chica debajo del importe que ya lo cuenta. */
function CashMark({ cents }: { cents: number }) {
  if (cents <= 0) return null
  return (
    <small
      className="block text-[11px] leading-tight font-normal text-warning-text"
      title="Salió de la caja del salón y falta pasarlo a los libros."
    >
      {formatCentsShort(cents)} de la caja
    </small>
  )
}

/**
 * La persona de un retiro. Si no está en la planilla de este mes (está de baja y sin movimientos), se
 * arma con lo que anotó la caja: el comprobante se puede cargar igual.
 */
function employeeOf(
  employees: readonly PayrollEmployee[],
  item: PosCashPending,
): PayrollEmployee | null {
  if (!item.employeeId) return null
  return (
    employees.find((employee) => employee.id === item.employeeId) ?? {
      id: item.employeeId,
      name: item.employeeName ?? 'Sin nombre',
      branchId: item.branchId,
      payFrequency: 'monthly',
      active: false,
      notes: null,
      salaryCents: 0,
      advancesCents: 0,
      paidCents: 0,
      movements: [],
    }
  )
}

/**
 * La planilla de Sueldos de un mes: Empleado · Sueldo · Adelantos · Pagado · Saldo · Horas extra, con
 * [Adelanto], [Pagar] y [Horas extra] al pasar y el total con su doble raya. Tocar la fila despliega
 * sus movimientos. Al pie, agregar a alguien en el lugar y «Devengar».
 *
 * Arriba, solo si hay: la bandeja «De la caja del salón», con los retiros para el personal que
 * todavía no tienen comprobante. La planilla ya los cuenta (cada uno con su marca «de la caja»);
 * «Pasar a <mes>» abre el diálogo de siempre ya completo y, al guardar, sigue con el que viene.
 *
 * A la contadora no se le dibuja nada que escriba (ni celdas, ni botones, ni el alta) ni la apertura
 * del sueldo en blanco y en negro.
 */
export function PayrollSheet({
  report,
  today,
  canWrite,
  pendingCash = [],
}: {
  report: PayrollReport
  today: string
  canWrite: boolean
  /** Los retiros de la caja del salón para el personal que esperan su comprobante (de cualquier mes). */
  pendingCash?: readonly PosCashPending[]
}) {
  const { tenantSlug, readOnly } = useAccounting()
  // Dos guardas: el permiso que manda la página y el de la sección.
  const writable = canWrite && !readOnly
  const { month, employees } = report
  const mes = monthWord(month)
  const totals = payrollTotals(employees)
  const extras = payrollExtras(employees)
  const offer = accrualOffer(report, today)
  // Devengado el mes, sus sueldos quedan fijos: para cambiarlos hay que anular el asiento.
  const locked = report.accrual !== null
  const cols = writable ? 7 : 6

  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [movement, setMovement] = useState<MovementTarget | null>(null)
  const [accruing, setAccruing] = useState(false)
  const [splitting, setSplitting] = useState<PayrollEmployee | null>(null)
  const [passing, setPassing] = useState<Passing | null>(null)

  // Solo los del personal, y solo para quien carga: a un proveedor se le paga desde Compras.
  const tray = writable ? pendingCash.filter((item) => isPayrollPurpose(item.purpose)) : []
  // El que toca: el primero de la fila que sigue esperando (otro pudo pasarlo mientras tanto).
  const passingIndex = passing
    ? passing.ids.findIndex(
        (id, index) => index >= passing.position && tray.some((item) => item.id === id),
      )
    : -1
  const passingItem =
    passing && passingIndex >= 0
      ? (tray.find((item) => item.id === passing.ids[passingIndex]) ?? null)
      : null
  const passingEmployee = passingItem ? employeeOf(employees, passingItem) : null

  // Se terminó la fila (o lo que quedaba ya no espera): no queda nada abierto.
  useEffect(() => {
    if (passing && !passingItem) setPassing(null)
  }, [passing, passingItem])

  /** Arranca por ese retiro y sigue con los demás, en el orden de la bandeja. */
  const startPassing = (id: string) => {
    const index = tray.findIndex((item) => item.id === id)
    if (index < 0) return
    const ordered = [...tray.slice(index), ...tray.slice(0, index)]
    setPassing({ ids: ordered.map((item) => item.id), position: 0 })
  }

  return (
    <>
      <PosCashTray
        tenantSlug={tenantSlug}
        items={tray}
        note={
          tray.length === 1
            ? 'la planilla ya lo cuenta; falta pasarlo a los libros.'
            : 'la planilla ya los cuenta; falta pasarlos a los libros.'
        }
        actions={(item) => (
          <>
            {/* Se pasa al mes que se está mirando: si parece de otro, se ofrece ir a ese. */}
            {pendingCashMonth(item) !== month ? (
              <Link href={payrollHref(tenantSlug, pendingCashMonth(item))} className={QUIET_BUTTON}>
                ¿De {monthWord(pendingCashMonth(item))}?
              </Link>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="bg-card pointer-coarse:h-11"
              aria-label={`Pasar a ${mes}: ${POS_CASH_PURPOSE_LABELS[item.purpose]} de ${item.employeeName ?? 'alguien del equipo'}, ${formatCentsShort(item.amountCents)}`}
              onClick={() => startPassing(item.id)}
            >
              Pasar a {mes}
            </Button>
          </>
        )}
      />
      <Planilla>
        <PTable minWidth={writable ? 880 : 640} className={PHONE_FIT} label={`Sueldos de ${mes}`}>
          <thead>
            <tr>
              <PTh>Empleado</PTh>
              <PTh align="right">Sueldo</PTh>
              <PTh align="right" className={PHONE_HIDDEN}>
                Adelantos
              </PTh>
              <PTh align="right" className={PHONE_HIDDEN}>
                Pagado
              </PTh>
              <PTh align="right">Saldo</PTh>
              <PTh align="right" className={PHONE_HIDDEN}>
                Horas extra
              </PTh>
              {writable ? (
                <PTh>
                  <span className="sr-only">Cargar</span>
                </PTh>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 ? (
              <tr>
                <td colSpan={cols} className="px-3 py-6 text-center">
                  <p className="text-sm text-muted-foreground text-pretty">
                    {writable
                      ? 'Todavía no cargaste a tu equipo.'
                      : 'Todavía no hay empleados cargados.'}
                  </p>
                  {writable && !adding ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3 h-11"
                      onClick={() => setAdding(true)}
                    >
                      Agregar empleado
                    </Button>
                  ) : null}
                </td>
              </tr>
            ) : null}
            {employees.map((employee) => (
              <EmployeeRow
                key={`${employee.id}-${month}`}
                employee={employee}
                month={month}
                writable={writable}
                locked={locked}
                cols={cols}
                open={openId === employee.id}
                onToggle={() => setOpenId((id) => (id === employee.id ? null : employee.id))}
                onMove={(kind) => setMovement({ kind, employee })}
                onSplit={() => setSplitting(employee)}
                onPass={startPassing}
              />
            ))}
          </tbody>
          {employees.length > 0 ? (
            <tfoot>
              <PTotalRow>
                <PTd>Total</PTd>
                <PTd align="right">
                  <span className={AMOUNT_ALIGN}>{formatCentsShort(totals.salaryCents)}</span>
                </PTd>
                <PTd align="right" className={PHONE_HIDDEN}>
                  {formatCentsShort(totals.advancesCents)}
                </PTd>
                <PTd align="right" className={PHONE_HIDDEN}>
                  {formatCentsShort(totals.paidCents)}
                </PTd>
                <PTd align="right">{formatCentsShort(totals.balanceCents)}</PTd>
                <PTd align="right" className={PHONE_HIDDEN}>
                  <Money cents={extras.overtimeCents} />
                </PTd>
                {writable ? <PTd /> : null}
              </PTotalRow>
            </tfoot>
          ) : null}
        </PTable>

        {offer.kind === 'done' || (writable && (employees.length > 0 || adding)) ? (
          <PlanillaFoot>
            <div className="flex min-h-8 flex-wrap items-center gap-2.5">
              {offer.kind === 'done' ? (
                <>
                  <Stamp tone="ok">Devengado</Stamp>
                  <Link
                    href={documentHref(tenantSlug, offer.accrual.documentId)}
                    className={TEXT_LINK}
                  >
                    Ver el asiento
                  </Link>
                </>
              ) : writable && offer.kind === 'ready' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="pointer-coarse:h-11"
                  onClick={() => setAccruing(true)}
                >
                  Devengar {mes}
                </Button>
              ) : writable && offer.kind === 'no_total' && employees.length > 0 ? (
                <span className="text-sm text-muted-foreground">
                  Para devengar {mes}, cargá los sueldos.
                </span>
              ) : null}
            </div>
            {writable && !adding && employees.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="pointer-coarse:h-11"
                onClick={() => setAdding(true)}
              >
                Agregar empleado
              </Button>
            ) : null}
            {writable && adding ? <EmployeeForm onClose={() => setAdding(false)} keepOpen /> : null}
          </PlanillaFoot>
        ) : null}
      </Planilla>

      {movement ? (
        <MovementDialog
          key={`${movement.employee.id}-${movement.kind}`}
          kind={movement.kind}
          employee={movement.employee}
          month={month}
          onClose={() => setMovement(null)}
        />
      ) : null}
      {passing && passingItem && passingEmployee && isPayrollPurpose(passingItem.purpose) ? (
        <MovementDialog
          key={passingItem.id}
          kind={PAYROLL_KIND_OF_PURPOSE[passingItem.purpose]}
          employee={passingEmployee}
          month={month}
          source={{
            posCash: passingItem,
            step: { index: passingIndex + 1, total: passing.ids.length },
          }}
          onClose={() => setPassing(null)}
          // Guardado: el que sigue se abre solo, ya completo.
          onSaved={() =>
            setPassing((current) =>
              current && passingIndex + 1 < current.ids.length
                ? { ...current, position: passingIndex + 1 }
                : null,
            )
          }
        />
      ) : null}
      {splitting ? (
        <SalaryPartsDialog
          key={splitting.id}
          employee={splitting}
          month={month}
          onClose={() => setSplitting(null)}
        />
      ) : null}
      {accruing && offer.kind === 'ready' ? (
        <AccrualDialog
          month={month}
          totalCents={offer.totalCents}
          onClose={() => setAccruing(false)}
        />
      ) : null}
    </>
  )
}

function EmployeeRow({
  employee,
  month,
  writable,
  locked,
  cols,
  open,
  onToggle,
  onMove,
  onSplit,
  onPass,
}: {
  employee: PayrollEmployee
  month: string
  writable: boolean
  locked: boolean
  cols: number
  open: boolean
  onToggle: () => void
  onMove: (kind: PayrollKind) => void
  /** Abrir el sueldo en sus dos partes (en blanco y en negro). */
  onSplit: () => void
  /** Pasar a los libros un retiro de la caja del salón. */
  onPass: (posCashId: string) => void
}) {
  const panelId = useId()
  const balance = employeeBalanceCents(employee)
  const frequency = PAY_FREQUENCY_LABELS[employee.payFrequency]
  const pending = pendingCashSums(employee.pendingCash)
  // La apertura en blanco y en negro es de quien carga: a la contadora no se le dibuja.
  const partsWords = writable ? salaryPartsWords(employee) : null
  return (
    <>
      <PRow className="relative">
        <PTd className="min-w-40 max-sm:min-w-28">
          {/* El nombre es el botón que abre la fila, estirado a toda ella. */}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
            className="block cursor-pointer text-left font-medium [overflow-wrap:anywhere] outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
          >
            {employee.name}
          </button>
          <small className="block text-xs text-muted-foreground">
            {employee.active ? frequency : `${frequency} · De baja`}
          </small>
        </PTd>
        <PTd align="right">
          {writable && !locked ? (
            <span className="relative z-[1] inline-flex items-center gap-1">
              {partsWords ? (
                // Con parte en negro el total no se escribe en la celda: se abre en sus dos partes.
                <button
                  type="button"
                  onClick={onSplit}
                  aria-label={`Sueldo de ${employee.name}: ${formatCentsShort(employee.salaryCents)}. ${partsWords}. Cambiar`}
                  className={cn(
                    AMOUNT_ALIGN,
                    'cursor-pointer rounded-md py-0.5 pl-2 text-right outline-none hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  {formatCentsShort(employee.salaryCents)}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onSplit}
                    title="En blanco y en negro"
                    aria-label={`Partir el sueldo de ${employee.name} en blanco y en negro`}
                    className={cn(
                      ROW_ACTION,
                      'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:hidden',
                    )}
                  >
                    <SplitSquareHorizontal aria-hidden className="size-4" />
                  </button>
                  <SalaryCell employee={employee} month={month} />
                </>
              )}
            </span>
          ) : (
            <span
              className={AMOUNT_ALIGN}
              title={locked ? 'Devengado: para cambiarlo, anulá el asiento.' : undefined}
            >
              <Money cents={employee.salaryCents} />
            </span>
          )}
          {partsWords ? (
            <small
              className={cn(
                AMOUNT_ALIGN,
                'block text-[11px] leading-tight font-normal text-muted-foreground',
              )}
            >
              {partsWords}
            </small>
          ) : null}
        </PTd>
        <PTd align="right" className={PHONE_HIDDEN}>
          <Money cents={employee.advancesCents} />
          <CashMark cents={pending.advance} />
        </PTd>
        <PTd align="right" className={PHONE_HIDDEN}>
          <Money cents={employee.paidCents} />
          <CashMark cents={pending.salary} />
        </PTd>
        <PTd align="right">
          <span className="font-semibold" title={balance < 0 ? 'Le pagaste de más' : undefined}>
            <Money cents={balance} />
          </span>
        </PTd>
        <PTd align="right" className={PHONE_HIDDEN}>
          <span className="text-muted-foreground">
            <Money cents={employee.overtimeCents ?? 0} />
          </span>
          <CashMark cents={pending.overtime} />
        </PTd>
        {writable ? (
          <PTd align="right" className="w-[17.5rem] max-sm:w-44">
            <span className={cn(ROW_ACTION, 'relative z-[1] inline-flex gap-1.5')}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="pointer-coarse:h-11"
                aria-label={`Adelanto a ${employee.name}`}
                onClick={() => onMove('advance')}
              >
                Adelanto
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="pointer-coarse:h-11"
                aria-label={`Pagar el sueldo de ${employee.name}`}
                onClick={() => onMove('payment')}
              >
                Pagar
              </Button>
              {/* En el celular no entra: está en la fila abierta y en el diálogo de los otros dos. */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="max-sm:hidden pointer-coarse:h-11"
                aria-label={`Horas extra de ${employee.name}`}
                onClick={() => onMove('overtime')}
              >
                Horas extra
              </Button>
            </span>
          </PTd>
        ) : null}
      </PRow>
      {open ? (
        <tr id={panelId}>
          <td colSpan={cols} className="border-b border-border/60 bg-secondary/40 p-0">
            <div className="sticky left-0 grid w-full max-w-[calc(100vw-2rem-2px)] gap-2.5 px-3 py-2.5 sm:max-w-none">
              <EmployeeMovements
                employee={employee}
                month={month}
                // Los retiros de la caja se pasan desde la bandeja de arriba: acá, solo a quien carga.
                onPass={writable ? onPass : null}
                showParts={writable}
              />
              {writable ? (
                <EmployeeManage
                  employee={employee}
                  onSplit={locked ? null : onSplit}
                  onOvertime={() => onMove('overtime')}
                />
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

const MOVEMENT_ROW =
  'grid grid-cols-[3rem_minmax(0,1fr)_auto_auto] items-baseline gap-x-3 sm:grid-cols-[3rem_minmax(8rem,auto)_minmax(0,1fr)_auto_auto]'

/** Un retiro de la caja del salón que todavía no tiene comprobante: ya cuenta, y falta pasarlo. */
function PendingCashRow({
  item,
  month,
  onPass,
}: {
  item: PayrollPendingCash
  month: string
  onPass: ((posCashId: string) => void) | null
}) {
  const what = [
    PAYROLL_KIND_LABELS[PAYROLL_KIND_OF_PURPOSE[item.purpose]],
    periodWords(item.periodFrom, item.periodTo),
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className={MOVEMENT_ROW}>
      <span className="text-muted-foreground tabular-nums">{formatDayMonth(item.date)}</span>
      <span>{what}</span>
      <span className="truncate text-warning-text max-sm:hidden">
        De la caja del salón: falta pasarlo a los libros
      </span>
      <span className="text-right tabular-nums">{formatCentsShort(item.amountCents)}</span>
      {onPass ? (
        <button
          type="button"
          className={TEXT_LINK}
          aria-label={`Pasar a ${monthWord(month)}: ${what} del ${formatDayMonth(item.date)}`}
          onClick={() => onPass(item.id)}
        >
          Pasar
        </button>
      ) : (
        <span />
      )}
    </li>
  )
}

/**
 * Sus movimientos del mes: fecha, qué fue (con las fechas que cubre y si fue en negro), cuenta, importe
 * y el link al comprobante. Abajo, lo que salió de la caja del salón y falta pasar; y si el sueldo
 * tiene parte en negro, cuánto falta de cada parte.
 */
function EmployeeMovements({
  employee,
  month,
  onPass,
  showParts,
}: {
  employee: PayrollEmployee
  month: string
  onPass: ((posCashId: string) => void) | null
  showParts: boolean
}) {
  const { tenantSlug } = useAccounting()
  const pendingCash = employee.pendingCash ?? []
  const parts = showParts ? employeeParts(employee) : null
  return (
    <>
      {employee.movements.length === 0 && pendingCash.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin movimientos en {monthWord(month)}.</p>
      ) : (
        <ul className="grid max-w-3xl gap-1 text-sm">
          {employee.movements.map((movement) => {
            // «En negro» lo ve quien carga; a la contadora, qué fue y qué fechas cubre.
            const words = movementWords(showParts ? movement : { ...movement, offBooks: false })
            return (
              <li key={movement.documentId} className={MOVEMENT_ROW}>
                <span className="text-muted-foreground tabular-nums">
                  {formatDayMonth(movement.date)}
                </span>
                <span>{words}</span>
                <span className="truncate text-muted-foreground max-sm:hidden">
                  {movement.treasury ?? ''}
                </span>
                <span className="text-right tabular-nums">
                  {formatCentsShort(movement.amountCents)}
                </span>
                <Link
                  href={documentHref(tenantSlug, movement.documentId)}
                  aria-label={`Ver el comprobante: ${words} del ${formatDayMonth(movement.date)}`}
                  className={TEXT_LINK}
                >
                  Ver
                </Link>
              </li>
            )
          })}
          {pendingCash.map((item) => (
            <PendingCashRow key={item.id} item={item} month={month} onPass={onPass} />
          ))}
        </ul>
      )}
      {parts ? (
        // Lo que falta de cada parte, adelante; cómo se llegó, al lado y en gris.
        <div className="grid max-w-3xl gap-1">
          <dl className="grid w-fit grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 text-sm">
            {(
              [
                ['En blanco', parts.declared],
                ['En negro', parts.offBooks],
              ] as const
            ).map(([label, part]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right tabular-nums">
                  falta <span className="font-semibold">{formatCentsShort(part.owedCents)}</span>
                </dd>
                <dd className="text-muted-foreground tabular-nums">
                  pagaste {formatCentsShort(part.settledCents)} de{' '}
                  {formatCentsShort(part.salaryCents)}
                </dd>
              </div>
            ))}
          </dl>
          {parts.unassignedCents > 0 ? (
            <p className="text-xs text-muted-foreground text-pretty">
              Sin contar {formatCentsShort(parts.unassignedCents)} que salieron de la caja: dicen de
              qué parte son cuando se pasan a los libros.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

/**
 * Cambiarle el nombre o la frecuencia, abrir su sueldo en blanco y en negro, cargarle horas extra y
 * darlo de baja (o de vuelta de alta). No se borra.
 */
function EmployeeManage({
  employee,
  onSplit,
  onOvertime,
}: {
  employee: PayrollEmployee
  /** `null`: el mes está devengado y el sueldo quedó fijo. */
  onSplit: (() => void) | null
  onOvertime: () => void
}) {
  const { tenantSlug } = useAccounting()
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [pending, start] = useTransition()

  const setActive = (active: boolean) =>
    start(async () => {
      try {
        const result = await saveEmployee(tenantSlug, {
          id: employee.id,
          name: employee.name,
          payFrequency: employee.payFrequency,
          active,
          notes: employee.notes,
        })
        if (!result.ok) {
          toast.error(result.message)
          return
        }
        toast.success(active ? 'Volvió a la planilla.' : `${employee.name} quedó de baja.`)
        setConfirming(false)
        router.refresh()
      } catch {
        toast.error(ACC_UNREACHABLE.offline)
      }
    })

  if (editing) return <EmployeeForm employee={employee} onClose={() => setEditing(false)} />
  return (
    <div className="flex flex-wrap items-center gap-x-4">
      <button type="button" className={QUIET_BUTTON} onClick={() => setEditing(true)}>
        Editar
      </button>
      {onSplit ? (
        <button type="button" className={QUIET_BUTTON} onClick={onSplit}>
          Sueldo en blanco y en negro
        </button>
      ) : null}
      <button type="button" className={cn(QUIET_BUTTON, 'sm:hidden')} onClick={onOvertime}>
        Horas extra
      </button>
      {employee.active ? (
        <button
          type="button"
          className={QUIET_BUTTON}
          disabled={pending}
          onClick={() => setConfirming(true)}
        >
          Dar de baja
        </button>
      ) : (
        <button
          type="button"
          className={QUIET_BUTTON}
          disabled={pending}
          onClick={() => setActive(true)}
        >
          Volver a darlo de alta
        </button>
      )}
      <AlertDialog open={confirming} onOpenChange={(next) => !pending && setConfirming(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Das de baja a {employee.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Sale de la planilla de los meses que vienen. Lo que ya le pagaste queda igual.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                setActive(false)
              }}
            >
              {pending ? 'Guardando…' : 'Dar de baja'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * Nombre y Mensual/Quincenal, en el lugar. Al agregar queda abierto y con el cursor en el nombre: se
 * carga al equipo de corrido y después se bajan los sueldos con Enter.
 */
function EmployeeForm({
  employee,
  onClose,
  keepOpen = false,
}: {
  employee?: PayrollEmployee
  onClose: () => void
  keepOpen?: boolean
}) {
  const { tenantSlug } = useAccounting()
  const router = useRouter()
  const uid = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(employee?.name ?? '')
  const [frequency, setFrequency] = useState<PayFrequency>(employee?.payFrequency ?? 'monthly')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    start(async () => {
      try {
        const result = await saveEmployee(tenantSlug, {
          id: employee?.id ?? null,
          name,
          payFrequency: frequency,
          active: employee?.active ?? true,
          notes: employee?.notes ?? null,
        })
        if (!result.ok) {
          setError(result.fieldErrors?.name ?? result.message)
          nameRef.current?.focus()
          return
        }
        toast.success(result.message)
        setError(null)
        router.refresh()
        if (keepOpen) {
          setName('')
          nameRef.current?.focus()
        } else {
          onClose()
        }
      } catch {
        setError(ACC_UNREACHABLE.offline)
      }
    })
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !pending) {
          event.stopPropagation()
          onClose()
        }
      }}
      className="flex w-full flex-wrap items-start gap-2"
    >
      <div className="grid min-w-44 flex-1 gap-1 sm:max-w-72">
        <Input
          ref={nameRef}
          value={name}
          maxLength={80}
          autoComplete="off"
          aria-label="Nombre del empleado"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${uid}-error` : undefined}
          placeholder="Nombre y apellido"
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          className="h-11 text-base md:pointer-fine:h-8 md:pointer-fine:text-sm"
        />
        {error ? (
          <p id={`${uid}-error`} role="alert" className="text-xs text-destructive text-pretty">
            {error}
          </p>
        ) : null}
      </div>
      <ChoiceChips<PayFrequency>
        size="sm"
        label="Cada cuánto cobra"
        value={frequency}
        onChange={setFrequency}
        options={[
          { value: 'monthly', label: PAY_FREQUENCY_LABELS.monthly },
          { value: 'biweekly', label: PAY_FREQUENCY_LABELS.biweekly },
        ]}
      />
      <Button type="submit" size="sm" disabled={pending} className="pointer-coarse:h-11">
        {pending ? 'Guardando…' : employee ? 'Guardar' : 'Agregar'}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        className="pointer-coarse:h-11"
        onClick={onClose}
      >
        {keepOpen ? 'Listo' : 'Cancelar'}
      </Button>
    </form>
  )
}

/** El sueldo de una persona desde ese mes: se guarda al salir de la celda; Enter baja a la otra. */
function SalaryCell({ employee, month }: { employee: PayrollEmployee; month: string }) {
  const { tenantSlug } = useAccounting()
  const router = useRouter()
  const initial = employee.salaryCents > 0 ? employee.salaryCents : null
  const [value, setValue] = useState<number | null>(initial)
  const [save, setSave] = useState<CellSave>('idle')
  const [failure, setFailure] = useState<string | null>(null)
  const savedRef = useRef(employee.salaryCents)
  // Enter guarda y baja: al salir de la celda, lo mismo no se manda dos veces.
  const sendingRef = useRef<number | null>(null)

  // La pantalla se refrescó con otro sueldo (lo cambió alguien más): manda el de la base.
  useEffect(() => {
    savedRef.current = employee.salaryCents
    setValue(employee.salaryCents > 0 ? employee.salaryCents : null)
  }, [employee.salaryCents])

  const commit = async (cents: number | null) => {
    if (cents === null || cents === savedRef.current || cents === sendingRef.current) return
    sendingRef.current = cents
    setSave('saving')
    setFailure(null)
    try {
      const result = await saveEmployeeSalary(tenantSlug, {
        employeeId: employee.id,
        month,
        salaryCents: cents,
      })
      if (!result.ok) {
        setSave('error')
        setFailure(`No se guardó. ${result.message}`.trim())
        return
      }
      savedRef.current = cents
      setSave('saved')
      router.refresh()
    } catch {
      setSave('error')
      setFailure(ACC_UNREACHABLE.offline)
    } finally {
      sendingRef.current = null
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <CellMoney
        column="sueldo"
        label={`Sueldo de ${employee.name}`}
        value={value}
        onValueChange={setValue}
        onCommit={(cents) => void commit(cents)}
        placeholder="Poner sueldo"
        save={save}
      />
      {failure ? (
        <SaveMark
          state="error"
          message={failure}
          onRetry={() => void commit(value)}
          className="max-w-44 justify-end text-right whitespace-normal"
        />
      ) : null}
    </span>
  )
}
