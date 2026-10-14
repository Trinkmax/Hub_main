'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { Amount } from '@/components/administracion/amount'
import { LedgerGroup, LedgerList, LedgerRail, LedgerRow } from '@/components/administracion/kit'
import { isRealIsoDay, MONTH_NAMES_SHORT } from '@/lib/dates'
import { OUT_GROUP_TITLE, type OutGroup, outGroup } from '@/lib/imports/ui/review-copy'
import { RuleDialog } from '../bank-rules-card'
import { askLabel, lineWords, ProposalInHand, ProposalLine } from './proposal-row'
import { PaperFold, ProposalTicket } from './proposal-ticket'
import { useReview } from './review-context'
import type { ProposalView } from './types'

const OUT_ORDER: readonly OutGroup[] = ['already', 'ours', 'other']

/**
 * La lista de hojas de una vista (listos, cargados, lo que no se carga, todos):
 * renglones cerrados con margen, que se abren en el lugar de a uno. En «No se
 * cargan» van agrupados bajo tres títulos, porque ahí se mezclaba lo bueno («ya
 * estaba cargado»), lo decidido («no es nuestro») y lo que pide atención.
 */
export function ProposalList({
  rows,
  label,
  grouped = false,
}: {
  rows: ProposalView[]
  label: string
  /** Agrupar por qué no se carga (la vista «No se cargan»). */
  grouped?: boolean
}) {
  if (!grouped) {
    return (
      <LedgerList aria-label={label}>
        {rows.map((p) => (
          <ProposalLine key={p.key} p={p} />
        ))}
      </LedgerList>
    )
  }
  const groups = OUT_ORDER.map((group) => ({
    group,
    rows: rows.filter((p) => outGroup(p.status, p.error?.reason) === group),
  })).filter((g) => g.rows.length > 0)
  return (
    <LedgerList aria-label={label}>
      {groups.map((g) => (
        <LedgerGroup key={g.group} title={OUT_GROUP_TITLE[g.group]} count={g.rows.length}>
          {g.rows.map((p) => (
            <ProposalLine key={p.key} p={p} />
          ))}
        </LedgerGroup>
      ))}
    </LedgerList>
  )
}

/**
 * «Con una pregunta»: la primera hoja de la página, en la mano (la pregunta a
 * la izquierda, su papel a la derecha), y debajo «Las que siguen», cerradas, en
 * una línea cada una. Tocar una la trae a la mano. Al contestar, la página se
 * vuelve a armar, la siguiente pasa a ser la primera y el foco va a su pregunta.
 *
 * En el celular el papel va arriba de la pregunta, resumido, con «Ver el papel».
 */
export function QuestionDeck({
  rows,
  offset,
  total,
}: {
  rows: ProposalView[]
  /** Cuántas preguntas hay antes de esta página. */
  offset: number
  /** Cuántas preguntas quedan en total. */
  total: number
}) {
  const { handKey, setHandKey } = useReview()
  const firstRender = useRef(true)
  const top = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    firstRender.current = false
  }, [])
  const handIndex = Math.max(
    0,
    rows.findIndex((p) => p.key === handKey),
  )
  const hand = rows[handIndex]
  if (!hand) return null
  const rest = rows.filter((p) => p.key !== hand.key)
  const next = rows[(handIndex + 1) % rows.length]

  const bring = (key: string) => {
    setHandKey(key)
    top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return (
    <div ref={top} className="scroll-mt-28 space-y-6">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">
        <aside className="min-w-0 lg:sticky lg:top-20 lg:order-2">
          <PaperFold p={hand} className="lg:hidden" />
          <ProposalTicket p={hand} className="max-lg:hidden" />
        </aside>
        <div className="min-w-0 lg:order-1">
          <ProposalInHand
            key={hand.key}
            p={hand}
            position={offset + handIndex + 1}
            total={Math.max(total, offset + rows.length)}
            onLater={next && next.key !== hand.key ? () => bring(next.key) : undefined}
            focusOnMount={!firstRender.current}
          />
        </div>
      </div>

      {rest.length > 0 ? (
        <section aria-labelledby="las-que-siguen" className="space-y-2">
          <h2
            id="las-que-siguen"
            className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
          >
            Las que siguen
          </h2>
          <LedgerList aria-label="Las preguntas que siguen">
            {rest.map((p) => {
              const s = p.summary
              const day = isRealIsoDay(s.date) ? s.date : null
              return (
                <LedgerRow
                  key={p.key}
                  rail={
                    day ? (
                      <LedgerRail
                        label={MONTH_NAMES_SHORT[Number(day.slice(5, 7)) - 1]}
                        value={day.slice(8, 10)}
                      />
                    ) : undefined
                  }
                  title={lineWords(s).title}
                  onClick={() => bring(p.key)}
                  meta={
                    <>
                      {lineWords(s).paper}
                      <span className="block font-medium text-warning-text">{askLabel(p)}</span>
                    </>
                  }
                  amount={<Amount cents={s.total_cents} />}
                />
              )
            })}
          </LedgerList>
        </section>
      ) : null}
    </div>
  )
}

/**
 * «Enseñarme algo nuevo», abierto desde una pregunta de la revisión («¿Pasa
 * todas las semanas? Enseñame a reconocerlo»): el mismo diálogo de la subida
 * del banco, con la descripción ya puesta. Vale para las próximas subidas.
 */
export function TeachHost() {
  const router = useRouter()
  const { slug, options, editable, teach, setTeach } = useReview()
  // Enseñar algo es una carga: quien solo lee no llega a este diálogo.
  if (!editable || !teach || !options) return null
  return (
    <RuleDialog
      slug={slug}
      rule={null}
      initial={teach}
      options={{
        parties: options.parties,
        accounts: options.accounts.map((a) => ({ ...a, postable: a.postable && !a.treasury })),
        treasuries: options.treasuries,
      }}
      onClose={() => setTeach(null)}
      onSaved={() => {
        setTeach(null)
        router.refresh()
      }}
    />
  )
}
