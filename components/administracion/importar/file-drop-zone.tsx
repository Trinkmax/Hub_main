'use client'

import { FileUp } from 'lucide-react'
import { type DragEvent, type ReactNode, useId, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * La ranura para soltar el archivo: se arrastra encima o se toca para elegirlo.
 * Es un `<label>` que envuelve el `<input type="file">`, así que con el teclado
 * se llega con Tab y se abre con Enter o Espacio, y en el celular abre el
 * selector de archivos. Arriba lleva el dibujo del origen (de dónde viene ese
 * papel); el botón dice «Elegir archivo», que es el texto que enseña la Guía.
 *
 * En un teléfono no se arrastra nada: ahí el título es `touchTitle` («Elegí el
 * ZIP…») en lugar de «Soltá acá…».
 */
export function FileDropZone({
  accept,
  title,
  touchTitle,
  hint,
  art,
  disabled = false,
  onFile,
  className,
}: {
  /** `.zip,.csv,.xlsx` (lo que el selector muestra primero). */
  accept: string
  title: string
  /** El título donde no se puede arrastrar (pantalla táctil o angosta). Sin él, vale `title`. */
  touchTitle?: string
  hint: string
  /** El dibujo del origen (`SourceMark`). Sin él, una hoja genérica. */
  art?: ReactNode
  disabled?: boolean
  onFile: (file: File) => void
  className?: string
}) {
  const id = useId()
  const [dragging, setDragging] = useState(false)

  const take = (files: FileList | null | undefined) => {
    const file = files?.[0]
    if (file && !disabled) onFile(file)
  }

  const onDragOver = (event: DragEvent<HTMLLabelElement>) => {
    if (disabled) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (!dragging) setDragging(true)
  }

  return (
    <label
      htmlFor={id}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        take(event.dataTransfer.files)
      }}
      className={cn(
        'flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-5 py-8 text-center transition-colors duration-(--duration-fast) motion-reduce:transition-none',
        'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
        dragging
          ? 'border-primary bg-primary/5'
          : 'border-border bg-secondary/30 hover:border-primary/50 hover:bg-cream-tint',
        disabled && 'pointer-events-none opacity-60',
        className,
      )}
    >
      <span className="flex size-14 items-center justify-center rounded-2xl border border-border/70 bg-card text-primary shadow-xs">
        {art ?? <FileUp className="size-6" aria-hidden />}
      </span>
      <span className="font-serif text-lg font-semibold leading-snug tracking-tight text-balance text-foreground">
        {dragging ? (
          'Soltalo acá'
        ) : touchTitle ? (
          <>
            <span className="max-sm:hidden pointer-coarse:hidden">{title}</span>
            <span className="hidden max-sm:inline pointer-coarse:inline">{touchTitle}</span>
          </>
        ) : (
          title
        )}
      </span>
      <span className="max-w-md text-sm text-muted-foreground text-pretty">{hint}</span>
      <span
        aria-hidden
        className="inline-flex h-11 items-center rounded-md border border-border bg-card px-5 text-sm font-medium shadow-xs"
      >
        Elegir archivo
      </span>
      <input
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        aria-label={`${title}. ${hint}`}
        onChange={(event) => {
          take(event.currentTarget.files)
          // Para poder elegir el mismo archivo otra vez (después de un error).
          event.currentTarget.value = ''
        }}
      />
    </label>
  )
}
