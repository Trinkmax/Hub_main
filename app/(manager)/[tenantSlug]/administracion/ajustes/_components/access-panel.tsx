'use client'

import { ChevronRight, Eye, Search, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
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
  claimAccountingAdmin,
  grantAccountingAccess,
  revokeAccountingAccess,
} from '@/lib/accounting/actions/access'
import type { AccessOverview, AccessPersonRow } from '@/lib/accounting/queries/access'
import { cn } from '@/lib/utils'
import { grantLine, revokedLine } from '../_lib/access-copy'
import { joinWords } from '../_lib/cobros'
import { accessCounts } from '../_lib/portada'
import { Callout } from './form-bits'
import { INPUT_CLASS } from './inputs'
import { KeyDots } from './key-dots'
import { useMasterAction } from './use-master-action'

/**
 * Ajustes › Accesos: quién entra a Administración y quién da los accesos. El
 * objeto son las llaves: un punto por socio, que se cuenta con el ojo; abajo,
 * las dos listas con nombre y la acción del momento en la misma fila.
 *
 * Las tres acciones son las de siempre, con el mismo envío: dar acceso (un
 * toque, sin confirmar), sacarlo (confirma y pide un motivo opcional) y pasar
 * a dar los accesos cuando nadie los da. Solo quien da accesos ve controles;
 * los demás y la contadora lo leen en palabras. Solo nombres, nunca emails.
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

/** Con más socios que estos, aparece el buscador. */
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
  const { pending, run } = useMasterAction()
  const [revoking, setRevoking] = useState<AccessPersonRow | null>(null)
  const [reason, setReason] = useState('')
  const [query, setQuery] = useState('')

  const counts = accessCounts(overview)
  const total = counts.inCount + counts.outCount
  const lastAdmin = overview.adminCount <= 1
  const admins = overview.active.filter((row) => row.isAdmin)
  const onlyAdmin = admins.length === 1 ? admins[0] : undefined

  const grant = (userId: string, isAdminValue: boolean, displayName: string | null) =>
    run(() =>
      grantAccountingAccess(tenantSlug, {
        userId,
        isAdmin: isAdminValue,
        displayName,
      }),
    )

  const confirmRevoke = () => {
    const target = revoking
    if (!target) return
    setRevoking(null)
    run(() =>
      revokeAccountingAccess(tenantSlug, {
        userId: target.userId,
        reason: reason.trim() || null,
      }),
    )
  }

  const searching = showMembers && total > SEARCH_FROM
  const inside = query
    ? overview.active.filter((r) => matches(r.displayName, query))
    : overview.active
  const outside = query
    ? overview.ownersWithoutAccess.filter((m) => matches(m.name, query))
    : overview.ownersWithoutAccess

  // La oración de las llaves: quién puede habilitar a otros.
  const adminSentence =
    overview.adminCount === 0
      ? null
      : onlyAdmin
        ? onlyAdmin.userId === currentUserId
          ? 'Solo vos podés habilitar a otros. Conviene que un socio más también dé accesos, por si un día no estás.'
          : `Los accesos los da ${onlyAdmin.displayName}.`
        : `Dan accesos: ${joinWords(admins.map((a) => a.displayName))}.`

  return (
    <div className="space-y-6">
      <Panel>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:items-center md:gap-8">
          <div className="min-w-0">
            <p className="font-serif leading-none font-semibold tracking-tight">
              <span className="text-5xl tabular-nums sm:text-6xl">{counts.inCount}</span>
              <span className="text-xl font-normal text-muted-foreground sm:text-2xl">
                {showMembers
                  ? ` de ${total} ${total === 1 ? 'socio entra' : 'socios entran'}`
                  : counts.inCount === 1
                    ? ' persona entra'
                    : ' personas entran'}
              </span>
            </p>
            {adminSentence ? (
              <p className="mt-3 max-w-prose text-sm text-muted-foreground text-pretty">
                {adminSentence}
              </p>
            ) : null}
          </div>
          <KeyDots
            size="md"
            legend
            inCount={counts.inCount}
            adminCount={counts.adminCount}
            outCount={counts.outCount}
            max={48}
          />
        </div>
        {overview.adminCount === 0 && canWrite ? (
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
            placeholder="Buscar un socio"
            aria-label="Buscar un socio"
            onChange={(e) => setQuery(e.target.value)}
            className={cn(INPUT_CLASS, 'rounded-full pl-10')}
          />
        </div>
      ) : null}

      {/* La columna única del celular también es `minmax(0, …)`: sin eso, un nombre largo (que no
          corta de renglón) ensancha los dos paneles y el botón «Dar acceso» queda fuera de la pantalla. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
        <Panel
          title={
            <>
              Entran
              <Count n={counts.inCount} />
            </>
          }
          description={
            isAdmin
              ? '«Da accesos» le deja habilitar a otros socios.'
              : 'Ven y cargan en Administración.'
          }
        >
          {inside.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {query ? 'Nadie con ese nombre entra todavía.' : 'Todavía no entra nadie.'}
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {inside.map((row) => {
                const self = row.userId === currentUserId
                const adminId = `acc-${row.userId}-admin`
                const locked = row.isAdmin && lastAdmin
                return (
                  <li
                    key={row.userId}
                    className="flex min-w-0 flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <PersonChip
                      name={row.displayName}
                      badge={self ? <You /> : undefined}
                      sub={grantLine(row)}
                    />
                    {isAdmin ? (
                      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 pl-[2.875rem] sm:pl-0">
                        <span className="flex items-center gap-2">
                          <Switch
                            id={adminId}
                            checked={row.isAdmin}
                            disabled={pending || locked}
                            aria-describedby={locked ? 'acc-last-admin' : undefined}
                            onCheckedChange={(checked) =>
                              grant(row.userId, checked, row.displayName)
                            }
                          />
                          <Label htmlFor={adminId} className="text-sm font-normal">
                            Da accesos
                          </Label>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-11 px-2 text-muted-foreground hover:text-destructive md:h-9"
                          disabled={pending}
                          onClick={() => {
                            setReason('')
                            setRevoking(row)
                          }}
                        >
                          Sacar acceso
                        </Button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 flex-wrap gap-1.5 pl-[2.875rem] sm:pl-0">
                        <StatusPill tone="ok">Ve y carga</StatusPill>
                        {row.isAdmin ? <StatusPill tone="info">Da accesos</StatusPill> : null}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {isAdmin && lastAdmin && overview.adminCount > 0 ? (
            <p
              id="acc-last-admin"
              className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground text-pretty"
            >
              Tiene que quedar al menos una persona que dé accesos: para dejar de darlos, primero
              habilitá a otro dueño.
            </p>
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
            description={
              isAdmin
                ? 'Con un toque empiezan a ver y cargar. Se puede sacar cuando quieras.'
                : 'Los habilita quien da los accesos.'
            }
            // La tarea de todos los días de quien da accesos es habilitar a alguien: en el celular va
            // primero, mientras quede alguien por habilitar.
            className={cn(isAdmin && counts.outCount > 0 && 'max-lg:order-first')}
          >
            {outside.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {query ? 'Nadie con ese nombre.' : 'Todos los socios ya entran.'}
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {outside.map((member) => (
                  <li
                    key={member.userId}
                    className="flex min-w-0 items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <PersonChip
                      name={member.name}
                      tone="hollow"
                      // Corto: el título del panel ya dice dónde; en el celular entra en un renglón
                      // al lado de «Dar acceso».
                      sub="Sin acceso todavía"
                    />
                    {isAdmin ? (
                      // En contorno: con doce socios afuera eran doce botones verdes rellenos en
                      // columna, y el relleno queda para la acción de la vista.
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 shrink-0 rounded-full px-4"
                        disabled={pending}
                        aria-label={`Dar acceso a ${member.name}`}
                        onClick={() => grant(member.userId, false, null)}
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
          overview.accountants.length > 0 ? (
            <>
              <ul className="divide-y divide-border/60">
                {overview.accountants.map((a) => (
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

      {overview.revoked.length > 0 ? (
        <details className="group/history rounded-2xl bg-secondary/50">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              className="size-4 text-muted-foreground transition-transform group-open/history:rotate-90 motion-reduce:transition-none"
            />
            Accesos que se sacaron
            <span className="rounded-full bg-card px-1.5 py-px text-[11px] font-medium tabular-nums">
              {overview.revoked.length}
            </span>
          </summary>
          <ul className="divide-y divide-border/60 px-4 pb-4">
            {overview.revoked.map((row) => (
              <li key={row.id} className="space-y-0.5 py-2.5">
                <p className="text-sm font-medium">{row.displayName}</p>
                <p className="text-xs text-muted-foreground text-pretty">{revokedLine(row)}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

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
