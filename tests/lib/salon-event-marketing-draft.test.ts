import { describe, expect, it } from 'vitest'
import type { EventMarketingRow, MonthPendingRow } from '@/lib/salon/event-marketing'
import {
  blockedSaveMessage,
  checkMarketingDraft,
  draftFromRow,
  EMPTY_MARKETING_DRAFT,
  firstEmptyField,
  keepMarketingDraft,
  lastRateChipLabel,
  lastValidFromDraft,
  type MarketingDraft,
  MESSAGES_OVER_REACH_WARNING,
  marketingBaseline,
  marketingCopy,
  marketingRevenueVisible,
  nextLastValid,
  pinOpenPendingRow,
  restoreMarkAfterFailedUndo,
  sameDraft,
} from '@/lib/salon/event-marketing-draft'
import { MARKETING_FIELD_MESSAGES as M } from '@/lib/salon/event-marketing-schemas'

const NBSP = String.fromCharCode(0xa0)
const EVENT_ID = '8b0f2a4e-3c1d-4f5a-9b6e-2d7c8a9e0f11'
const CTX = { scheduledEventId: EVENT_ID, expectedUpdatedAt: null, revenueVisible: true }

/** El ejemplo del dueño: Noche Astral 09/09. */
const ASTRAL: EventMarketingRow = {
  scheduledEventId: EVENT_ID,
  adSpendUsdCents: 17526,
  messages: 51,
  reach: 8420,
  revenueArsCents: 248_000_000,
  usdArsRate: 1450,
  notes: 'Campaña de reels del 1/9 al 9/9',
  updatedAt: '2026-09-10T17:32:00+00:00',
  updatedByName: 'Nacho B.',
}

function draft(patch: Partial<MarketingDraft>): MarketingDraft {
  return { ...EMPTY_MARKETING_DRAFT, ...patch }
}

describe('draftFromRow', () => {
  it('escribe lo guardado como queda el input después del blur', () => {
    expect(draftFromRow(ASTRAL)).toEqual({
      adSpendUsd: '175,26',
      messages: '51',
      reach: '8.420',
      revenueArs: '2.480.000',
      usdArsRate: '1.450',
      notes: 'Campaña de reels del 1/9 al 9/9',
      revenueOpen: true,
    })
  })

  it('sin fila o con «No tuvo pauta» abre vacío (un 0,00 en Gastado sería inválido)', () => {
    expect(draftFromRow(null)).toEqual(EMPTY_MARKETING_DRAFT)
    expect(
      draftFromRow({
        ...ASTRAL,
        adSpendUsdCents: 0,
        messages: null,
        reach: null,
        revenueArsCents: null,
        usdArsRate: null,
        notes: null,
      }),
    ).toEqual(EMPTY_MARKETING_DRAFT)
  })

  it('sin facturación deja la sección cerrada', () => {
    const d = draftFromRow({ ...ASTRAL, revenueArsCents: null, usdArsRate: null, reach: null })
    expect(d.revenueOpen).toBe(false)
    expect(d.revenueArs).toBe('')
    expect(d.reach).toBe('')
  })

  it('vuelve a leerse igual: el borrador de una fila guardada pasa el chequeo tal cual', () => {
    const check = checkMarketingDraft(draftFromRow(ASTRAL), {
      ...CTX,
      expectedUpdatedAt: ASTRAL.updatedAt,
    })
    expect(check.fieldErrors).toEqual({})
    expect(check.input).toEqual({
      scheduledEventId: EVENT_ID,
      adSpendUsd: 175.26,
      messages: 51,
      reach: 8420,
      revenueArs: 2_480_000,
      usdArsRate: 1450,
      notes: 'Campaña de reels del 1/9 al 9/9',
      expectedUpdatedAt: ASTRAL.updatedAt,
    })
  })
})

describe('sameDraft', () => {
  it('abrir la facturación sin escribir no es un cambio', () => {
    expect(sameDraft(EMPTY_MARKETING_DRAFT, draft({ revenueOpen: true }))).toBe(true)
  })

  it('los espacios de más no son un cambio; un número sí', () => {
    const saved = draftFromRow(ASTRAL)
    expect(sameDraft(saved, { ...saved, messages: ' 51 ' })).toBe(true)
    expect(sameDraft(saved, { ...saved, messages: '52' })).toBe(false)
    expect(sameDraft(saved, { ...saved, notes: 'otra' })).toBe(false)
  })

  it('cerrar la facturación la borra aunque los campos hayan quedado escritos', () => {
    const saved = draftFromRow({ ...ASTRAL, revenueArsCents: null, usdArsRate: null })
    expect(sameDraft(saved, { ...saved, revenueArs: '10', revenueOpen: false })).toBe(true)
  })
})

describe('marketingRevenueVisible', () => {
  it('la facturación se ofrece en fechas que pasaron o que son hoy', () => {
    expect(marketingRevenueVisible('past', null)).toBe(true)
    expect(marketingRevenueVisible('tonight', null)).toBe(true)
  })

  it('en una fecha futura solo si la fila ya trae facturación (no se esconde lo guardado)', () => {
    expect(marketingRevenueVisible('future', null)).toBe(false)
    expect(
      marketingRevenueVisible('future', { ...ASTRAL, revenueArsCents: null, usdArsRate: null }),
    ).toBe(false)
    expect(marketingRevenueVisible('future', ASTRAL)).toBe(true)
  })
})

describe('borrador guardado al cancelar', () => {
  const V1 = '2026-09-10T17:32:00+00:00'
  const V2 = '2026-09-11T09:00:00+00:00'

  it('keepMarketingDraft guarda lo tipeado con su versión, y nada si es igual a lo guardado', () => {
    const saved = draftFromRow(ASTRAL)
    expect(keepMarketingDraft(saved, saved, V1)).toBeNull()
    const typed = { ...saved, adSpendUsd: '90' }
    expect(keepMarketingDraft(typed, saved, V1)).toEqual({ draft: typed, baseAt: V1 })
  })

  it('al reabrir, la base es la del borrador: si otro dueño guardó en el medio, se nota', () => {
    const typed = { ...draftFromRow(ASTRAL), adSpendUsd: '90' }
    const kept = keepMarketingDraft(typed, draftFromRow(ASTRAL), V1)
    const current = { ...ASTRAL, updatedAt: V2 }
    // Antes la base era la fila de ESE momento (V2): sin aviso, y el guardado
    // mandaba V2 como versión esperada y pisaba los números del otro dueño.
    expect(marketingBaseline(kept, current)).toBe(V1)
    expect(marketingBaseline(kept, current)).not.toBe(current.updatedAt)
  })

  it('un borrador escrito sobre «sin cargar» guarda base null, y la fila que apareció se nota', () => {
    const kept = keepMarketingDraft(draft({ adSpendUsd: '45' }), draftFromRow(null), null)
    expect(marketingBaseline(kept, ASTRAL)).toBeNull()
  })

  it('sin borrador, la base es la fila actual', () => {
    expect(marketingBaseline(null, ASTRAL)).toBe(ASTRAL.updatedAt)
    expect(marketingBaseline(undefined, null)).toBeNull()
  })
})

describe('restoreMarkAfterFailedUndo', () => {
  const X = '2026-09-10T17:32:00+00:00'
  const Y = '2026-09-10T17:33:00+00:00'

  it('una falla de red con props en la misma versión (o sin traerla) vuelve a mostrar la marca', () => {
    expect(restoreMarkAfterFailedUndo('error', X, X)).toBe(true)
    expect(restoreMarkAfterFailedUndo('error', null, X)).toBe(true)
  })

  it('con stale, o con props ya en otra versión, gana la del server', () => {
    expect(restoreMarkAfterFailedUndo('stale', X, X)).toBe(false)
    // Se guardó US$ 50 encima (Y) mientras el toast seguía: la marca X no vuelve.
    expect(restoreMarkAfterFailedUndo('stale', Y, X)).toBe(false)
    expect(restoreMarkAfterFailedUndo('error', Y, X)).toBe(false)
  })
})

describe('pinOpenPendingRow', () => {
  const pendingRow = (eventId: string, date: string, row: EventMarketingRow | null = null) =>
    ({
      eventId,
      date,
      title: `Evento ${eventId}`,
      colorHex: null,
      weekdayLabel: date,
      reservations: 11,
      guests: 29,
      reservationsLabel: '11 reservas en pie',
      incomplete: false,
      row,
      cargarAriaLabel: `Cargar ${eventId}`,
      noAdsAriaLabel: `No tuvo pauta ${eventId}`,
    }) satisfies MonthPendingRow

  const ramen = pendingRow('ramen', '2026-09-07')
  const pizza = pendingRow('pizza', '2026-09-03')
  const merienda = pendingRow('merienda', '2026-09-26')

  it('sin form abierto, o con la fila todavía pendiente, las filas quedan como vienen', () => {
    const rows = [pizza, ramen, merienda]
    expect(pinOpenPendingRow(rows, null, [])).toEqual(rows)
    expect(pinOpenPendingRow(rows, ramen, [])).toEqual(rows)
  })

  it('si otro dueño la completó, la fila abierta sigue en su lugar por fecha, con la fila nueva', () => {
    const completed = { ...ASTRAL, scheduledEventId: 'ramen' }
    const out = pinOpenPendingRow([pizza, merienda], ramen, [
      { eventId: 'ramen', row: completed, status: 'completa' },
    ])
    expect(out.map((r) => r.eventId)).toEqual(['pizza', 'ramen', 'merienda'])
    expect(out[1]).toMatchObject({ row: completed, incomplete: false, title: 'Evento ramen' })
  })

  it('si era la última pendiente, queda sola (el recuadro no desaparece con lo tipeado)', () => {
    const noAds = { ...ASTRAL, adSpendUsdCents: 0, messages: null, reach: null }
    const out = pinOpenPendingRow([], ramen, [
      { eventId: 'ramen', row: noAds, status: 'sin-pauta' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.row).toBe(noAds)
  })

  it('si la edición ya no está en el mes, queda la foto de cuando se abrió', () => {
    expect(pinOpenPendingRow([pizza], ramen, [])).toEqual([pizza, ramen])
  })
})

describe('nextLastValid', () => {
  it('mientras se tipea un número a medias, la vista previa sigue con el último válido', () => {
    expect(nextLastValid(175, '175,', 'money')).toBe(175)
    expect(nextLastValid(null, '175,26', 'money')).toBe(175.26)
    expect(nextLastValid(3, '51,5', 'count')).toBe(3)
  })

  it('vacío es vacío, no el último valor', () => {
    expect(nextLastValid(175, '', 'money')).toBeNull()
    expect(nextLastValid(175, '   ', 'money')).toBeNull()
  })

  it('lastValidFromDraft lee cada campo de un borrador recién abierto', () => {
    expect(lastValidFromDraft(draftFromRow(ASTRAL))).toEqual({
      adSpendUsd: 175.26,
      messages: 51,
      reach: 8420,
      revenueArs: 2_480_000,
      usdArsRate: 1450,
    })
    expect(lastValidFromDraft(draft({ adSpendUsd: 'abc' })).adSpendUsd).toBeNull()
  })
})

describe('checkMarketingDraft', () => {
  it('Gastado vacío o en 0 manda a «No tuvo pauta»', () => {
    expect(checkMarketingDraft(EMPTY_MARKETING_DRAFT, CTX).fieldErrors).toEqual({
      adSpendUsd: M.spendMissing,
    })
    expect(checkMarketingDraft(draft({ adSpendUsd: '0' }), CTX).fieldErrors.adSpendUsd).toBe(
      M.spendMissing,
    )
    expect(checkMarketingDraft(draft({ adSpendUsd: '0,00' }), CTX).fieldErrors.adSpendUsd).toBe(
      M.spendMissing,
    )
    // `0,001` no es "casi cero": una coma seguida de 3 dígitos separa miles (= 1).
    expect(checkMarketingDraft(draft({ adSpendUsd: '0,001' }), CTX).input?.adSpendUsd).toBe(1)
    expect(checkMarketingDraft(EMPTY_MARKETING_DRAFT, CTX).input).toBeNull()
  })

  it('los errores de lectura, con las palabras del form', () => {
    const check = checkMarketingDraft(
      draft({ adSpendUsd: 'abc', messages: '51,5', reach: '-3' }),
      CTX,
    )
    expect(check.fieldErrors).toEqual({
      adSpendUsd: M.unreadable,
      messages: M.withDecimals,
      reach: M.negative,
    })
  })

  it('los topes salen del schema del server, con sus mismos mensajes', () => {
    expect(checkMarketingDraft(draft({ adSpendUsd: '100.001' }), CTX).fieldErrors).toEqual({
      adSpendUsd: M.spendTooHigh,
    })
    expect(
      checkMarketingDraft(draft({ adSpendUsd: '10', messages: '1.000.001' }), CTX).fieldErrors,
    ).toEqual({ messages: M.countOutOfRange })
  })

  it('facturación y dólar van juntos: el error cae en el que falta', () => {
    const sinDolar = checkMarketingDraft(
      draft({ adSpendUsd: '175,26', revenueOpen: true, revenueArs: '2.480.000' }),
      CTX,
    )
    expect(sinDolar.fieldErrors).toEqual({ usdArsRate: M.rateMissing })

    const sinFacturacion = checkMarketingDraft(
      draft({ adSpendUsd: '175,26', revenueOpen: true, usdArsRate: '1.450' }),
      CTX,
    )
    expect(sinFacturacion.fieldErrors).toEqual({ revenueArs: M.revenueMissing })
  })

  it('una facturación ilegible no le reclama el dólar a nadie: ya tiene su error', () => {
    const check = checkMarketingDraft(
      draft({ adSpendUsd: '175,26', revenueOpen: true, revenueArs: 'mucho' }),
      CTX,
    )
    expect(check.fieldErrors).toEqual({ revenueArs: M.unreadable })
  })

  it('el dólar fuera de rango muestra lo que quedó', () => {
    const check = checkMarketingDraft(
      draft({
        adSpendUsd: '175,26',
        revenueOpen: true,
        revenueArs: '2.480.000',
        usdArsRate: '14,50',
      }),
      CTX,
    )
    expect(check.fieldErrors).toEqual({ usdArsRate: `Revisá el dólar: quedó en $${NBSP}14,50.` })
  })

  it('una facturación en 0 no es una facturación', () => {
    const check = checkMarketingDraft(
      draft({ adSpendUsd: '175,26', revenueOpen: true, revenueArs: '0', usdArsRate: '1.450' }),
      CTX,
    )
    expect(check.fieldErrors).toEqual({ revenueArs: M.revenueOutOfRange })
  })

  it('con la sección cerrada, lo escrito en facturación no viaja', () => {
    const check = checkMarketingDraft(
      draft({ adSpendUsd: '45', revenueOpen: false, revenueArs: 'abc', usdArsRate: '14' }),
      CTX,
    )
    expect(check.fieldErrors).toEqual({})
    expect(check.input?.revenueArs).toBeNull()
    expect(check.input?.usdArsRate).toBeNull()
  })

  it('con la facturación fuera de la vista (fecha futura sin facturación guardada) no viaja', () => {
    const check = checkMarketingDraft(
      draft({
        adSpendUsd: '60',
        messages: '12',
        revenueOpen: true,
        revenueArs: '100.000',
        usdArsRate: '1.450',
      }),
      { ...CTX, revenueVisible: marketingRevenueVisible('future', null) },
    )
    expect(check.fieldErrors).toEqual({})
    expect(check.input).toMatchObject({ adSpendUsd: 60, messages: 12, revenueArs: null })
  })

  it('una edición movida a una fecha futura NO borra en silencio la facturación guardada', () => {
    // Antes: la sección se escondía y el guardado mandaba facturación y dólar en null.
    const check = checkMarketingDraft(draftFromRow(ASTRAL), {
      ...CTX,
      expectedUpdatedAt: ASTRAL.updatedAt,
      revenueVisible: marketingRevenueVisible('future', ASTRAL),
    })
    expect(check.input).toMatchObject({ revenueArs: 2_480_000, usdArsRate: 1450 })
  })

  it('la nota viaja recortada, y vacía es null', () => {
    expect(
      checkMarketingDraft(draft({ adSpendUsd: '45', notes: '  reels  ' }), CTX).input?.notes,
    ).toBe('reels')
    expect(
      checkMarketingDraft(draft({ adSpendUsd: '45', notes: '   ' }), CTX).input?.notes,
    ).toBeNull()
  })

  it('más mensajes que alcance avisa pero no bloquea', () => {
    const check = checkMarketingDraft(draft({ adSpendUsd: '45', messages: '90', reach: '80' }), CTX)
    expect(check.softWarning).toBe(MESSAGES_OVER_REACH_WARNING)
    expect(check.fieldErrors).toEqual({})
    expect(check.input).not.toBeNull()
    expect(
      checkMarketingDraft(draft({ adSpendUsd: '45', messages: '9', reach: '80' }), CTX).softWarning,
    ).toBeNull()
  })

  it('pega desde Meta en cualquier formato', () => {
    const check = checkMarketingDraft(
      draft({ adSpendUsd: 'US$175,26', messages: '51 conversaciones', reach: '8 420' }),
      CTX,
    )
    expect(check.input).toMatchObject({ adSpendUsd: 175.26, messages: 51, reach: 8420 })
  })
})

describe('blockedSaveMessage', () => {
  it('nombra los campos en el orden de la pantalla', () => {
    expect(blockedSaveMessage({})).toBeNull()
    expect(blockedSaveMessage({ messages: 'x' })).toBe('Corregí «Mensajes» para guardar.')
    expect(blockedSaveMessage({ messages: 'x', adSpendUsd: 'y' })).toBe(
      'Corregí «Gastado» y «Mensajes» para guardar.',
    )
    expect(blockedSaveMessage({ reach: 'x', adSpendUsd: 'y', usdArsRate: 'z' })).toBe(
      'Corregí «Gastado», «Alcance» y «Dólar del día» para guardar.',
    )
  })
})

describe('firstEmptyField', () => {
  it('el foco va al primer campo vacío', () => {
    expect(firstEmptyField(EMPTY_MARKETING_DRAFT, true)).toBe('adSpendUsd')
    expect(firstEmptyField(draft({ adSpendUsd: '175,26' }), true)).toBe('messages')
    expect(firstEmptyField(draft({ adSpendUsd: '175,26', messages: '51' }), true)).toBe('reach')
  })

  it('con todo cargado vuelve a Gastado; la facturación cuenta solo si está a la vista', () => {
    const full = draft({ adSpendUsd: '1', messages: '2', reach: '3' })
    expect(firstEmptyField(full, true)).toBe('adSpendUsd')
    expect(firstEmptyField({ ...full, revenueOpen: true }, true)).toBe('revenueArs')
    expect(firstEmptyField({ ...full, revenueOpen: true }, false)).toBe('adSpendUsd')
  })
})

describe('lastRateChipLabel', () => {
  it('dice cuál fue el último dólar y de qué día (hora de Córdoba)', () => {
    // 07/09 a las 23:30 en Córdoba ya es 08/09 en UTC.
    expect(lastRateChipLabel({ rate: 1450, loadedAt: '2026-09-08T02:30:00Z' })).toBe(
      `Usar $${NBSP}1.450 (último, 07/09)`,
    )
    expect(lastRateChipLabel({ rate: 1450.5, loadedAt: 'no-es-fecha' })).toBe(
      `Usar $${NBSP}1.450,50 (último)`,
    )
  })
})

describe('marketingCopy', () => {
  it('cada texto nombra la fecha como la spec', () => {
    const c = marketingCopy('Noche Astral', '2026-09-09')
    expect(c.formLabel).toBe('Pauta en Meta de Noche Astral del 09/09')
    expect(c.editAria).toBe('Editar la pauta de Noche Astral del 09/09')
    expect(c.loadAria).toBe('Cargar pauta de Noche Astral del 09/09')
    expect(c.noAdsAria).toBe('No tuvo pauta: Noche Astral del 09/09')
    expect(c.deleteTitle).toBe('¿Borrar la pauta de Noche Astral del 09/09?')
    expect(c.savedToast).toBe('Pauta de Noche Astral 09/09 guardada.')
    expect(c.deletedToast).toBe('Pauta de Noche Astral 09/09 borrada.')
    expect(c.noAdsToast).toBe('Noche Astral 09/09 quedó sin pauta.')
    expect(c.undoneToast).toBe('Listo: volvió a «Sin cargar».')
  })
})
