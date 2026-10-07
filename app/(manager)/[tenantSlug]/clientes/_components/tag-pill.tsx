import { X } from 'lucide-react'

type Tag = { id: string; name: string; color: string }

/**
 * Etiqueta de un cliente, con el color que eligió el bar. Server-safe (sin
 * hooks): la lista la dibuja en el server y la ficha, con «Quitar», en el
 * cliente.
 *
 * El color es un dato del bar, no un token: tiñe el borde y el fondo, y el
 * texto lo mezcla con la tinta para que se lea (un amarillo puro sobre papel
 * no llega a 4,5:1).
 */
export function TagPill({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span
      data-slot="tag-pill"
      className="inline-flex h-6 max-w-full items-center gap-1 rounded-full border px-2 type-caption font-medium"
      style={{
        borderColor: `color-mix(in oklch, ${tag.color} 50%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${tag.color} 16%, transparent)`,
        color: `color-mix(in oklch, ${tag.color} 55%, var(--foreground))`,
      }}
    >
      <span className="truncate">{tag.name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Quitar la etiqueta ${tag.name}`}
          className="relative hit-area -me-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full opacity-70 outline-offset-2 outline-(--ring) hover:bg-hover hover:opacity-100 focus-visible:outline-2"
        >
          <X aria-hidden="true" className="size-3" />
        </button>
      ) : null}
    </span>
  )
}
