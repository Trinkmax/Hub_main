import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'
import { BrandWordmarkLarge } from '@/components/shell/brand-mark'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/*
 * El marco de las pantallas sueltas (sin el shell del panel): ingresar,
 * recuperar y cambiar la contraseña, aceptar una invitación y crear el bar.
 * Kit §7.c paso 0.8: papel plano (sin el degradé ni el brillo verde del shell
 * viejo), una tarjeta quieta (sin sombra, sin vidrio) y sin animación de
 * entrada (lo que siempre está visible al montar no se anima).
 */

/** La página: centrada en el papel. Es el `<main>` de estas pantallas (no tienen shell). */
export function AuthFrame({
  children,
  width = 'sm',
}: {
  children: React.ReactNode
  /** `sm` 384 px (formularios cortos) · `md` 448 px (invitación, crear el bar). */
  width?: 'sm' | 'md'
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className={cn('w-full', width === 'md' ? 'max-w-md' : 'max-w-sm')}>{children}</div>
    </main>
  )
}

/** La marca arriba y una tarjeta con el título (`h1`) de la pantalla. */
export function AuthCard({
  title,
  description,
  icon: Icon,
  tone = 'brand',
  children,
  footer,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  /** Disco de 40 px arriba del título (estados: invitación, mail enviado, listo). */
  icon?: LucideIcon
  tone?: 'brand' | 'success'
  children?: React.ReactNode
  /** Abajo de la tarjeta, afuera de ella (un «Volver»). */
  footer?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex justify-center">
        <BrandWordmarkLarge />
      </div>
      <Card padding="lg" className="gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          {Icon ? (
            <span
              aria-hidden="true"
              className={cn(
                'mb-2 grid size-10 place-items-center rounded-full',
                tone === 'success'
                  ? 'bg-success-soft text-success-text'
                  : 'bg-secondary text-primary',
              )}
            >
              <Icon className="size-5" strokeWidth={1.75} />
            </span>
          ) : null}
          <h1 className="type-title">{title}</h1>
          {description ? (
            // div y no p: la descripción acepta cualquier nodo (una etiqueta, dos líneas).
            <div className="type-body text-pretty text-muted-foreground">{description}</div>
          ) : null}
        </div>
        {children}
      </Card>
      {footer ? <div className="flex justify-center">{footer}</div> : null}
    </div>
  )
}
