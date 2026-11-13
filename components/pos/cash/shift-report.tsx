import { Check, LockKeyhole } from 'lucide-react'
import type { ShiftReport } from '@/lib/pos/cash/report'
import { cn } from '@/lib/utils'

/**
 * El turno resumido, en papel: lo que entró por cada medio, las mesas, el cajón con su arqueo y
 * todo lo que hay que mirar (correcciones, descuentos, bajas, anulaciones) con quién hizo cada
 * cosa. Es el mismo armado que viaja por WhatsApp (`shiftShareText`).
 */
export function ShiftReportSlip({
  report,
  title,
  practice = false,
  bare = false,
}: {
  report: ShiftReport
  title: string
  practice?: boolean
  /** Dentro de una hoja: sin el papel alrededor ni el encabezado (la hoja ya es el papel). */
  bare?: boolean
}) {
  return (
    <article
      className={cn('caja-report', bare ? 'is-bare' : 'caja-slip', practice && 'is-practice')}
      aria-label={title}
      data-testid="resumen"
    >
      <header className="caja-report-top" hidden={bare}>
        <div>
          <h2 className="caja-slip-title">{title}</h2>
          <p>{report.meta}</p>
        </div>
        {report.closed ? (
          report.difference?.kind === 'exact' ? (
            <span className="caja-stamp">
              <Check aria-hidden strokeWidth={3} />
              Cuadró
            </span>
          ) : (
            <span className="caja-stamp is-closed">
              <LockKeyhole aria-hidden strokeWidth={2.8} />
              Cerrado
            </span>
          )
        ) : null}
      </header>

      {report.sections.map((section) => (
        <section key={section.key}>
          <h3>{section.title}</h3>
          {section.lines.length > 0 ? (
            <dl>
              {section.lines.map((line) => (
                <div
                  key={`${line.label}:${line.value ?? ''}:${line.detail ?? ''}`}
                  className={cn(
                    'caja-report-line',
                    line.tone && `is-${line.tone}`,
                    !line.value && 'is-plain',
                  )}
                >
                  <dt>
                    {line.label}
                    {line.detail && line.inline ? <small>{line.detail}</small> : null}
                  </dt>
                  {line.value ? <dd>{line.value}</dd> : null}
                  {line.detail && !line.inline ? (
                    <dd className="is-detail">{line.detail}</dd>
                  ) : null}
                </div>
              ))}
            </dl>
          ) : null}
          {section.foot ? <p className="caja-report-foot">{section.foot}</p> : null}
        </section>
      ))}

      {report.note ? (
        <section>
          <h3>Nota de quien cerró</h3>
          <p className="caja-report-note">«{report.note}»</p>
        </section>
      ) : null}
    </article>
  )
}
