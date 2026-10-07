'use client'

import { Banknote, CreditCard, Landmark, Receipt } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Checkbox } from '@/components/ui/checkbox'
import { CodeField } from '@/components/ui/code-field'
import {
  Field,
  FieldRow,
  type FormActionState,
  FormError,
  FormSection,
} from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { IconPicker } from '@/components/ui/icon-picker'
import { Input, InputAddon, InputGroup, SearchField } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberField } from '@/components/ui/number-field'
import { RadioCards } from '@/components/ui/radio-cards'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SubmitButton } from '@/components/ui/submit-button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { isValidCuit } from '@/lib/fiscal/cuit'
import { CatalogBlock, CatalogFamily, DemoRow, DemoStack, Readout } from './catalog-block'
import { wait } from './demo-utils'
import {
  ComboboxBlock,
  DatePickerBlock,
  MoneyFieldBlock,
  NumberFieldBlock,
  PeriodPickerBlock,
  TimeFieldBlock,
} from './fields-complex'
import { tourId } from './registry'

// ─── Input, InputGroup y SearchField ─────────────────────────────────────────

function InputDemo() {
  const [debounced, setDebounced] = React.useState('')
  return (
    <DemoStack>
      <Field label="Razón social" hint="Como figura en la factura.">
        <Input
          defaultValue="Distribuidora del Centro SA"
          autoComplete="organization"
          data-tour={tourId('input')}
        />
      </Field>
      <DemoRow label="Tamaños: sm 32 · md 36 · lg 44 px">
        <Input size="sm" aria-label="Campo chico" placeholder="Chico" className="max-w-40" />
        <Input size="md" aria-label="Campo mediano" placeholder="Mediano" className="max-w-40" />
        <Input size="lg" aria-label="Campo grande" placeholder="Grande" className="max-w-40" />
      </DemoRow>
      <DemoRow label="Estados fijos" stack>
        <FieldRow columns={3}>
          <Field label="Deshabilitado" disabled>
            <Input defaultValue="No se puede editar" />
          </Field>
          <Field label="Solo lectura" readOnly>
            <Input defaultValue="Se puede copiar" />
          </Field>
          <Field label="Inválido" error="Falta la razón social.">
            <Input />
          </Field>
        </FieldRow>
      </DemoRow>
      <DemoRow label="InputGroup: prefijo y sufijo sin spans a mano" stack>
        <FieldRow columns={2}>
          <Field label="Costo del cubierto">
            <InputGroup data-tour={tourId('input-group')}>
              <InputAddon>$</InputAddon>
              <Input inputMode="decimal" defaultValue="1.500" />
            </InputGroup>
          </Field>
          <Field label="Recordar antes">
            <InputGroup>
              <Input inputMode="numeric" defaultValue="3" />
              <InputAddon side="end">días</InputAddon>
            </InputGroup>
          </Field>
        </FieldRow>
      </DemoRow>
      <DemoRow
        label="SearchField: lupa, «Limpiar» y Esc; filtra en vivo con 200 ms de espera"
        stack
      >
        <Field label="Buscar proveedor" labelHidden>
          <SearchField
            placeholder="Buscar por nombre o CUIT"
            onDebouncedChange={setDebounced}
            data-tour={tourId('search-field')}
          />
        </Field>
        <Readout items={[{ label: 'Lo que llega al filtro', value: `«${debounced}»` }]} />
      </DemoRow>
    </DemoStack>
  )
}

// ─── Textarea y Label ────────────────────────────────────────────────────────

function TextareaDemo() {
  return (
    <DemoStack>
      <Field label="Comentario para la cocina" optional hint="Lo ve el mozo en la comanda.">
        <Textarea
          maxLength={140}
          showCount
          placeholder="Sin cebolla, a punto"
          data-tour={tourId('textarea')}
        />
      </Field>
      <FieldRow columns={2}>
        <Field label="Solo lectura" readOnly>
          <Textarea defaultValue="Mesa junto a la ventana." />
        </Field>
        <Field label="Inválido" error="Escribí al menos un motivo.">
          <Textarea />
        </Field>
      </FieldRow>
    </DemoStack>
  )
}

function LabelDemo() {
  const nameId = React.useId()
  const phoneId = React.useId()
  return (
    <DemoStack>
      <div className="grid gap-2">
        <Label htmlFor={nameId} data-tour={tourId('label')}>
          Nombre
        </Label>
        <Input id={nameId} autoComplete="given-name" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={phoneId} optional>
          Teléfono
        </Label>
        <Input id={phoneId} type="tel" autoComplete="tel" />
      </div>
    </DemoStack>
  )
}

// ─── Field y el formulario ───────────────────────────────────────────────────

/** Una «Server Action» de mentira con el contrato del kit: `{ ok, error, fieldErrors }`. */
async function fakeSaveSupplier(
  _previous: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  await wait(900)
  const name = String(formData.get('legal_name') ?? '').trim()
  const cuit = String(formData.get('cuit') ?? '')
  const fieldErrors: Record<string, string[]> = {}
  if (name === '') fieldErrors.legal_name = ['Falta la razón social.']
  if (cuit === '') fieldErrors.cuit = ['Falta el CUIT.']
  else if (!isValidCuit(cuit)) fieldErrors.cuit = ['El CUIT no es válido: revisá el último número.']
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: 'Revisá los campos marcados.', fieldErrors }
  }
  return { ok: true }
}

function FieldDemo() {
  const [state, formAction] = React.useActionState(fakeSaveSupplier, null)
  return (
    <form action={formAction} className="flex flex-col gap-6">
      <FormError message={state?.ok === false ? state.error : null} />
      {state?.ok ? (
        <Callout tone="success" announce="polite" title="Proveedor guardado">
          Es de mentira: no se guardó nada.
        </Callout>
      ) : null}
      <FormSection
        title="Datos fiscales"
        description="Así figuran en las facturas que te hace."
        data-tour={tourId('form-section')}
      >
        <Field
          label="Razón social"
          name="legal_name"
          error={state?.fieldErrors?.legal_name}
          data-tour={tourId('field')}
        >
          <Input defaultValue="Distribuidora del Centro SA" autoComplete="organization" />
        </Field>
        <FieldRow columns={2} data-tour={tourId('field-row')}>
          <Field label="CUIT" name="cuit" hint="Con o sin guiones" error={state?.fieldErrors?.cuit}>
            <CodeField kind="cuit" defaultValue="20123456785" />
          </Field>
          <Field label="Plazo de pago" name="payment_days" optional>
            <NumberField min={0} max={180} defaultValue={21} suffix="días" />
          </Field>
        </FieldRow>
      </FormSection>
      <FormSection title="Avisos">
        <Field
          layout="toggle"
          label="Avisarme cuando vence una factura"
          hint="Un mail tres días antes del vencimiento."
          name="notify"
        >
          <Switch defaultChecked />
        </Field>
        <Field layout="inline" label="Notas internas" name="notes" optional>
          <Textarea placeholder="Entrega martes y jueves" />
        </Field>
      </FormSection>
      <FormActions sticky={false} data-tour={tourId('form-actions')}>
        <Button type="reset" variant="secondary">
          Restablecer
        </Button>
        <SubmitButton pendingText="Guardando…">Guardar proveedor</SubmitButton>
      </FormActions>
    </form>
  )
}

// ─── Select ──────────────────────────────────────────────────────────────────

function ConditionSelect({
  size,
  label,
  defaultValue = 'ri',
  probe = false,
}: {
  size?: 'sm' | 'md' | 'lg'
  label?: string
  defaultValue?: string
  probe?: boolean
}) {
  return (
    <Select defaultValue={defaultValue}>
      <SelectTrigger
        size={size}
        aria-label={label}
        data-tour={probe ? tourId('select') : undefined}
      >
        <SelectValue placeholder="Elegí…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ri" description="Discrimina el IVA en la factura A">
          Responsable inscripto
        </SelectItem>
        <SelectItem value="mono" description="Te hace factura C">
          Monotributo
        </SelectItem>
        <SelectItem value="exento">Exento</SelectItem>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Otros</SelectLabel>
          <SelectItem value="cf">Consumidor final</SelectItem>
          <SelectItem value="no-alcanzado" disabled>
            No alcanzado
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function SelectDemo() {
  return (
    <DemoStack>
      <Field label="Condición frente al IVA" name="vat_condition">
        <ConditionSelect probe />
      </Field>
      <DemoRow label="Tamaños: el disparador mide lo mismo que un campo">
        <ConditionSelect size="sm" label="Condición, chico" />
        <ConditionSelect size="md" label="Condición, mediano" />
        <ConditionSelect size="lg" label="Condición, grande" />
      </DemoRow>
      <DemoRow label="Estados fijos" stack>
        <FieldRow columns={3}>
          <Field label="Deshabilitado" disabled>
            <ConditionSelect />
          </Field>
          <Field label="Solo lectura" readOnly>
            <ConditionSelect defaultValue="mono" />
          </Field>
          <Field label="Inválido" error="Elegí una condición.">
            <ConditionSelect defaultValue="" />
          </Field>
        </FieldRow>
      </DemoRow>
    </DemoStack>
  )
}

// ─── Checkbox, Switch, RadioCards, IconPicker ────────────────────────────────

function CheckboxRow({
  label,
  ...props
}: React.ComponentProps<typeof Checkbox> & { label: string }) {
  const id = React.useId()
  return (
    <span className="flex items-center gap-2">
      <Checkbox id={id} {...props} />
      <Label htmlFor={id}>{label}</Label>
    </span>
  )
}

function CheckboxDemo() {
  return (
    <DemoStack>
      <DemoRow label="Estados" className="gap-x-6 gap-y-3">
        <CheckboxRow label="Sin marcar" data-tour={tourId('checkbox')} />
        <CheckboxRow label="Marcada" defaultChecked />
        <CheckboxRow label="Algunas (para «elegir todo»)" checked="indeterminate" />
        <CheckboxRow label="Deshabilitada" disabled />
        <CheckboxRow label="Inválida" invalid />
        <CheckboxRow label="Solo lectura" defaultChecked readOnly />
      </DemoRow>
      <DemoRow label='Field layout="toggle": toda la fila es clickeable' stack>
        <Field
          layout="toggle"
          label="Incluir las cuentas inactivas"
          hint="Aparecen con la etiqueta «Inactiva»."
        >
          <Checkbox />
        </Field>
      </DemoRow>
    </DemoStack>
  )
}

function SwitchRow({ label, ...props }: React.ComponentProps<typeof Switch> & { label: string }) {
  const id = React.useId()
  return (
    <span className="flex items-center gap-2">
      <Switch id={id} {...props} />
      <Label htmlFor={id}>{label}</Label>
    </span>
  )
}

function SwitchDemo() {
  const [on, setOn] = React.useState(true)
  const [pending, setPending] = React.useState(false)
  return (
    <DemoStack>
      <DemoRow label="Tamaños y estados" className="gap-x-6 gap-y-3">
        <SwitchRow label="Mediano" defaultChecked data-tour={tourId('switch')} />
        <SwitchRow label="Chico" size="sm" />
        <SwitchRow label="Deshabilitado" disabled />
        <SwitchRow label="Solo lectura" defaultChecked readOnly />
        <SwitchRow
          label={pending ? 'Guardando…' : 'Optimista (pending)'}
          checked={on}
          pending={pending}
          onCheckedChange={async (next) => {
            setOn(next)
            setPending(true)
            await wait(1200)
            setPending(false)
          }}
        />
      </DemoRow>
      <DemoRow label='Ajustes: Field layout="toggle"' stack>
        <Field
          layout="toggle"
          label="Mandar la encuesta después de la visita"
          hint="Por WhatsApp, al día siguiente."
        >
          <Switch defaultChecked />
        </Field>
      </DemoRow>
    </DemoStack>
  )
}

function RadioCardsDemo() {
  return (
    <DemoStack>
      <Field label="Nuevo gasto">
        <RadioCards
          defaultValue="con-factura"
          columns={2}
          data-tour={tourId('radio-cards')}
          items={[
            {
              value: 'con-factura',
              label: 'Con factura',
              description: 'Discrimina IVA: va al libro de IVA compras.',
              icon: Receipt,
            },
            {
              value: 'sin-factura',
              label: 'Sin factura',
              description: 'Un ticket o un gasto chico de caja.',
              icon: Banknote,
            },
          ]}
        />
      </Field>
      <Field label="Medio de pago">
        <RadioCards
          defaultValue="efectivo"
          columns={3}
          size="sm"
          items={[
            { value: 'efectivo', label: 'Efectivo', meta: 'Caja del local', icon: Banknote },
            { value: 'transferencia', label: 'Transferencia', meta: 'Banco', icon: Landmark },
            {
              value: 'tarjeta',
              label: 'Tarjeta',
              description: 'Configurala en Ajustes',
              icon: CreditCard,
              disabled: true,
            },
          ]}
        />
      </Field>
    </DemoStack>
  )
}

function IconPickerDemo() {
  const [icon, setIcon] = React.useState<string | null>('Gift')
  return (
    <DemoStack>
      <Field
        label="Ícono del beneficio"
        hint="Las flechas recorren la grilla; Tab entra en el elegido."
      >
        <IconPicker value={icon} onChange={setIcon} data-tour={tourId('icon-picker')} />
      </Field>
      <Readout items={[{ label: 'Valor', value: icon ?? 'sin ícono' }]} />
    </DemoStack>
  )
}

// ─── CodeField ───────────────────────────────────────────────────────────────

function CodeFieldDemo() {
  return (
    <DemoStack>
      <FieldRow columns={2}>
        <Field label="CUIT válido" hint="Con o sin guiones: al salir se ve 20-12345678-6">
          <CodeField kind="cuit" defaultValue="20123456786" data-tour={tourId('code-field')} />
        </Field>
        <Field label="CUIT con el dígito mal" hint="Entrá y salí del campo para ver el error">
          <CodeField kind="cuit" defaultValue="20-12345678-5" />
        </Field>
        <Field label="Punto de venta" hint="Escribí 3 y salí: 00003">
          <CodeField kind="pv" defaultValue="3" />
        </Field>
        <Field label="Número" hint="Escribí 1290 y salí: 00001290">
          <CodeField kind="doc-number" defaultValue="1290" />
        </Field>
      </FieldRow>
    </DemoStack>
  )
}

// ─── La familia ──────────────────────────────────────────────────────────────

export function FieldsFamily() {
  return (
    <CatalogFamily id="campos">
      <CatalogBlock
        id="input"
        purpose="Texto de una línea, con prefijos y sufijos (`InputGroup`) y el buscador de las listas (`SearchField`)."
        yes="Nombres, mails, notas cortas. `SearchField` arriba de una tabla (`name=&quot;q&quot;`, sirve tal cual para filtros por GET)."
        no="Números (`NumberField`), plata (`MoneyField`), fechas (`DatePicker`) o códigos con dígito verificador (`CodeField`)."
        usage={`<Field label="Razón social" name="legal_name" error={state?.fieldErrors?.legal_name}>
  <Input autoComplete="organization" />
</Field>
<InputGroup>
  <InputAddon>$</InputAddon>
  <Input />
  <InputAddon side="end">días</InputAddon>
</InputGroup>
<SearchField onDebouncedChange={setQuery} />`}
        a11y={[
          'Foco «sobre el borde»: 2 px que cubren el borde de 1 px sin mover nada y se ven en alto contraste.',
          'Con el dedo la letra pasa a 16 px: iOS no hace zoom al enfocar.',
          'Solo lectura se puede seleccionar y enfocar (fondo apagado); deshabilitado no.',
          '`SearchField`: Esc limpia si hay texto (si no, deja pasar el Esc al diálogo que lo contiene).',
        ]}
      >
        <InputDemo />
      </CatalogBlock>

      <CatalogBlock
        id="textarea"
        purpose="Texto largo: mismo aspecto que el campo, crece con el contenido hasta 320 px."
        yes="Notas, comentarios, el motivo de una cancelación. Con `showCount` y `maxLength`, el contador."
        no="Una línea (`Input`)."
        usage={`<Field label="Comentario" name="comment" optional>
  <Textarea maxLength={140} showCount />
</Field>`}
        a11y={[
          'El contador «120 / 140» se anuncia recién al llegar al 90 %: antes sería ruido en cada tecla.',
          'Crece con `field-sizing: content` en Chromium; Safari usa `rows`.',
        ]}
      >
        <TextareaDemo />
      </CatalogBlock>

      <CatalogBlock
        id="label"
        purpose="La etiqueta de un campo: `type-label` en tinta. Adentro de un `Field` la pone el Field."
        yes="Suelta, solo con un control que no va en un `Field` (una casilla en una fila)."
        no="Asteriscos de obligatorio: en es-AR se marca lo opcional («(opcional)»), no lo obligatorio."
        usage={`<Label htmlFor={id} optional>Teléfono</Label>
<Input id={id} type="tel" />`}
        a11y={[
          'Siempre asociada con `htmlFor`: tocar la etiqueta enfoca (o marca) el control.',
          '« (opcional)» es texto: el lector lo lee junto con el nombre.',
        ]}
      >
        <LabelDemo />
      </CatalogBlock>

      <CatalogBlock
        id="field"
        purpose="Etiqueta, control, ayuda y error cableados y accesibles, pensados para Server Actions con `useActionState`."
        yes="Todo campo de formulario. `FieldRow` para pares cortos, `FormSection` para bloques, `FormActions` para los botones y `FormError` para el error general."
        no="Armar etiqueta, ayuda y error a mano con `aria-describedby` escrito: el Field ya los conecta en el orden correcto."
        usage={`const [state, formAction] = useActionState(saveSupplier, null)
<form action={formAction}>
  <FormError message={state?.error} />
  <FormSection title="Datos fiscales">
    <Field label="Razón social" name="legal_name" error={state?.fieldErrors?.legal_name}>
      <Input />
    </Field>
    <FieldRow columns={2}>
      <Field label="CUIT" name="cuit" hint="Con o sin guiones"><CodeField kind="cuit" /></Field>
      <Field label="Plazo" name="payment_days" optional><NumberField suffix="días" /></Field>
    </FieldRow>
  </FormSection>
  <FormActions>
    <Button variant="secondary" asChild><Link href={volver}>Cancelar</Link></Button>
    <SubmitButton pendingText="Guardando…">Guardar proveedor</SubmitButton>
  </FormActions>
</form>`}
        a11y={[
          'Ids `<id>-hint` y `<id>-error`, en `aria-describedby` en ese orden; el error lleva ícono y `aria-invalid` en el control.',
          'Al volver la respuesta del server, el foco va al primer campo inválido (o al `FormError`, que es `role="alert"`).',
          'Los errores locales (CUIT que no cierra, plata ilegible) aparecen al salir del campo, nunca mientras se escribe.',
          'Acá `FormActions` va con `sticky={false}`: en una pantalla real, en el celular es una barra fija abajo de 44 px.',
        ]}
      >
        <FieldDemo />
      </CatalogBlock>

      <CatalogBlock
        id="select"
        compat="`size=&quot;default&quot;` es `md` (también en `Switch`) (`@deprecated`)."
        purpose="Una lista corta de opciones fijas, sobre Radix: el disparador es un campo."
        yes="Hasta 8 opciones fijas: condición frente al IVA, tipo de comprobante."
        no="Más de 8 opciones o algo que vive en la base: `Combobox`. Un filtro de una sola opción a la vista: `SegmentedControl`."
        usage={`<Field label="Condición frente al IVA" name="vat_condition">
  <Select defaultValue="ri">
    <SelectTrigger><SelectValue placeholder="Elegí…" /></SelectTrigger>
    <SelectContent>
      <SelectItem value="ri" description="Factura A">Responsable inscripto</SelectItem>
      <SelectItem value="mono">Monotributo</SelectItem>
    </SelectContent>
  </Select>
</Field>`}
        a11y={[
          'Listbox de Radix: flechas, Inicio, Fin y búsqueda por tipeo; Esc cierra.',
          'La elegida lleva check (forma, no solo color); el resaltado de teclado no se anima.',
          'Con `name`, Radix arma el `<select>` nativo oculto para el FormData.',
        ]}
      >
        <SelectDemo />
      </CatalogBlock>

      <ComboboxBlock />
      <MoneyFieldBlock />
      <NumberFieldBlock />
      <DatePickerBlock />
      <PeriodPickerBlock />
      <TimeFieldBlock />

      <CatalogBlock
        id="checkbox"
        purpose="Una casilla: sí o no, o la de «elegir todo» con guion."
        yes="Opciones independientes, aceptar algo, elegir filas de una tabla."
        no="Un ajuste que se aplica al toque (`Switch`) o una opción entre varias (`RadioCards`)."
        usage={`<Field layout="toggle" label="Incluir inactivas" name="inactive">
  <Checkbox />
</Field>`}
        a11y={[
          'Espacio marca y desmarca; foco «afuera».',
          'El área clickeable llega a 24 px con mouse y a 44 con el dedo (`hit-area`), aunque la caja dibuje 16.',
          'Solo lectura: se ve y se enfoca, pero no cambia.',
        ]}
      >
        <CheckboxDemo />
      </CatalogBlock>

      <CatalogBlock
        id="switch"
        purpose="Un ajuste que se aplica al toque: prendido o apagado."
        yes="Ajustes, con `Field layout=&quot;toggle&quot;`: etiqueta y descripción a la izquierda, el switch a la derecha."
        no="Algo que se confirma con «Guardar» junto con otros campos: ahí va una casilla."
        usage={`<Field layout="toggle" label="Avisar por WhatsApp" hint="Al día siguiente">
  <Switch checked={on} onCheckedChange={guardar} pending={guardando} />
</Field>`}
        a11y={[
          '`role="switch"` de Radix: Espacio cambia; foco «afuera».',
          '`pending` suma un spinner en la perilla y `aria-busy`.',
          'En alto contraste la perilla lleva borde: sin él, el fondo pintado desaparece y no se ve si está prendido.',
        ]}
      >
        <SwitchDemo />
      </CatalogBlock>

      <CatalogBlock
        id="radio-cards"
        purpose="Una opción entre pocas, cuando cada una necesita una línea de explicación."
        yes="Tipo de premio de bienvenida, medio de pago, «Nuevo gasto» con o sin factura."
        no="Muchas opciones (`Select`, `Combobox`) o un filtro (`SegmentedControl`)."
        usage={`<Field label="Nuevo gasto" name="kind">
  <RadioCards columns={2} items={[
    { value: 'con-factura', label: 'Con factura', description: 'Va al libro de IVA compras', icon: Receipt },
    { value: 'sin-factura', label: 'Sin factura', icon: Banknote },
  ]} />
</Field>`}
        a11y={[
          'RadioGroup de Radix: Tab entra en la elegida y las flechas mueven y eligen.',
          'La descripción va en `aria-describedby` de cada tarjeta, no en su nombre.',
          'Elegida: borde verde, `ring-1` y punto relleno (forma además de color).',
        ]}
      >
        <RadioCardsDemo />
      </CatalogBlock>

      <CatalogBlock
        id="icon-picker"
        purpose="Elegir un ícono del catálogo curado, viendo cómo queda."
        yes="Beneficios del club, categorías de la carta: lo que el dueño ilustra con un ícono."
        no="Para pedir el nombre de un ícono de una librería: el dueño no tiene por qué conocerla."
        usage={`<Field label="Ícono" name="icon">
  <IconPicker value={icon} onChange={setIcon} />
</Field>`}
        a11y={[
          'RadioGroup: Tab entra en el elegido y las flechas recorren la grilla.',
          'Cada opción mide 44 px y tiene nombre («Regalo»); la elegida, relleno verde.',
        ]}
      >
        <IconPickerDemo />
      </CatalogBlock>

      <CatalogBlock
        id="code-field"
        purpose="Códigos que son números pero no cantidades: CUIT, punto de venta y número de comprobante."
        yes="Llevan ceros a la izquierda, guiones fijos o dígito verificador. El hidden lleva solo dígitos."
        no="Cantidades (`NumberField`): las flechas y la agrupación de miles les comerían los ceros."
        usage={`<Field label="CUIT" name="tax_id" hint="Con o sin guiones">
  <CodeField kind="cuit" />
</Field>
<FieldRow columns={2}>
  <Field label="Punto de venta" name="pv"><CodeField kind="pv" /></Field>
  <Field label="Número" name="number"><CodeField kind="doc-number" /></Field>
</FieldRow>`}
        a11y={[
          '`inputMode="numeric"` y cifras tabulares; mismo foco, alto y estados que `Input`.',
          'El error del dígito verificador aparece al salir del campo: «El CUIT no es válido: revisá el último número».',
        ]}
      >
        <CodeFieldDemo />
      </CatalogBlock>
    </CatalogFamily>
  )
}
