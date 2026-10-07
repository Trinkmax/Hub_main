'use client'

import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Field, FieldRow, FormError, FormSection } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { MoneyField } from '@/components/ui/money-field'
import { NumberField } from '@/components/ui/number-field'
import { SubmitButton } from '@/components/ui/submit-button'
import { Switch } from '@/components/ui/switch'
import { type TenantConfigState, updateTenantConfig } from '@/lib/admin/tenant-config'

const initial: TenantConfigState = { ok: false, message: '' }

type Config = {
  guest_idle_hours_to_rescan: number
  session_auto_abandon_hours: number
  ticket_auto_accept_enabled: boolean
  ticket_auto_accept_max_cents: number | null
  ticket_auto_accept_max_items: number | null
  kitchen_flow_enabled: boolean
}

/**
 * Ajustes de comandas del salón. Un solo formulario con Server Action
 * (`updateTenantConfig`): los nombres de los campos y los valores que viajan
 * son los de siempre.
 *
 * - Los interruptores van con `Field layout="toggle"` (toda la fila se toca) y
 *   mandan «on» cuando están prendidos, como el checkbox de antes.
 * - Los topes solo se mandan con la auto-aceptación prendida: apagarla y guardar
 *   los deja sin límite (igual que antes).
 */
export function AutoAcceptForm({
  tenantSlug,
  initialConfig,
}: {
  tenantSlug: string
  initialConfig: Config
}) {
  const [state, action] = useActionState(
    (prev: TenantConfigState, fd: FormData) => updateTenantConfig(tenantSlug, prev, fd),
    initial,
  )
  const [enabled, setEnabled] = useState(initialConfig.ticket_auto_accept_enabled)
  // El tope se guarda en centavos y se piensa en pesos: MoneyField lee los pesos y
  // da centavos. Vacío o $ 0 = sin límite (el schema pide 1 centavo o más).
  const [maxCents, setMaxCents] = useState<number | null>(
    initialConfig.ticket_auto_accept_max_cents,
  )
  const maxCentsValue = maxCents !== null && maxCents > 0 ? String(maxCents) : ''

  // Toast como efecto, no durante el render (evita disparos en cada re-render).
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message)
  }, [state])

  return (
    <form action={action} className="flex flex-col gap-6">
      <FormError message={state.ok ? null : state.message} />

      {/* Las secciones van pegadas: FormSection pone el pelo y el aire entre ellas. */}
      <div>
        <FormSection
          title="Auto-aceptación"
          description="Las comandas del comensal pasan directo a cocina sin esperar al mozo. Con topes, las comandas grandes igual las confirma una persona."
        >
          <Field
            layout="toggle"
            name="ticket_auto_accept_enabled"
            label="Aceptar comandas solas"
            hint="Se aceptan solas hasta los topes de abajo."
          >
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </Field>

          {enabled ? (
            <FieldRow>
              {/* Sin `name`: el valor viaja en el hidden de abajo (vacío o $ 0 = sin límite). */}
              <Field
                label="Tope de monto"
                optional
                hint="Si la comanda pasa este monto, la confirma un mozo. Vacío: sin límite."
              >
                <MoneyField
                  decimals="auto"
                  cents={maxCents}
                  onCentsChange={(cents) => setMaxCents(cents)}
                  placeholder="Sin límite"
                />
              </Field>
              <Field
                label="Tope de ítems"
                name="ticket_auto_accept_max_items"
                optional
                hint="Si la comanda trae más ítems, la confirma un mozo. Vacío: sin límite."
              >
                <NumberField
                  min={1}
                  max={100}
                  defaultValue={initialConfig.ticket_auto_accept_max_items}
                  placeholder="Sin límite"
                />
              </Field>
            </FieldRow>
          ) : null}
          {enabled ? (
            <input type="hidden" name="ticket_auto_accept_max_cents" value={maxCentsValue} />
          ) : null}
        </FormSection>

        <FormSection
          title="Flujo de cocina"
          description="Con cocina, solo la cocina (y vos) mueven las comandas por preparación (En preparación → Listo) y el mozo confirma y entrega. Sin cocina, el mozo maneja todo."
        >
          <Field
            layout="toggle"
            name="kitchen_flow_enabled"
            label="El bar usa cocina (KDS)"
            hint="Activa la pantalla de cocina y separa el trabajo del mozo y de la cocina."
          >
            <Switch defaultChecked={initialConfig.kitchen_flow_enabled} />
          </Field>
        </FormSection>

        <FormSection
          title="Tiempos"
          description="Cuándo pedirle al comensal que vuelva a escanear y cuándo cerrar solas las mesas sin movimiento."
        >
          <FieldRow>
            <Field
              label="Volver a escanear después de"
              name="guest_idle_hours_to_rescan"
              required
              hint="Si el comensal estuvo inactivo más de este tiempo, tiene que escanear de nuevo el QR de la mesa para pedir."
            >
              <NumberField
                min={1}
                max={24}
                suffix="horas"
                defaultValue={initialConfig.guest_idle_hours_to_rescan}
              />
            </Field>
            <Field
              label="Cerrar mesas inactivas después de"
              name="session_auto_abandon_hours"
              required
              hint="Una vez por día, las mesas sin actividad por más de este tiempo se cierran como abandonadas."
            >
              <NumberField
                min={1}
                max={72}
                suffix="horas"
                defaultValue={initialConfig.session_auto_abandon_hours}
              />
            </Field>
          </FieldRow>
        </FormSection>
      </div>

      <FormActions>
        <SubmitButton pendingText="Guardando…">Guardar cambios</SubmitButton>
      </FormActions>
    </form>
  )
}
