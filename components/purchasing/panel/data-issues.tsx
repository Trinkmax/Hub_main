'use client'

import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import {
  countByGroup,
  type DataIssue,
  ISSUE_GROUP_LABELS,
  type IssueGroup,
} from '@/lib/purchasing/checks'
import { cn } from '@/lib/utils'

const ORDER: IssueGroup[] = ['proveedores', 'eventos', 'insumos', 'recetas']

function hrefFor(slug: string, issue: DataIssue): string {
  switch (issue.target.kind) {
    case 'item':
      return `/${slug}/compras/insumos?editar=${issue.target.id}`
    case 'supplier':
      return `/${slug}/compras/proveedores?editar=${issue.target.id}`
    case 'recipe':
      return `/${slug}/compras/recetas/${issue.target.id}`
    case 'event':
      return '#pur-upcoming'
  }
}

/**
 * «Datos para corregir»: lo que falta o no coincide (lo más urgente, los WhatsApp y días de entrega de los
 * proveedores). Cada línea lleva a donde se arregla y la lista se vacía sola.
 */
export function DataIssues({ slug, issues }: { slug: string; issues: DataIssue[] }) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState<Set<IssueGroup>>(new Set())
  if (!issues.length) {
    return (
      <p className="card-hairline rounded-2xl bg-card px-5 py-4 text-sm text-muted-foreground shadow-xs">
        <span className="font-semibold text-foreground">Datos para corregir</span> · no hay nada
        pendiente.
      </p>
    )
  }
  const counts = countByGroup(issues)
  return (
    <section className="card-hairline rounded-2xl bg-card shadow-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-col gap-1 px-5 py-4 text-left sm:flex-row sm:items-center sm:justify-between"
      >
        <span>
          <span className="font-semibold">Datos para corregir</span>
          <span className="text-muted-foreground"> · {issues.length}</span>
        </span>
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          {ORDER.filter((g) => counts[g])
            .map((g) => `${ISSUE_GROUP_LABELS[g]} ${counts[g]}`)
            .join(' · ')}
          <ChevronDown
            className={cn('size-4 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </span>
      </button>
      {open ? (
        <div className="space-y-5 border-t border-border/70 px-5 pt-4 pb-5">
          {ORDER.filter((g) => counts[g]).map((g) => {
            const list = issues.filter((i) => i.group === g)
            const all = showAll.has(g)
            const shown = all ? list : list.slice(0, 12)
            return (
              <div key={g}>
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {ISSUE_GROUP_LABELS[g]}
                </h3>
                <ul className="mt-2 grid gap-x-8 gap-y-1.5 text-[0.95rem] md:grid-cols-2">
                  {shown.map((i) => (
                    <li key={i.key} className="flex gap-2">
                      <span aria-hidden className="text-muted-foreground">
                        •
                      </span>
                      <Link href={hrefFor(slug, i)} className="underline-offset-4 hover:underline">
                        {i.text}
                      </Link>
                    </li>
                  ))}
                </ul>
                {list.length > shown.length ? (
                  <button
                    type="button"
                    onClick={() => setShowAll((prev) => new Set(prev).add(g))}
                    className="mt-2 min-h-10 text-sm font-medium underline underline-offset-4"
                  >
                    Ver los {list.length}
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
