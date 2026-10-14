'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { ChoiceCard } from '@/components/administracion/kit/choice-card'
import { Pill } from '@/components/administracion/kit/pill'
import { WALLET_ICONS } from '@/components/administracion/kit/wallet-card'
import { Input } from '@/components/ui/input'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { type SavedTreasury, saveTreasuryAccount } from '@/lib/accounting/actions/master'
import type { TreasuryAccountRow } from '@/lib/accounting/queries/treasury'
import type { TreasuryKind } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'
import { type TreasuryDraft, treasuryDraftOf, treasurySavePayload } from '../_lib/payloads'
import { EditDialog } from './edit-dialog'
import { describedBy, Field } from './form-bits'
import { INPUT_CLASS, SwitchRow } from './inputs'
import { useMasterAction } from './use-master-action'

/**
 * Alta y edición de una caja o cuenta. Vive en su archivo (antes estaba adentro
 * del panel de Cajas y cuentas) para poder abrirla también desde los saldos
 * iniciales, cuando falta una caja justo antes de guardar.
 *
 * Manda lo mismo de siempre (`treasurySavePayload`, fijado por un test). Lo
 * que cambió es cómo se pregunta: «¿Qué es?» son cuatro tarjetas con su
 * consecuencia (antes, un desplegable «Tipo»). Van en fila —ícono a la
 * izquierda, 64 px— para que en el celular entren las cuatro y el nombre. En
 * una edición el nombre va primero: es lo que se viene a cambiar.
 *
 * `afterCreate` decide qué ofrece el aviso al crear una caja:
 * - `opening`: los saldos iniciales siguen pendientes → «Cargar los saldos
 *   iniciales» (lo que tiene hoy va ahí, no como un ingreso).
 * - `view`: ya están cargados → «Arranca en $ 0.» + «Ver la caja». No se
 *   aconseja cómo cargarle lo que ya tenía: eso lo define la contadora.
 * - `plain`: no se sabe (el catálogo no cargó) → solo «Arranca en $ 0.».
 * - `none`: se abrió desde los saldos iniciales → sin botón: lo que tiene se
 *   escribe ahí mismo, en su renglón.
 */

export type TreasuryDialogTarget = {
  /** La caja a editar; `null` = una nueva. */
  row: TreasuryAccountRow | null
  /** En un alta, con qué tipo arranca elegido. */
  kind?: TreasuryKind
}

export type TreasuryAfterCreate = 'opening' | 'view' | 'plain' | 'none'

const KIND_CHOICES: ReadonlyArray<{ value: TreasuryKind; title: string; consequence: string }> = [
  { value: 'cash', title: 'Efectivo', consequence: 'Una caja con billetes' },
  { value: 'bank', title: 'Banco', consequence: 'Cuenta corriente o caja de ahorro' },
  { value: 'wallet', title: 'Billetera', consequence: 'Mercado Pago, Ualá…' },
  {
    value: 'credit_card',
    title: 'Tarjeta de la empresa',
    consequence: 'Lo que gastás y pagás después',
  },
]

function draftFor(target: TreasuryDialogTarget): TreasuryDraft {
  const draft = treasuryDraftOf(target.row)
  return target.row === null && target.kind ? { ...draft, kind: target.kind } : draft
}

export function TreasuryDialog({
  tenantSlug,
  target,
  onClose,
  afterCreate,
  onSaved,
}: {
  tenantSlug: string
  /** `null` = cerrado. */
  target: TreasuryDialogTarget | null
  onClose: () => void
  afterCreate: TreasuryAfterCreate
  /** Después de guardar bien (alta o edición), con lo que devolvió la base. */
  onSaved?: (row: SavedTreasury, created: boolean) => void
}) {
  const router = useRouter()
  const { pending, run } = useMasterAction()
  const [seen, setSeen] = useState<TreasuryDialogTarget | null>(null)
  const [draft, setDraft] = useState<TreasuryDraft | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  // Al abrirse para otra caja arranca limpio; al cerrarse conserva lo último
  // para que la animación de salida no muestre el formulario vacío.
  if (target !== seen) {
    setSeen(target)
    if (target) {
      setDraft(draftFor(target))
      setErrors({})
      setMessage(null)
    }
  }

  const base = `/${tenantSlug}/administracion`

  const onFailure = (state: AccFailureState) => {
    setErrors(state.fieldErrors ?? {})
    setMessage(
      state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? null : state.message,
    )
  }

  const save = () => {
    if (!draft) return
    const d = draft
    run(() => saveTreasuryAccount(tenantSlug, treasurySavePayload(d)), {
      quiet: true,
      onSuccess: (row, msg) => {
        onClose()
        onSaved?.(row, d.id === null)
        if (d.id || afterCreate === 'none') {
          toast.success(msg)
        } else if (afterCreate === 'opening') {
          toast.success(msg, {
            description: 'Arranca en $ 0: lo que tiene hoy se carga con los saldos iniciales.',
            action: {
              label: 'Cargar los saldos iniciales',
              onClick: () => router.push(`${base}/configurar`),
            },
          })
        } else if (afterCreate === 'view') {
          toast.success(msg, {
            description: 'Arranca en $ 0.',
            action: { label: 'Ver la caja', onClick: () => router.push(`${base}/cajas/${row.id}`) },
          })
        } else {
          toast.success(msg, { description: 'Arranca en $ 0.' })
        }
      },
      onFailure,
    })
  }

  const err = (k: string) => errors[k] ?? null
  const editing = draft?.id != null
  // Una caja no pasa a ser la tarjeta de la empresa (ni al revés): en una edición no se ofrece.
  const choices = editing
    ? KIND_CHOICES.filter((c) =>
        draft?.kind === 'credit_card' ? c.value === 'credit_card' : c.value !== 'credit_card',
      )
    : KIND_CHOICES
  const offersOther = !editing || draft?.kind !== 'credit_card'
  const set = (patch: Partial<TreasuryDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const kindField = draft ? (
    <fieldset className="m-0 grid min-w-0 gap-2.5 border-0 p-0">
      <legend className="mb-2.5 p-0 text-sm font-medium">¿Qué es?</legend>
      <div className="grid gap-2">
        {choices.map((c) => {
          const Icon = WALLET_ICONS[c.value]
          return (
            <ChoiceCard
              key={c.value}
              name="tr-kind"
              value={c.value}
              title={c.title}
              consequence={c.consequence}
              checked={draft.kind === c.value}
              onChange={() => set({ kind: c.value })}
              art={
                <span className="flex size-9 items-center justify-center rounded-full border border-border/70 bg-card text-foreground shadow-2xs">
                  <Icon className="size-4" />
                </span>
              }
            />
          )
        })}
      </div>
      {offersOther ? (
        <div>
          <Pill
            size="touch"
            className="md:h-9 md:px-3 md:text-[13px]"
            active={draft.kind === 'other'}
            onClick={() => set({ kind: 'other' })}
          >
            Es otra cosa
          </Pill>
        </div>
      ) : null}
      {err('kind') ? (
        <p role="alert" className="text-xs text-destructive">
          {err('kind')}
        </p>
      ) : null}
    </fieldset>
  ) : null

  const nameField = draft ? (
    <Field id="tr-name" label="Nombre" required error={err('name')}>
      <Input
        id="tr-name"
        value={draft.name}
        maxLength={60}
        placeholder={
          draft.kind === 'cash'
            ? 'Caja del local'
            : draft.kind === 'wallet'
              ? 'Mercado Pago'
              : draft.kind === 'credit_card'
                ? 'Visa de la empresa'
                : 'Banco Galicia · cuenta corriente'
        }
        aria-invalid={err('name') ? true : undefined}
        aria-describedby={describedBy('tr-name', null, err('name'))}
        onChange={(e) => set({ name: e.target.value })}
        className={INPUT_CLASS}
      />
    </Field>
  ) : null

  return (
    <EditDialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={editing ? 'Editar caja o cuenta' : 'Nueva caja o cuenta'}
      description={
        editing ? 'Si le cambiás el nombre, cambia en toda la sección.' : 'Arranca en $ 0.'
      }
      pending={pending}
      message={message}
      onSubmit={save}
    >
      {draft ? (
        <>
          {/* En una edición, el nombre primero: es lo que se viene a cambiar. */}
          {editing ? nameField : kindField}
          {editing ? kindField : nameField}

          {draft.kind === 'bank' || draft.kind === 'credit_card' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="tr-bank"
                label={draft.kind === 'bank' ? 'Banco' : 'Banco que la emite'}
                optional
                error={err('bankName')}
              >
                <Input
                  id="tr-bank"
                  value={draft.bankName}
                  maxLength={80}
                  onChange={(e) => set({ bankName: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
              {draft.kind === 'bank' ? (
                <Field id="tr-number" label="N° de cuenta" optional error={err('accountNumber')}>
                  <Input
                    id="tr-number"
                    value={draft.accountNumber}
                    maxLength={40}
                    onChange={(e) => set({ accountNumber: e.target.value })}
                    className={cn(INPUT_CLASS, 'tabular-nums')}
                  />
                </Field>
              ) : null}
            </div>
          ) : null}

          {draft.kind === 'bank' || draft.kind === 'wallet' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="tr-cbu"
                label={draft.kind === 'bank' ? 'CBU' : 'CVU'}
                optional
                hint="Sirve para reconocer las transferencias entre tus cuentas cuando subís el extracto."
                error={err('cbuCvu')}
              >
                <Input
                  id="tr-cbu"
                  value={draft.cbuCvu}
                  maxLength={26}
                  inputMode="numeric"
                  aria-invalid={err('cbuCvu') ? true : undefined}
                  aria-describedby={describedBy('tr-cbu', true, err('cbuCvu'))}
                  onChange={(e) => set({ cbuCvu: e.target.value })}
                  className={cn(INPUT_CLASS, 'tabular-nums')}
                />
              </Field>
              <Field id="tr-alias" label="Alias" optional error={err('alias')}>
                <Input
                  id="tr-alias"
                  value={draft.alias}
                  maxLength={20}
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={err('alias') ? true : undefined}
                  aria-describedby={describedBy('tr-alias', null, err('alias'))}
                  onChange={(e) => set({ alias: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
            </div>
          ) : null}

          {draft.kind !== 'cash' && draft.kind !== 'credit_card' ? (
            <SwitchRow
              id="tr-negative"
              label="Puede quedar en negativo"
              description="Para una cuenta con descubierto acordado: el sistema no avisa cuando baja de cero."
              checked={draft.allowNegative}
              onCheckedChange={(checked) => set({ allowNegative: checked })}
            />
          ) : null}
          {!editing && draft.kind === 'bank' ? (
            <SwitchRow
              id="tr-bank-party"
              label="Sumar el banco como proveedor"
              description="Así sus comisiones y gastos quedan a su nombre."
              checked={draft.createBankParty}
              onCheckedChange={(checked) => set({ createBankParty: checked })}
            />
          ) : null}
        </>
      ) : null}
    </EditDialog>
  )
}
