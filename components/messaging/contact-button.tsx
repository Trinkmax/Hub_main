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

/**
 * Botón embebible "Contactar" que abre el ContactCustomerSheet.
 * Si `phone` está vacío o es inválido, no renderiza nada.
 *
 * `size="icon"` renderiza solo el ícono: esa variante es un cuadrado fijo
 * (`size-9`) y el label desbordaba encima de lo que tuviera al lado — en las
 * listas de reservas se comía la cantidad de personas. El nombre accesible
 * queda en el `aria-label`.
 */
export function ContactButton({
  tenantSlug,
  phone,
  customerId,
  name,
  variant = 'outline',
  size = 'sm',
}: ContactButtonProps) {
  // Validate phone: skip render entirely if it's unparseable
  const normalized = tryNormalizePhone(phone)
  if (!normalized) return null

  const iconOnly = size === 'icon'

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
          aria-label={iconOnly ? 'Contactar' : undefined}
          title={iconOnly ? 'Contactar' : undefined}
        >
          <MessageCircle className="size-4" aria-hidden />
          {iconOnly ? null : 'Contactar'}
        </Button>
      }
    />
  )
}
