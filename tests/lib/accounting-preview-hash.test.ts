import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalize,
  HASH_EXCLUDED_KEYS,
  hashProposal,
  hashProposalSync,
  PREVIEW_HASH_RE,
  sha256Hex,
  toEntryPreview,
} from '@/lib/accounting/preview'
import type { ProposedBundle } from '@/lib/accounting/types'
import { buildCoreFixture, doc, fixedUuid, line } from './accounting-core-context'

const f = buildCoreFixture()

/** E5: artículos de limpieza con Factura A, $ 12.100 pagados con Mercado Pago (bundle [purchase, payment]). */
function e5Bundle(): ProposedBundle {
  const mayorista = f.party('mayorista')
  const payable = f.sys('payable_suppliers')
  return {
    clientRef: fixedUuid(777),
    newParties: [],
    documents: [
      doc({
        ref: 'd1',
        kind: 'purchase',
        voucherType: 'factura_a',
        afipVoucherCode: 1,
        party: { id: mayorista.id },
        pointOfSale: 3,
        number: 4521,
        dueDate: '2026-10-03',
        description: 'Factura A 0003-00004521 · Mayorista X',
        totalCents: 1_210_000,
        controlAccountId: payable.id,
        lines: [
          line({
            lineNo: 1,
            role: 'net',
            accountId: f.sys('cleaning').id,
            side: 'debit',
            amountCents: 1_000_000,
            vatRateBp: 2100,
            baseCents: 1_000_000,
            memo: 'Neto 21 %',
          }),
          line({
            lineNo: 2,
            role: 'vat',
            accountId: f.sys('vat_credit').id,
            side: 'debit',
            amountCents: 210_000,
            vatRateBp: 2100,
            baseCents: 1_000_000,
            vatComputedCents: 210_000,
            taxKind: 'iva',
            memo: 'IVA 21 %',
          }),
          line({
            lineNo: 3,
            role: 'control',
            accountId: payable.id,
            side: 'credit',
            amountCents: 1_210_000,
            partyRef: { id: mayorista.id },
            dueDate: '2026-10-03',
            memo: 'Factura A 0003-00004521',
          }),
        ],
        fiscalVouchers: [
          {
            book: 'purchases',
            voucherType: 'factura_a',
            afipVoucherCode: 1,
            isCreditNote: false,
            voucherDate: '2026-10-03',
            pointOfSale: 3,
            numberFrom: 4521,
            numberTo: null,
            channel: null,
            counterparty: {
              party: { id: mayorista.id },
              name: 'Mayorista X',
              docType: 80,
              docNumber: mayorista.taxId ?? '',
              ivaCondition: 'responsable_inscripto',
            },
            amounts: {
              net_21_cents: 1_000_000,
              vat_21_cents: 210_000,
              total_cents: 1_210_000,
              vat_computable_cents: 210_000,
            },
          },
        ],
      }),
      doc({
        ref: 'd2',
        kind: 'payment',
        party: { id: mayorista.id },
        description: 'Pago a Mayorista X',
        totalCents: 1_210_000,
        controlAccountId: payable.id,
        lines: [
          line({
            lineNo: 1,
            role: 'control',
            accountId: payable.id,
            side: 'debit',
            amountCents: 1_210_000,
            partyRef: { id: mayorista.id },
            memo: 'Pago',
          }),
          line({
            lineNo: 2,
            role: 'treasury',
            accountId: f.treasury('mp').accountId,
            side: 'credit',
            amountCents: 1_210_000,
            treasuryAccountId: f.treasury('mp').id,
            memo: 'Mercado Pago SAS',
          }),
        ],
      }),
    ],
    allocations: [
      {
        debit: { doc: 'd2', lineNo: 1 },
        credit: { doc: 'd1', lineNo: 3 },
        amountCents: 1_210_000,
        kind: 'payment',
      },
    ],
  }
}

/** Una copia profunda con un cambio aplicado. */
function variant(mutate: (b: ProposedBundle) => void): ProposedBundle {
  const b = structuredClone(e5Bundle())
  mutate(b)
  return b
}

function firstDoc(b: ProposedBundle) {
  const d = b.documents[0]
  if (!d) throw new Error('sin documento')
  return d
}

function firstLine(b: ProposedBundle) {
  const l = firstDoc(b).lines[0]
  if (!l) throw new Error('sin renglón')
  return l
}

describe('sha256Hex: SHA-256 puro, igual a node:crypto', () => {
  const samples = [
    '',
    'abc',
    'IVA crédito fiscal · Ñandú 🍺 «Coca-Cola»',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(63),
    'a'.repeat(64),
    'a'.repeat(65),
    'x'.repeat(1_000),
    JSON.stringify({ a: 1, b: [1, 2, 3], c: 'ñ' }).repeat(50),
  ]
  for (const text of samples) {
    it(`«${text.slice(0, 24)}…» (${text.length} caracteres)`, () => {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'))
    })
  }

  it('vectores conocidos', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('bytes sueltos', () => {
    const bytes = new Uint8Array([0, 255, 128, 1])
    expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'))
  })
})

describe('hashProposal (Web Crypto) = hashProposalSync (puro)', () => {
  it('dan el mismo hex de 64 caracteres', async () => {
    const bundle = e5Bundle()
    const sync = hashProposalSync(bundle)
    expect(sync).toMatch(PREVIEW_HASH_RE)
    expect(await hashProposal(bundle)).toBe(sync)
    expect(createHash('sha256').update(canonicalize(bundle), 'utf8').digest('hex')).toBe(sync)
  })

  it('es estable: el mismo bundle da siempre el mismo hash', () => {
    expect(hashProposalSync(e5Bundle())).toBe(hashProposalSync(e5Bundle()))
  })
})

describe('canonicalize: orden de claves, ceros, espacios y textos derivados', () => {
  const base = hashProposalSync(e5Bundle())

  it('el orden de las claves no importa', () => {
    const b = e5Bundle()
    const reordered = JSON.parse(
      JSON.stringify(b, (_k, v) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse())
          : v,
      ),
    ) as ProposedBundle
    expect(Object.keys(reordered)[0]).not.toBe(Object.keys(b)[0])
    expect(hashProposalSync(reordered)).toBe(base)
  })

  it('las columnas en cero de un comprobante fiscal son lo mismo que ausentes', () => {
    const b = variant((x) => {
      const fv = firstDoc(x).fiscalVouchers[0]
      if (fv) fv.amounts = { ...fv.amounts, net_105_cents: 0, perc_iva_cents: 0 }
    })
    expect(hashProposalSync(b)).toBe(base)
  })

  it('un cero que es dato (punto de venta 0, alícuota 0) sí cuenta', () => {
    const withPos0 = variant((x) => {
      firstDoc(x).pointOfSale = 0
    })
    expect(hashProposalSync(withPos0)).not.toBe(base)
  })

  it('`null` y una clave ausente dan lo mismo', () => {
    const b = variant((x) => {
      const l = firstLine(x) as unknown as Record<string, unknown>
      delete l.reference
      delete l.certificateNumber
    })
    expect(hashProposalSync(b)).toBe(base)
  })

  it('los espacios en los bordes de un texto no cambian nada', () => {
    const b = variant((x) => {
      firstDoc(x).issueDate = ' 2026-10-03 '
    })
    expect(hashProposalSync(b)).toBe(base)
  })

  it('descripciones, leyendas, nombres, notas, motivos y avisos aceptados no entran', () => {
    const b = variant((x) => {
      const d = firstDoc(x)
      d.description = 'Otra descripción'
      d.notes = 'una nota'
      d.overrideReason = 'motivo largo'
      d.warningsAck = ['possible_duplicate']
      firstLine(x).memo = 'otra leyenda'
      const fv = d.fiscalVouchers[0]
      if (fv) fv.counterparty.name = 'Otro nombre SRL'
    })
    expect(hashProposalSync(b)).toBe(base)
    expect([...HASH_EXCLUDED_KEYS].sort()).toEqual(
      [
        'description',
        'label',
        'memo',
        'name',
        'notes',
        'overrideReason',
        'tradeName',
        'warningsAck',
      ].sort(),
    )
  })

  it('el clientRef no entra (es la clave de idempotencia, no contenido)', () => {
    const b = variant((x) => {
      x.clientRef = fixedUuid(888)
    })
    expect(hashProposalSync(b)).toBe(base)
  })

  it('la forma canónica no tiene espacios y ordena las claves', () => {
    const text = canonicalize(e5Bundle())
    expect(text.startsWith('{"allocations":[')).toBe(true)
    expect(text).not.toContain(' ":')
    expect(text).not.toContain('"description"')
    expect(text).not.toContain('"memo"')
    expect(text).not.toContain('"clientRef"')
  })

  it('un importe que no es entero es un error del motor', () => {
    const b = variant((x) => {
      firstLine(x).amountCents = 1_000_000.5
    })
    expect(() => hashProposalSync(b)).toThrow(RangeError)
  })
})

describe('el hash cambia con cualquier cosa que mueva plata', () => {
  const base = hashProposalSync(e5Bundle())
  const cases: Array<[string, (b: ProposedBundle) => void]> = [
    [
      'un centavo en un renglón',
      (b) => {
        firstLine(b).amountCents += 1
      },
    ],
    [
      'un centavo en el total',
      (b) => {
        firstDoc(b).totalCents += 1
      },
    ],
    [
      'la alícuota',
      (b) => {
        firstLine(b).vatRateBp = 1050
      },
    ],
    [
      'la cuenta',
      (b) => {
        firstLine(b).accountId = f.sys('purchases_food').id
      },
    ],
    [
      'el lado',
      (b) => {
        firstLine(b).side = 'credit'
      },
    ],
    [
      'el vencimiento',
      (b) => {
        const control = firstDoc(b).lines[2]
        if (control) control.dueDate = '2026-10-24'
      },
    ],
    [
      'el partícipe',
      (b) => {
        firstDoc(b).party = { id: f.party('cocacola').id }
      },
    ],
    [
      'la fecha contable',
      (b) => {
        firstDoc(b).accountingDate = '2026-10-04'
      },
    ],
    [
      'el número del comprobante',
      (b) => {
        firstDoc(b).number = 4522
      },
    ],
    [
      'el importe de una imputación',
      (b) => {
        const a = b.allocations[0]
        if (a) a.amountCents -= 1
      },
    ],
    [
      'una columna del libro IVA',
      (b) => {
        const fv = firstDoc(b).fiscalVouchers[0]
        if (fv) fv.amounts.vat_computable_cents = 0
      },
    ],
    [
      'la caja',
      (b) => {
        const t = b.documents[1]?.lines[1]
        if (t) t.treasuryAccountId = f.treasury('banco').id
      },
    ],
    [
      'el comprobante relacionado',
      (b) => {
        firstDoc(b).relatedDocument = { id: fixedUuid(4242) }
      },
    ],
    [
      'lo contado en un arqueo',
      (b) => {
        firstDoc(b).countedCents = 1
      },
    ],
  ]
  for (const [what, mutate] of cases) {
    it(what, () => {
      expect(hashProposalSync(variant(mutate))).not.toBe(base)
    })
  }
})

describe('toEntryPreview: lo que dibuja EntryPreview', () => {
  it('un asiento por documento, primero el Debe y después el Haber, con códigos y partícipes', () => {
    const preview = toEntryPreview(e5Bundle(), f.ctx)
    expect(preview).toHaveLength(2)
    const [purchase, payment] = preview
    expect(
      purchase?.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents, l.partyName]),
    ).toEqual([
      ['5.3.02.08', 1_000_000, null, null],
      ['1.1.03.01', 210_000, null, null],
      ['2.1.01.01', null, 1_210_000, 'Mayorista X'],
    ])
    expect(purchase?.balanced).toBe(true)
    expect(purchase?.debitCents).toBe(1_210_000)
    expect(purchase?.diffCents).toBe(0)
    expect(purchase?.lines[0]?.id).toBe('d1:1')
    expect(purchase?.lines[0]?.accountName).toBe('Limpieza e higiene')
    expect(payment?.lines.map((l) => l.accountCode)).toEqual(['2.1.01.01', '1.1.01.02'])
  })

  it('ordena el Haber después aunque venga primero', () => {
    const b = variant((x) => {
      const d = firstDoc(x)
      d.lines = [...d.lines].reverse()
    })
    const lines = toEntryPreview(b, f.ctx)[0]?.lines ?? []
    expect(lines.map((l) => l.lineNo)).toEqual([1, 2, 3])
  })

  it('descuadrado y partícipes nuevos del bundle', () => {
    const b = variant((x) => {
      x.newParties = [
        {
          ref: 'p1',
          kind: 'supplier',
          name: 'Distribuidora Norte SRL',
          tradeName: null,
          taxIdType: 'none',
          taxId: null,
          ivaCondition: 'responsable_inscripto',
          paymentTermDays: 0,
          defaultAccountId: null,
        },
      ]
      const control = firstDoc(x).lines[2]
      if (control) {
        control.partyRef = { ref: 'p1' }
        control.amountCents = 1_210_001
      }
    })
    const p = toEntryPreview(b, f.ctx)[0]
    expect(p?.balanced).toBe(false)
    expect(p?.diffCents).toBe(-1)
    expect(p?.lines[2]?.partyName).toBe('Distribuidora Norte SRL')
  })

  it('una cuenta que no está en el contexto se muestra sin romper', () => {
    const b = variant((x) => {
      firstLine(x).accountId = fixedUuid(123_456)
    })
    expect(toEntryPreview(b, f.ctx)[0]?.lines[0]?.accountCode).toBe('?')
  })
})
