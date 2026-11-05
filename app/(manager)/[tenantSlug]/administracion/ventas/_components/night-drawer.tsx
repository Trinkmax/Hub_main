'use client'

import { useRouter } from 'next/navigation'
import { type ReactNode, useState, useTransition } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

/**
 * La hoja lateral de una noche: se abre al tocar «Ver cierre» (`?dia=` en la URL) y lo de adentro lo
 * dibuja el servidor (`NightSheet`). Al cerrarla se vuelve a la planilla sin saltar arriba y sin sumar
 * historial; primero se cierra, así se ve la animación, y la URL se pone al día después.
 */
export function NightDrawer({
  title,
  closeHref,
  children,
}: {
  /** «La noche del lunes 02/11». */
  title: string
  /** La planilla, sin `?dia=`. */
  closeHref: string
  children: ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(true)
  const [, startTransition] = useTransition()

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) startTransition(() => router.replace(closeHref, { scroll: false }))
      }}
    >
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-4 sm:max-w-md sm:p-5">
        <SheetHeader className="sr-only">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>Lo que se vendió esa noche y cómo te pagaron.</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  )
}
