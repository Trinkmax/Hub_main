type Tag = { id: string; name: string; color: string }

export function TagPill({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none"
      style={{
        borderColor: `color-mix(in oklch, ${tag.color} 50%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${tag.color} 18%, transparent)`,
        color: tag.color,
      }}
    >
      {tag.name}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Quitar ${tag.name}`}
          className="ml-0.5 -mr-0.5 inline-flex size-3.5 items-center justify-center rounded-full opacity-60 hover:bg-current/20 hover:opacity-100"
        >
          ×
        </button>
      ) : null}
    </span>
  )
}
