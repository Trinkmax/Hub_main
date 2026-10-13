'use client'

import { FileImage, FileText, Loader2, Paperclip } from 'lucide-react'
import { useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { ATTACHMENT_ACCEPT, type AttachmentKind } from '@/lib/accounting/attachments'
import { cn } from '@/lib/utils'

/**
 * El cuadrado de adelante de cada archivo: la miniatura si es una foto que el
 * navegador sabe dibujar, o un ícono (PDF, HEIC, o una foto que no cargó).
 * Es decorativo: el nombre y el tipo van escritos al lado.
 */
export function AttachmentTile({
  kind,
  src,
  className,
}: {
  kind: AttachmentKind
  /** Link firmado o `blob:` local. `null` = sin vista previa. */
  src: string | null
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  const Icon = kind === 'pdf' ? FileText : FileImage
  return (
    <span
      className={cn(
        'flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-cream-tint text-muted-foreground',
        className,
      )}
    >
      {kind === 'image' && src !== null && !broken ? (
        // biome-ignore lint/performance/noImgElement: link firmado de un bucket privado (o blob local): next/image no aplica
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <Icon className="size-6" aria-hidden />
      )}
    </span>
  )
}

/**
 * «Agregar foto o PDF»: un `<label>` con el `<input type="file">` adentro, con
 * la misma pinta que un botón `outline`. Se llega con Tab y se abre con Enter
 * o Espacio. En el celular, el selector deja sacar la foto en el momento,
 * elegirla de la galería o buscar un archivo (sin `capture`, que obligaría a
 * usar la cámara).
 */
export function AddAttachmentButton({
  onFiles,
  label = 'Agregar foto o PDF',
  busy = false,
  disabled = false,
  multiple = true,
  describedBy,
  className,
}: {
  onFiles: (files: File[]) => void
  label?: string
  /** Subiendo: muestra «Subiendo…» y no deja elegir más. */
  busy?: boolean
  disabled?: boolean
  multiple?: boolean
  describedBy?: string
  className?: string
}) {
  const off = disabled || busy
  return (
    <label className={cn('inline-flex', off && 'pointer-events-none', className)}>
      <input
        type="file"
        accept={ATTACHMENT_ACCEPT}
        multiple={multiple}
        disabled={off}
        aria-describedby={describedBy}
        className="peer sr-only"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          // Para poder elegir el mismo archivo otra vez (después de un error).
          event.currentTarget.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
      <span
        className={cn(
          buttonVariants({ variant: 'outline' }),
          'h-11 cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 md:h-9',
          off && 'opacity-50',
        )}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Paperclip className="size-4" aria-hidden />
        )}
        {busy ? 'Subiendo…' : label}
      </span>
    </label>
  )
}
