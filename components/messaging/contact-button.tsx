'use client'

import type { VariantProps } from 'class-variance-authority'
import { MessageCircle } from 'lucide-react'
import { Button, type buttonVariants } from '@/components/ui/button'
import { tryNormalizePhone } from '@/lib/phone'
import { ContactCustomerSheet } from './contact-customer-sheet'

export interface ContactButtonProps extends VariantProps<typeof buttonVariants> {
  tenantSlug: string
  phone: string
  customerId?: string
  name?: string
}

/** Los tamaños de ícono del kit: el botón es un cuadrado y la etiqueta no entra. */
const ICON_SIZES = new Set(['icon', 'icon-sm', 'icon-lg'])

/**
 * Botón embebible "Contactar" que abre el ContactCustomerSheet.
 * Si `phone` está vacío o es inválido, no renderiza nada.
 *
 * Con un tamaño de ícono (`icon`, `icon-sm`, `icon-lg`) dibuja solo el ícono:
 * esos tamaños son un cuadrado fijo y la etiqueta desbordaba encima de lo que
 * tuviera al lado — en las listas de reservas se comía la cantidad de personas.
 * El nombre accesible queda en el `aria-label`.
 *
 * Kit HUB: `secondary` por defecto (antes `outline`) y las variantes y los
 * tamaños del kit.
 */
export function ContactButton({
  tenantSlug,
  phone,
  customerId,
  name,
  variant = 'secondary',
  size = 'sm',
}: ContactButtonProps) {
  // Validate phone: skip render entirely if it's unparseable
  const normalized = tryNormalizePhone(phone)
  if (!normalized) return null

  const iconOnly = size !== null && size !== undefined && ICON_SIZES.has(size)
  const label = name ? `Contactar a ${name}` : 'Contactar'

  return (
    <ContactCustomerSheet
      tenantSlug={tenantSlug}
      phone={normalized}
      customerId={customerId}
      name={name}
      trigger={
        <Button
          variant={variant}
          size={size}
          aria-label={iconOnly ? label : undefined}
          title={iconOnly ? label : undefined}
        >
          <MessageCircle aria-hidden />
          {iconOnly ? null : 'Contactar'}
        </Button>
      }
    />
  )
}
