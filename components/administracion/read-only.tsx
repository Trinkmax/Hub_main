'use client'

import { Eye, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { DoorSign } from '@/components/administracion/puerta/door-sign'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAccountingOptional } from './accounting-provider'

const BANNER_KEY = 'hub_acc_readonly_banner_hidden'

/**
 * La franja de la contadora arriba de Administración (H.19): «Estás en modo
 * lectura…». Una línea baja, con el ojo: está siempre a la vista pero no
 * empuja la pantalla. Se puede ocultar por sesión (sessionStorage; si no hay,
 * vuelve a aparecer, que no es grave).
 */
export function ReadOnlyBanner({ className }: { className?: string }) {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(BANNER_KEY) === '1') setHidden(true)
    } catch {
      // sessionStorage puede no existir (modo privado, iframe): se muestra.
    }
  }, [])

  if (hidden) return null

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-xl border border-info/30 bg-info/10 py-1 pr-1 pl-3.5 text-sm sm:rounded-full',
        className,
      )}
    >
      <Eye aria-hidden="true" className="size-4 shrink-0 text-info" />
      <p className="min-w-0 flex-1 py-1 leading-snug text-pretty">
        Estás en modo lectura <span className="text-muted-foreground">(Contabilidad)</span>: podés
        ver y exportar todo.
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 rounded-full text-muted-foreground md:size-8"
        aria-label="Ocultar este aviso"
        onClick={() => {
          setHidden(true)
          try {
            window.sessionStorage.setItem(BANNER_KEY, '1')
          } catch {
            // sin sessionStorage: se oculta hasta recargar.
          }
        }}
      >
        <X className="size-4" />
      </Button>
    </div>
  )
}

/**
 * La etiqueta «Solo lectura» del título (H.2): una píldora gris con el ojo. Va
 * en la prop `badge` de `AdmHeader` (`badge={<ReadOnlyBadge />}`) y no trae
 * margen propio. Sin `show`, la decide el contexto de Administración
 * (contadora o dueño sin escritura).
 */
export function ReadOnlyBadge({ show, className }: { show?: boolean; className?: string }) {
  const ctx = useAccountingOptional()
  const visible = show ?? ctx?.readOnly ?? false
  if (!visible) return null
  return (
    <StatusPill tone="muted" icon={Eye} className={className}>
      Solo lectura
    </StatusPill>
  )
}

/**
 * Lo que ve la contadora si entra a una pantalla de carga (H.19): el cartel
 * «SOLO LECTURA», qué es esa pantalla y a dónde ir a verlo. «Esta pantalla es
 * para cargar comprobantes. Con Contabilidad podés verlos en Compras ›
 * Comprobantes.» [Ir a Comprobantes].
 */
export function ReadOnlyNotice({
  title = 'Esta pantalla es para cargar',
  description,
  href,
  linkLabel,
  className,
}: {
  title?: string
  description: string
  href: string
  linkLabel: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card/50 px-6 pt-8 pb-10 text-center',
        className,
      )}
    >
      <DoorSign word="Solo lectura" className="mb-6" />
      <p className="font-serif text-xl font-semibold tracking-tight text-balance text-foreground">
        {title}
      </p>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground text-pretty">{description}</p>
      <Button asChild className="mt-6 h-11 px-5">
        <Link href={href}>{linkLabel}</Link>
      </Button>
    </div>
  )
}
