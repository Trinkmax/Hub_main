'use client'

import { Eye, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAccountingOptional } from './accounting-provider'

const BANNER_KEY = 'hub_acc_readonly_banner_hidden'

/**
 * La franja de la contadora arriba de Administración (H.19): «Estás en modo
 * lectura…». Se puede ocultar por sesión (sessionStorage; si no hay, vuelve a
 * aparecer, que no es grave).
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
        'flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-3 text-sm sm:items-center',
        className,
      )}
    >
      <Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info sm:mt-0" />
      <p className="flex-1 text-pretty">
        Estás en modo lectura <span className="text-muted-foreground">(Contabilidad)</span>: podés
        ver y exportar todo.
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="-my-1 size-9 shrink-0 text-muted-foreground"
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
 * La etiqueta «Solo lectura» al lado del título (H.2). Sin `show`, la decide
 * el contexto de Administración (contadora o dueño sin escritura).
 */
export function ReadOnlyBadge({ show, className }: { show?: boolean; className?: string }) {
  const ctx = useAccountingOptional()
  const visible = show ?? ctx?.readOnly ?? false
  if (!visible) return null
  return (
    <Badge
      variant="muted"
      className={cn('ml-2 align-middle font-sans text-xs tracking-normal', className)}
    >
      Solo lectura
    </Badge>
  )
}

/**
 * Lo que ve la contadora si entra a una pantalla de carga (H.19): qué es y a
 * dónde ir a verlo. «Esta pantalla es para cargar comprobantes. Con
 * Contabilidad podés verlos en Compras › Comprobantes.» [Ir a Comprobantes].
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
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card/50 px-6 py-14 text-center',
        className,
      )}
    >
      <div className="mb-5 flex size-14 items-center justify-center rounded-full border border-primary/20 bg-cream-tint text-primary shadow-2xs">
        <Eye className="size-6" aria-hidden />
      </div>
      <p className="font-serif text-lg font-semibold tracking-tight text-foreground">{title}</p>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground text-pretty">{description}</p>
      <Button asChild className="mt-6 h-11 md:h-9">
        <Link href={href}>{linkLabel}</Link>
      </Button>
    </div>
  )
}
