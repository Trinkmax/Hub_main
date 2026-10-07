'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
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
import { type SavedAccount, saveAccount } from '@/lib/accounting/actions/master'
import { useMasterAction } from '../../ajustes/_components/use-master-action'
import { deactivateRefusal, failureKey } from '../_lib/feedback'
import { type ChartAccount, type ChartIndex, deactivationBlock } from '../_lib/tree'

/**
 * Desactivar una cuenta (se confirma: deja de aparecer al cargar). Si no se puede, explica por qué
 * con las reglas de la base en criollo (la usa el sistema, tiene saldo, tiene cuentas activas
 * adentro, la usa una caja, un proveedor o un gasto fijo) y adónde ir para resolverlo.
 */
export function DeactivateDialog({
  tenantSlug,
  index,
  balancesAvailable,
  accountId,
  onClose,
  onDone,
}: {
  tenantSlug: string
  index: ChartIndex
  balancesAvailable: boolean
  accountId: string | null
  onClose: () => void
  onDone: (saved: SavedAccount, message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const account = accountId ? (index.byId.get(accountId) ?? null) : null
  return (
    <AlertDialog
      open={account !== null}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      {account ? (
        <DeactivateBody
          key={account.id}
          tenantSlug={tenantSlug}
          index={index}
          balancesAvailable={balancesAvailable}
          account={account}
          onBusyChange={setBusy}
          onDone={onDone}
        />
      ) : null}
    </AlertDialog>
  )
}

function DeactivateBody({
  tenantSlug,
  index,
  balancesAvailable,
  account,
  onBusyChange,
  onDone,
}: {
  tenantSlug: string
  index: ChartIndex
  balancesAvailable: boolean
  account: ChartAccount
  onBusyChange: (busy: boolean) => void
  onDone: (saved: SavedAccount, message: string) => void
}) {
  const { pending, run } = useMasterAction()
  const [refusal, setRefusal] = useState<{ text: string; key: string | null } | null>(null)
  const block = deactivationBlock(index, account, balancesAvailable)
  const reason = refusal?.text ?? block
  const reasonKey = refusal?.key ?? (account.systemKey ? 'system_account_locked' : null)
  const base = `/${tenantSlug}/administracion`

  useEffect(() => onBusyChange(pending), [pending, onBusyChange])

  const deactivate = () => {
    if (pending) return
    run(
      () =>
        saveAccount(tenantSlug, {
          mode: 'update',
          id: account.id,
          expectedUpdatedAt: account.updatedAt,
          active: false,
        }),
      {
        quiet: true,
        onSuccess: (saved) =>
          onDone(saved, `Listo: ${saved.code} ${saved.name} quedó desactivada.`),
        onFailure: (state) =>
          setRefusal({ text: deactivateRefusal(state, account), key: failureKey(state) }),
      },
    )
  }

  // Lo que ayuda a resolverlo, según el motivo.
  const fix =
    reasonKey === 'system_account_locked'
      ? { href: `${base}/plan-de-cuentas?tab=sistema`, label: 'Ver cuentas del sistema' }
      : reasonKey === 'account_has_balance' || (block && account.postable && !account.systemKey)
        ? { href: `${base}/libros/asiento-manual`, label: 'Hacer un asiento manual' }
        : reasonKey === 'account_in_use' && account.isTreasury
          ? { href: `${base}/ajustes?tab=cajas`, label: 'Ir a Cajas y cuentas' }
          : null

  const name = `${account.code} ${account.name}`
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle className="text-pretty">
          {reason ? `No se puede desactivar ${name}` : `¿Desactivás ${name}?`}
        </AlertDialogTitle>
        <AlertDialogDescription className="text-pretty">
          {reason ??
            (account.postable
              ? 'Deja de aparecer al cargar gastos, facturas y asientos. Lo que ya está cargado queda igual y la podés reactivar cuando quieras.'
              : 'El grupo deja de aparecer para elegir. Lo podés reactivar cuando quieras.')}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        {reason ? (
          <>
            {fix ? (
              <Button asChild variant="outline" className="h-11 md:h-9">
                <Link href={fix.href}>{fix.label}</Link>
              </Button>
            ) : null}
            <AlertDialogCancel className="h-11 md:h-9">Entendido</AlertDialogCancel>
          </>
        ) : (
          <>
            <AlertDialogCancel className="h-11 md:h-9" disabled={pending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 md:h-9"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                deactivate()
              }}
            >
              {pending ? 'Desactivando…' : 'Desactivar'}
            </AlertDialogAction>
          </>
        )}
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}
