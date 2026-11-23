'use client'

import { ChevronRight, Eye, Search, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useOptimistic, useState } from 'react'
import { toast } from 'sonner'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { ChoiceCard } from '@/components/administracion/kit/choice-card'
import { EmptyTeach } from '@/components/administracion/kit/empty-teach'
import { Panel } from '@/components/administracion/kit/panel'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { PersonChip } from '@/components/administracion/puerta/person-chip'
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
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  type AccountingScope,
  canGrantOthers,
  DEFAULT_GRANT_SCOPE,
} from '@/lib/accounting/access-levels'
import type { AccFailureState, AccSimpleState } from '@/lib/accounting/action-state'
import {
  claimAccountingAdmin,
  revokeAccountingAccess,
  setAccountingAccess,
} from '@/lib/accounting/actions/access'
import type { AccessOverview, AccessPersonRow, MemberName } from '@/lib/accounting/queries/access'
import { cn } from '@/lib/utils'
import { applyAccessChange, isOnlyAdmin, levelCounts } from '../_lib/access-changes'
import {
  accessFactsLine,
  downgradeCopy,
  entersWords,
  grantLine,
  LEVEL_COPY,
  LEVEL_ORDER,
  revokedLine,
  savedLine,
} from '../_lib/access-copy'
import { joinWords } from '../_lib/cobros'
import { accessCounts } from '../_lib/portada'
import { EditDialog } from './edit-dialog'
import { Callout } from './form-bits'
import { INPUT_CLASS } from './inputs'
import { KeyDots } from './key-dots'
import { useMasterAction } from './use-master-action'

/**
 * Ajustes › Accesos: quién entra a Administración, con qué nivel, y quién da
 * los accesos. El objeto son las llaves: un punto por socio, que se cuenta con
 * el ojo; abajo, las dos listas con nombre y la acción del momento en la fila.
 *
 * Cada acceso tiene un nivel (pedido de los socios de HUB, 22/11/2026: «los
 * empleados solo deberían poder ver compra y pagos»): «Completo» ve todo;
 * «Solo compras y pagos» carga compras, gastos y pagos a proveedores y nada
 * más. Se elige al dar el acceso (se propone el acotado, que es lo prudente) y
 * se cambia con un toque en la fila; bajar de nivel pregunta antes, porque esa
 * persona deja de ver cosas. «También da accesos» pide el nivel completo.
 *
 * Lo que se toca se ve al instante y, si el guardado falla, vuelve solo a como
 * estaba (`useOptimistic`) y la lista se vuelve a leer: casi siempre falló
 * porque otra persona la cambió recién. Solo quien da accesos ve controles; los
 * demás y la contadora lo leen en palabras. Solo nombres, nunca emails.
 */

/** Un contador al lado de un título: en su pastilla, nunca un número suelto. */
function Count({ n }: { n: number }) {
  return (
    <span className="ml-2 inline-flex translate-y-[-1px] rounded-full bg-secondary px-2 py-0.5 align-middle text-[11px] font-medium tabular-nums">
      {n}
    </span>
  )
}

/** «Vos»: quién sos en la lista. */
function You() {
  return (
    <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] leading-none font-medium text-muted-foreground">
      Vos
    </span>
  )
}

/** Los dos niveles, cada uno con su línea de «qué ve»: va una vez, arriba de la lista. */
function LevelLegend() {
  return (
    <dl className="grid max-w-4xl gap-x-8 gap-y-1.5 sm:grid-cols-2">
      {LEVEL_ORDER.map((scope) => (
        <div key={scope} className="min-w-0">
          <dt className="inline font-medium text-foreground">{LEVEL_COPY[scope].label}. </dt>
          <dd className="inline">{LEVEL_COPY[scope].sees}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Dar un acceso: se elige qué va a ver. Dos tarjetas con su consecuencia; viene marcada la acotada.
 * «También da accesos» solo se puede prender con el nivel completo.
 */
function GrantDialog({
  member,
  open,
  pending,
  onClose,
  onGrant,
}: {
  member: MemberName
  open: boolean
  pending: boolean
  onClose: () => void
  onGrant: (scope: AccountingScope, isAdmin: boolean) => void
}) {
  const id = useId()
  const [scope, setScope] = useState<AccountingScope>(DEFAULT_GRANT_SCOPE)
  const [admin, setAdmin] = useState(false)
  const full = canGrantOthers(scope)
  return (
    <EditDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={`¿Qué va a ver ${member.name}?`}
      description="Lo podés cambiar o sacar cuando quieras."
      pending={pending}
      submitLabel="Dar acceso"
      onSubmit={() => onGrant(scope, full && admin)}
    >
      <fieldset className="grid gap-2.5">
        <legend className="sr-only">Qué va a ver</legend>
        {LEVEL_ORDER.map((value) => (
          <ChoiceCard
            key={value}
            name={`${id}-level`}
            value={value}
            checked={scope === value}
            onChange={() => setScope(value)}
            title={LEVEL_COPY[value].label}
            consequence={LEVEL_COPY[value].sees}
            badge={<StatusPill tone="muted">{LEVEL_COPY[value].forWhom}</StatusPill>}
          />
        ))}
      </fieldset>
      <div className="flex items-start gap-3 rounded-xl bg-secondary/50 p-3.5">
        <Switch
          id={`${id}-admin`}
          className="mt-0.5"
          checked={full && admin}
          disabled={!full}
          aria-describedby={`${id}-admin-hint`}
          onCheckedChange={setAdmin}
        />
        <div className="min-w-0">
          <Label htmlFor={`${id}-admin`} className="text-sm font-medium">
            También da accesos
          </Label>
          <p id={`${id}-admin-hint`} className="mt-0.5 text-xs text-muted-foreground text-pretty">
            {full
              ? 'Puede habilitar a otras personas y cambiarles el nivel. Conviene que lo tengan todos los socios.'
              : 'Para dar accesos hace falta el nivel Completo.'}
          </p>
        </div>
      </div>
    </EditDialog>
  )
}

/**
 * El pedido ni llegó al servidor (sin conexión). El texto de las hojas de carga dice «quedó cargado
 * para reintentar», y acá no es cierto: lo que se tocó volvió a como estaba y hay que tocarlo de nuevo.
 */
const OFFLINE: AccFailureState = {
  ok: false,
  code: 'error',
  message: 'Sin conexión: no se guardó. Volvé a tocarlo cuando vuelva.',
}

/** Una llamada que no llega se cuenta como un guardado que falló, con su propio aviso. */
function reach<T>(call: Promise<AccSimpleState<T>>): Promise<AccSimpleState<T>> {
  return call.catch(() => OFFLINE)
}

/** Con más personas que estas, aparece el buscador. */
const SEARCH_FROM = 8

function matches(name: string, query: string): boolean {
  const fold = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('es-AR')
  return fold(name).includes(fold(query.trim()))
}

export function AccessPanel({
  tenantSlug,
  overview,
  currentUserId,
  isAdmin,
  canWrite,
  showMembers,
}: {
  tenantSlug: string
  overview: AccessOverview
  currentUserId: string
  /** Quien mira da accesos (y puede cargar). */
  isAdmin: boolean
  canWrite: boolean
  /** Hay datos del equipo (dueños sin acceso, contadoras): solo para dueños. */
  showMembers: boolean
}) {
  const router = useRouter()
  const { pending, run } = useMasterAction()
  // Lo que se ve mientras se guarda. Sin nada en vuelo es `overview`, tal cual llegó.
  const [view, applyChange] = useOptimistic(overview, applyAccessChange)
  const [revoking, setRevoking] = useState<AccessPersonRow | null>(null)
  const [reason, setReason] = useState('')
  const [query, setQuery] = useState('')
  // El diálogo queda montado al cerrarse (así se va con su animación y sin cambiar de texto).
  const [granting, setGranting] = useState<{ member: MemberName; open: boolean } | null>(null)
  const [lowering, setLowering] = useState<{ row: AccessPersonRow; open: boolean } | null>(null)

  const counts = accessCounts(view)
  const levels = levelCounts(view.active)
  const facts = accessFactsLine({ ...levels, outside: showMembers ? counts.outCount : 0 })
  const total = counts.inCount + counts.outCount
  const admins = view.active.filter((row) => row.isAdmin)
  const onlyAdmin = admins.length === 1 ? admins[0] : undefined
  const hasOnlyAdmin = view.adminCount === 1

  /**
   * Un guardado que falló: se dice por qué y se vuelve a leer la lista. Lo que se había mostrado al
   * instante ya volvió solo a como estaba; si falló porque otra persona cambió lo mismo recién
   * («esa persona ya no tiene acceso»), con la lista nueva se ve.
   */
  const failed = (state: AccFailureState) => {
    toast.error(state.message)
    // Sin conexión no se relee: pedir la pantalla de nuevo sin red la reemplaza por el error del navegador.
    if (state !== OFFLINE) router.refresh()
  }

  /** Dar un acceso o cambiarlo. `before` vacío = todavía no entraba. */
  const save = (
    target: { userId: string; name: string },
    next: { scope: AccountingScope; isAdmin: boolean },
    before: Pick<AccessPersonRow, 'scope' | 'isAdmin'> | null,
  ) =>
    run(
      () => {
        applyChange({ type: 'set', ...target, ...next, at: new Date().toISOString() })
        return reach(setAccountingAccess(tenantSlug, { userId: target.userId, ...next }))
      },
      // El aviso dice lo que cambió («ahora ve todo», «ya no da accesos»), no un «guardado» genérico.
      {
        quiet: true,
        onSuccess: (saved) => toast.success(savedLine(before, saved)),
        onFailure: failed,
      },
    )

  const pickLevel = (row: AccessPersonRow, next: AccountingScope) => {
    if (next === row.scope) return
    // Bajar de nivel le saca cosas de la vista: se pregunta antes. Subir, no.
    if (next === 'purchases') {
      setLowering({ row, open: true })
      return
    }
    save({ userId: row.userId, name: row.displayName }, { scope: next, isAdmin: false }, row)
  }

  const confirmLower = () => {
    const target = lowering?.row
    if (!target) return
    setLowering({ row: target, open: false })
    save(
      { userId: target.userId, name: target.displayName },
      { scope: 'purchases', isAdmin: false },
      target,
    )
  }

  const confirmGrant = (scope: AccountingScope, admin: boolean) => {
    const target = granting?.member
    if (!target) return
    setGranting({ member: target, open: false })
    save(target, { scope, isAdmin: admin }, null)
  }

  const confirmRevoke = () => {
    const target = revoking
    if (!target) return
    setRevoking(null)
    run(
      () => {
        applyChange({ type: 'revoke', userId: target.userId })
        return reach(
          revokeAccountingAccess(tenantSlug, {
            userId: target.userId,
            reason: reason.trim() || null,
          }),
        )
      },
      { onFailure: failed },
    )
  }

  const searching = showMembers && total > SEARCH_FROM
  const inside = query ? view.active.filter((r) => matches(r.displayName, query)) : view.active
  const outside = query
    ? view.ownersWithoutAccess.filter((m) => matches(m.name, query))
    : view.ownersWithoutAccess

  // La oración de las llaves: quién puede habilitar a otros.
  const adminSentence =
    view.adminCount === 0
      ? null
      : onlyAdmin
        ? onlyAdmin.userId === currentUserId
          ? 'Solo vos podés habilitar a otros. Conviene que un socio más también dé accesos, por si un día no estás.'
          : `Los accesos los da ${onlyAdmin.displayName}.`
        : `Dan accesos: ${joinWords(admins.map((a) => a.displayName))}.`

  const lowerWords = lowering
    ? downgradeCopy({
        name: lowering.row.displayName,
        self: lowering.row.userId === currentUserId,
        isAdmin: lowering.row.isAdmin,
      })
    : null

  return (
    <div className="space-y-6">
      <Panel>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:items-center md:gap-8">
          <div className="min-w-0">
            <p className="font-serif leading-none font-semibold tracking-tight">
              <span className="text-5xl tabular-nums sm:text-6xl">{counts.inCount}</span>
              {/* Personas, no socios: con los niveles también entran empleados. */}
              <span className="text-xl font-normal text-muted-foreground sm:text-2xl">
                {` ${entersWords(counts.inCount)}`}
              </span>
            </p>
            {facts ? <p className="mt-3 text-sm font-medium">{facts}</p> : null}
            {adminSentence ? (
              <p
                className={cn(
                  'max-w-prose text-sm text-muted-foreground text-pretty',
                  facts ? 'mt-1' : 'mt-3',
                )}
              >
                {adminSentence}
              </p>
            ) : null}
          </div>
          <KeyDots
            size="md"
            legend
            inCount={counts.inCount}
            adminCount={counts.adminCount}
            limitedCount={levels.purchases}
            outCount={counts.outCount}
            max={48}
          />
        </div>
        {view.adminCount === 0 && canWrite ? (
          <Callout
            tone="warning"
            title="Nadie está dando los accesos."
            className="mt-5"
            action={
              <Button
                type="button"
                className="h-11"
                disabled={pending}
                onClick={() => run(() => claimAccountingAdmin(tenantSlug))}
              >
                Pasar a darlos yo
              </Button>
            }
          >
            Quien los daba ya no es dueño. Alguien con acceso tiene que tomar ese lugar.
          </Callout>
        ) : null}
      </Panel>

      {searching ? (
        <div className="relative max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            placeholder="Buscar a alguien"
            aria-label="Buscar a alguien por su nombre"
            onChange={(e) => setQuery(e.target.value)}
            className={cn(INPUT_CLASS, 'rounded-full pl-10')}
          />
        </div>
      ) : null}

      {/* Una sola columna, y `minmax(0, …)`: sin eso, un nombre largo (que no corta de renglón)
          ensancha los paneles y los botones quedan fuera de la pantalla. La lista de quienes entran
          va a todo el ancho: cada fila lleva el nivel, «da accesos» y «sacar». */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel
          title={
            <>
              Entran
              <Count n={counts.inCount} />
            </>
          }
          description={<LevelLegend />}
        >
          {inside.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {query ? 'Nadie con ese nombre entra todavía.' : 'Todavía no entra nadie.'}
            </p>
          ) : (
            <ul className="@container divide-y divide-border/60">
              {inside.map((row) => {
                const self = row.userId === currentUserId
                const adminId = `acc-${row.userId}-admin`
                const locked = isOnlyAdmin(row, view)
                const full = canGrantOthers(row.scope)
                return (
                  <li
                    key={row.userId}
                    className="flex min-w-0 flex-col gap-3 py-3.5 first:pt-0 last:pb-0 @4xl:flex-row @4xl:items-center @4xl:justify-between"
                  >
                    <PersonChip
                      name={row.displayName}
                      badge={self ? <You /> : undefined}
                      sub={grantLine(row)}
                    />
                    {isAdmin ? (
                      // En el celular van desde el borde (las dos fichas del nivel necesitan el ancho);
                      // con más lugar se alinean con el nombre, y bien ancho pasan a la derecha.
                      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 sm:pl-[2.875rem] @4xl:pl-0">
                        <ChoiceChips<AccountingScope>
                          label={`Qué ve ${row.displayName}`}
                          value={row.scope}
                          onChange={(next) => pickLevel(row, next)}
                          options={LEVEL_ORDER.map((scope) => ({
                            value: scope,
                            label: LEVEL_COPY[scope].label,
                            // A quien es el único que da accesos no se lo puede bajar de nivel.
                            disabled: pending || (scope === 'purchases' && locked),
                          }))}
                        />
                        <span className="flex min-h-11 items-center gap-2 md:pointer-fine:min-h-9">
                          <Switch
                            id={adminId}
                            checked={row.isAdmin}
                            disabled={pending || locked || !full}
                            aria-describedby={
                              locked ? 'acc-last-admin' : full ? undefined : 'acc-admin-needs-full'
                            }
                            onCheckedChange={(checked) =>
                              save(
                                { userId: row.userId, name: row.displayName },
                                { scope: row.scope, isAdmin: checked },
                                row,
                              )
                            }
                          />
                          {/* Apagado, el `Label` ya se atenúa solo (va detrás del interruptor): no se
                              le suma otro gris, que lo dejaba casi ilegible. */}
                          <Label htmlFor={adminId} className="text-sm font-normal">
                            También da accesos
                          </Label>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-11 px-2 text-muted-foreground hover:text-destructive md:h-9"
                          // Sacarle el acceso al único que da accesos dejaría el bar sin nadie que
                          // habilite (la base lo rechaza): primero tiene que haber otro.
                          disabled={pending || locked}
                          aria-describedby={locked ? 'acc-last-admin' : undefined}
                          onClick={() => {
                            setReason('')
                            setRevoking(row)
                          }}
                        >
                          Sacar acceso
                        </Button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 flex-wrap gap-1.5 pl-[2.875rem] @4xl:pl-0">
                        <StatusPill tone={full ? 'ok' : 'muted'}>
                          {LEVEL_COPY[row.scope].label}
                        </StatusPill>
                        {row.isAdmin ? <StatusPill tone="info">Da accesos</StatusPill> : null}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {isAdmin && (hasOnlyAdmin || levels.purchases > 0) ? (
            <div className="mt-4 space-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground text-pretty">
              {levels.purchases > 0 ? (
                <p id="acc-admin-needs-full">
                  Dar accesos pide el nivel Completo: quien habilita a otros ve todo Administración.
                </p>
              ) : null}
              {hasOnlyAdmin ? (
                <p id="acc-last-admin">
                  Tiene que quedar al menos una persona que dé accesos: para dejar de darlos, bajar
                  de nivel o salir, primero marcá «También da accesos» en otra persona.
                </p>
              ) : null}
            </div>
          ) : null}
        </Panel>

        {showMembers ? (
          <Panel
            title={
              <>
                Todavía no entran
                <Count n={counts.outCount} />
              </>
            }
            // Sin nadie afuera no hay nada que explicar: alcanza con «ya entran todos».
            description={
              counts.outCount === 0
                ? undefined
                : isAdmin
                  ? 'Al darle acceso elegís qué va a ver. Se puede cambiar o sacar cuando quieras.'
                  : 'Los habilita quien da los accesos.'
            }
            // La tarea de todos los días de quien da accesos es habilitar a alguien: en el celular va
            // primero, mientras quede alguien por habilitar.
            className={cn(isAdmin && counts.outCount > 0 && 'max-lg:order-first')}
          >
            {outside.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {query ? 'Nadie con ese nombre.' : 'Ya entran todos los dueños del bar.'}
              </p>
            ) : (
              // En columnas desde `sm`: con doce personas afuera, una sola columna a todo el ancho era
              // una tira larga con el botón lejos del nombre. La raya de arriba de la primera fila
              // queda recortada (`-mt-px` + `overflow-hidden`).
              <ul className="grid gap-x-8 overflow-hidden sm:grid-cols-2 xl:grid-cols-3">
                {outside.map((member) => (
                  <li
                    key={member.userId}
                    className="-mt-px flex min-w-0 items-center justify-between gap-3 border-t border-border/60 py-2.5"
                  >
                    <PersonChip
                      name={member.name}
                      tone="hollow"
                      // Corto: el título del panel ya dice dónde; en el celular entra en un renglón
                      // al lado de «Dar acceso».
                      sub="Sin acceso todavía"
                    />
                    {isAdmin ? (
                      // En contorno: con doce personas afuera eran doce botones verdes rellenos en
                      // columna, y el relleno queda para la acción de la vista.
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 shrink-0 rounded-full px-4"
                        disabled={pending}
                        aria-label={`Dar acceso a ${member.name}`}
                        onClick={() => setGranting({ member, open: true })}
                      >
                        Dar acceso
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>

      <Panel title="La contadora">
        {showMembers ? (
          view.accountants.length > 0 ? (
            <>
              <ul className="divide-y divide-border/60">
                {view.accountants.map((a) => (
                  <li
                    key={a.userId}
                    className="flex min-w-0 items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <PersonChip name={a.name} />
                    <StatusPill tone="muted" icon={Eye}>
                      Solo lectura
                    </StatusPill>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground text-pretty">
                Ve y exporta los libros, el IVA y las cuentas. No carga ni cambia nada y no ve el
                resto del panel.
                {isAdmin ? (
                  <>
                    {' '}
                    <Link
                      href={`/${tenantSlug}/configuracion/equipo?rol=accountant`}
                      className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Sumar a otra
                    </Link>
                  </>
                ) : null}
              </p>
            </>
          ) : (
            <EmptyTeach
              plain
              icon={Eye}
              title="Todavía no sumaste a la contadora"
              action={
                isAdmin ? (
                  <Button asChild variant="outline" className="h-11 gap-2">
                    <Link href={`/${tenantSlug}/configuracion/equipo?rol=accountant`}>
                      <UserPlus className="size-4" aria-hidden />
                      Sumar a la contadora
                    </Link>
                  </Button>
                ) : undefined
              }
              secondary={
                isAdmin ? 'Te lleva a Configuración › Equipo. Al terminar, volvé acá.' : undefined
              }
            >
              Entra con su propio usuario: ve y exporta los libros, el IVA y las cuentas. No carga
              ni cambia nada y no ve el resto del panel.
            </EmptyTeach>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            La contadora entra con su propio usuario, en modo lectura.
          </p>
        )}
      </Panel>

      {view.revoked.length > 0 ? (
        <details className="group/history rounded-2xl bg-secondary/50">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              className="size-4 text-muted-foreground transition-transform group-open/history:rotate-90 motion-reduce:transition-none"
            />
            Accesos que se sacaron
            <span className="rounded-full bg-card px-1.5 py-px text-[11px] font-medium tabular-nums">
              {view.revoked.length}
            </span>
          </summary>
          <ul className="divide-y divide-border/60 px-4 pb-4">
            {view.revoked.map((row) => (
              <li key={row.id} className="space-y-0.5 py-2.5">
                <p className="text-sm font-medium">{row.displayName}</p>
                <p className="text-xs text-muted-foreground text-pretty">{revokedLine(row)}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {granting ? (
        <GrantDialog
          // Otra persona, otra elección: arranca de nuevo en el nivel acotado.
          key={granting.member.userId}
          member={granting.member}
          open={granting.open}
          pending={pending}
          onClose={() => setGranting({ member: granting.member, open: false })}
          onGrant={confirmGrant}
        />
      ) : null}

      <AlertDialog
        open={lowering?.open === true}
        onOpenChange={(open) => {
          if (!open && lowering) setLowering({ row: lowering.row, open: false })
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{lowerWords?.title}</AlertDialogTitle>
            <AlertDialogDescription>{lowerWords?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLower}>{lowerWords?.action}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {revoking?.userId === currentUserId
                ? '¿Dejás de ver Administración?'
                : `¿Le sacás el acceso a ${revoking?.displayName ?? 'esta persona'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {revoking?.userId === currentUserId
                ? 'Vas a dejar de ver Administración al instante. Para volver, te lo tiene que dar otra persona.'
                : 'Deja de ver Administración al instante. Queda en el historial.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="acc-revoke-reason">
              Motivo <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="acc-revoke-reason"
              value={reason}
              maxLength={200}
              placeholder="Lo ve la contadora en el historial"
              onChange={(e) => setReason(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmRevoke}
            >
              Sacar acceso
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
