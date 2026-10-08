'use client'

import { ListOrdered } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { type GuideStepStatus, progressPercent, progressText } from './arca-guide-model'
import { useGuideNav } from './guide-nav'
import { GUIDE_STATUS_TEXT_CLASS, GuideStatusDot } from './guide-status'

/**
 * El riel de una guía (diseño §5.1.1): en la compu, una columna fija a la izquierda con la barra
 * de avance («5 de 9») y la lista de pasos, cada uno con su estado en texto; en el celular, una
 * barra arriba con lo que toca y «Ver los pasos», que abre la lista en una hoja.
 */

export type GuideRailItem = {
  readonly id: string
  readonly anchor: string
  readonly n: number
  readonly title: string
  readonly status: GuideStepStatus
  readonly statusText: string
  readonly optional?: boolean
}

type Summary = { readonly done: number; readonly total: number }

function RailList({
  items,
  currentId,
  onPick,
}: {
  items: readonly GuideRailItem[]
  currentId: string | null
  onPick: (item: GuideRailItem, event: React.MouseEvent<HTMLAnchorElement>) => void
}) {
  return (
    <ol className="space-y-0.5">
      {items.map((item) => {
        const current = item.id === currentId
        return (
          <li key={item.id}>
            <a
              href={`#${item.anchor}`}
              aria-current={current ? 'step' : undefined}
              onClick={(event) => onPick(item, event)}
              className={cn(
                'flex min-h-11 items-start gap-2.5 rounded-lg px-2 py-2 text-sm outline-none transition-colors hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring',
                current && 'bg-cream-tint',
              )}
            >
              <GuideStatusDot status={item.status} n={item.n} size="sm" className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block leading-snug text-pretty',
                    current ? 'font-medium text-foreground' : 'text-foreground/90',
                  )}
                >
                  <span className="tabular-nums text-muted-foreground">{item.n}.</span> {item.title}
                </span>
                <span className={cn('block text-xs', GUIDE_STATUS_TEXT_CLASS[item.status])}>
                  {item.statusText}
                </span>
              </span>
            </a>
          </li>
        )
      })}
    </ol>
  )
}

function ProgressBlock({ summary, label }: { summary: Summary; label: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium tabular-nums">{progressText(summary)}</p>
      <Progress
        value={progressPercent(summary)}
        aria-label={`${label}: ${progressText(summary)}`}
      />
    </div>
  )
}

/** La columna de la compu (desde `lg`), fija mientras se scrollea. */
export function GuideRail({
  label,
  items,
  summary,
  currentId,
}: {
  /** «Pasos para conectar ARCA». */
  label: string
  items: readonly GuideRailItem[]
  summary: Summary
  /** El paso que toca (se marca con `aria-current="step"`). */
  currentId: string | null
}) {
  const nav = useGuideNav()
  return (
    <nav
      aria-label={label}
      className="hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto"
    >
      <div className="card-hairline space-y-4 rounded-xl border bg-card p-4">
        <ProgressBlock summary={summary} label={label} />
        <RailList
          items={items}
          currentId={currentId}
          onPick={(item) => nav?.setOpen(item.id, true)}
        />
      </div>
    </nav>
  )
}

/** La barra del celular (hasta `lg`): lo que toca, el avance y la lista en una hoja. */
export function GuideMobileBar({
  label,
  items,
  summary,
  currentId,
  headline,
}: {
  label: string
  items: readonly GuideRailItem[]
  summary: Summary
  currentId: string | null
  /** «Te toca: 6. Creá el certificado en ARCA y bajalo» (o «¡Listo!…»). */
  headline: string
}) {
  const nav = useGuideNav()
  const [open, setOpen] = useState(false)
  const target = useRef<string | null>(null)
  return (
    <div className="sticky top-14 z-20 -mx-4 border-b border-border/60 bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:hidden">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="line-clamp-2 text-sm font-medium leading-snug text-pretty">{headline}</p>
          <div className="flex items-center gap-2">
            <Progress
              value={progressPercent(summary)}
              aria-label={`${label}: ${progressText(summary)}`}
              className="h-1.5"
            />
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {summary.done} de {summary.total}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0 gap-1.5"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          <ListOrdered className="size-4" aria-hidden />
          Pasos
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] gap-0 overflow-y-auto"
          onCloseAutoFocus={(event) => {
            const id = target.current
            target.current = null
            if (id && nav) {
              // El foco va al paso elegido, no al botón «Pasos».
              event.preventDefault()
              nav.reveal(id)
            }
          }}
        >
          <SheetHeader className="pb-2">
            <SheetTitle>{label}</SheetTitle>
            <SheetDescription>{progressText(summary)}</SheetDescription>
          </SheetHeader>
          <div className="px-2 pb-4">
            <RailList
              items={items}
              currentId={currentId}
              onPick={(item, event) => {
                if (!nav) return
                event.preventDefault()
                target.current = item.id
                setOpen(false)
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
