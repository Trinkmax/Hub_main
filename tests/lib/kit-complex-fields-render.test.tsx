// @vitest-environment node
import { createElement as h, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Calendar } from '@/components/ui/calendar'
import { Combobox, type EntityOption } from '@/components/ui/combobox'
import { DatePicker } from '@/components/ui/date-picker'
import { Field } from '@/components/ui/field'
import { MoneyField } from '@/components/ui/money-field'
import { NumberField } from '@/components/ui/number-field'
import { PeriodPicker } from '@/components/ui/period-picker'
import { DateTimeField, TimeField } from '@/components/ui/time-field'

/**
 * Kit HUB §3.2, los campos compuestos en el primer HTML (server): el hidden
 * con el valor canónico (centavos, YYYY-MM-DD, HH:mm) sin duplicar el `name`,
 * el cableado accesible (nombre con la etiqueta del Field, spinbutton,
 * combobox, grilla del calendario) y `data-tour` llegando al DOM.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    h('a', { href, ...rest }, children),
}))

const render = (el: ReactElement) => renderToStaticMarkup(el)

/** React escapa `& < > " '` en los atributos: se vuelven a leer como en el DOM. */
function decode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Los atributos de cada etiqueta que matchea `selector`, con el nombre en
 * minúscula como los lee el DOM (React escribe `inputMode`, el HTML no
 * distingue mayúsculas).
 */
function allAttrs(markup: string, selector: RegExp): Array<Record<string, string>> {
  const flags = selector.flags.includes('g') ? selector.flags : `${selector.flags}g`
  return [...markup.matchAll(new RegExp(selector.source, flags))].map((m) =>
    Object.fromEntries(
      [...m[0].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)]
        .slice(1)
        .map(([, k, v]) => [(k ?? '').toLowerCase(), decode(v ?? '')]),
    ),
  )
}

function attrsOf(markup: string, selector: RegExp): Record<string, string> {
  const first = allAttrs(markup, selector)[0]
  if (!first) throw new Error(`no encontré ${selector} en ${markup}`)
  return first
}

const hiddenInputs = (markup: string) => allAttrs(markup, /<input[^>]*type="hidden"[^>]*>/)
const tour = (value: string) => ({ 'data-tour': value }) as const

describe('MoneyField', () => {
  it('adentro de un Field: centavos en el hidden, pesos prolijos en el visible, sin name duplicado', () => {
    const out = render(
      <Field label="Importe" name="amount_cents">
        <MoneyField defaultCents={123450} {...tour('importe')} />
      </Field>,
    )
    expect(hiddenInputs(out)).toEqual([{ type: 'hidden', name: 'amount_cents', value: '123450' }])
    const visible = attrsOf(out, /<input[^>]*type="text"[^>]*>/)
    expect(visible.value).toBe('1.234,50')
    expect(visible.inputmode).toBe('decimal')
    expect(visible.autocomplete).toBe('off')
    expect(visible.name).toBeUndefined()
    expect(visible['data-tour']).toBe('importe')
    expect(visible.class).toContain('type-amount')
    expect(visible.class).toContain('text-right')
  })

  it('el $ va oculto para el lector y el nombre suma «en pesos»', () => {
    const out = render(
      <Field label="Importe" id="importe">
        <MoneyField />
      </Field>,
    )
    expect(out).toMatch(/<span[^>]*aria-hidden="true"[^>]*>\$<\/span>/)
    const visible = attrsOf(out, /<input[^>]*type="text"[^>]*>/)
    const [labelId, currencyId] = (visible['aria-labelledby'] ?? '').split(' ')
    expect(labelId).toBe('importe-label')
    expect(out).toContain(`<span id="${currencyId}" hidden="">en pesos</span>`)
  })

  it('suelto con aria-label, en dólares y con submit en pesos', () => {
    const out = render(
      <MoneyField
        name="usd"
        aria-label="Pauta"
        currency="USD"
        submit="pesos"
        defaultCents={17526}
      />,
    )
    expect(attrsOf(out, /<input[^>]*type="text"[^>]*>/)['aria-label']).toBe('Pauta, en dólares')
    expect(out).toContain('>US$</span>')
    expect(hiddenInputs(out)[0]?.value).toBe('175.26')
  })

  it('sin dato: el hidden va vacío y no hay placeholder «0»', () => {
    const out = render(<MoneyField name="x" />)
    expect(hiddenInputs(out)[0]?.value).toBe('')
    expect(attrsOf(out, /<input[^>]*type="text"[^>]*>/).placeholder).toBeUndefined()
  })
})

describe('NumberField', () => {
  it('spinbutton con valor, bordes y texto («4 personas»); hidden con el entero', () => {
    const out = render(
      <NumberField
        name="guests"
        defaultValue={4}
        min={1}
        max={40}
        suffix="personas"
        {...tour('n')}
      />,
    )
    const input = attrsOf(out, /<input[^>]*role="spinbutton"[^>]*>/)
    expect(input['aria-valuenow']).toBe('4')
    expect(input['aria-valuemin']).toBe('1')
    expect(input['aria-valuemax']).toBe('40')
    expect(input['aria-valuetext']).toBe('4 personas')
    expect(input.inputmode).toBe('numeric')
    expect(input['data-tour']).toBe('n')
    expect(hiddenInputs(out)).toEqual([{ type: 'hidden', name: 'guests', value: '4' }])
  })

  it('los botones − y + están fuera del Tab, con nombre, y se apagan en el límite', () => {
    const out = render(<NumberField defaultValue={1} min={1} max={40} />)
    const minus = attrsOf(out, /<button[^>]*data-slot="number-field-decrement"[^>]*>/)
    const plus = attrsOf(out, /<button[^>]*data-slot="number-field-increment"[^>]*>/)
    expect(minus.tabindex).toBe('-1')
    expect(minus['aria-label']).toBe('Restar uno')
    expect('disabled' in minus).toBe(true)
    expect(plus['aria-label']).toBe('Sumar uno')
    expect('disabled' in plus).toBe(false)
  })

  it('con decimales: coma en el visible, punto en el hidden; sin botones si se piden', () => {
    const out = render(<NumberField name="rate" defaultValue={2.5} decimals={1} steppers={false} />)
    expect(attrsOf(out, /<input[^>]*role="spinbutton"[^>]*>/).value).toBe('2,5')
    expect(hiddenInputs(out)[0]?.value).toBe('2.5')
    expect(out).not.toContain('number-field-increment')
  })
})

describe('DatePicker', () => {
  it('dd/MM/yyyy en el visible y YYYY-MM-DD en el hidden (como <input type="date">)', () => {
    const out = render(
      <Field label="Fecha" name="date">
        <DatePicker defaultValue="2026-09-15" today="2026-10-06" {...tour('fecha')} />
      </Field>,
    )
    expect(hiddenInputs(out)).toEqual([{ type: 'hidden', name: 'date', value: '2026-09-15' }])
    const visible = attrsOf(out, /<input[^>]*type="text"[^>]*>/)
    expect(visible.value).toBe('15/09/2026')
    expect(visible.placeholder).toBe('dd/mm/aaaa')
    expect(visible.name).toBeUndefined()
    expect(visible['data-tour']).toBe('fecha')
  })

  it('el botón del calendario abre un diálogo y dice para qué es', () => {
    const out = render(<DatePicker />)
    const button = attrsOf(out, /<button[^>]*data-slot="date-picker-trigger"[^>]*>/)
    expect(button['aria-label']).toBe('Elegir fecha')
    expect(button['aria-haspopup']).toBe('dialog')
    expect(button['aria-expanded']).toBe('false')
  })

  it('sin calendario (para tipear al lado de uno que ya se ve), y una fecha inválida no se manda', () => {
    const out = render(<DatePicker name="d" calendar={false} defaultValue="2026-02-31" />)
    expect(out).not.toContain('date-picker-trigger')
    expect(hiddenInputs(out)[0]?.value).toBe('')
  })
})

describe('TimeField y DateTimeField', () => {
  it('24 h: la hora de Postgres (21:30:00) se ve como 21:30 y viaja como HH:mm', () => {
    const out = render(<TimeField name="t" defaultValue="21:30:00" {...tour('hora')} />)
    const visible = attrsOf(out, /<input[^>]*type="text"[^>]*>/)
    expect(visible.value).toBe('21:30')
    expect(visible.placeholder).toBe('hh:mm')
    expect(visible['data-tour']).toBe('hora')
    expect(visible.role).toBeUndefined()
    expect(hiddenInputs(out)).toEqual([{ type: 'hidden', name: 't', value: '21:30' }])
  })

  it('con sugerencias es un combobox (cerrado al cargar)', () => {
    const out = render(<TimeField suggestions min="20:00" max="23:00" step={30} />)
    const input = attrsOf(out, /<input[^>]*type="text"[^>]*>/)
    expect(input.role).toBe('combobox')
    expect(input['aria-expanded']).toBe('false')
    expect(input['aria-autocomplete']).toBe('none')
  })

  it('DateTimeField: un solo hidden como datetime-local, y los dos controles con su valor', () => {
    const out = render(
      <Field label="Envío" name="send_at">
        <DateTimeField defaultValue="2026-09-15T21:30" {...tour('envio')} />
      </Field>,
    )
    expect(hiddenInputs(out)).toEqual([
      { type: 'hidden', name: 'send_at', value: '2026-09-15T21:30' },
    ])
    const texts = allAttrs(out, /<input[^>]*type="text"[^>]*>/).map((a) => a.value)
    expect(texts).toEqual(['15/09/2026', '21:30'])
    expect(attrsOf(out, /<div[^>]*data-slot="date-time-field"[^>]*>/)['data-tour']).toBe('envio')
    // La hora tiene su propio id (el del Field es de la fecha) y se nombra con la etiqueta + «Hora».
    const time = allAttrs(out, /<input[^>]*type="text"[^>]*>/)[1] ?? {}
    expect(time.id).not.toBe(allAttrs(out, /<input[^>]*type="text"[^>]*>/)[0]?.id)
    expect(time['aria-labelledby']?.split(' ')[0]).toMatch(/-label$/)
  })
})

const SUPPLIERS: EntityOption[] = [
  { value: 'p1', label: 'Coca-Cola', description: 'CUIT 30-50000000-7' },
  { value: 'p2', label: 'Quilmes' },
  { value: 'p3', label: 'Fernet Branca' },
  { value: 'p4', label: 'Distribuidora Norte' },
]

describe('Combobox', () => {
  it('disparador combobox nombrado por la etiqueta del Field y el valor visible', () => {
    const out = render(
      <Field label="Proveedor" name="supplier_id" id="prov">
        <Combobox options={SUPPLIERS} defaultValue="p2" {...tour('proveedor')} />
      </Field>,
    )
    const trigger = attrsOf(out, /<button[^>]*role="combobox"[^>]*>/)
    expect(trigger['aria-haspopup']).toBe('listbox')
    expect(trigger['aria-expanded']).toBe('false')
    expect(trigger['aria-labelledby']).toBe('prov-label prov-value')
    expect(trigger['data-tour']).toBe('proveedor')
    expect(out).toContain('<span id="prov-value" class="truncate">Quilmes</span>')
    expect(hiddenInputs(out)).toEqual([{ type: 'hidden', name: 'supplier_id', value: 'p2' }])
  })

  it('sin valor: el placeholder no se lee como valor y el hidden va vacío', () => {
    const out = render(
      <Field label="Proveedor" name="supplier_id" id="prov">
        <Combobox options={SUPPLIERS} />
      </Field>,
    )
    expect(attrsOf(out, /<button[^>]*role="combobox"[^>]*>/)['aria-labelledby']).toBe('prov-label')
    expect(out).toContain('Elegí…')
    expect(hiddenInputs(out)[0]?.value).toBe('')
  })

  it('múltiple: dos chips y «+2», un hidden por valor', () => {
    const out = render(
      <Combobox
        aria-label="Etiquetas"
        name="tags"
        multiple
        options={SUPPLIERS}
        defaultValue={['p1', 'p2', 'p3', 'p4']}
      />,
    )
    expect(hiddenInputs(out).map((a) => a.value)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(out).toContain('+2')
    expect(out).toContain('Coca-Cola')
    expect(out).toContain('Quilmes')
    expect(out).not.toContain('>Fernet Branca<')
  })

  it('modo asíncrono: la etiqueta del valor sale de selectedOption', () => {
    const out = render(
      <Combobox
        name="supplier_id"
        aria-label="Proveedor"
        search={async () => []}
        defaultValue="p9"
        selectedOption={{ value: 'p9', label: 'Proveedor nuevo' }}
      />,
    )
    expect(out).toContain('Proveedor nuevo')
    expect(hiddenInputs(out)[0]?.value).toBe('p9')
  })

  it('obligatorio: un campo oculto frena el envío si no se eligió nada', () => {
    const out = render(<Combobox aria-label="Proveedor" options={SUPPLIERS} required />)
    const proxy = attrsOf(out, /<input[^>]*required[^>]*>/)
    expect(proxy.tabindex).toBe('-1')
    expect(proxy['aria-hidden']).toBe('true')
    expect(proxy.value).toBe('')
  })
})

describe('PeriodPicker', () => {
  it('disparador «Período: Septiembre 2026» con flechas que dicen a dónde van', () => {
    const out = render(
      <PeriodPicker
        value={{ kind: 'month', month: '2026-09' }}
        today="2026-10-06"
        name="periodo"
        {...tour('periodo')}
      />,
    )
    expect(out).toContain('<span class="sr-only">Período: </span>')
    expect(out).toContain('Septiembre 2026')
    const labels = allAttrs(out, /<button[^>]*aria-label="Período[^"]*"[^>]*>/).map(
      (a) => a['aria-label'],
    )
    expect(labels).toEqual(['Período anterior: agosto 2026', 'Período siguiente: octubre 2026'])
    expect(hiddenInputs(out)).toEqual([{ type: 'hidden', name: 'periodo', value: '2026-09' }])
    expect(attrsOf(out, /<div[^>]*data-slot="period-picker"[^>]*>/)['data-tour']).toBe('periodo')
  })

  it('las flechas se apagan en los bordes y un mes cerrado lleva candado', () => {
    const out = render(
      <PeriodPicker
        value={{ kind: 'month', month: '2026-09' }}
        today="2026-10-06"
        min="2026-09-01"
        max="2026-09-30"
        closedMonths={['2026-09']}
      />,
    )
    const steps = allAttrs(out, /<button[^>]*aria-label="Período[^"]*"[^>]*>/)
    expect(steps.every((a) => 'disabled' in a)).toBe(true)
    expect(out).toContain('<span class="sr-only">, cerrado</span>')
  })

  it('sin flechas si se piden; el ejercicio con su etiqueta', () => {
    const out = render(
      <PeriodPicker
        value={{ kind: 'fiscal-year', year: 2026 }}
        fiscalYearStartMonth={7}
        today="2026-10-06"
        stepper={false}
      />,
    )
    expect(out).toContain('Ejercicio 2026/27')
    expect(out).not.toContain('Período anterior')
  })
})

describe('Calendar', () => {
  const markup = render(
    <Calendar selected="2026-09-15" today="2026-09-10" min="2026-09-05" {...tour('cal')} />,
  )

  it('grilla con encabezados desde el lunes (nombre completo en abbr) y título del mes', () => {
    expect(attrsOf(markup, /<table[^>]*>/).role).toBe('grid')
    const headers = allAttrs(markup, /<th\s[^>]*>/)
    expect(headers.map((a) => a.abbr)).toEqual([
      'lunes',
      'martes',
      'miércoles',
      'jueves',
      'viernes',
      'sábado',
      'domingo',
    ])
    expect(markup).toContain('septiembre de 2026')
    expect(attrsOf(markup, /<div[^>]*data-slot="calendar"[^>]*>/)['data-tour']).toBe('cal')
  })

  it('una sola parada de Tab, en el día elegido; hoy con aria-current', () => {
    const days = allAttrs(markup, /<button[^>]*data-slot="calendar-day"[^>]*>/)
    expect(days).toHaveLength(42)
    const tabbable = days.filter((d) => d.tabindex === '0')
    expect(tabbable.map((d) => d['data-day'])).toEqual(['2026-09-15'])
    const today = days.find((d) => d['data-day'] === '2026-09-10')
    expect(today?.['aria-current']).toBe('date')
    expect(today?.['aria-label']).toBe('jueves 10 de septiembre de 2026')
  })

  it('lo de antes del mínimo queda aria-disabled y «Mes anterior» se apaga', () => {
    const days = allAttrs(markup, /<button[^>]*data-slot="calendar-day"[^>]*>/)
    expect(days.find((d) => d['data-day'] === '2026-09-04')?.['aria-disabled']).toBe('true')
    expect(days.find((d) => d['data-day'] === '2026-09-05')?.['aria-disabled']).toBeUndefined()
    expect('disabled' in attrsOf(markup, /<button[^>]*aria-label="Mes anterior"[^>]*>/)).toBe(true)
    expect('disabled' in attrsOf(markup, /<button[^>]*aria-label="Mes siguiente"[^>]*>/)).toBe(
      false,
    )
  })

  it('el elegido marca su celda con aria-selected', () => {
    expect(markup).toMatch(
      /<td role="gridcell" aria-selected="true"[^>]*><button[^>]*data-day="2026-09-15"/,
    )
  })

  it('rango: inicio y fin con aria-description, el medio marcado', () => {
    const out = render(
      <Calendar mode="range" range={{ from: '2026-09-03', to: '2026-09-10' }} today="2026-09-01" />,
    )
    const days = allAttrs(out, /<button[^>]*data-slot="calendar-day"[^>]*>/)
    const byDay = (iso: string) => days.find((d) => d['data-day'] === iso)
    expect(byDay('2026-09-03')?.['data-range']).toBe('start')
    expect(byDay('2026-09-03')?.['aria-description']).toBe('inicio del rango')
    expect(byDay('2026-09-10')?.['aria-description']).toBe('fin del rango')
    expect(byDay('2026-09-06')?.['data-range']).toBe('inside')
  })

  it('marcadores y mes y año en selects (cumpleaños)', () => {
    const out = render(
      <Calendar
        defaultMonth="1985-09"
        today="2026-10-06"
        captionLayout="dropdowns"
        markers={{ '1985-09-20': 'dot' }}
      />,
    )
    expect(out).toContain('data-slot="calendar-marker"')
    expect(attrsOf(out, /<select[^>]*aria-label="Mes"[^>]*>/)).toBeTruthy()
    expect(attrsOf(out, /<select[^>]*aria-label="Año"[^>]*>/)).toBeTruthy()
    expect(out).toMatch(/<option value="1985" selected="">1985<\/option>/)
  })

  it('modo link: los días que se pueden elegir son links', () => {
    const out = render(
      <Calendar today="2026-09-10" dayHref={(iso) => `/hub/libros?periodo=${iso}`} />,
    )
    expect(out).toContain('href="/hub/libros?periodo=2026-09-15"')
  })
})
