'use client'

import { Loader2, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type MouseEvent, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  fetchDocumentAttachmentUrl,
  removeDocumentAttachment,
} from '@/lib/accounting/actions/attachments'
import {
  ATTACHMENT_MESSAGES,
  attachmentKindLabel,
  attachmentRoom,
  formatAttachmentSize,
  MAX_ATTACHMENTS_PER_DOCUMENT,
} from '@/lib/accounting/attachments'
import type { DocumentAttachment } from '@/lib/accounting/queries/attachments'
import { formatDateTime } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { AddAttachmentButton, AttachmentTile } from './attachment-bits'
import { uploadDocumentAttachments } from './upload'

const OFFLINE_REMOVE = 'Sin conexión: no se quitó. Probá de nuevo.'
const OPEN_FAILED = 'No pudimos abrir el archivo. Probá de nuevo.'

/** Un link al que le queda menos que esto se pide de nuevo antes de abrir. */
const URL_MARGIN_MS = 30_000

/**
 * «Comprobante adjunto»: la foto o el PDF de la factura, el tique o el remito,
 * en la pantalla del comprobante. Cada archivo se abre en una pestaña nueva.
 * Quien carga (`canEdit`) puede sumar («Agregar foto o PDF», hasta 5) y quitar,
 * con confirmación. La contadora solo los ve y los abre.
 *
 * La lista llega del servidor (`listDocumentAttachments`) con links de vida
 * corta; después de sumar o quitar se refresca la página y vienen links nuevos.
 */
export function DocumentAttachments({
  tenantSlug,
  documentId,
  attachments,
  canEdit,
  loadError = null,
  className,
}: {
  tenantSlug: string
  documentId: string
  attachments: readonly DocumentAttachment[]
  /** Dueño con acceso sobre un comprobante vigente. */
  canEdit: boolean
  /** Si la lista no se pudo leer, el texto para mostrar en su lugar. */
  loadError?: string | null
  className?: string
}) {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState<DocumentAttachment | null>(null)
  const [removePending, setRemovePending] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const full = attachments.length >= MAX_ATTACHMENTS_PER_DOCUMENT
  const canAdd = canEdit && loadError === null && !full

  async function add(files: File[]) {
    if (uploading || files.length === 0) return
    const { accept, overflow } = attachmentRoom(attachments.length, files.length)
    if (accept === 0) {
      toast.error(ATTACHMENT_MESSAGES.limit)
      return
    }
    setUploading(true)
    try {
      const result = await uploadDocumentAttachments(tenantSlug, documentId, files.slice(0, accept))
      for (const failure of result.failed) toast.error(`${failure.file.name}: ${failure.message}`)
      if (overflow > 0) {
        toast.warning(
          `${ATTACHMENT_MESSAGES.limit} ${overflow === 1 ? 'Quedó uno sin subir.' : `Quedaron ${overflow} sin subir.`}`,
        )
      }
      if (result.uploaded > 0) {
        toast.success(
          result.uploaded === 1 ? 'Archivo adjuntado.' : `${result.uploaded} archivos adjuntados.`,
        )
      }
      // También si falló: un corte al final puede haber dejado alguno adjunto.
      router.refresh()
    } finally {
      setUploading(false)
    }
  }

  /**
   * Con el link vigente, el `<a>` hace lo suyo. Si venció (la pantalla quedó
   * abierta), se abre la pestaña en el momento, que es cuando el navegador lo
   * permite, y se la lleva al link nuevo cuando llega.
   */
  function open(event: MouseEvent<HTMLAnchorElement>, attachment: DocumentAttachment) {
    if (attachment.url !== null && Date.now() < attachment.urlExpiresAt - URL_MARGIN_MS) return
    event.preventDefault()
    const tab = window.open('', '_blank')
    void fetchDocumentAttachmentUrl(tenantSlug, { attachmentId: attachment.id })
      .then((result) => {
        if (!result.ok) {
          tab?.close()
          toast.error(result.message)
          return
        }
        if (tab) {
          tab.opener = null
          tab.location.replace(result.data.url)
        } else {
          window.location.assign(result.data.url)
        }
      })
      .catch(() => {
        tab?.close()
        toast.error(OPEN_FAILED)
      })
  }

  async function remove() {
    const target = removing
    if (!target || removePending) return
    setRemoveError(null)
    setRemovePending(true)
    try {
      const result = await removeDocumentAttachment(tenantSlug, { attachmentId: target.id })
      if (!result.ok) {
        setRemoveError(result.message)
        return
      }
      setRemoving(null)
      toast.success(result.message)
      router.refresh()
    } catch {
      setRemoveError(OFFLINE_REMOVE)
    } finally {
      setRemovePending(false)
    }
  }

  return (
    <section className={cn('card-hairline rounded-xl border bg-card', className)}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="space-y-0.5">
          <h2 className="font-serif text-lg font-semibold tracking-tight">Comprobante adjunto</h2>
          <p className="text-xs text-muted-foreground">
            La foto o el PDF de la factura, el tique o el remito.
          </p>
        </div>
        {canAdd ? (
          <AddAttachmentButton onFiles={(files) => void add(files)} busy={uploading} />
        ) : null}
      </header>

      {loadError !== null ? (
        <p role="alert" className="px-5 py-6 text-sm text-muted-foreground text-pretty">
          {loadError}
        </p>
      ) : attachments.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground text-pretty">
          {canEdit
            ? 'Todavía no tiene ningún archivo. Sacale una foto a la factura o subí el PDF.'
            : 'No tiene ningún archivo adjunto.'}
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex items-center gap-3 px-5 py-3">
              <a
                href={attachment.url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => open(event, attachment)}
                className="group flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <AttachmentTile
                  key={attachment.url ?? attachment.id}
                  kind={attachment.kind}
                  src={attachment.url}
                />
                <span className="min-w-0 space-y-0.5">
                  <span className="block truncate text-sm font-medium underline-offset-4 group-hover:text-primary group-hover:underline">
                    {attachment.fileName}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {attachmentKindLabel(attachment.kind)} ·{' '}
                    {formatAttachmentSize(attachment.sizeBytes)} · Subido el{' '}
                    {formatDateTime(attachment.createdAt)}
                  </span>
                  <span className="sr-only">Se abre en una pestaña nueva.</span>
                </span>
              </a>
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 text-muted-foreground hover:text-destructive md:size-9"
                  aria-label={`Quitar ${attachment.fileName}`}
                  disabled={uploading}
                  onClick={() => {
                    setRemoveError(null)
                    setRemoving(attachment)
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit && loadError === null && full ? (
        <p className="border-t border-border/60 px-5 py-3 text-xs text-muted-foreground">
          {ATTACHMENT_MESSAGES.limit} Para sumar otro, quitá uno.
        </p>
      ) : null}

      <AlertDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (removePending) return
          if (!next) {
            setRemoving(null)
            setRemoveError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitás este archivo?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {removing ? (
                  <p className="break-words font-medium text-foreground">{removing.fileName}</p>
                ) : null}
                <p className="text-pretty">
                  Se borra del comprobante y no se puede recuperar. El comprobante y su asiento no
                  cambian.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError ? (
            <p role="alert" className="text-sm text-destructive text-pretty">
              {removeError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removePending}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              disabled={removePending}
              onClick={() => void remove()}
              className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removePending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {removePending ? 'Quitando…' : 'Quitar'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
