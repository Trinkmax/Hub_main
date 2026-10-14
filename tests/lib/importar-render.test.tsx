// @vitest-environment node
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * «Importar» ya dibujado: la bandeja, la subida y la revisión de un archivo.
 * Las cuentas y las palabras tienen sus tests (`imports-ui-*`); acá se cuida lo
 * que solo se ve armado: que la contadora (solo lectura) no reciba NINGÚN botón
 * de carga, respuesta, descarte ni link a subir un archivo; que un dato que
 * falta no salga como «$ 0»; y que cada estado tenga su forma.
 */

const ui = vi.hoisted(() => ({ readOnly: false }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/bar/administracion/importar',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/administracion/accounting-provider', () => {
  const value = () => ({
    tenantSlug: 'bar',
    today: '2026-10-13',
    access: { read: true, write: !ui.readOnly, admin: !ui.readOnly },
    readOnly: ui.readOnly,
    openAction: () => {},
    closeAction: () => {},
  })
  return { useAccounting: value, useAccountingOptional: value }
})
// Las acciones son del servidor: para dibujar no hacen falta.
vi.mock('@/lib/imports/actions', () => ({
  addImportItems: vi.fn(),
  buildImportProposals: vi.fn(),
  cancelImportBatch: vi.fn(),
  createImportBatch: vi.fn(),
  createImportSuppliers: vi.fn(),
  deleteImportRule: vi.fn(),
  postImportProposals: vi.fn(),
  resolveImportNeeds: vi.fn(),
  saveImportLayout: vi.fn(),
  saveImportRule: vi.fn(),
  saveMercadoPagoImportSettings: vi.fn(),
}))
vi.mock('@/lib/imports/review-actions', () => ({
  fetchPostQueue: vi.fn(),
  fetchProposalItemIds: vi.fn(),
  previewImportProposal: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/master', () => ({ saveParty: vi.fn() }))
vi.mock('@/lib/arca/actions', () => ({ lookupCuits: vi.fn() }))
vi.mock('@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-actions', () => ({
  loadPartyItems: vi.fn(),
}))

import {
  HowToBanco,
  HowToMercadoPago,
  HowToMisComprobantes,
} from '@/components/administracion/guias/how-to'
import { BankImport } from '@/components/administracion/importar/bank-import'
import { ArcaRulesCard, BankRulesCard } from '@/components/administracion/importar/bank-rules-card'
import { ImportHistory } from '@/components/administracion/importar/import-history'
import { ImportUploader } from '@/components/administracion/importar/import-uploader'
import {
  HistoryEmpty,
  HistoryList,
  type HistoryRow,
} from '@/components/administracion/importar/inbox/history-list'
import { HowItWorks } from '@/components/administracion/importar/inbox/how-it-works'
import { AgendaLine, NextUp } from '@/components/administracion/importar/inbox/next-up'
import { ImportTray } from '@/components/administracion/importar/inbox/tray'
import { MpSettingsCard } from '@/components/administracion/importar/mp-settings-card'
import { StillManual } from '@/components/administracion/importar/page-bits'
import { BalanceCheck } from '@/components/administracion/importar/review/balance-check'
import { MoreOptions } from '@/components/administracion/importar/review/more-options'
import { MpInsights } from '@/components/administracion/importar/review/mp-insights'
import { NeedQuestion } from '@/components/administracion/importar/review/need-block'
import { NewSuppliers } from '@/components/administracion/importar/review/new-suppliers'
import { PaperPile, pileSheets } from '@/components/administracion/importar/review/paper-pile'
import { PostBar } from '@/components/administracion/importar/review/post-bar'
import {
  ProposalList,
  QuestionDeck,
  TeachHost,
} from '@/components/administracion/importar/review/proposal-list'
import { ProposalOpened } from '@/components/administracion/importar/review/proposal-row'
import {
  type ReviewOptions,
  ReviewProvider,
} from '@/components/administracion/importar/review/review-context'
import { ReviewHero } from '@/components/administracion/importar/review/review-hero'
import type { ProposalView } from '@/components/administracion/importar/review/types'
import {
  InboxSkeleton,
  ReviewPageSkeleton,
  UploadPageSkeleton,
} from '@/components/administracion/importar/skeletons'
import { ArrivalTicket } from '@/components/administracion/importar/upload/arrival-ticket'
import { UploadProgress } from '@/components/administracion/importar/upload/upload-progress'
import { WantRange } from '@/components/administracion/importar/upload/want-range'
import type { ImportBatchCounts, ImportNeed } from '@/lib/imports/server/types'
import { filterCounts } from '@/lib/imports/ui/filters'
import { buildInbox, type InboxBatch } from '@/lib/imports/ui/inbox'
import { mpCut, mpDays } from '@/lib/imports/ui/mp-insights'
import { reviewHero, reviewTally } from '@/lib/imports/ui/review-copy'
import type { UploadPlan } from '@/lib/imports/ui/upload'

afterEach(() => {
  ui.readOnly = false
})

const NB = String.fromCharCode(160)
const html = (node: ReactNode) => renderToStaticMarkup(node).replaceAll(NB, ' ')
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** Rutas de subida: quien solo lee no tiene que recibir ningún link a ellas. */
const UPLOAD_LINK = /href="\/bar\/administracion\/importar\/(arca|mercado-pago|banco)[#"]/
/** Palabras de los botones que cargan, contestan, descartan o enseñan. */
const WRITE_WORDS =
  /Cargar \d|Cargar los|Guardar|>Elegir<|Reintentar|No es nuestro|Volver a incluirlo|Volver a cargar|Descartar este archivo|Volver a armar|Seguir revisando|Subir |Terminar de subirlo|Enseñarme|Sacarlo de este archivo|Cargarlo a mano|Es otro: cargalo|Sí: es|Son todos nuevos|Contar /

const ZERO: ImportBatchCounts = {
  items: 0,
  new: 0,
  duplicate: 0,
  ignored: 0,
  review: 0,
  postedItems: 0,
  cancelled: 0,
  proposals: 0,
  needsInput: 0,
  ready: 0,
  posting: 0,
  posted: 0,
  stale: 0,
  error: 0,
  skipped: 0,
  voided: 0,
}

const BATCHES: InboxBatch[] = [
  {
    id: ID(1),
    source: 'arca_recibidos',
    status: 'posting',
    periodFrom: '2026-09-01',
    periodTo: '2026-09-30',
    pending: 3,
    counts: { ...ZERO, proposals: 23, posted: 18, skipped: 2, needsInput: 3 },
    createdAt: '2026-10-08T15:00:00Z',
  },
  {
    id: ID(2),
    source: 'mp_release',
    status: 'done',
    periodFrom: '2026-10-07',
    periodTo: '2026-10-08',
    pending: 0,
    counts: { ...ZERO, proposals: 6, posted: 5, skipped: 1 },
    createdAt: '2026-10-08T15:10:00Z',
  },
]

const inboxOf = (
  canWrite: boolean,
  treasuries = [{ id: 'w', name: 'Mercado Pago', kind: 'wallet' }],
) =>
  buildInbox({
    today: '2026-10-13',
    batches: BATCHES,
    treasuries,
    booksStartDate: '2026-09-01',
    hasCuit: false,
    canWrite,
    slug: 'bar',
  })

const HISTORY: HistoryRow[] = [
  {
    ...(BATCHES[0] as InboxBatch),
    origin: 'upload',
    fileName: 'comprobantes_recibidos_septiembre_2026_un_nombre_muy_largo_de_archivo.zip',
    createdByName: 'Luz',
  },
  {
    id: ID(9),
    source: 'arca_recibidos',
    origin: 'api',
    fileName: null,
    periodFrom: '2026-10-08',
    periodTo: '2026-10-10',
    status: 'review',
    pending: 0,
    counts: { ...ZERO, items: 4, proposals: 4, skipped: 4 },
    createdByName: '',
    createdAt: '2026-10-12T16:11:00Z',
  },
]

describe('la bandeja', () => {
  const bandeja = (canWrite: boolean) => {
    const inbox = inboxOf(canWrite)
    return html(
      <>
        {canWrite && inbox.next ? <NextUp next={inbox.next} /> : null}
        {inbox.trays.map((tray) => (
          <ImportTray key={tray.source} tray={tray} />
        ))}
        <HistoryList slug="bar" rows={HISTORY} today="2026-10-13" />
      </>,
    )
  }

  it('el dueño ve lo que toca, con UN botón principal, y las tres bandejas', () => {
    const out = bandeja(true)
    expect(out).toContain('Te toca')
    expect(out).toContain('Las compras de septiembre tienen 3 comprobantes con una pregunta.')
    expect(out).toContain('Seguir revisando')
    expect(out).toMatch(UPLOAD_LINK)
    expect(out).toContain('¿Cómo se baja?')
    for (const name of ['ARCA', 'Mercado Pago', 'Banco']) expect(out).toContain(`>${name}</h2>`)
  })

  it('la contadora ve las bandejas y el historial, sin un solo botón ni link para subir', () => {
    const out = bandeja(false)
    expect(out).not.toContain('<button')
    expect(out).not.toMatch(UPLOAD_LINK)
    expect(out).not.toMatch(WRITE_WORDS)
    expect(out).not.toContain('¿Cómo se baja?')
    expect(out).not.toContain('Te toca')
    // Lo que sí ve: lo que falta, la tira, las hojas que esperan y cada archivo.
    expect(out).toContain('Al día')
    expect(out).toContain('Sin subir')
    expect(out).toContain('Para revisar')
    expect(out).toContain(`href="/bar/administracion/importar/${ID(1)}"`)
  })

  it('cada bandeja tiene su forma: al día, nunca usada y trabada', () => {
    const inbox = inboxOf(true)
    const [arca, mp, bank] = inbox.trays.map((tray) => html(<ImportTray tray={tray} />))
    // ARCA: el héroe, la tira de meses y la hoja que espera adentro de la bandeja.
    expect(arca).toContain('Al día')
    expect(arca).toContain('Octubre se baja desde el 11/11.')
    expect(arca).toContain('aria-label="Archivos que esperan"')
    expect(arca).toContain('3 con una pregunta')
    expect(arca).toContain('Sin el CUIT del bar no puedo chequear que el archivo sea tuyo.')
    // Mercado Pago: lo que falta en grande, con su unidad pegada (nunca dos números sueltos).
    expect(mp).toMatch(/>4<\/span><span[^>]*>días<\/span>/)
    expect(mp).toContain('role="img"')
    // Banco sin cuenta: trabada, con el botón que la destraba.
    expect(bank).toContain('border-dashed')
    expect(bank).toContain('Primero decime cuál es tu cuenta del banco.')
    expect(bank).toContain('Agregar la cuenta')
    expect(bank).not.toContain('¿Cómo se baja?')
  })

  it('la bandeja que nunca se usó enseña qué va a llegar', () => {
    const inbox = buildInbox({
      today: '2026-10-13',
      batches: [],
      treasuries: [{ id: 'w', name: 'Mercado Pago', kind: 'wallet' }],
      booksStartDate: '2026-10-12',
      hasCuit: true,
      canWrite: true,
      slug: 'bar',
    })
    const mp = html(<ImportTray tray={inbox.trays[1] as (typeof inbox.trays)[number]} />)
    expect(mp).toContain('Todavía no subiste nada')
    expect(mp).toContain('Subir el primer reporte')
    expect(mp).not.toContain('$ 0')
    const top = html(<HowItWorks startNote={inbox.startNote} agenda={inbox.agenda} />)
    expect(top).toContain('Bajalo de allá')
    expect(top).toContain('Subilo acá')
    expect(top).toContain('Revisá y cargá')
    expect(top).toContain('Tus números arrancan el 12/10: todavía no hay nada atrasado.')
    expect(html(<AgendaLine agenda={inbox.agenda} />)).toContain('Estás al día.')
  })

  it('el historial dice en qué quedó cada archivo, en palabras', () => {
    const out = html(<HistoryList slug="bar" rows={HISTORY} today="2026-10-13" />)
    expect(out).toContain('Septiembre')
    expect(out).toContain('lo subió Luz')
    expect(out).toContain('18 cargados · 3 para revisar · 2 no van')
    expect(out).toContain('A medio cargar')
    // El archivo «eterno»: todo descartado ya no figura «Para revisar».
    expect(out).toContain('Nada para cargar')
    expect(out).toContain('ARCA · automática')
    expect(out).toContain('08/10 – 10/10')
    // El nombre largo del archivo se corta con «…» y queda entero en el `title`.
    expect(out).toContain('class="block truncate"')
  })

  it('la tabla de la contadora lleva los títulos en castellano', () => {
    const out = html(
      <ImportHistory
        slug="bar"
        rows={HISTORY}
        today="2026-10-13"
        olderHref={null}
        newestHref={null}
      />,
    )
    for (const head of [
      'Subido',
      'Origen',
      'Período',
      'Renglones del archivo',
      'Cargados',
      'Pendientes',
      'Estado',
    ]) {
      expect(out).toContain(`>${head}</th>`)
    }
    expect(out).not.toMatch(/>Filas<|>Repetidas</)
    expect(out).not.toContain('<button')
    expect(html(<HistoryEmpty newestHref={null} reader />)).toContain(
      'Todavía no se subió ningún archivo',
    )
    expect(html(<HistoryEmpty newestHref={null} />)).toContain('Todavía no subiste ningún archivo')
  })

  it('«lo que no viene en ningún archivo» usa el nombre que cada destino tiene en su pantalla', () => {
    const out = html(<StillManual slug="bar" />)
    for (const label of [
      'Cerrar el día',
      'Pagué algo recién',
      'Me entró plata',
      'Cargar una compra que debo',
      'Sueldos del mes',
    ]) {
      expect(out).toContain(label)
    }
    expect(out).toContain('href="/bar/administracion/libros/asiento-manual?tipo=sueldos"')
    expect(out).toContain('Queda registrado igual.')
    expect(out).not.toMatch(/en negro|en blanco|afuera/i)
  })

  it('los esqueletos tienen la forma de cada pantalla', () => {
    expect(html(<InboxSkeleton />)).toContain('Cargando Importar…')
    expect(html(<UploadPageSkeleton label="la subida" extraCard />)).toContain(
      'Cargando la subida…',
    )
    expect(html(<ReviewPageSkeleton />)).toContain('Cargando la revisión…')
  })
})

describe('subir un archivo', () => {
  const wanted = {
    from: '2026-10-09',
    to: '2026-10-12',
    sentence: 'Desde el día siguiente a lo último que subiste, hasta ayer.',
    extra: 'Si querés completar lo de antes, pedí también del 01/09 al 06/10.',
  }

  it('«Qué pedir»: dos fichas, cada fecha con su rótulo adentro', () => {
    const out = html(<WantRange wanted={wanted} />)
    expect(out).toMatch(/Desde<\/dt><dd[^>]*>09\/10\/2026</)
    expect(out).toMatch(/Hasta<\/dt><dd[^>]*>12\/10\/2026</)
    expect(out).toContain('Si se pisan las fechas no pasa nada: lo que ya subiste no se repite.')
    const none = html(
      <WantRange
        wanted={{ from: null, to: null, sentence: 'Ya subiste hasta ayer.', extra: null }}
      />,
    )
    expect(none).not.toContain('Desde')
    expect(none).toContain('Ya subiste hasta ayer.')
  })

  it('los tres pasos están a la vista, con la ranura y su botón «Elegir archivo»', () => {
    const out = html(
      <ImportUploader
        slug="bar"
        context={{ source: 'arca_recibidos', sasCuit: null }}
        howTo={<HowToMisComprobantes bare />}
        wanted={wanted}
        firstTime={false}
        booksStartDate="2026-09-01"
      />,
    )
    for (const step of ['Bajalo de ARCA', 'Subilo acá', 'Revisá y cargá'])
      expect(out).toContain(step)
    expect(out).toContain('Soltá acá el ZIP que bajaste de ARCA')
    expect(out).toContain('Elegir archivo')
    // Quien ya subió algo arranca en el paso 2, con el paso 1 plegado y su resumen.
    expect(out).toContain('Pedí del 09/10 al 12/10')
    expect(out).toContain('Ver cómo se baja')
    expect(out).toContain('id="paso-1"')
    expect(out).toContain('id="paso-2"')
  })

  it('la primera vez arranca en «Bajalo de allá», con el cómo a la vista', () => {
    const out = html(
      <ImportUploader
        slug="bar"
        context={{ source: 'mp_release', sasCuit: null, ownCbus: [], cutoffHour: 0 }}
        howTo={<HowToMercadoPago bare />}
        wanted={wanted}
        firstTime
        booksStartDate={null}
      />,
    )
    expect(out).toContain('Bajalo de Mercado Pago')
    expect(out).toContain('Ya lo tengo: seguir')
    expect(out).toContain('Lo hago después')
    expect(out).toContain('Crear reporte')
    // El paso 2 todavía no se abrió: no hay ranura.
    expect(out).not.toContain('Elegir archivo')
  })

  it('el banco sin ninguna cuenta enseña el paso que falta en vez de una ranura trabada', () => {
    const out = html(
      <BankImport
        slug="bar"
        banks={[]}
        layouts={[]}
        ajustesHref="/bar/administracion/ajustes?tab=cajas"
        howTo={<HowToBanco bare />}
        wanted={wanted}
        firstTime
        booksStartDate={null}
      />,
    )
    expect(out).toContain('Falta decir cuál es tu cuenta del banco')
    expect(out).toContain('Agregar la cuenta')
    expect(out).not.toContain('Elegir archivo')
  })

  it('con una sola cuenta del banco ya viene elegida', () => {
    const out = html(
      <BankImport
        slug="bar"
        banks={[{ id: ID(3), name: 'Banco Nación', kind: 'bank', balanceCents: 4_201_342_770 }]}
        layouts={[]}
        ajustesHref="/x"
        howTo={<HowToBanco bare />}
        wanted={wanted}
        firstTime={false}
        booksStartDate={null}
      />,
    )
    expect(out).toContain('¿De qué cuenta es?')
    expect(out).toContain('Banco Nación')
    expect(out).toContain('Soltá acá lo que exportaste del banco')
    expect(out).not.toContain('Elegí primero de qué cuenta es.')
  })

  it('los «cómo se baja» con `bare` van sin plegable; sin `bare`, igual que siempre', () => {
    for (const HowTo of [HowToMisComprobantes, HowToMercadoPago, HowToBanco]) {
      const bare = html(<HowTo bare />)
      expect(bare).not.toContain('<details class="card-hairline')
      expect(bare).not.toContain('¿Cómo lo bajo?')
      expect(bare).toContain('<ol')
      const folded = html(<HowTo />)
      expect(folded).toContain('¿Cómo lo bajo?')
      expect(folded).toContain('<details')
    }
  })

  const base: UploadPlan = {
    source: 'arca_recibidos',
    fileName: 'comprobantes.zip',
    fileSize: 1024,
    detectedFormat: 'mc_g3',
    periodFrom: '2026-09-01',
    periodTo: '2026-09-30',
    meta: {},
    rows: Array.from({ length: 23 }, (_, i) => ({
      rowNo: i,
      naturalKey: `k${i}`,
      data: {},
      issues: [],
    })),
    title: '23 comprobantes de compras',
    facts: [],
    rowErrors: [],
    notices: [],
  }

  it('«Llegó esto» de ARCA: el sello, los proveedores más grandes y el total', () => {
    const out = html(
      <ArrivalTicket
        plan={{
          ...base,
          figures: {
            items: 23,
            creditNotes: 1,
            suppliers: 14,
            topSuppliers: [
              'Distribuidora de Bebidas Demo SA',
              'Carnicería Demo SRL',
              'Limpieza Demo SA',
            ],
            totalCents: 524_493_500,
            foreignCurrency: 1,
            otherCuit: 2,
          },
        }}
        beforeStart={0}
        booksStartDate="2026-09-01"
      />,
    )
    expect(out).toContain('Llegó esto')
    expect(out).toContain('Con factura')
    expect(out).toContain('1 es nota de crédito')
    expect(out).toContain(
      'Los más grandes: Distribuidora de Bebidas Demo SA, Carnicería Demo SRL y Limpieza Demo SA',
    )
    expect(out).toContain('$ 5.244.935,00')
    expect(out).toContain('1 está en otra moneda')
    expect(out).toContain('2 están a nombre de otra persona')
  })

  it('«Llegó esto» del banco: la cuenta a la vista, y sin saldos no inventa un $ 0', () => {
    const bank = { ...base, source: 'bank_statement' as const, fileName: 'movimientos.csv' }
    const full = html(
      <ArrivalTicket
        plan={{
          ...bank,
          figures: {
            items: 14,
            openingCents: 99_999_999_900,
            inCents: 41_750_000_000,
            outCents: 12_426_840,
            closingCents: 4_201_342_770,
            balance: 'ok',
            guessed: 2,
          },
        }}
        beforeStart={0}
        booksStartDate={null}
      />,
    )
    for (const label of ['Saldo al empezar', '+ Entró', '− Salió', 'Saldo al terminar']) {
      expect(full).toContain(label)
    }
    expect(full).toContain('$ 999.999.999,00')
    expect(full).toContain('La cuenta cierra con lo que dice el archivo.')
    expect(full).toContain('En 2 movimientos no sé bien si entró o salió')
    expect(full).not.toContain('Con factura')

    const noBalance = html(
      <ArrivalTicket
        plan={{
          ...bank,
          figures: {
            items: 3,
            inCents: 100,
            outCents: 200,
            openingCents: null,
            closingCents: null,
            balance: null,
          },
        }}
        beforeStart={0}
        booksStartDate={null}
      />,
    )
    expect(noBalance).not.toContain('Saldo al empezar')
    expect(noBalance).not.toContain('Saldo al terminar')
    expect(noBalance).not.toMatch(/\$ 0[,<]/)
  })

  it('avisa antes de subir lo que es de antes del arranque', () => {
    const some = html(
      <ArrivalTicket
        plan={{ ...base, figures: { items: 23 } }}
        beforeStart={4}
        booksStartDate="2026-10-12"
      />,
    )
    expect(some).toContain(
      '4 son de antes del 12/10, cuando arrancan tus números: esos no se van a poder cargar (lo de antes va en los saldos iniciales).',
    )
    const all = html(
      <ArrivalTicket
        plan={{ ...base, figures: { items: 23 } }}
        beforeStart={23}
        booksStartDate="2026-10-12"
      />,
    )
    expect(all).toContain('Este archivo es todo de antes del 12/10. No hay nada para cargar.')
  })

  it('mientras sube se ven los tres momentos y que todavía no se cargó nada', () => {
    const out = html(<UploadProgress source="arca_recibidos" step="rows" done={230} total={500} />)
    expect(out).toContain('Abro la carpeta de este archivo')
    expect(out).toContain('Guardo los renglones (230 de 500)')
    expect(out).toContain('Armo los comprobantes con tus proveedores')
    expect(out).toContain('No cierres esta pestaña. Todavía no se carga nada.')
    expect(out.match(/\(hecho\)/g)?.length).toBe(1)
    expect(out.match(/\(falta\)/g)?.length).toBe(1)
  })

  const mpSettings = {
    connection: null,
    effective: {
      treasuryId: ID(4),
      partyId: ID(5),
      channelMethods: { qr: ID(11) },
      inferred: ['qr' as const],
    },
    wallets: [{ id: ID(4), name: 'Mercado Pago', hasCvu: false }],
    methods: [
      { id: ID(11), name: 'QR Mercado Pago', kind: 'qr', partyId: ID(5) },
      { id: ID(12), name: 'Transferencia', kind: 'transfer', partyId: null },
    ],
    ownAccounts: 0,
  }

  it('«Antes de empezar» de Mercado Pago: tres preguntas, sin un desplegable a la vista', () => {
    const out = html(<MpSettingsCard slug="bar" settings={mpSettings} ajustesHref="/x" />)
    expect(out).toContain('Antes de empezar, una sola vez')
    expect(out).toContain('¿Cuál es tu cuenta de Mercado Pago?')
    expect(out).toContain('¿Cómo llamás a cada cobro en tu cierre del día?')
    expect(out).toContain('Lo que cobrás después de medianoche, ¿de qué día es?')
    expect(out).toContain('Mercado Pago le dice')
    expect(out).toContain('Lo deduje por el nombre: fijate.')
    expect(out).toContain('De la noche anterior (hasta las 5 a. m.)')
    expect(out).not.toContain('role="combobox"')
    // La cuenta única ya viene elegida (rellena).
    expect(out).toMatch(/aria-pressed="true"[^>]*>(<[^>]+>)*<span>Mercado Pago<\/span>/)
  })

  it('ya guardado, queda en una línea con «Cambiar»', () => {
    const out = html(
      <MpSettingsCard
        slug="bar"
        ajustesHref="/x"
        settings={{
          ...mpSettings,
          connection: {
            treasuryAccountId: ID(4),
            channelMethods: { qr: ID(11) },
            dayCutoffHour: 5,
            updatedAt: '2026-10-12T15:00:00+00:00',
          },
        }}
      />,
    )
    expect(out).toContain('Cómo leo tu Mercado Pago:')
    expect(out).toContain('QR → QR Mercado Pago')
    expect(out).toContain('Point, Transferencias y Link de pago → no los uso')
    expect(out).toContain('noche anterior (hasta las 5 a. m.)')
    expect(out).toContain('Cambiar')
    expect(out).not.toContain('Antes de empezar, una sola vez')
  })

  it('«Lo que ya sé reconocer» arranca plegado, con cuántas cosas enseñó el bar', () => {
    const bank = html(
      <BankRulesCard
        slug="bar"
        options={{ parties: [], accounts: [], treasuries: [] }}
        rules={[
          {
            id: ID(20),
            priority: 100,
            label: 'Luz del local',
            pattern: 'DEBAUT SERVICIO LUZ',
            counterpartyCuit: null,
            direction: 'debit',
            kind: 'movement',
            component: null,
            accountId: null,
            partyId: null,
            treasuryId: null,
            active: true,
            serverSafe: true,
            updatedAt: null,
          },
        ]}
      />,
    )
    expect(bank).toContain('Lo que ya sé reconocer')
    expect(bank).toContain('1 cosa tuya')
    expect(bank).toContain('aria-expanded="false"')
    expect(bank).not.toContain('Enseñarme algo nuevo')
    // Sin nada enseñado de ARCA, no se dibuja.
    expect(html(<ArcaRulesCard slug="bar" rules={[]} />)).toBe('')
  })
})

// ─── La revisión ─────────────────────────────────────────────────────────────

const OPTIONS: ReviewOptions = {
  parties: [
    { id: ID(31), name: 'Limpieza Demo SA', taxId: '30705556667', active: true, kind: 'supplier' },
    {
      id: ID(32),
      name: 'Hielo Polar',
      taxId: null,
      active: true,
      kind: 'supplier',
      updatedAt: '2026-10-12T15:00:00+00:00',
    },
  ],
  accounts: [
    {
      id: ID(40),
      code: '5.1',
      name: 'Compras',
      postable: false,
      active: true,
      parentId: null,
      purchase: false,
      treasury: false,
      type: 'expense',
    },
    {
      id: ID(41),
      code: '5.1.01',
      name: 'Compras: bebidas con alcohol',
      postable: true,
      active: true,
      parentId: ID(40),
      purchase: true,
      treasury: false,
      type: 'expense',
      systemKey: 'purchases_alcohol',
    },
  ],
  treasuries: [{ id: ID(50), name: 'Caja', kind: 'cash', balanceCents: 39_475_700, active: true }],
  methods: [{ id: ID(11), name: 'QR Mercado Pago' }],
  iibbJurisdictionCode: 904,
}

function proposal(over: Partial<ProposalView> & { needs?: ImportNeed[] }): ProposalView {
  return {
    key: 'mc:30705556667:1:2:61',
    form: 'purchase',
    status: 'needs_input',
    previewHash: null,
    summary: {
      kind: 'purchase',
      date: '2026-09-15',
      month: null,
      label: 'Factura A 0002-00000061',
      counterparty: 'Limpieza Demo SA',
      total_cents: 11_858_000,
      item_count: 1,
      detail: { code: 1, cuit: '30705556667', currency: 'ARS' },
    },
    needs: [{ key: 'supplier_account', party_id: ID(31) }],
    warningsAck: [],
    documentId: null,
    error: null,
    partyId: ID(31),
    hasDecisions: false,
    hasValues: false,
    ...over,
  }
}

const ROWS: ProposalView[] = [
  proposal({}),
  proposal({
    key: 'mc:2',
    summary: {
      kind: 'purchase',
      date: '2026-09-23',
      month: null,
      label: 'Factura A 0002-00003455',
      counterparty: 'Cervecería Artesanal Sierras SRL',
      total_cents: 59_520_000,
      item_count: 1,
    },
    needs: [{ key: 'other_taxes_as', party_id: ID(31), amount_cents: 1_440_000 }],
  }),
  proposal({
    key: 'mc:3',
    needs: [{ key: 'engine_error', error_key: 'date_before_start', message: 'x', field: null }],
  }),
]

function review(
  node: ReactNode,
  opts: { editable: boolean; source?: 'arca_recibidos' | 'bank_statement' },
) {
  ui.readOnly = !opts.editable
  return html(
    <ReviewProvider
      slug="bar"
      batchId={ID(1)}
      source={opts.source ?? 'arca_recibidos'}
      editable={opts.editable}
      canWrite={opts.editable}
      options={opts.editable ? OPTIONS : null}
      booksStartDate="2026-10-12"
    >
      {node}
    </ReviewProvider>,
  )
}

describe('revisar un archivo', () => {
  const byStatus = { needs_input: 3, posted: 18, skipped: 2 }
  const tally = reviewTally(byStatus, 2)
  const hero = (
    <ReviewHero
      hero={reviewHero({ source: 'arca_recibidos', tally, readyCents: 0 })}
      tally={tally}
      unit="comprobantes"
      active="revisar"
      counts={filterCounts(byStatus)}
      hrefFor={(q) => `/bar/administracion/importar/x?ver=${q.ver}`}
    />
  )

  it('arriba: el número de la tarea con su unidad, la pila y las vistas', () => {
    const out = html(hero)
    expect(out).toContain('Te falta contestar')
    expect(out).toMatch(/>3<\/span><span[^>]*>de 23 comprobantes<\/span>/)
    expect(out).toContain('18 ya se cargaron y 2 ya estaban cargados.')
    // Una hojita por comprobante.
    expect(out.match(/viewBox="0 0 14 18"/g)?.length).toBeGreaterThanOrEqual(23)
    // Las vistas: la activa marcada, la que está en cero apagada y sin link.
    expect(out).toContain('aria-current="page"')
    expect(out).toContain('Con una pregunta')
    expect(out).toMatch(/aria-disabled="true"[^>]*>.*Listos/)
    expect(out).not.toContain('?ver=listas')
    expect(out).toContain('?ver=cargadas')
  })

  it('la pila: hasta 120 hojas una por comprobante; con más, cada hoja vale varios y se dice', () => {
    expect(pileSheets({ ...tally }).each).toBe(1)
    const big = { questions: 10, ready: 1, posted: 1380, already: 9, out: 0, total: 1400 }
    const sheets = pileSheets(big)
    expect(sheets.each).toBe(12)
    // Ningún grupo con algo se queda sin su hoja.
    expect(sheets.groups.find((g) => g.group === 'ready')?.sheets).toBe(1)
    expect(sheets.groups.find((g) => g.group === 'out')?.sheets).toBe(0)
    expect(html(<PaperPile tally={big} unit="comprobantes" />)).toContain(
      'Cada hoja son 12 comprobantes.',
    )
    expect(
      html(
        <PaperPile
          tally={{ questions: 0, ready: 0, posted: 0, already: 0, out: 0, total: 0 }}
          unit="comprobantes"
        />,
      ),
    ).toBe('')
  })

  it('la pregunta en la mano: una pregunta en criollo, con su papel al lado y las que siguen', () => {
    const out = review(<QuestionDeck rows={ROWS} offset={0} total={3} />, { editable: true })
    expect(out).toContain('Pregunta 1 de 3 · En qué le comprás')
    expect(out).toContain('¿En qué le comprás a Limpieza Demo SA?')
    expect(out).toContain('Bebidas con alcohol')
    expect(out).toContain('>Guardar<')
    expect(out).toContain('No es nuestro')
    // El papel: lo que trae ARCA lleva el sello «Con factura».
    expect(out).toContain('Con factura')
    expect(out).toContain('30-70555666-7')
    expect(out).toContain('Las que siguen')
    expect(out).toContain('Cervecería Artesanal Sierras SRL')
    expect(out).toContain('Otros impuestos')
    // Una sola pregunta abierta por vez.
    expect(out.match(/Pregunta \d de 3/g)?.length).toBe(1)
  })

  it('lo anterior al arranque tiene salida, sin mandar a cargarlo a mano', () => {
    const out = review(<QuestionDeck rows={[ROWS[2] as ProposalView]} offset={0} total={1} />, {
      editable: true,
    })
    expect(out).toContain(
      'Esto es de antes del 12/10, cuando arrancan tus números. Acá no se puede cargar.',
    )
    expect(out).toContain('Sacarlo de este archivo')
    expect(out).toContain('Ir a los saldos iniciales')
    expect(out).not.toContain('Cargarlo a mano')
  })

  it('en el banco, «¿A quién le pagaste?» ofrece enseñarlo para la próxima', () => {
    const bank = proposal({
      key: 'bank:1',
      form: 'payment',
      summary: {
        kind: 'bank_payment',
        date: '2026-10-07',
        month: null,
        label: 'DEBAUT EXPENSAS',
        counterparty: null,
        total_cents: 18_640_000,
        item_count: 1,
        detail: { direction: 'debit' },
      },
      needs: [{ key: 'pick_party', role: 'supplier', suggested_party_id: ID(32) }],
      partyId: null,
    })
    const out = review(<QuestionDeck rows={[bank]} offset={0} total={1} />, {
      editable: true,
      source: 'bank_statement',
    })
    expect(out).toContain('¿A quién le pagaste?')
    expect(out).toContain('Sí: es Hielo Polar')
    expect(out).toContain('Es otro…')
    expect(out).toContain('¿Pasa todas las semanas? Enseñame a reconocerlo')
    expect(out).toContain('Salió')
    expect(out).not.toContain('Con factura')
  })

  it('las demás vistas son renglones cerrados; «No se cargan» va agrupado', () => {
    const rows = [
      proposal({ key: 'a', status: 'skipped', error: { reason: 'already_loaded' }, needs: [] }),
      proposal({ key: 'b', status: 'skipped', error: { reason: 'ignored' }, needs: [] }),
      proposal({ key: 'c', status: 'voided', needs: [] }),
    ]
    const out = review(<ProposalList rows={rows} label="No se cargan" grouped />, {
      editable: true,
    })
    for (const title of ['Ya estaban cargados', 'Dijiste que no son nuestros', 'No van']) {
      expect(out).toContain(title)
    }
    expect(out).toContain('Ya está cargado')
    expect(out).toContain('Anulado')
    // Cerrados: la acción de cada uno aparece recién al abrirlo.
    expect(out).not.toContain('Volver a incluirlo')
    expect(out.match(/aria-expanded="false"/g)?.length).toBe(3)
  })

  it('la contadora ve la lista y qué falta, sin respuestas ni botones de carga', () => {
    const out = review(
      <>
        {hero}
        <ProposalList rows={ROWS} label="Con una pregunta" />
        <PostBar
          readyCount={18}
          readyCents={524_493_500}
          months={[{ month: '2026-09', count: 18, totalCents: 524_493_500 }]}
          movedToOpenMonth={0}
          warnings={{}}
          unit={['comprobante', 'comprobantes']}
          showMoney
          pendingAnswers={3}
        />
        <BalanceCheck
          who="el banco"
          periodTo="2026-10-07"
          reportCents={4_201_342_770}
          book={{ treasuryId: ID(50), name: 'Banco Nación', balanceCents: 4_186_342_770 }}
          movementsHref={`/bar/administracion/cajas/${ID(50)}`}
        />
        <NewSuppliers
          lookup={null}
          connectHref="/bar/administracion/ajustes/arca"
          rows={[
            {
              cuit: '30712345671',
              name: 'HIELO POLAR SRL',
              suggestedCondition: 'responsable_inscripto',
              suggestedAccountId: null,
              vouchers: 3,
              totalCents: 12_000_000,
            },
          ]}
        />
      </>,
      { editable: false },
    )
    expect(out).not.toMatch(WRITE_WORDS)
    expect(out).not.toContain('id="cargar"')
    expect(out).not.toContain('<input')
    expect(out).not.toContain('<select')
    // Los únicos botones son los que abren un renglón para leerlo.
    const buttons = out.match(/<button[^>]*>/g) ?? []
    expect(buttons.length).toBe(ROWS.length)
    for (const button of buttons) expect(button).toContain('aria-expanded')
    // Lo que sí ve.
    expect(out).toContain('Te falta contestar')
    expect(out).toContain('Proveedores que faltan reconocer (1)')
    expect(out).toContain('Hay $ 150.000,00 de diferencia con el banco')
    expect(out).toContain('Ver los movimientos de Banco Nación')
  })

  it('el dueño sí: la barra para cargar, «¿Los tenés de antes?» y «Contar {caja}»', () => {
    const out = review(
      <>
        <PostBar
          readyCount={18}
          readyCents={524_493_500}
          months={[]}
          movedToOpenMonth={0}
          warnings={{}}
          unit={['comprobante', 'comprobantes']}
          showMoney
          pendingAnswers={3}
        />
        <BalanceCheck
          who="el banco"
          periodTo="2026-10-07"
          reportCents={4_201_342_770}
          book={{ treasuryId: ID(50), name: 'Banco Nación', balanceCents: 4_186_342_770 }}
          movementsHref="/x"
        />
        <NewSuppliers
          lookup={null}
          connectHref="/bar/administracion/ajustes/arca"
          rows={[
            {
              cuit: '30712345671',
              name: 'HIELO POLAR SRL',
              suggestedCondition: 'responsable_inscripto',
              suggestedAccountId: ID(41),
              vouchers: 3,
              totalCents: 12_000_000,
            },
          ]}
        />
        <MoreOptions slug="bar" batchId={ID(1)} posted={18} />
      </>,
      { editable: true },
    )
    expect(out).toContain('id="cargar"')
    // Con preguntas sin contestar el botón no compite con la respuesta.
    expect(out).toContain('Cargar los 18 que ya están')
    expect(out).toContain('18 listos')
    expect(out).toContain('$ 5.244.935')
    expect(out).toContain('Contar Banco Nación')
    // «¿Lo tenés de antes?»: el parecido se ofrece como respuesta y nunca viene elegido.
    expect(out).toContain('¿A este lo tenés de antes?')
    expect(out).toContain('¿Lo tenés de antes?')
    expect(out).toContain('Sí: es Hielo Polar')
    expect(out).toContain('Sí, es otro…')
    expect(out).toContain('No, es nuevo')
    expect(out).toContain('Lo dejo para después')
    expect(out).toMatch(/aria-pressed="false"[^>]*>(<[^>]+>)*<span>Sí: es Hielo Polar/)
    expect(out).toContain('Guardar las respuestas')
    expect(out).toContain('Más opciones')
    expect(out).toContain('Volver a armar con los datos de hoy')
    expect(out).toContain('Descartar este archivo')
  })

  it('sin proveedores sin CUIT a los que parecerse, la fila abre directo en la categoría', () => {
    const noLink = { ...OPTIONS, parties: [OPTIONS.parties[0] as ReviewOptions['parties'][number]] }
    ui.readOnly = false
    const out = html(
      <ReviewProvider
        slug="bar"
        batchId={ID(1)}
        source="arca_recibidos"
        editable
        canWrite
        options={noLink}
      >
        <NewSuppliers
          lookup={null}
          connectHref="/x"
          rows={[
            {
              cuit: '30712345671',
              name: 'HIELO POLAR SRL',
              suggestedCondition: 'responsable_inscripto',
              suggestedAccountId: ID(41),
              vouchers: 1,
              totalCents: 100,
            },
          ]}
        />
      </ReviewProvider>,
    )
    expect(out).toContain('1 proveedor que no conozco')
    // La misma pregunta y el mismo selector que en Compras (la categoría habitual de un proveedor).
    expect(out).toContain('¿En qué le comprás a HIELO POLAR SRL?')
    expect(out).not.toContain('¿En qué se gasta con')
    expect(out).toContain('data-category-chip')
    // La sugerida se marca (para lectores: «Sugerida: …») y nunca viene elegida.
    expect(out).toMatch(/aria-pressed="false"[^>]*>(<[^>]+>)*Sugerida: /)
    expect(out).toContain('Bebidas con alcohol')
    expect(out).not.toMatch(/data-category-chip=""[^>]*aria-pressed="true"/)
    expect(out).not.toContain('¿Lo tenés de antes?')
    expect(out).not.toContain('Son todos nuevos')
  })

  it('«¿Coincide?»: pendiente, igual y distinto', () => {
    const pending = html(
      <BalanceCheck
        who="Mercado Pago"
        periodTo="2026-10-08"
        reportCents={47_140_962}
        book={null}
        movementsHref={null}
      />,
    )
    expect(pending).toContain('Según Mercado Pago, al 08/10 había')
    expect(pending).toContain('$ 471.409,62')
    expect(pending).toContain('Cuando cargues todo te digo si tu sistema coincide.')
    const same = html(
      <BalanceCheck
        who="Mercado Pago"
        periodTo="2026-10-08"
        reportCents={47_140_962}
        book={{ treasuryId: ID(4), name: 'Mercado Pago', balanceCents: 47_140_962 }}
        movementsHref="/x"
      />,
    )
    expect(same).toContain('Coincide')
    expect(same).toContain('En tu sistema')
    expect(same).toContain('Según Mercado Pago')
    expect(same).toContain('Mercado Pago coincide con el archivo al 08/10.')
    expect(same).not.toContain('Contar')
  })

  it('«Mercado Pago contra tus cierres»: un día sin cierre no es cero y lleva a cargarlo', () => {
    const rows = [
      {
        status: 'posted' as const,
        summary: {
          kind: 'mp_collection' as const,
          date: '2026-10-08',
          notes: ['missing_close' as const],
          detail: { gross_cents: 12_960_000, net_cents: 12_744_728, commission_cents: 103_894 },
        },
      },
    ]
    const out = html(
      <MpInsights
        days={mpDays(rows)}
        cut={mpCut(rows)}
        slug="bar"
        periodFrom="2026-10-07"
        periodTo="2026-10-08"
        open
      />,
    )
    expect(out).toContain('Mercado Pago contra tus cierres')
    expect(out).toContain('Falta el cierre:')
    expect(out).toContain('href="/bar/administracion/ventas/cierre?fecha=2026-10-08"')
    expect(out).toContain('Te depositaron')
    expect(out).toContain('Según este reporte (07/10 – 08/10/2026).')
    expect(out).not.toMatch(/ganancia|ganaste/i)
    // Sin cobros, el panel no se dibuja.
    expect(
      html(<MpInsights days={[]} cut={null} slug="bar" periodFrom={null} periodTo={null} open />),
    ).toBe('')
  })
})

// ─── La contadora, pieza por pieza ───────────────────────────────────────────

/**
 * Los tests de arriba miran la revisión con los renglones cerrados. Acá se abre
 * cada pieza que escribe (cada pregunta y cada renglón abierto) y se comprueba
 * su guarda: quien solo lee no recibe ningún control; quien carga, sí.
 */
describe('la contadora no escribe: cada pregunta y cada renglón abierto', () => {
  /** Una de cada cosa que le puede faltar a una hoja. */
  const NEEDS: ImportNeed[] = [
    {
      key: 'new_supplier',
      cuit: '30712345671',
      name: 'HIELO POLAR SRL',
      suggested_condition: 'responsable_inscripto',
    },
    { key: 'supplier_account', party_id: ID(31) },
    { key: 'supplier_inactive', party_id: ID(31) },
    {
      key: 'condition_mismatch',
      party_id: ID(31),
      condition: 'monotributo',
      suggested_condition: 'responsable_inscripto',
    },
    { key: 'other_taxes_as', party_id: ID(31), amount_cents: 1_440_000 },
    { key: 'vat_rate' },
    { key: 'unsupported_voucher', code: 99 },
    { key: 'receipt', code: 4 },
    { key: 'foreign_currency', currency: 'USD', fx_rate: '1465.50', original_total_cents: 10_769 },
    { key: 'total_gap', cents: 100 },
    { key: 'possible_duplicate', document_id: ID(70), label: 'Factura A 0002-00000061' },
    { key: 'mp_invoice' },
    { key: 'channel_method', channel: 'qr' },
    { key: 'pick_party', role: 'supplier', suggested_party_id: ID(32) },
    { key: 'pick_treasury', suggested_treasury_id: ID(50) },
    { key: 'counterpart_account', direction: 'out' },
    { key: 'unknown_tax', tax: 'Tasa municipal', amount_cents: -12_000 },
    { key: 'estimated_deductions' },
    { key: 'accept_warning', warnings: ['vat_diff'] },
    { key: 'engine_error', error_key: null, message: 'No cierra.', field: null },
    { key: 'engine_error', error_key: 'date_before_start', message: 'x', field: null },
    { key: 'manual', reason: 'not_ours' },
  ]
  /** Cualquier cosa que se pueda tocar. */
  const CONTROL = /<button|<a |<input|<select|<textarea|role="(radio|checkbox|combobox|switch)"/

  it('cada cosa que puede faltar es, para quien solo lee, una línea sin nada que tocar', () => {
    for (const need of NEEDS) {
      const out = review(<NeedQuestion p={proposal({ needs: [need] })} need={need} />, {
        editable: false,
      })
      expect(out, need.key).toMatch(/^<p /)
      expect(out, need.key).not.toMatch(CONTROL)
      expect(out, need.key).not.toMatch(WRITE_WORDS)
    }
  })

  it('para quien carga, cada una trae su respuesta', () => {
    for (const need of NEEDS) {
      const out = review(<NeedQuestion p={proposal({ needs: [need] })} need={need} />, {
        editable: true,
      })
      expect(out, need.key).toMatch(/<button|<a /)
    }
  })

  /** Un renglón de cada estado, con todo lo que puede traer una acción. */
  const OPENED: Array<{ name: string; row: ProposalView; owner: string[] }> = [
    {
      name: 'con una pregunta y algo ya contestado',
      row: proposal({ key: 'o1', hasDecisions: true, hasValues: true }),
      owner: [
        '>Guardar<',
        'No es nuestro',
        'Deshacer lo que contesté',
        'Ver cómo queda en los libros',
      ],
    },
    {
      name: 'cambió desde que se miró',
      row: proposal({ key: 'o2', status: 'stale', needs: [], hasValues: true }),
      owner: ['Ver cómo queda ahora', 'No es nuestro'],
    },
    {
      name: 'no se pudo cargar',
      row: proposal({
        key: 'o3',
        status: 'error',
        needs: [],
        previewHash: 'h',
        hasValues: true,
        error: { reason: 'post_failed', message: 'El mes está cerrado.' },
      }),
      owner: ['Reintentar', 'Ver cómo queda en los libros'],
    },
    {
      name: 'una nota de crédito lista',
      row: proposal({
        key: 'o4',
        status: 'ready',
        needs: [],
        hasValues: true,
        summary: {
          kind: 'credit_note',
          date: '2026-09-20',
          month: '2026-09',
          label: 'Nota de crédito A 0002-00000007',
          counterparty: 'Limpieza Demo SA',
          total_cents: 1_000_000,
          item_count: 1,
        },
      }),
      owner: ['Elegir la factura', 'Ver cómo queda en los libros', 'No es nuestro'],
    },
    {
      name: 'marcado como «no es nuestro»',
      row: proposal({ key: 'o5', status: 'skipped', needs: [], error: { reason: 'ignored' } }),
      owner: ['Volver a incluirlo'],
    },
    {
      name: 'anulado',
      row: proposal({ key: 'o6', status: 'voided', needs: [] }),
      owner: ['Volver a cargar', '¿Lo cargo de nuevo?'],
    },
    {
      name: 'cargado',
      row: proposal({ key: 'o7', status: 'posted', needs: [], documentId: ID(71) }),
      owner: ['Ver el comprobante'],
    },
  ]

  it('un renglón abierto, para quien solo lee: el papel y el motivo, sin ningún botón', () => {
    for (const { name, row } of OPENED) {
      const out = review(<ProposalOpened p={row} />, { editable: false })
      expect(out, name).not.toContain('<button')
      expect(out, name).not.toMatch(/<input|<select|role="(radio|checkbox|combobox)"/)
      expect(out, name).not.toMatch(WRITE_WORDS)
      for (const words of [
        'Ver cómo queda',
        'Deshacer lo que contesté',
        'Elegir la factura',
        '¿Lo cargo de nuevo?',
      ]) {
        expect(out, name).not.toContain(words)
      }
      // Lo que sí ve: el papel de la hoja.
      expect(out, name).toContain('Ver el papel')
    }
    // Los links a lo ya cargado siguen: mirar no es escribir.
    const posted = review(<ProposalOpened p={OPENED[6]?.row as ProposalView} />, {
      editable: false,
    })
    expect(posted).toContain(`href="/bar/administracion/comprobantes/${ID(71)}"`)
    const failed = review(<ProposalOpened p={OPENED[2]?.row as ProposalView} />, {
      editable: false,
    })
    expect(failed).toContain('El mes está cerrado.')
  })

  it('el mismo renglón, para quien carga, trae su acción', () => {
    for (const { name, row, owner } of OPENED) {
      const out = review(<ProposalOpened p={row} />, { editable: true })
      for (const words of owner) expect(out, `${name}: ${words}`).toContain(words)
    }
  })

  it('«Enseñarme algo nuevo» no se abre solo: sin nada que enseñar, no dibuja nada', () => {
    expect(review(<TeachHost />, { editable: false })).toBe('')
    expect(review(<TeachHost />, { editable: true })).toBe('')
  })
})
