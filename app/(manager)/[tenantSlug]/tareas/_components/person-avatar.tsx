import { firstName, initials, personColorClass } from '@/lib/marketing/board'
import { cn } from '@/lib/utils'

type Person = { id: string; name: string; inTeam?: boolean }

const SIZES = {
  xs: 'size-5 text-[9px]',
  sm: 'size-6 text-[10px]',
  md: 'size-7 text-[11px]',
  lg: 'size-9 text-xs',
} as const

/** El círculo con las iniciales, del color de esa persona (siempre el mismo). */
export function PersonAvatar({
  person,
  size = 'sm',
  className,
  ring = false,
}: {
  person: Person
  size?: keyof typeof SIZES
  className?: string
  /** Borde del color del fondo: para apilarlos sin que se peguen. */
  ring?: boolean
}) {
  const gone = person.inTeam === false
  return (
    <span
      title={person.name}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-tight text-(--task-person-fg)',
        SIZES[size],
        gone ? 'bg-muted-foreground/40' : personColorClass(person.id),
        ring && 'ring-2 ring-background',
        className,
      )}
    >
      <span aria-hidden>{initials(person.name)}</span>
      <span className="sr-only">{person.name}</span>
    </span>
  )
}

/** Avatares apilados (hasta `max`, el resto como «+N»). */
export function AvatarStack({
  people,
  max = 3,
  size = 'sm',
}: {
  people: ReadonlyArray<Person>
  max?: number
  size?: keyof typeof SIZES
}) {
  const shown = people.slice(0, max)
  const rest = people.length - shown.length
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {shown.map((person) => (
        <PersonAvatar key={person.id} person={person} size={size} ring />
      ))}
      {rest > 0 ? (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground ring-2 ring-background',
            SIZES[size],
          )}
        >
          +{rest}
        </span>
      ) : null}
    </span>
  )
}

/** La ficha con el nombre en el color de la persona (la columna «Involucrados» de Monday). */
export function PersonChip({ person, className }: { person: Person; className?: string }) {
  const gone = person.inTeam === false
  return (
    <span
      title={person.name}
      className={cn(
        'inline-flex h-6 min-w-0 max-w-full items-center rounded-md px-2 text-xs font-semibold text-(--task-person-fg)',
        gone ? 'bg-muted-foreground/40' : personColorClass(person.id),
        className,
      )}
    >
      <span className="truncate">{firstName(person.name)}</span>
    </span>
  )
}
