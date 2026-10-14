/**
 * Las palabras de la revisión de un archivo (`lib/imports/ui/review-copy.ts`):
 * que cada cosa que puede faltar y cada estado tengan su texto, que el número de
 * arriba cuente bien en cada momento, que el papel solo muestre lo que el
 * archivo trae, y que nada sugiera que algo queda «afuera» de los libros.
 */

import { describe, expect, it } from 'vitest'
import {
  type ImportNeed,
  NEED_KEYS,
  NOTE_KEYS,
  PROPOSAL_STATUSES,
  type ProposalSummary,
  SKIP_REASONS,
} from '@/lib/imports/server/types'
import {
  ANSWER,
  isBeforeStart,
  MANUAL_COPY,
  NOTE_COPY,
  needLine,
  needPillLabel,
  OUT_GROUP_TITLE,
  outGroup,
  PARTY_QUESTION,
  paperLines,
  proposalBadge,
  QUESTION_COPY,
  questionFor,
  reviewHero,
  reviewTally,
  reviewTitle,
  routeSteps,
  SKIP_COPY,
  STALE_QUESTION,
  skipText,
  VOIDED_QUESTION,
} from '@/lib/imports/ui/review-copy'

const NBSP = ' '
const plain = (text: string) => text.replaceAll(NBSP, ' ')
const ctx = {
  partyName: (id: string | null | undefined) => (id === 'p1' ? 'Limpieza Demo SA' : null),
  totalCents: 15_781_970,
  booksStartDate: '2026-10-12',
}

/** Una de cada clase, con datos de ejemplo. */
const NEEDS: ImportNeed[] = [
  {
    key: 'new_supplier',
    cuit: '30712345671',
    name: 'Hielo Polar SRL',
    suggested_condition: 'responsable_inscripto',
  },
  { key: 'supplier_account', party_id: 'p1' },
  { key: 'supplier_inactive', party_id: 'p1' },
  {
    key: 'condition_mismatch',
    party_id: 'p1',
    condition: 'monotributo',
    suggested_condition: 'responsable_inscripto',
  },
  { key: 'other_taxes_as', party_id: 'p1', amount_cents: 1_440_000 },
  { key: 'vat_rate' },
  { key: 'unsupported_voucher', code: 91 },
  { key: 'receipt', code: 4 },
  { key: 'foreign_currency', currency: 'USD', fx_rate: '1465.5', original_total_cents: 10_769 },
  { key: 'total_gap', cents: 100 },
  { key: 'possible_duplicate', document_id: 'd1', label: 'Factura A 0003-00001100' },
  { key: 'mp_invoice' },
  { key: 'channel_method', channel: 'qr' },
  { key: 'pick_party', role: 'supplier', suggested_party_id: null },
  { key: 'pick_treasury', suggested_treasury_id: null },
  { key: 'counterpart_account', direction: 'in' },
  { key: 'unknown_tax', tax: 'TASA X', amount_cents: -4_500 },
  { key: 'estimated_deductions' },
  { key: 'accept_warning', warnings: ['vat_diff'] },
  { key: 'engine_error', error_key: 'date_before_start', message: 'x', field: null },
  { key: 'manual', reason: 'cheque' },
]

const FORBIDDEN = /en negro|en blanco|ganancia|ganaste|afuera|\bHUB\b|Thinkeon/i

describe('cada cosa que puede faltar tiene su pregunta', () => {
  it('las 21 claves tienen pregunta, etiqueta corta y una línea para quien solo mira', () => {
    expect(NEEDS.map((n) => n.key).sort()).toEqual([...NEED_KEYS].sort())
    for (const key of NEED_KEYS) {
      expect(QUESTION_COPY[key].question.length, key).toBeGreaterThan(10)
      expect(needPillLabel(key).length, key).toBeGreaterThan(3)
    }
    for (const need of NEEDS) {
      const q = questionFor(need, ctx)
      expect(q.question.length, need.key).toBeGreaterThan(10)
      expect(needLine(need, ctx).length, need.key).toBeGreaterThan(10)
    }
  })

  it('ningún texto dice «en negro», «ganancia» ni «afuera», ni nombra un bar', () => {
    const all = [
      JSON.stringify(QUESTION_COPY),
      JSON.stringify(SKIP_COPY),
      JSON.stringify(NOTE_COPY),
      JSON.stringify(ANSWER),
      JSON.stringify(OUT_GROUP_TITLE),
      VOIDED_QUESTION,
      STALE_QUESTION,
      ...NEEDS.flatMap((n) => {
        const q = questionFor(n, ctx)
        return [q.question, q.context ?? '', needLine(n, ctx)]
      }),
      ...NEED_KEYS.map(needPillLabel),
    ].join('\n')
    expect(all).not.toMatch(FORBIDDEN)
  })

  it('lo que no se arma solo: a quien carga le dice qué hacer; a quien solo mira, solo el motivo', () => {
    const reasons = [
      'cheque',
      'commissions_extras',
      'unsupported',
      'not_ours',
      'check_row',
    ] as const
    expect(Object.keys(MANUAL_COPY).sort()).toEqual([...reasons].sort())
    // Palabras de sistema o de contador que traían los textos del servidor.
    const jargon = /\bSAS\b|tributos|percepci|se importa|asiento|\bfila\b/i
    // Órdenes que quien solo lee no puede cumplir.
    const orders = /marcalo|cargal[oa]|revisal[oa]|elegí|contest[aá]/i
    for (const reason of reasons) {
      const need: ImportNeed = { key: 'manual', reason }
      const owner = questionFor(need, ctx)
      expect(owner.question, reason).toBe('Esto no lo puedo armar por mi cuenta.')
      expect(owner.context, reason).toBe(MANUAL_COPY[reason].owner)
      expect(owner.context ?? '', reason).not.toMatch(jargon)
      const line = needLine(need, ctx)
      expect(line, reason).toBe(`No se puede armar solo: ${MANUAL_COPY[reason].reader}`)
      expect(line, reason).not.toMatch(jargon)
      expect(line, reason).not.toMatch(orders)
      expect(line, reason).not.toMatch(/No es nuestro/)
    }
    // Las demás que no se arman solas tampoco mandan a hacer nada a quien solo mira.
    for (const need of NEEDS) {
      if (!['vat_rate', 'total_gap', 'unsupported_voucher', 'engine_error'].includes(need.key)) {
        continue
      }
      expect(needLine(need, ctx), need.key).not.toMatch(orders)
      expect(needLine(need, ctx), need.key).not.toMatch(jargon)
    }
    // Sin motivo del motor, el respaldo también va en palabras de dueño.
    const bare: ImportNeed = { key: 'engine_error', error_key: null, message: '', field: null }
    expect(questionFor(bare, ctx).context).toBe('No se pudo armar con estos datos.')
    expect(needLine(bare, ctx)).toBe('No se pudo armar con estos datos.')
  })

  it('las preguntas con datos los dicen', () => {
    const by = (key: string) => {
      const need = NEEDS.find((n) => n.key === key)
      if (!need) throw new Error(key)
      return questionFor(need, ctx)
    }
    expect(by('supplier_account').question).toBe('¿En qué le comprás a Limpieza Demo SA?')
    expect(plain(by('other_taxes_as').question)).toBe(
      'Esta factura trae $ 14.400,00 de «otros impuestos» y ARCA no dice cuáles. ¿Qué son?',
    )
    expect(plain(by('foreign_currency').question)).toBe(
      'Está en dólares: 107,69 USD × 1.465,50 = $ 157.819,70. ¿La cargo en pesos con ese cambio?',
    )
    expect(by('condition_mismatch').question).toBe(
      'Limpieza Demo SA figura como monotributista, pero esta factura es de un responsable inscripto. ¿Cuál es?',
    )
    expect(by('channel_method').question).toBe(
      'Mercado Pago le dice «Cobros con QR». ¿Cómo lo llamás en tu cierre del día?',
    )
    expect(plain(by('unknown_tax').question)).toBe(
      'Mercado Pago te descontó $ 45,00 de «TASA X» y no sé qué impuesto es. ¿Dónde lo anoto?',
    )
    expect(by('counterpart_account').question).toBe('Entró plata y no sé de qué es. ¿Qué fue?')
    expect(questionFor({ key: 'counterpart_account', direction: 'out' }, ctx).context).toBe(
      'Por ejemplo, un gasto o un retiro de un socio.',
    )
  })

  it('sin el nombre del proveedor no queda un hueco en la oración', () => {
    const q = questionFor({ key: 'supplier_account', party_id: 'otro' }, ctx)
    expect(q.question).toBe('¿En qué le comprás a este proveedor?')
    expect(needLine({ key: 'supplier_account', party_id: 'otro' }, ctx)).toBe(
      'Falta: en qué se le compra a este proveedor.',
    )
  })

  it('a quién corresponde: una pregunta por rol', () => {
    expect(PARTY_QUESTION).toEqual({
      supplier: '¿A quién le pagaste?',
      tax_agency: '¿A qué organismo le pagaste?',
      payroll: '¿De quién es el sueldo?',
      card_processor: '¿Qué tarjeta o procesador es?',
      any: '¿De quién es?',
    })
    expect(needLine({ key: 'pick_party', role: 'tax_agency', suggested_party_id: null }, ctx)).toBe(
      'Falta: a qué organismo le pagaste.',
    )
  })

  it('lo anterior al arranque tiene salida: se dice la fecha y no se manda a cargar a mano', () => {
    const need = NEEDS.find((n) => n.key === 'engine_error') as ImportNeed
    expect(isBeforeStart(need)).toBe(true)
    expect(questionFor(need, ctx)).toEqual({
      question: 'Esto es de antes del 12/10, cuando arrancan tus números. Acá no se puede cargar.',
      context: 'Lo que debías de antes va en los saldos iniciales.',
      tone: 'info',
    })
    // Sin la fecha (no se pudo leer) la oración igual cierra.
    expect(questionFor(need, { ...ctx, booksStartDate: null }).question).toMatch(
      /^Esto es de antes de la fecha/,
    )
    const other: ImportNeed = {
      key: 'engine_error',
      error_key: 'x',
      message: 'El total no da.',
      field: null,
    }
    expect(isBeforeStart(other)).toBe(false)
    expect(questionFor(other, ctx).context).toBe('El total no da.')
  })

  it('respeta los textos que la Guía ya enseña', () => {
    expect(ANSWER.same).toBe('Es el mismo: no lo cargues')
    expect(ANSWER.other).toBe('Es otro: cargalo')
    expect(proposalBadge('skipped', 'already_loaded').label).toBe('Ya está cargado')
    expect(SKIP_COPY.already_loaded).toBe('Ya está cargado.')
  })
})

describe('el estado de cada hoja', () => {
  it('los 8 estados tienen su palabra y su tono', () => {
    for (const status of PROPOSAL_STATUSES) {
      const badge = proposalBadge(status)
      expect(badge.label.length, status).toBeGreaterThan(3)
      expect(['ok', 'warn', 'late', 'info', 'muted'], status).toContain(badge.tone)
    }
    expect(proposalBadge('needs_input').label).toBe('Con una pregunta')
    expect(proposalBadge('ready').label).toBe('Listo')
    expect(proposalBadge('posted')).toEqual({ label: 'Cargado', tone: 'ok' })
    expect(proposalBadge('voided').label).toBe('Anulado')
    expect(proposalBadge('error').tone).toBe('late')
  })

  it('una salteada dice por qué: ya estaba, no es nuestra o no va', () => {
    expect(proposalBadge('skipped', 'manual_overlap').label).toBe('Ya está cargado')
    expect(proposalBadge('skipped', 'posted_in_other_batch').label).toBe('Ya está cargado')
    expect(proposalBadge('skipped', 'ignored').label).toBe('No es nuestro')
    expect(proposalBadge('skipped', 'reserve').label).toBe('No va')
    expect(proposalBadge('skipped', null).label).toBe('No va')
    expect(outGroup('skipped', 'already_loaded')).toBe('already')
    expect(outGroup('skipped', 'ignored')).toBe('ours')
    expect(outGroup('skipped', 'rule_ignore')).toBe('other')
    expect(outGroup('voided')).toBe('other')
  })

  it('cada motivo de salteo y cada nota tienen texto', () => {
    for (const reason of [...SKIP_REASONS, 'post_failed' as const]) {
      expect(SKIP_COPY[reason].length, reason).toBeGreaterThan(8)
    }
    for (const note of NOTE_KEYS) expect(NOTE_COPY[note].length, note).toBeGreaterThan(10)
    expect(skipText('no_existe')).toBe('')
    expect(skipText(null)).toBe('')
  })
})

describe('el título dice la tarea', () => {
  const sep = { periodFrom: '2026-09-01', periodTo: '2026-09-30' }
  const days = { periodFrom: '2026-10-07', periodTo: '2026-10-08' }

  it('pendiente: «Revisá…»; terminado: «…, cargado»; descartado: lo dice', () => {
    expect(reviewTitle({ source: 'arca_recibidos', stage: 'pending', ...sep })).toBe(
      'Revisá las compras de septiembre',
    )
    expect(reviewTitle({ source: 'mp_release', stage: 'pending', ...days })).toBe(
      'Revisá Mercado Pago del 07/10 al 08/10',
    )
    expect(
      reviewTitle({
        source: 'bank_statement',
        stage: 'pending',
        ...days,
        treasuryName: 'Banco Nación',
      }),
    ).toBe('Revisá Banco Nación del 07/10 al 08/10')
    expect(reviewTitle({ source: 'arca_recibidos', stage: 'loaded', ...sep })).toBe(
      'Las compras de septiembre, cargadas',
    )
    expect(reviewTitle({ source: 'mp_release', stage: 'loaded', ...days })).toBe(
      'Mercado Pago del 07/10 al 08/10, cargado',
    )
    expect(reviewTitle({ source: 'arca_recibidos', stage: 'cancelled', ...sep })).toBe(
      'Las compras de septiembre (archivo descartado)',
    )
  })

  it('sin período o sin nada para cargar no inventa', () => {
    expect(
      reviewTitle({ source: 'bank_statement', stage: 'nothing', periodFrom: null, periodTo: null }),
    ).toBe('El banco')
    expect(
      reviewTitle({ source: 'arca_recibidos', stage: 'pending', periodFrom: null, periodTo: null }),
    ).toBe('Revisá las compras')
  })
})

describe('el número de arriba', () => {
  it('cuenta cada grupo una sola vez y suman el total', () => {
    const t = reviewTally(
      {
        needs_input: 2,
        stale: 1,
        error: 0,
        ready: 17,
        posting: 1,
        posted: 0,
        skipped: 2,
        voided: 0,
      },
      2,
    )
    expect(t).toEqual({ questions: 3, ready: 18, posted: 0, already: 2, out: 0, total: 23 })
    expect(t.questions + t.ready + t.posted + t.already + t.out).toBe(t.total)
    // «Ya estaban» nunca supera lo salteado.
    expect(reviewTally({ skipped: 1 }, 9)).toMatchObject({ already: 1, out: 0, total: 1 })
    expect(reviewTally({}, 0)).toMatchObject({ total: 0 })
  })

  it('con preguntas: te falta contestar', () => {
    const hero = reviewHero({
      source: 'arca_recibidos',
      tally: { questions: 3, ready: 18, posted: 0, already: 2, out: 0, total: 23 },
      readyCents: 524_493_500,
    })
    expect(hero).toMatchObject({
      stage: 'pending',
      label: 'Te falta contestar',
      value: '3',
      unit: 'de 23 comprobantes',
    })
    expect(plain(hero.sentence)).toBe(
      'Los otros 18 ya se pueden cargar ($ 5.244.935) y 2 ya estaban cargados.',
    )
  })

  it('el bar de ejemplo: 3 preguntas, 18 ya cargados y 2 que ya estaban', () => {
    const hero = reviewHero({
      source: 'arca_recibidos',
      tally: reviewTally({ needs_input: 3, posted: 18, skipped: 2 }, 2),
      readyCents: 0,
    })
    expect(hero.sentence).toBe('18 ya se cargaron y 2 ya estaban cargados.')
  })

  it('sin preguntas: listos para cargar, con el importe solo en ARCA', () => {
    const tally = { questions: 0, ready: 18, posted: 0, already: 2, out: 0, total: 20 }
    const arca = reviewHero({ source: 'arca_recibidos', tally, readyCents: 524_493_500 })
    expect(arca).toMatchObject({ label: 'Listos para cargar', value: '18', unit: 'comprobantes' })
    expect(plain(arca.sentence)).toBe('Son $ 5.244.935. 2 ya estaban cargados: no se repiten.')
    const bank = reviewHero({ source: 'bank_statement', tally, readyCents: 524_493_500 })
    expect(bank.unit).toBe('movimientos')
    expect(bank.sentence).not.toMatch(/\$/)
  })

  it('todo cargado', () => {
    const hero = reviewHero({
      source: 'mp_release',
      tally: { questions: 0, ready: 0, posted: 5, already: 1, out: 0, total: 6 },
      readyCents: 0,
    })
    expect(hero).toMatchObject({
      stage: 'loaded',
      label: 'Cargados',
      value: '5',
      unit: 'movimientos',
    })
    expect(hero.sentence).toBe('1 ya estaba cargado.')
  })

  it('nada para cargar: el archivo «eterno» se explica', () => {
    const none = reviewHero({
      source: 'arca_recibidos',
      tally: reviewTally({ skipped: 4 }, 0),
      readyCents: 0,
    })
    expect(none).toMatchObject({ stage: 'nothing', label: null, value: 'Nada para cargar' })
    expect(none.sentence).toBe('Los 4 quedaron en «No van».')
    expect(
      reviewHero({ source: 'arca_recibidos', tally: reviewTally({ skipped: 2 }, 2), readyCents: 0 })
        .sentence,
    ).toBe('Los 2 ya estaban cargados: no se repiten.')
    expect(
      reviewHero({ source: 'arca_recibidos', tally: reviewTally({}, 0), readyCents: 0 }).sentence,
    ).toBe('Este archivo no dejó nada para cargar.')
  })

  it('los renglones repetidos de otro archivo se dicen aparte', () => {
    const hero = reviewHero({
      source: 'bank_statement',
      tally: { questions: 0, ready: 3, posted: 0, already: 0, out: 0, total: 3 },
      readyCents: 0,
      duplicates: 4,
    })
    expect(plain(hero.sentence)).toMatch(
      /4 renglones ya habían entrado con otro archivo: no se repiten\.$/,
    )
  })

  it('un solo comprobante concuerda en singular', () => {
    const hero = reviewHero({
      source: 'arca_recibidos',
      tally: { questions: 1, ready: 1, posted: 0, already: 0, out: 0, total: 2 },
      readyCents: 99_999_999_900,
    })
    expect(plain(hero.sentence)).toBe('El otro ya se puede cargar ($ 999.999.999).')
  })

  it('descartado: lo cargado sigue registrado', () => {
    const hero = reviewHero({
      source: 'arca_recibidos',
      tally: reviewTally({ posted: 18, skipped: 5 }, 0),
      readyCents: 0,
      cancelled: true,
    })
    expect(hero.sentence).toBe('Los 18 que ya se habían cargado siguen registrados.')
    expect(hero.sentence).not.toMatch(FORBIDDEN)
  })
})

describe('la ruta: en qué orden', () => {
  const hrefFor = (q: Record<string, string | null>) => `/x?ver=${q.ver}`

  it('proveedores primero, después las preguntas, al final cargar', () => {
    expect(routeSteps({ newSuppliers: 14, questions: 3, ready: 18, hrefFor })).toEqual([
      { key: 'suppliers', title: '¿Los tenés de antes?', count: 14, href: '#proveedores-nuevos' },
      { key: 'questions', title: 'Contestá lo que te pregunto', count: 3, href: '/x?ver=revisar' },
      { key: 'load', title: 'Cargá', count: 18, href: '#cargar' },
    ])
  })

  it('con una sola cosa por hacer, o ninguna, no hay ruta', () => {
    expect(routeSteps({ newSuppliers: 0, questions: 0, ready: 18, hrefFor })).toEqual([])
    expect(routeSteps({ newSuppliers: 0, questions: 0, ready: 0, hrefFor })).toEqual([])
    expect(routeSteps({ newSuppliers: 0, questions: 3, ready: 0, hrefFor })).toHaveLength(2)
  })
})

describe('el papel de una hoja', () => {
  const base: ProposalSummary = {
    kind: 'purchase',
    date: '2026-09-23',
    month: null,
    label: 'Factura A 0002-00003455',
    counterparty: 'Cervecería Artesanal Sierras SRL',
    total_cents: 59_520_000,
    item_count: 1,
  }

  it('una compra de ARCA trae poco: el CUIT y el total (no se inventa neto ni IVA)', () => {
    const paper = paperLines({ ...base, detail: { code: 1, cuit: '30708889993', currency: 'ARS' } })
    expect(paper.lines).toEqual([{ label: 'CUIT', value: '30-70888999-3' }])
    expect(plain(paper.total?.value ?? '')).toBe('$ 595.200,00')
    expect(paper.total?.label).toBe('Total')
    expect(paper.aside).toEqual([])
  })

  it('en otra moneda muestra el importe original y el cambio', () => {
    const paper = paperLines({
      ...base,
      total_cents: 15_781_970,
      detail: {
        cuit: '30715556665',
        currency: 'USD',
        fx_rate: '1465.5',
        original_total_cents: 10_769,
      },
    })
    expect(paper.lines[1]).toEqual({ label: 'En dólares', value: '107,69 USD', hint: '× 1.465,50' })
  })

  it('un cobro de Mercado Pago se lee como una cuenta, con los descuentos en negativo', () => {
    const paper = paperLines({
      ...base,
      kind: 'mp_collection',
      total_cents: 12_960_000,
      notes: ['missing_close'],
      detail: {
        gross_cents: 12_960_000,
        net_cents: 12_744_728,
        commission_cents: 103_894,
        commission_vat_cents: 21_818,
        sirtac_cents: 11_800,
        sircupa_cents: 0,
        ley25413_cents: 77_760,
        close_cents: 0,
        difference_cents: 12_960_000,
      },
    })
    expect(paper.lines.map((l) => l.label)).toEqual([
      'Cobrado',
      'Comisión',
      'IVA de la comisión',
      'Retenciones',
      'Impuesto al cheque',
    ])
    expect(paper.lines[1]?.value.startsWith('−')).toBe(true)
    expect(paper.total?.label).toBe('Te depositaron')
    // Sin cierre, «Según tu cierre» no es cero.
    expect(paper.aside).toEqual([
      { label: 'Según tu cierre', value: '—', hint: 'Falta el cierre de ese día' },
    ])
  })

  it('un movimiento del banco dice si entró o salió', () => {
    const out = paperLines({
      ...base,
      kind: 'bank_review',
      detail: { direction: 'debit', voucher: '7781020' },
    })
    expect(out.total?.label).toBe('Salió')
    expect(out.lines).toEqual([{ label: 'Comprobante n.º', value: '7781020' }])
    expect(
      paperLines({ ...base, kind: 'bank_transfer', detail: { direction: 'credit' } }).total?.label,
    ).toBe('Entró')
    expect(paperLines({ ...base, kind: 'bank_review' }).total?.label).toBe('Importe')
  })

  it('los gastos del banco: solo los renglones que tienen plata', () => {
    const paper = paperLines({
      ...base,
      kind: 'bank_expense',
      total_cents: 8_676_000,
      detail: { fees_net_cents: 6_900_000, vat_cents: 1_449_000, sircreb_cents: 0, other_cents: 0 },
    })
    expect(paper.lines.map((l) => l.label)).toEqual(['Comisiones', 'IVA de las comisiones'])
  })

  it('sin detalle no rompe', () => {
    expect(paperLines(base)).toEqual({
      lines: [],
      total: { label: 'Total', value: expect.any(String) },
      aside: [],
    })
    expect(paperLines({ ...base, kind: 'credit_note' }).total?.label).toBe('A tu favor')
  })
})
