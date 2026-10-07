import type * as React from 'react'
import { cn } from '@/lib/utils'

export type AmountStackProps = React.ComponentProps<'div'> & {
  /** El nombre del grupo para el lector: «Importes del comprobante». */
  'aria-label'?: string
}

/**
 * La columna de plata de un formulario o de una cuenta (kit §3.8): los
 * importes del comprobante de compra (netos por alícuota, IVA calculado,
 * percepciones, total), el cierre de ventas del día, la posición de IVA del mes
 * (débito − crédito − percepciones = a pagar) y los medios de una orden de
 * pago. Server-safe: los campos de adentro son cliente.
 *
 * - **Grilla:** desde `md`, `[etiqueta] [campo o valor] [etiqueta del costado]
 *   [valor del costado]` (y una columna angosta de signo adelante si alguna
 *   fila lo lleva), con las filas en `subgrid`: todas las cifras terminan en el
 *   mismo borde derecho (`MoneyField align="end"`, `Amount` en `type-amount`).
 *   En el celular cada fila se apila: etiqueta, campo a ancho completo y el
 *   costado debajo en chico («IVA 21 %: $ 149.256,20»).
 * - **Total:** la raya simple de la regla contable arriba y semibold. La raya
 *   doble queda para el total final de un libro: un formulario cierra con raya
 *   simple.
 * - **Calculados** en `<output aria-live="off">`: `<output>` tiene rol de
 *   estado y hablaría en cada tecla; el resumen audible lo da `EntryPreview`
 *   cuando cambia de «cuadra» a «no cuadra».
 * - **Faltante no es cero:** un calculado sin datos va `<Amount cents={null} />`
 *   («—»), nunca `$ 0,00`.
 *
 * ```tsx
 * <AmountStack aria-label="Importes del comprobante">
 *   <AmountStackRow label="Neto 21 %" fieldId="net21" valueFor="net21"
 *     field={<MoneyField id="net21" name="net_21_cents" />}
 *     side={{ label: 'IVA 21 %', value: <Amount cents={vat21} /> }} />
 *   <AmountStackRow label="Total" emphasis="total" valueFor="net21 perc"
 *     value={<Amount cents={total} />} />
 * </AmountStack>
 * ```
 */
function AmountStack({ className, ...props }: AmountStackProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: un <fieldset> trae borde, relleno y `min-inline-size: min-content`, que rompen la grilla; el grupo es solo para nombrar la pila
    <div
      role="group"
      data-slot="amount-stack"
      className={cn(
        'group/amount-stack grid gap-y-3 md:gap-x-4',
        // Las columnas que hacen falta, según lo que traigan las filas: con alguna
        // fila con signo (posición de IVA), una angosta adelante; con alguna con
        // costado (el IVA al lado del neto), dos al final. Sin eso no quedan
        // columnas vacías con su separación: las cifras llegan al borde.
        'md:grid-cols-[minmax(0,1fr)_minmax(9rem,15rem)]',
        'md:has-[[data-stack-side]]:grid-cols-[minmax(0,1fr)_minmax(9rem,15rem)_auto_auto]',
        'md:has-[[data-stack-sign]]:grid-cols-[1rem_minmax(0,1fr)_minmax(9rem,15rem)]',
        'md:has-[[data-stack-sign]]:has-[[data-stack-side]]:grid-cols-[1rem_minmax(0,1fr)_minmax(9rem,15rem)_auto_auto]',
        className,
      )}
      {...props}
    />
  )
}

export type AmountStackSign = '+' | '−' | '='

const SIGN_WORD: Readonly<Record<AmountStackSign, string>> = {
  '+': 'más',
  '−': 'menos',
  '=': 'igual a',
}

export type AmountStackRowProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  /** «Neto 21 %». */
  label: React.ReactNode
  /** `<MoneyField …/>`, o nada si la fila es solo un resultado. */
  field?: React.ReactNode
  /** `<Amount cents={…} />`: un resultado calculado, alineado con los campos. */
  value?: React.ReactNode
  /** Al costado: «IVA 21 %  $ 149.256,20». */
  side?: { label: React.ReactNode; value: React.ReactNode }
  /** Para las cuentas (posición de IVA): `+`, `−` o `=` en una columna angosta a la izquierda. */
  sign?: AmountStackSign
  hint?: React.ReactNode
  /** `subtotal`: pelo arriba · `total`: la raya de la regla contable arriba y semibold. */
  emphasis?: 'subtotal' | 'total'
  /** El id del campo: la etiqueta pasa a ser su `<label for>`. */
  fieldId?: string
  /** Los ids (separados por espacio) de los campos de los que sale el calculado: `<output for>`. */
  valueFor?: string
}

/** Una fila de la pila. */
function AmountStackRow({
  label,
  field,
  value,
  side,
  sign,
  hint,
  emphasis,
  fieldId,
  valueFor,
  className,
  ...props
}: AmountStackRowProps) {
  const labelClass = cn('type-body text-foreground', emphasis === 'total' && 'font-semibold')
  const labelContent = (
    <>
      {sign ? (
        // En el celular el signo va pegado a la etiqueta: ahí no hay columna para él.
        <span aria-hidden="true" className="me-1 type-amount text-muted-foreground md:hidden">
          {sign}
        </span>
      ) : null}
      {label}
    </>
  )

  return (
    <div
      data-slot="amount-stack-row"
      data-emphasis={emphasis}
      className={cn(
        'flex flex-col gap-1.5',
        'md:col-span-full md:grid md:grid-cols-subgrid md:items-center md:gap-y-1',
        emphasis === 'subtotal' && 'border-t border-border pt-3',
        emphasis === 'total' && 'border-t border-rule pt-3 font-semibold',
        className,
      )}
      {...props}
    >
      <span
        data-slot="amount-stack-sign"
        data-stack-sign={sign}
        className="hidden text-center type-amount text-muted-foreground md:group-has-[[data-stack-sign]]/amount-stack:block"
      >
        {sign ? (
          <>
            <span aria-hidden="true">{sign}</span>
            <span className="sr-only">{SIGN_WORD[sign]}</span>
          </>
        ) : null}
      </span>
      <span className="grid min-w-0 gap-0.5">
        {fieldId ? (
          <label data-slot="amount-stack-label" htmlFor={fieldId} className={labelClass}>
            {labelContent}
          </label>
        ) : (
          <span data-slot="amount-stack-label" className={labelClass}>
            {labelContent}
          </span>
        )}
        {hint ? (
          <span
            data-slot="amount-stack-hint"
            className="type-caption text-pretty text-subtle-foreground"
          >
            {hint}
          </span>
        ) : null}
      </span>
      <span
        data-slot="amount-stack-value"
        className="flex min-w-0 justify-end text-end type-amount"
      >
        {field ?? null}
        {value !== undefined ? (
          <output aria-live="off" htmlFor={valueFor} className="block w-full text-end">
            {value}
          </output>
        ) : null}
      </span>
      {side ? (
        <span
          data-slot="amount-stack-side"
          data-stack-side=""
          className="flex items-baseline justify-between gap-1 type-small text-muted-foreground md:contents"
        >
          <span>
            {side.label}
            <span className="md:hidden">:</span>
          </span>
          <output
            aria-live="off"
            htmlFor={valueFor}
            className="text-end type-amount text-foreground"
          >
            {side.value}
          </output>
        </span>
      ) : (
        // Sin costado, el lugar vacío solo si otra fila de la pila tiene costado.
        <span
          aria-hidden="true"
          className="hidden md:col-span-2 md:group-has-[[data-stack-side]]/amount-stack:block"
        />
      )}
    </div>
  )
}

export { AmountStack, AmountStackRow }
