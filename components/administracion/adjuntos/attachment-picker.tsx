'use client'

import { X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  ATTACHMENT_MESSAGES,
  attachmentRoom,
  checkAttachmentCandidate,
  formatAttachmentSize,
  MAX_ATTACHMENTS_PER_DOCUMENT,
} from '@/lib/accounting/attachments'
import { cn } from '@/lib/utils'
import { AddAttachmentButton, AttachmentTile } from './attachment-bits'

function sameFile(a: File, b: File): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}

/**
 * El selector de fotos o PDF para un formulario donde el comprobante TODAVÍA
 * no existe (una compra, un gasto, un pago que se está cargando).
 *
 * Es controlado y no sube nada: guarda los `File` elegidos (`value`) y avisa
 * cada cambio (`onChange`). Cuando el formulario guarda y ya tiene el id del
 * comprobante, llama a `uploadPendingAttachments(tenantSlug, documentId, value)`
 * (`./upload`). Rechaza en el momento lo que no es foto ni PDF, lo que pesa de
 * más y lo que pasa de `max`.
 */
export function AttachmentPicker({
  value,
  onChange,
  disabled = false,
  max = MAX_ATTACHMENTS_PER_DOCUMENT,
  label = 'Foto del comprobante',
  optional = true,
  hint,
  className,
}: {
  value: readonly File[]
  onChange: (files: File[]) => void
  /** Mientras el formulario guarda. */
  disabled?: boolean
  /** Cuántos archivos como mucho (hasta 5, que es el tope del comprobante). */
  max?: number
  label?: ReactNode
  /** Muestra «(opcional)» al lado de la etiqueta. */
  optional?: boolean
  /** Reemplaza la ayuda de abajo. */
  hint?: ReactNode
  className?: string
}) {
  const uid = useId()
  const labelId = `${uid}-label`
  const hintId = `${uid}-hint`
  const [errors, setErrors] = useState<string[]>([])
  const limit = Math.min(Math.max(1, Math.trunc(max)), MAX_ATTACHMENTS_PER_DOCUMENT)

  // El formulario se vació (guardó y sigue con otro): los avisos de la carga anterior no quedan.
  const count = value.length
  useEffect(() => {
    if (count === 0) setErrors([])
  }, [count])

  function add(picked: File[]) {
    const problems: string[] = []
    const fresh: File[] = []
    for (const file of picked) {
      if ([...value, ...fresh].some((other) => sameFile(other, file))) continue
      const check = checkAttachmentCandidate(file)
      if (check.ok) fresh.push(file)
      else problems.push(`${file.name}: ${check.message}`)
    }
    const { accept, overflow } = attachmentRoom(value.length, fresh.length, limit)
    if (overflow > 0) {
      problems.push(
        limit === MAX_ATTACHMENTS_PER_DOCUMENT
          ? ATTACHMENT_MESSAGES.limit
          : `Acá van hasta ${limit} ${limit === 1 ? 'archivo' : 'archivos'}.`,
      )
    }
    setErrors(problems)
    if (accept > 0) onChange([...value, ...fresh.slice(0, accept)])
  }

  function removeAt(index: number) {
    setErrors([])
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: un grupo con etiqueta, no un fieldset (el formulario ya arma los suyos)
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn('grid content-start gap-1.5', className)}
    >
      <span id={labelId} className="text-sm font-medium leading-none">
        {label}
        {optional ? (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">(opcional)</span>
        ) : null}
      </span>

      {value.length > 0 ? (
        <ul className="divide-y divide-border/60 rounded-md border border-border/60">
          {value.map((file, index) => (
            <PickedFile
              key={`${file.name}:${file.size}:${file.lastModified}`}
              file={file}
              disabled={disabled}
              onRemove={() => removeAt(index)}
            />
          ))}
        </ul>
      ) : null}

      {value.length < limit ? (
        <AddAttachmentButton
          onFiles={add}
          disabled={disabled}
          multiple={limit > 1}
          describedBy={hintId}
          label={value.length === 0 ? 'Agregar foto o PDF' : 'Agregar otro'}
          className="justify-self-start"
        />
      ) : null}

      <p id={hintId} className="text-xs text-muted-foreground text-pretty">
        {hint ??
          `La factura, el tique o el remito: ${limit === 1 ? 'una foto o un PDF' : `hasta ${limit} fotos o PDF`}. Se ${limit === 1 ? 'sube' : 'suben'} al guardar.`}
      </p>
      {errors.length > 0 ? (
        <div role="alert" className="space-y-0.5 text-xs text-destructive">
          {errors.map((message) => (
            <p key={message} className="text-pretty">
              {message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PickedFile({
  file,
  disabled,
  onRemove,
}: {
  file: File
  disabled: boolean
  onRemove: () => void
}) {
  const check = checkAttachmentCandidate(file)
  const isImage = check.ok && check.kind === 'image'
  const [src, setSrc] = useState<string | null>(null)

  // La vista previa es un `blob:` local: se libera al quitar el archivo o al desmontar.
  useEffect(() => {
    if (!isImage) return
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file, isImage])

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <AttachmentTile
        key={src ?? 'sin-vista'}
        kind={isImage ? 'image' : 'pdf'}
        src={src}
        className="size-11"
      />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block truncate text-sm font-medium">{file.name}</span>
        <span className="block text-xs text-muted-foreground">
          {isImage ? 'Foto' : 'PDF'} · {formatAttachmentSize(file.size)}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 text-muted-foreground hover:text-destructive md:size-9"
        aria-label={`Quitar ${file.name}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <X className="size-4" aria-hidden />
      </Button>
    </li>
  )
}
