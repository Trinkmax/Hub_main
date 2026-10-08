'use client'

import { FileUp } from 'lucide-react'
import { type DragEvent, useId, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * La zona para soltar el archivo (diseño §4.1 paso 1): se arrastra encima o se
 * toca para elegirlo. Es un `<label>` que envuelve el `<input type="file">`, así
 * que con el teclado se llega con Tab y se abre con Enter o Espacio, y en el
 * celular abre el selector de archivos. 44 px o más de alto en todo.
 */
export function FileDropZone({
  accept,
  title,
  hint,
  disabled = false,
  onFile,
  className,
}: {
  /** `.zip,.csv,.xlsx` (lo que el selector muestra primero). */
  accept: string
  title: string
  hint: string
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
        'flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
        'focus-within:outline-none focus-within:ring-[3px] focus-within:ring-ring/50',
        dragging
          ? 'border-primary bg-primary/5'
          : 'border-border/80 bg-card/50 hover:border-primary/50 hover:bg-cream-tint',
        disabled && 'pointer-events-none opacity-60',
        className,
      )}
    >
      <span className="flex size-14 items-center justify-center rounded-full border border-primary/20 bg-cream-tint text-primary shadow-2xs">
        <FileUp className="size-6" aria-hidden />
      </span>
      <span className="font-serif text-lg font-semibold tracking-tight text-foreground">
        {dragging ? 'Soltalo acá' : title}
      </span>
      <span className="max-w-md text-sm text-muted-foreground text-pretty">{hint}</span>
      <span
        aria-hidden
        className="inline-flex h-11 items-center rounded-md border border-border bg-background px-4 text-sm font-medium shadow-xs md:h-9"
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
