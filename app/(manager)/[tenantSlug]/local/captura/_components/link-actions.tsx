'use client'

import { Download, Pause, Play, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { deleteCaptureLink, toggleCaptureLink } from '@/lib/capture/actions'

type Link = { id: string; slug: string; label: string; active: boolean }

export function LinkActions({
  tenantSlug,
  link,
  pngDataUrl,
}: {
  tenantSlug: string
  link: Link
  pngDataUrl: string
}) {
  const [pending, start] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const onToggle = () => {
    start(async () => {
      const result = await toggleCaptureLink(tenantSlug, link.id, !link.active)
      if (!result.ok) toast.error(result.message)
      else toast.success(link.active ? 'Link pausado.' : 'Link activado.')
    })
  }

  const onDelete = () => {
    start(async () => {
      const result = await deleteCaptureLink(tenantSlug, link.id)
      if (!result.ok) toast.error(result.message)
      else toast.success('Link eliminado.')
      setConfirmOpen(false)
    })
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm" className="gap-1.5">
        <a href={pngDataUrl} download={`qr-${link.slug}.png`}>
          <Download className="size-3.5" />
          PNG
        </a>
      </Button>
      <Button variant="outline" size="sm" disabled={pending} onClick={onToggle} className="gap-1.5">
        {link.active ? (
          <>
            <Pause className="size-3.5" />
            Pausar
          </>
        ) : (
          <>
            <Play className="size-3.5" />
            Activar
          </>
        )}
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
            Borrar
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar link?</AlertDialogTitle>
            <AlertDialogDescription>
              Cualquier QR ya impreso dejará de funcionar. Los clientes capturados con este link
              siguen en tu base.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {pending ? 'Borrando…' : 'Borrar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
