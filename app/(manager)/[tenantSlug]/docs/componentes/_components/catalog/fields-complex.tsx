'use client'

import * as React from 'react'
import { closedMonthGuard, closedMonthReason } from '@/components/accounting/closed-periods'
import { Calendar } from '@/components/ui/calendar'
import {
  Combobox,
  type ComboboxSearch,
  type EntityOption,
  EntityPicker,
  normalizeSearchText,
  useRouteSearch,
} from '@/components/ui/combobox'
import { CopyButton } from '@/components/ui/copy-button'
import { DatePicker } from '@/components/ui/date-picker'
import { Field, FieldRow } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { MoneyField, readMoneyText } from '@/components/ui/money-field'
import { NumberField } from '@/components/ui/number-field'
import { type Period, PeriodPicker } from '@/components/ui/period-picker'
import { Switch } from '@/components/ui/switch'
import { DateTimeField, TimeField } from '@/components/ui/time-field'
import type { RangeDraft } from '@/lib/dates/calendar-grid'
import { addDays, addMonthsToYearMonth, endOfMonth, monthOf } from '@/lib/dates/civil'
import { formatIsoDay } from '@/lib/dates/format'
import { periodLabel, periodRange, serializePeriod } from '@/lib/dates/period'
import { CatalogBlock, DemoRow, DemoStack, Readout } from './catalog-block'
import { useCatalog } from './catalog-provider'
import { tourId } from './registry'
import { SAMPLE_CATEGORIES, SAMPLE_SUPPLIERS, supplierDescription } from './sample-data'

// ─── Combobox y EntityPicker ─────────────────────────────────────────────────

const CATEGORY_OPTIONS: EntityOption[] = SAMPLE_CATEGORIES.map((category) => ({
  value: category.value,
  label: category.label,
  group: category.group,
}))

const TAG_OPTIONS: EntityOption[] = [
  { value: 'frecuente', label: 'Cliente frecuente' },
  { value: 'cumple', label: 'Cumpleaños este mes' },
  { value: 'empresa', label: 'Empresa' },
  { value: 'vegetariano', label: 'Vegetariano' },
  { value: 'sin-tacc', label: 'Sin TACC' },
  { value: 'mesa-ventana', label: 'Prefiere ventana' },
]

/** Los recientes: lo que se ve con la búsqueda vacía. */
const RECENT_SUPPLIERS: EntityOption[] = SAMPLE_SUPPLIERS.slice(0, 3).map((supplier) => ({
  value: supplier.id,
  label: supplier.name,
  description: supplierDescription(supplier),
}))

type SearchStats = { sent: number; canceled: number; answered: number; failed: number }

const NO_STATS: SearchStats = { sent: 0, canceled: 0, answered: 0, failed: 0 }

function AsyncPickerDemo() {
  const { basePath } = useCatalog()
  const [fail, setFail] = React.useState(false)
  const [stats, setStats] = React.useState<SearchStats>(NO_STATS)
  const [created, setCreated] = React.useState<EntityOption[]>([])
  const switchId = React.useId()
  const params = React.useMemo(() => (fail ? { fallo: '1' } : undefined), [fail])
  const routeSearch = useRouteSearch(`${basePath}/busqueda`, { params })

  // La búsqueda del Route Handler, contada: cada tecla que llega a buscar
  // cancela la anterior de verdad (el AbortSignal corta el fetch).
  const search = React.useCallback<ComboboxSearch>(
    async (query, signal) => {
      setStats((s) => ({ ...s, sent: s.sent + 1 }))
      const onAbort = () => setStats((s) => ({ ...s, canceled: s.canceled + 1 }))
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        const found = await routeSearch(query, signal)
        setStats((s) => ({ ...s, answered: s.answered + 1 }))
        const q = normalizeSearchText(query.trim())
        const mine = created.filter((option) => normalizeSearchText(option.label).includes(q))
        return [...mine, ...found]
      } catch (error) {
        if (!signal.aborted) setStats((s) => ({ ...s, failed: s.failed + 1 }))
        throw error
      } finally {
        signal.removeEventListener('abort', onAbort)
      }
    },
    [routeSearch, created],
  )

  return (
    <DemoStack>
      <Field
        label="Proveedor"
        hint="Búsqueda de mentira de 400 ms en un Route Handler. Tipeá rápido: cada tecla cancela la anterior."
      >
        <EntityPicker
          search={search}
          defaultOptions={RECENT_SUPPLIERS}
          clearable
          placeholder="Elegí un proveedor…"
          searchPlaceholder="Buscar por nombre o rubro…"
          onCreate={(query) => {
            const option: EntityOption = {
              value: `nuevo-${normalizeSearchText(query).replace(/[^a-z0-9]+/g, '-')}`,
              label: query,
              description: 'Recién creado (en una pantalla real abre la hoja «Nuevo proveedor»)',
            }
            setCreated((current) => [...current, option])
            return option
          }}
          data-tour={tourId('entity-picker')}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="flex items-center gap-2">
          <Switch id={switchId} checked={fail} onCheckedChange={setFail} />
          <Label htmlFor={switchId}>Simular error</Label>
        </span>
      </div>
      <Readout
        items={[
          { label: 'Búsquedas enviadas', value: stats.sent },
          { label: 'Canceladas al tipear', value: stats.canceled },
          { label: 'Respondidas', value: stats.answered },
          { label: 'Con error', value: stats.failed },
        ]}
      />
    </DemoStack>
  )
}

function ComboboxDemo() {
  return (
    <DemoStack>
      <Field label="Rubro" hint="Estático: filtra en el navegador, sin tildes, con grupos.">
        <Combobox
          options={CATEGORY_OPTIONS}
          clearable
          placeholder="Elegí un rubro…"
          data-tour={tourId('combobox')}
        />
      </Field>
      <AsyncPickerDemo />
      <Field label="Etiquetas" hint="Varios: hasta dos chips y «+3»; Retroceso saca la última.">
        <Combobox
          multiple
          options={TAG_OPTIONS}
          defaultValue={['frecuente', 'empresa', 'sin-tacc']}
          placeholder="Elegí etiquetas…"
        />
      </Field>
      <FieldRow columns={2}>
        <Field label="Deshabilitado" disabled>
          <Combobox options={CATEGORY_OPTIONS} defaultValue="bebidas" />
        </Field>
        <Field label="Con error" error="Elegí un rubro.">
          <Combobox options={CATEGORY_OPTIONS} placeholder="Elegí un rubro…" />
        </Field>
      </FieldRow>
    </DemoStack>
  )
}

export function ComboboxBlock() {
  return (
    <CatalogBlock
      id="combobox"
      sample
      purpose="Elegir uno (o varios) entre muchos: proveedor, cliente, cuenta, etiqueta. Con búsqueda, teclado completo y «Crear «…»»."
      yes="Más de 8 opciones, o una lista que vive en la base (`EntityPicker` busca por un Route Handler GET con `AbortController`)."
      no="Hasta 8 opciones fijas: `Select`. Para buscar en una tabla: `SearchField`."
      usage={`// Estático
<Field label="Rubro" name="rubro">
  <Combobox options={rubros} clearable />
</Field>

// Asíncrono: Route Handler GET, cada tecla cancela la anterior
const search = useRouteSearch(\`/api/\${slug}/search/proveedores\`)
<Field label="Proveedor" name="supplier_id">
  <EntityPicker search={search} defaultOptions={recientes} onCreate={abrirHojaNuevo} />
</Field>`}
      a11y={[
        'El disparador es `role="combobox"` y se nombra con la etiqueta del Field más el valor: «Proveedor, Distribuidora del Centro SA».',
        'Enter, Espacio, ↓ o Alt + ↓ abren; una letra abre con esa letra ya tipeada.',
        'Adentro: ↑ ↓ mueven, Inicio y Fin van a los extremos, RePág y AvPág saltan de a 10, Enter elige, Esc y Tab cierran y vuelven al disparador.',
        '«Buscando…» aparece recién a los 300 ms y la cantidad de resultados se anuncia; si falla, «No pudimos buscar» con «Reintentar».',
      ]}
    >
      <ComboboxDemo />
    </CatalogBlock>
  )
}

// ─── MoneyField ──────────────────────────────────────────────────────────────

const PASTE_SAMPLES = ['1.234,50', '1,234.50', 'US$175,26', '12,3,4'] as const

function MoneyFieldDemo() {
  const [text, setText] = React.useState('1.234,50')
  const state = readMoneyText(text)
  return (
    <DemoStack>
      <Field
        label="Importe"
        name="importe"
        hint="Mientras se tipea no hay formato ni error; al salir se reescribe prolijo."
      >
        <MoneyField value={text} onValueChange={setText} data-tour={tourId('money-field')} />
      </Field>
      <Readout
        items={[
          { label: 'Texto', value: `«${text}»` },
          { label: 'Centavos', value: state.cents === null ? '— (no se lee)' : state.cents },
          {
            label: 'Valor del hidden',
            value: state.submitValue === '' ? '«» (vacío)' : `«${state.submitValue}»`,
          },
        ]}
      />
      <DemoRow label="Para pegar (el último no se lee)">
        {PASTE_SAMPLES.map((sample) => (
          <span
            key={sample}
            className="inline-flex items-center gap-1 rounded-md border border-border-strong bg-card ps-2 font-mono type-small"
          >
            {sample}
            <CopyButton
              value={sample}
              iconOnly
              variant="ghost"
              size="icon-sm"
              label={`Copiar ${sample}`}
              copiedLabel={`${sample} copiado`}
            />
          </span>
        ))}
      </DemoRow>
      <DemoRow label="Variantes y estados fijos" stack>
        <FieldRow columns={2}>
          <Field label="Pauta en dólares">
            <MoneyField currency="USD" defaultCents={17_526} />
          </Field>
          <Field label="Seña" hint="decimals=&quot;auto&quot;: entero si es redondo">
            <MoneyField decimals="auto" defaultCents={5_000_000} />
          </Field>
          <Field label="Desde $ 1.000" hint="Probá 500 y salí del campo">
            <MoneyField minCents={100_000} />
          </Field>
          <Field label="Solo lectura" readOnly>
            <MoneyField defaultCents={12_345_678} />
          </Field>
          <Field label="Deshabilitado" disabled>
            <MoneyField />
          </Field>
          <Field label="Con error del server" error="Tiene que ser de $ 1.000,00 o más.">
            <MoneyField defaultCents={50_000} />
          </Field>
        </FieldRow>
      </DemoRow>
    </DemoStack>
  )
}

export function MoneyFieldBlock() {
  return (
    <CatalogBlock
      id="money-field"
      purpose="Plata. Siempre igual y sin errores de centavos: el texto se lee con aritmética de strings, nunca `Math.round(x * 100)`."
      yes="Todo importe en pesos o dólares. En un formulario, el `<input type=&quot;hidden&quot;>` lleva los centavos canónicos."
      no="Conteos (personas, alcance): `NumberField`. Códigos con ceros a la izquierda: `CodeField`."
      usage={`<Field label="Importe" name="amount_cents" error={state?.fieldErrors?.amount_cents}>
  <MoneyField defaultCents={comprobante?.amountCents} />
</Field>
// en el server: centsFromForm({ min: 1 }) de lib/money/zod.ts`}
      a11y={[
        'El `$` va adentro y oculto; el nombre suma «en pesos» (o «en dólares») para el lector de pantalla.',
        'Enter no se intercepta: envía el formulario con el hidden ya listo.',
        'Los errores aparecen al salir del campo, nunca mientras se escribe; si se envía ilegible, el foco vuelve al campo sin la burbuja nativa.',
        'En el celular, `inputMode="decimal"` y al enfocar se centra en la pantalla (el teclado tapa la mitad de abajo).',
      ]}
    >
      <MoneyFieldDemo />
    </CatalogBlock>
  )
}

// ─── NumberField ─────────────────────────────────────────────────────────────

function NumberFieldDemo() {
  const [guests, setGuests] = React.useState<number | null>(4)
  return (
    <DemoStack>
      <Field
        label="Personas"
        hint="↑ ↓ de a uno, RePág y AvPág de a 10, Inicio y Fin a los límites."
      >
        <NumberField
          value={guests}
          onValueChange={setGuests}
          min={1}
          max={40}
          suffix="personas"
          data-tour={tourId('number-field')}
        />
      </Field>
      <Readout items={[{ label: 'Valor', value: guests ?? '— (vacío)' }]} />
      <FieldRow columns={2}>
        <Field label="Propina sugerida" hint="Un decimal, de a 0,5">
          <NumberField defaultValue={10} decimals={1} step={0.5} min={0} max={30} suffix="%" />
        </Field>
        <Field label="Alcance" hint="Sin botones: conteos grandes">
          <NumberField defaultValue={12_500} steppers={false} min={0} />
        </Field>
        <Field label="Cupo de la cena" hint="Escribí 200 y salí: no se recorta en silencio">
          <NumberField defaultValue={120} min={0} max={150} />
        </Field>
        <Field label="Solo lectura" readOnly>
          <NumberField defaultValue={8} suffix="días" />
        </Field>
      </FieldRow>
    </DemoStack>
  )
}

export function NumberFieldBlock() {
  return (
    <CatalogBlock
      id="number-field"
      purpose="Personas, cupos, días y porcentajes: un solo campo con flechas y botones − y +."
      yes="Cantidades que se suman o restan de a pasos. Reemplaza los `type=&quot;number&quot;` y los steppers armados a mano."
      no="Plata (`MoneyField`) o códigos con ceros a la izquierda (`CodeField`)."
      usage={`<Field label="Personas" name="party_size">
  <NumberField min={1} max={40} suffix="personas" />
</Field>`}
      a11y={[
        '`role="spinbutton"` con `aria-valuenow`, `aria-valuemin`, `aria-valuemax` y `aria-valuetext` («4 personas»).',
        'Los botones − y + están fuera del orden de Tab (el campo es una sola parada) pero tienen nombre: «Sumar uno», «Restar uno».',
        'Mantener apretado repite (a los 400 ms y después cada 80 ms); se apagan en el límite.',
        'Fuera de rango al salir: error («El máximo es 150»), nunca un recorte en silencio.',
      ]}
    >
      <NumberFieldDemo />
    </CatalogBlock>
  )
}

// ─── DatePicker y Calendar ───────────────────────────────────────────────────

function DatePickerDemo() {
  const { today } = useCatalog()
  const closedMonth = addMonthsToYearMonth(monthOf(today), -1)
  const guard = React.useMemo(() => closedMonthGuard([closedMonth]), [closedMonth])
  const [range, setRange] = React.useState<RangeDraft>({ from: null, to: null })
  const [day, setDay] = React.useState<string | null>(today)
  const year = Number(today.slice(0, 4))

  return (
    <DemoStack>
      <Field
        label="Fecha del comprobante"
        hint={`${closedMonthReason(closedMonth)} Tipeá «15/9» y se completa el año.`}
      >
        <DatePicker
          value={day}
          onValueChange={setDay}
          today={today}
          min={addDays(today, -120)}
          max={addDays(today, 30)}
          presets={[
            { label: 'Mañana', value: addDays(today, 1) },
            { label: 'Fin de mes', value: endOfMonth(today) },
          ]}
          markers={{ [addDays(today, 2)]: 'dot', [addDays(today, 9)]: 'dot' }}
          isDateDisabled={guard.isDateDisabled}
          disabledReason={guard.disabledReason}
          clearable
          data-tour={tourId('date-picker')}
        />
      </Field>
      <Readout items={[{ label: 'Valor del hidden', value: day ? `«${day}»` : '«» (vacío)' }]} />
      <FieldRow columns={2}>
        <Field label="Cumpleaños" hint="Mes y año en selects">
          <DatePicker captionLayout="dropdowns" fromYear={1940} toYear={year} today={today} />
        </Field>
        <Field label="Deshabilitado" disabled>
          <DatePicker defaultValue={today} today={today} />
        </Field>
      </FieldRow>
      <DemoRow label="Calendar suelto, en modo rango (dos toques)" stack>
        <Calendar
          mode="range"
          range={range}
          onRangeChange={setRange}
          today={today}
          data-tour={tourId('calendar')}
        />
        <p className="type-small text-muted-foreground">
          {range.from
            ? `Desde ${formatIsoDay(range.from)}${range.to ? ` hasta ${formatIsoDay(range.to)}` : ': elegí el final'}`
            : 'Elegí el primer día del rango.'}
        </p>
      </DemoRow>
    </DemoStack>
  )
}

export function DatePickerBlock() {
  return (
    <CatalogBlock
      id="date-picker"
      purpose="Una fecha civil: un string `yyyy-MM-dd`, nunca un `Date`. Se tipea («15/9») o se elige en el calendario."
      yes="Toda fecha de un formulario. Reemplaza los `type=&quot;date&quot;` del panel; el hidden lleva lo mismo que el nativo."
      no="El período de un reporte (`PeriodPicker`) o una hora (`TimeField`)."
      usage={`const cerrado = closedMonthGuard(mesesCerrados)
<Field label="Fecha" name="date">
  <DatePicker
    defaultValue={comprobante?.date}
    isDateDisabled={cerrado.isDateDisabled}
    disabledReason={cerrado.disabledReason}
    presets={[{ label: 'Fin de mes', value: finDeMes }]}
  />
</Field>`}
      a11y={[
        'El calendario es un `role="dialog"` modal («Elegir fecha»): Tab no se escapa y Esc vuelve al campo. Se abre con el botón o con Alt + ↓.',
        'Grilla `role="grid"` desde el lunes: ← → un día, ↑ ↓ una semana, Inicio y Fin de la semana, RePág y AvPág un mes, con Mayús un año.',
        'Cada día se nombra entero («martes 15 de septiembre de 2026»); hoy lleva `aria-current="date"`; un día cerrado dice por qué.',
        'Con el calendario cerrado, Enter envía el formulario. Los errores aparecen al salir del campo.',
      ]}
    >
      <DatePickerDemo />
    </CatalogBlock>
  )
}

// ─── PeriodPicker ────────────────────────────────────────────────────────────

function PeriodPickerDemo() {
  const { today } = useCatalog()
  const closedMonth = addMonthsToYearMonth(monthOf(today), -1)
  const [period, setPeriod] = React.useState<Period>({ kind: 'month', month: monthOf(today) })
  const [monthOnly, setMonthOnly] = React.useState<Period>({
    kind: 'month',
    month: closedMonth,
  })
  const range = periodRange(period)

  return (
    <DemoStack>
      <DemoRow label="Día · Mes · Ejercicio · Rango, con atajos y un mes cerrado" stack>
        <PeriodPicker
          aria-label="Período"
          value={period}
          onValueChange={setPeriod}
          closedMonths={[closedMonth]}
          today={today}
          max={today}
          data-tour={tourId('period-picker')}
        />
        <Readout
          items={[
            { label: 'Período', value: periodLabel(period) },
            { label: 'En la URL', value: `?periodo=${serializePeriod(period)}` },
            { label: 'Rango', value: `${formatIsoDay(range.from)} a ${formatIsoDay(range.to)}` },
          ]}
        />
      </DemoRow>
      <DemoRow label="Solo meses, sin flechas" stack>
        <PeriodPicker
          aria-label="Mes"
          value={monthOnly}
          onValueChange={setMonthOnly}
          kinds={['month']}
          stepper={false}
          closedMonths={[closedMonth]}
          today={today}
        />
      </DemoRow>
    </DemoStack>
  )
}

export function PeriodPickerBlock() {
  return (
    <CatalogBlock
      id="period-picker"
      purpose="El período de reportes y libros: día, mes, ejercicio y rango, con atajos y por URL."
      yes="Todo reporte o libro. En modo link (`param=&quot;periodo&quot;`) el período viaja en la URL y lo comparten todos los reportes."
      no="Una fecha de un formulario (`DatePicker`)."
      usage={`// Reporte (Server Component): el período por URL
const periodo = parsePeriod(sp.periodo, { today }) ?? { kind: 'month', month: monthOf(today) }
<PeriodPicker value={periodo} param="periodo" closedMonths={cerrados} />

// Controlado
<PeriodPicker value={period} onValueChange={setPeriod} kinds={['month']} />`}
      a11y={[
        'Las flechas dicen a dónde van: «Período anterior: agosto 2026».',
        'El popover es un `role="dialog"` modal; las grillas de días y de meses se recorren con las flechas, como el calendario.',
        'Un mes cerrado lleva candado y su nombre suma «, cerrado».',
        'Debajo de `sm` el mismo contenido va en una hoja inferior, con «Aplicar» en el pie.',
      ]}
    >
      <PeriodPickerDemo />
    </CatalogBlock>
  )
}

// ─── TimeField y DateTimeField ───────────────────────────────────────────────

function TimeFieldDemo() {
  const { today } = useCatalog()
  const [time, setTime] = React.useState<string | null>('21:30')
  return (
    <DemoStack>
      <Field label="Hora de la reserva" hint="Tipeá 2130, 930 o 21h30. ↑ ↓ de a 15 minutos.">
        <TimeField
          value={time}
          onValueChange={setTime}
          step={15}
          suggestions
          min="19:00"
          max="02:00"
          crossesMidnight
          data-tour={tourId('time-field')}
        />
      </Field>
      <Readout items={[{ label: 'Valor del hidden', value: time ? `«${time}»` : '«» (vacío)' }]} />
      <Field label="Envío programado" hint="Fecha y hora con un solo hidden, como datetime-local">
        <DateTimeField
          defaultValue={`${addDays(today, 1)}T10:00`}
          minDate={today}
          data-tour={tourId('date-time-field')}
        />
      </Field>
      <FieldRow columns={2}>
        <Field label="Solo lectura" readOnly>
          <TimeField defaultValue="13:00" />
        </Field>
        <Field label="Con error" error="Usá formato 24 h, por ejemplo 21:30">
          <TimeField defaultValue="25:00" />
        </Field>
      </FieldRow>
    </DemoStack>
  )
}

export function TimeFieldBlock() {
  return (
    <CatalogBlock
      id="time-field"
      purpose="La hora, propia y en 24 h siempre: tipeable, con flechas y con sugerencias."
      yes="Horarios de reservas, turnos y envíos. El hidden lleva `HH:mm`, igual que el nativo."
      no="El `<input type=&quot;time&quot;>` nativo: muestra AM/PM según el idioma del sistema y se ve distinto en cada navegador."
      usage={`<Field label="Hora" name="time">
  <TimeField step={15} suggestions min="19:00" max="02:00" crossesMidnight />
</Field>
<Field label="Envío" name="send_at">
  <DateTimeField minDate={hoy} />
</Field>`}
      a11y={[
        '↑ ↓ suman o restan el paso (con Mayús, 60 minutos), dentro de `min` y `max`.',
        'Con `suggestions` es un combobox: la lista se abre al tomar foco o con Alt + ↓.',
        'Servicio de noche (`crossesMidnight`): 00:30 va después de 23:45.',
        'Enter no se intercepta; el error aparece al salir del campo.',
      ]}
    >
      <TimeFieldDemo />
    </CatalogBlock>
  )
}
