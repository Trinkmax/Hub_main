'use client'

import PhoneInput, { type Value } from 'react-phone-number-input'
import es from 'react-phone-number-input/locale/es'
import 'react-phone-number-input/style.css'
import { useFieldControl } from '@/components/ui/field'
import { cn } from '@/lib/utils'

/**
 * El WhatsApp del cliente con selector de país, con el aspecto de los campos
 * del kit (alto, borde, cartulina y foco «sobre el borde»). El kit no trae un
 * campo de teléfono: este compone `react-phone-number-input` y vive en la
 * carpeta de clientes hasta que el kit lo sume.
 *
 * Adentro de un `Field` toma de ahí id, ayuda, error y `required`. El valor
 * que viaja en el formulario (`name`) es el mismo de siempre: el del input del
 * número, que la acción normaliza a E.164.
 */
export function PhoneField({
  name,
  value,
  onChange,
  placeholder,
}: {
  name: string
  value: Value | undefined
  onChange: (value: Value | undefined) => void
  placeholder?: string
}) {
  const control = useFieldControl({})
  const invalid = control['aria-invalid'] === true

  return (
    <PhoneInput
      international
      defaultCountry="AR"
      countryCallingCodeEditable={false}
      labels={es}
      name={name}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      id={control.id}
      aria-describedby={control['aria-describedby']}
      aria-invalid={invalid || undefined}
      // Sin `required` nativo: el número arranca con «+54» y el navegador lo
      // daría por cargado; lo valida la acción («Ingresá un teléfono»).
      aria-required={control.required || undefined}
      disabled={control.disabled}
      readOnly={control.readOnly}
      // Es el teléfono de otra persona: que el navegador no ofrezca el del que carga.
      autoComplete="off"
      className={cn(
        'flex h-(--control-md) w-full min-w-0 items-center gap-2 rounded-md border border-input bg-card px-3 text-foreground',
        'text-(length:--control-font)',
        // Foco «sobre el borde», también cuando lo tiene el selector de país.
        'outline-(--ring) -outline-offset-1 has-[:focus-visible]:outline-2',
        invalid && 'border-destructive outline-(--destructive)',
        // La flecha del selector de país, en el color del texto de apoyo.
        '[&_.PhoneInputCountrySelectArrow]:text-subtle-foreground',
      )}
      countrySelectProps={{ 'aria-label': 'País del teléfono' }}
      numberInputProps={{
        className:
          'h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-foreground outline-none placeholder:text-subtle-foreground',
      }}
    />
  )
}
