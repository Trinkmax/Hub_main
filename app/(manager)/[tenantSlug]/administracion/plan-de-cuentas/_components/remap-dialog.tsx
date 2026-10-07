'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { remapSystemAccount } from '@/lib/accounting/actions/master'
import type { SystemRemapResult } from '@/lib/accounting/queries/accounts'
import type { SystemAccountKey } from '@/lib/accounting/system-keys'
import { formatCents } from '@/lib/money'
import { Callout, describedBy, Field } from '../../ajustes/_components/form-bits'
import { useMasterAction } from '../../ajustes/_components/use-master-action'
import { failureKey, remapCompatible, remapRefusal, remapRequirement } from '../_lib/feedback'
import { SYSTEM_USES } from '../_lib/system-uses'
import type { ChartAccount, ChartIndex } from '../_lib/tree'

/**
 * «Usar otra cuenta» para un uso del sistema (#16, `acc_remap_system_account`): solo se ofrecen las
 * cuentas que sirven (mismo tipo y lado, imputable, activa, mismo control de proveedor o cliente, sin
 * caja ni otro uso). Lo ya cargado queda en la cuenta anterior; por eso la anterior no puede tener
 * saldo.
 */
export function RemapDialog({
  tenantSlug,
  index,
  balancesAvailable,
  systemKey,
  onClose,
  onDone,
}: {
  tenantSlug: string
  index: ChartIndex
  balancesAvailable: boolean
  systemKey: SystemAccountKey | null
  onClose: () => void
  onDone: (result: SystemRemapResult, message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const current = systemKey ? (index.ordered.find((a) => a.systemKey === systemKey) ?? null) : null
  return (
    <Dialog
      open={systemKey !== null && current !== null}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      {systemKey && current ? (
        <RemapForm
          key={systemKey}
          tenantSlug={tenantSlug}
          index={index}
          balancesAvailable={balancesAvailable}
          systemKey={systemKey}
          current={current}
          onBusyChange={setBusy}
          onClose={onClose}
          onDone={onDone}
        />
      ) : null}
    </Dialog>
  )
}

function RemapForm({
  tenantSlug,
  index,
  balancesAvailable,
  systemKey,
  current,
  onBusyChange,
  onClose,
  onDone,
}: {
  tenantSlug: string
  index: ChartIndex
  balancesAvailable: boolean
  systemKey: SystemAccountKey
  current: ChartAccount
  onBusyChange: (busy: boolean) => void
  onClose: () => void
  onDone: (result: SystemRemapResult, message: string) => void
}) {
  const { pending, run } = useMasterAction()
  const [accountId, setAccountId] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<{ text: string; balance: boolean } | null>(null)
  const use = SYSTEM_USES[systemKey]

  useEffect(() => onBusyChange(pending), [pending, onBusyChange])

  const { options, compatible } = useMemo(() => {
    const ids = new Set(index.ordered.filter((a) => remapCompatible(current, a)).map((a) => a.id))
    const list: AccountOption[] = index.ordered.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      postable: a.postable,
      active: a.active,
      description: a.description,
      parentId: a.parentId,
    }))
    return { options: list, compatible: ids }
  }, [index, current])

  const chosen = accountId ? (index.byId.get(accountId) ?? null) : null
  // La historia queda en la cuenta de hoy: con saldo, la base no deja cambiarla (se avisa antes).
  const hasBalance =
    balancesAvailable && current.balanceCents !== null && current.balanceCents !== 0

  const submit = () => {
    if (pending) return
    if (!chosen) {
      setFieldError('Elegí la cuenta nueva.')
      return
    }
    setFieldError(null)
    setRefusal(null)
    run(() => remapSystemAccount(tenantSlug, { systemKey, accountId: chosen.id }), {
      quiet: true,
      onSuccess: (result) => {
        const parties =
          result.partiesRepointed > 0
            ? ` ${result.partiesRepointed === 1 ? 'Un proveedor o cliente pasó' : `${result.partiesRepointed} proveedores o clientes pasaron`} a la cuenta nueva.`
            : ''
        onDone(
          result,
          result.changed
            ? `Listo: «${use.label}» ahora va a ${result.to.code} ${result.to.name}.${parties}`
            : `«${use.label}» ya usaba ${result.to.code} ${result.to.name}.`,
        )
      },
      onFailure: (state: AccFailureState) =>
        setRefusal({
          text: remapRefusal(state),
          balance: failureKey(state) === 'system_remap_has_balance',
        }),
    })
  }

  return (
    <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg" showCloseButton={!pending}>
      <DialogHeader>
        <DialogTitle className="font-serif text-pretty">
          «{use.label}»: usar otra cuenta
        </DialogTitle>
        <DialogDescription className="text-pretty">{use.use}</DialogDescription>
      </DialogHeader>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          submit()
        }}
      >
        <div className="grid gap-0.5 rounded-lg border bg-background/50 p-3 text-sm">
          <span className="text-xs text-muted-foreground">Hoy usa</span>
          <span>
            <span className="font-mono text-xs text-muted-foreground">{current.code}</span>{' '}
            {current.name}
          </span>
        </div>

        {hasBalance ? (
          <Callout
            tone="warning"
            title={`${current.code} ${current.name} tiene saldo (${formatCents(Math.abs(current.balanceCents ?? 0))}).`}
            action={
              <Button asChild variant="outline" className="h-11 md:h-9">
                <Link href={`/${tenantSlug}/administracion/libros/asiento-manual`}>
                  Hacer un asiento manual
                </Link>
              </Button>
            }
          >
            Lo cargado se queda en esa cuenta: para cambiarla, primero pasá el saldo a la nueva con
            un asiento manual.
          </Callout>
        ) : null}

        {compatible.size === 0 ? (
          <Callout tone="info" title="No hay otra cuenta que sirva.">
            {remapRequirement(current)} Creala en el plan y volvé.
          </Callout>
        ) : (
          <Field
            id="rm-account"
            label="Cuenta nueva"
            required
            hint={remapRequirement(current)}
            error={fieldError}
          >
            <AccountCombobox
              id="rm-account"
              value={accountId}
              onValueChange={(id) => {
                setAccountId(id)
                setFieldError(null)
                setRefusal(null)
              }}
              accounts={options}
              filter={(a) => compatible.has(a.id)}
              placeholder="Elegí la cuenta nueva"
              invalid={Boolean(fieldError)}
              aria-describedby={describedBy('rm-account', true, fieldError)}
            />
          </Field>
        )}

        {chosen ? (
          <Callout tone="info" title="Qué cambia">
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Lo nuevo va a {chosen.code} {chosen.name}.
              </li>
              <li>
                Lo que ya está cargado queda en {current.code} {current.name}.
              </li>
              {current.requiresParty ? (
                <li>Los proveedores, clientes u organismos que la usaban pasan a la nueva.</li>
              ) : null}
            </ul>
          </Callout>
        ) : null}

        {refusal ? (
          <Callout
            tone="error"
            action={
              refusal.balance ? (
                <Button asChild variant="outline" className="h-11 md:h-9">
                  <Link href={`/${tenantSlug}/administracion/libros/asiento-manual`}>
                    Hacer un asiento manual
                  </Link>
                </Button>
              ) : undefined
            }
          >
            {refusal.text}
          </Callout>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="h-11 md:h-9"
            disabled={pending}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            className="h-11 min-w-[160px] md:h-9"
            disabled={pending || compatible.size === 0 || hasBalance}
          >
            {pending ? 'Guardando…' : 'Usar esta cuenta'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
