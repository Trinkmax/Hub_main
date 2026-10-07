'use client'

import * as React from 'react'
import { CodeField } from '@/components/ui/code-field'
import { Field, FieldRow } from '@/components/ui/field'
import { padDocNumber, padPv, parseVoucherNumber } from '@/lib/fiscal'

export type VoucherNumberValue = { pointOfSale: string; number: string }

export type VoucherNumberFieldsProps = Omit<
  React.ComponentProps<'div'>,
  'children' | 'onChange'
> & {
  /** Default `point_of_sale`: hidden con los dígitos («00003»). */
  pointOfSaleName?: string
  /** Default `number`: hidden con los dígitos («00001290»). */
  numberName?: string
  defaultPointOfSale?: number | string | null
  defaultNumber?: number | string | null
  /** Errores del server (`fieldErrors` de zod tal cual). */
  pointOfSaleError?: string | readonly string[] | null
  numberError?: string | readonly string[] | null
  /** Default «Punto de venta» y «Número». */
  pointOfSaleLabel?: string
  numberLabel?: string
  /** Ayuda del punto de venta (p. ej. el habitual del proveedor). */
  pointOfSaleHint?: React.ReactNode
  required?: boolean
  readOnly?: boolean
  disabled?: boolean
  /** Con los dígitos de los dos cada vez que cambian. */
  onValueChange?: (value: VoucherNumberValue) => void
}

function digitsOf(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\D/g, '')
}

/**
 * Punto de venta y número de un comprobante (kit §3.2 CodeField, en el
 * formulario de compra de §5.4): dos `CodeField` en un `FieldRow` de 2 que se
 * leen «00003-00001290».
 *
 * - Cada uno se completa con ceros al salir (`3` → `00003`, `1290` → `00001290`)
 *   y viaja en su `hidden` con solo dígitos.
 * - **Pegar el número entero** («0003-00001290», «Factura A 0003-00001290» o
 *   los 12 dígitos juntos) en cualquiera de los dos lo separa en los dos campos.
 *
 * Otros usos de `CodeField` en Administración:
 *
 * ```tsx
 * // CUIT con dígito verificador: se tipea con o sin guiones y se ve 20-12345678-6.
 * <Field label="CUIT" name="tax_id" hint="Con o sin guiones" error={state?.fieldErrors?.tax_id}>
 *   <CodeField kind="cuit" defaultValue={party?.taxId ?? ''} />
 * </Field>
 * // Un punto de venta suelto (Ajustes › Puntos de venta).
 * <Field label="Número" name="number"><CodeField kind="pv" pad={5} /></Field>
 * ```
 */
function VoucherNumberFields({
  pointOfSaleName = 'point_of_sale',
  numberName = 'number',
  defaultPointOfSale,
  defaultNumber,
  pointOfSaleError,
  numberError,
  pointOfSaleLabel = 'Punto de venta',
  numberLabel = 'Número',
  pointOfSaleHint,
  required,
  readOnly,
  disabled,
  onValueChange,
  ...props
}: VoucherNumberFieldsProps) {
  const [value, setValue] = React.useState<VoucherNumberValue>(() => ({
    pointOfSale: digitsOf(defaultPointOfSale),
    number: digitsOf(defaultNumber),
  }))

  function change(next: VoucherNumberValue) {
    setValue(next)
    onValueChange?.(next)
  }

  // Pegar «0003-00001290» en cualquiera de los dos: se reparte en los dos campos.
  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const parsed = parseVoucherNumber(event.clipboardData.getData('text'))
    if (!parsed) return
    event.preventDefault()
    change({ pointOfSale: padPv(parsed.pointOfSale), number: padDocNumber(parsed.number) })
  }

  return (
    <FieldRow columns={2} data-slot="voucher-number-fields" {...props}>
      <Field
        label={pointOfSaleLabel}
        name={pointOfSaleName}
        hint={pointOfSaleHint}
        error={pointOfSaleError}
        required={required}
        readOnly={readOnly}
        disabled={disabled}
      >
        <CodeField
          kind="pv"
          value={value.pointOfSale}
          onValueChange={(digits) => change({ ...value, pointOfSale: digits })}
          onPaste={handlePaste}
        />
      </Field>
      <Field
        label={numberLabel}
        name={numberName}
        error={numberError}
        required={required}
        readOnly={readOnly}
        disabled={disabled}
      >
        <CodeField
          kind="doc-number"
          value={value.number}
          onValueChange={(digits) => change({ ...value, number: digits })}
          onPaste={handlePaste}
        />
      </Field>
    </FieldRow>
  )
}

export { VoucherNumberFields }
