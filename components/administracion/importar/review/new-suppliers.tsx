'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { categoryOptions, featuredCategories } from '@/components/administracion/kit'
import { saveParty } from '@/lib/accounting/actions/master'
import { type IvaCondition, PARTY_KINDS, type PartyKind } from '@/lib/accounting/types'
import { lookupCuits } from '@/lib/arca/actions'
import type { PadronLookupData } from '@/lib/arca/views'
import { buildImportProposals, createImportSuppliers } from '@/lib/imports/actions'
import { SUPPLIER_IVA_CONDITIONS } from '@/lib/imports/ui/labels'
import { supplierCuitInput, supplierRows } from '@/lib/imports/ui/payloads'
import { count } from '@/lib/imports/ui/progress'
import {
  isLinkable,
  LINK_KNOWN_SUPPLIERS,
  type SimilarMatch,
  similarParties,
} from '@/lib/imports/ui/similar'
import { KnownBefore } from './known-before'
import { OFFLINE_TEXT, useReview } from './review-context'

export type NewSupplierView = {
  cuit: string
  name: string
  suggestedCondition: IvaCondition
  suggestedAccountId: string | null
  vouchers: number
  totalCents: number
}

export type LookupView = {
  /** Con qué ambiente se consulta el padrón; `null` = ARCA no está conectado. */
  environment: 'produccion' | 'homologacion' | null
  testData: boolean
} | null

/** Qué contestó la persona sobre un proveedor del archivo. */
export type SupplierAnswer = 'pending' | 'known' | 'new' | 'later'

export type SupplierRowState = {
  answer: SupplierAnswer
  /** Con `known`: el proveedor del bar al que se le guarda el CUIT. */
  knownId: string | null
  name: string
  nameEdited: boolean
  condition: IvaCondition
  conditionEdited: boolean
  accountId: string | null
  term: string
  /** Lo que dijo ARCA (o por qué no se pudo). */
  arca: { ok: true; data: PadronLookupData } | { ok: false; message: string } | null
  /** Por qué no se pudo guardar (después de «Guardar las respuestas»). */
  failed: string | null
}

/** Hasta cuántos crea `createImportSuppliers` por vez (y consulta `lookupCuits`). */
const PER_CALL = 200

function initial(
  rows: readonly NewSupplierView[],
  answer: SupplierAnswer,
): Record<string, SupplierRowState> {
  return Object.fromEntries(
    rows.map((r) => [
      r.cuit,
      {
        answer,
        knownId: null,
        name: r.name,
        nameEdited: false,
        condition: SUPPLIER_IVA_CONDITIONS.includes(r.suggestedCondition)
          ? r.suggestedCondition
          : 'responsable_inscripto',
        conditionEdited: false,
        accountId: null,
        term: '',
        arca: null,
        failed: null,
      } satisfies SupplierRowState,
    ]),
  )
}

function isPartyKind(kind: string): kind is PartyKind {
  return (PARTY_KINDS as readonly string[]).includes(kind)
}

/**
 * El estado y el guardado de «¿Los tenés de antes?» (la vista es `KnownBefore`).
 *
 * Para cada CUIT de las facturas que el bar no tiene cargado, la persona dice:
 * «ya lo tengo» (se le guarda el CUIT a ese proveedor, con `saveParty`, el
 * mismo envío de su ficha), «es nuevo» (se crea con `createImportSuppliers`,
 * igual que antes) o «después». Las sugerencias (categoría, datos de ARCA,
 * parecidos por el nombre) nunca se aplican solas.
 *
 * «Guardar las respuestas» hace, en orden: guarda los CUIT de los que ya
 * estaban; crea los nuevos (que vuelve a armar el archivo); y, si no hubo
 * nuevos, lo vuelve a armar con `buildImportProposals`. Lo que falla queda en
 * su fila con el motivo; lo demás se guarda.
 */
export function useNewSuppliers(rows: readonly NewSupplierView[]) {
  const { slug, batchId, options } = useReview()
  const parties = options?.parties ?? []
  // Los proveedores del bar a los que se les puede guardar un CUIT (activos y sin CUIT).
  const linkable = useMemo(
    () => (LINK_KNOWN_SUPPLIERS ? parties.filter(isLinkable) : []),
    [parties],
  )
  const canLink = linkable.length > 0
  // Sin nadie a quien parecerse no hay pregunta: todos arrancan como «nuevo», como antes.
  const firstAnswer: SupplierAnswer = canLink ? 'pending' : 'new'
  const [state, setState] = useState<Record<string, SupplierRowState>>(() =>
    initial(rows, firstAnswer),
  )
  const [arcaError, setArcaError] = useState<{ message: string; step: string | null } | null>(null)
  const [looking, startLooking] = useTransition()
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null)

  // Filas nuevas (otro archivo o un «Volver a armar») entran con su estado inicial.
  const rowsKey = rows.map((r) => r.cuit).join(',')
  const [seenKey, setSeenKey] = useState(rowsKey)
  if (seenKey !== rowsKey) {
    setSeenKey(rowsKey)
    setState((prev) => {
      const fresh = initial(rows, firstAnswer)
      for (const cuit of Object.keys(fresh)) {
        const old = prev[cuit]
        if (old) fresh[cuit] = old
      }
      return fresh
    })
  }

  const accounts = options?.accounts ?? []
  const purchase = useMemo(
    () => new Set(accounts.filter((a) => a.purchase).map((a) => a.id)),
    [accounts],
  )
  // Las categorías de compras y gastos, como las muestra el selector de Compras.
  const categories = useMemo(
    () => categoryOptions(accounts, (id) => purchase.has(id)),
    [accounts, purchase],
  )
  const featured = useMemo(() => featuredCategories(accounts), [accounts])
  const suggestions = useMemo(() => {
    const out: Record<string, SimilarMatch[]> = {}
    if (canLink) for (const r of rows) out[r.cuit] = similarParties(r.name, linkable)
    return out
  }, [rows, linkable, canLink])

  const patch = (cuit: string, next: Partial<SupplierRowState>) =>
    setState((prev) => {
      const row = prev[cuit]
      return row ? { ...prev, [cuit]: { ...row, ...next } } : prev
    })

  const known = rows.filter((r) => state[r.cuit]?.answer === 'known' && state[r.cuit]?.knownId)
  const fresh = rows.filter((r) => state[r.cuit]?.answer === 'new')
  const ready = fresh.filter(
    (r) => state[r.cuit]?.accountId && (state[r.cuit]?.name.trim().length ?? 0) >= 2,
  )
  const later = rows.filter((r) => state[r.cuit]?.answer === 'later')
  const pending = rows.filter((r) => state[r.cuit]?.answer === 'pending')
  const suggestible = rows.filter((r) => {
    const row = state[r.cuit]
    return (
      r.suggestedAccountId &&
      row &&
      (row.answer === 'new' || row.answer === 'pending') &&
      !row.accountId &&
      purchase.has(r.suggestedAccountId)
    )
  })

  const completeWithArca = () => {
    setArcaError(null)
    startLooking(async () => {
      let found = 0
      try {
        for (let i = 0; i < rows.length; i += PER_CALL) {
          const cuits = rows.slice(i, i + PER_CALL).map((r) => r.cuit)
          const result = await lookupCuits(slug, { cuits, purpose: 'supplier' })
          if (!result.ok) {
            setArcaError({ message: result.message, step: result.step })
            return
          }
          found += result.data.results.filter((x) => x.result.ok).length
          setState((prev) => {
            const next = { ...prev }
            for (const { cuit, result: r } of result.data.results) {
              const row = next[cuit]
              if (!row) continue
              if (!r.ok) {
                next[cuit] = { ...row, arca: { ok: false, message: r.message } }
                continue
              }
              const condition =
                !row.conditionEdited && SUPPLIER_IVA_CONDITIONS.includes(r.data.ivaCondition)
                  ? r.data.ivaCondition
                  : row.condition
              next[cuit] = {
                ...row,
                name: row.nameEdited ? row.name : r.data.name.slice(0, 120),
                condition,
                arca: { ok: true, data: r.data },
              }
            }
            return next
          })
        }
        toast.success(
          found > 0
            ? `Completé ${count(found, 'proveedor', 'proveedores')} con los datos de ARCA.`
            : 'ARCA no trajo datos de estos CUIT: mirá el motivo en cada uno.',
        )
      } catch {
        setArcaError({ message: OFFLINE_TEXT, step: null })
      }
    })
  }

  /** «Usar las categorías sugeridas»: un toque de la persona; nunca se aplican solas. */
  const applySuggestions = () => {
    setState((prev) => {
      const next = { ...prev }
      for (const r of suggestible) {
        const row = next[r.cuit]
        if (row && r.suggestedAccountId) next[r.cuit] = { ...row, accountId: r.suggestedAccountId }
      }
      return next
    })
  }

  /** «Son todos nuevos»: marca así los que faltan contestar (estado de pantalla). */
  const allNew = () => {
    setState((prev) => {
      const next = { ...prev }
      for (const r of rows) {
        const row = next[r.cuit]
        if (row && row.answer === 'pending') next[r.cuit] = { ...row, answer: 'new' }
      }
      return next
    })
  }

  const save = async () => {
    const total = known.length + ready.length
    if (total === 0 || saving) return
    let done = 0
    let linked = 0
    let created = 0
    setSaving({ done, total })
    try {
      // 1. A los que ya estaban, guardarles el CUIT (el envío de la ficha del proveedor).
      // Un proveedor tiene un solo CUIT: si se eligió el mismo para dos, el segundo no se manda.
      const taken = new Set<string>()
      for (const r of known) {
        const row = state[r.cuit] as SupplierRowState
        const party = parties.find((x) => x.id === row.knownId)
        if (!party?.updatedAt || !isPartyKind(party.kind)) {
          patch(r.cuit, { failed: 'No pude leer ese proveedor. Abrí su ficha y cargale el CUIT.' })
        } else if (taken.has(party.id)) {
          patch(r.cuit, {
            failed: `Ya elegiste a ${party.tradeName ?? party.name} para otro CUIT de este archivo. Elegí otro o decime que es nuevo.`,
          })
        } else {
          taken.add(party.id)
          const result = await saveParty(
            slug,
            supplierCuitInput(
              { id: party.id, kind: party.kind, name: party.name, updatedAt: party.updatedAt },
              r.cuit,
            ),
          )
          if (result.ok) linked++
          else patch(r.cuit, { failed: result.message })
        }
        done++
        setSaving({ done, total })
      }
      // 2. Crear los nuevos (vuelve a armar el archivo).
      for (let i = 0; i < ready.length; i += PER_CALL) {
        const slice = ready.slice(i, i + PER_CALL)
        const result = await createImportSuppliers(slug, {
          batchId,
          suppliers: supplierRows(slice, state),
        })
        if (!result.ok) {
          toast.error(result.message)
          break
        }
        created += result.data.created.length
        for (const f of result.data.failed) patch(f.cuit, { failed: f.message })
        done += slice.length
        setSaving({ done, total })
      }
      // 3. Sin nuevos, hay que volver a armar para que las facturas encuentren a su proveedor.
      if (created === 0 && linked > 0) {
        const rebuilt = await buildImportProposals(slug, { batchId })
        if (!rebuilt.ok) toast.error(rebuilt.message)
      }
      if (linked + created > 0) {
        const parts = [
          linked > 0 ? count(linked, 'CUIT guardado', 'CUIT guardados') : null,
          created > 0 ? count(created, 'proveedor creado', 'proveedores creados') : null,
        ].filter(Boolean)
        toast.success(`Listo: ${parts.join(' y ')}. Ya armé sus comprobantes.`)
      }
    } catch {
      toast.error(OFFLINE_TEXT)
    } finally {
      setSaving(null)
    }
  }

  return {
    rows,
    state,
    patch,
    canLink,
    linkable,
    suggestions,
    accounts,
    purchase,
    categories,
    featured,
    counts: {
      known: known.length,
      fresh: fresh.length,
      ready: ready.length,
      later: later.length,
      pending: pending.length,
      toSave: known.length + ready.length,
    },
    suggestible: suggestible.length,
    arcaError,
    looking,
    saving,
    completeWithArca,
    applySuggestions,
    allNew,
    save,
  }
}

export type NewSuppliersModel = ReturnType<typeof useNewSuppliers>

/**
 * «¿Los tenés de antes?» (antes «Proveedores nuevos»): el contenedor. Arma el
 * estado y el guardado, y se los pasa a la vista.
 */
export function NewSuppliers({
  rows,
  lookup,
  connectHref,
}: {
  rows: NewSupplierView[]
  lookup: LookupView
  /** La guía «Conectar ARCA» (para completar los nombres solos). */
  connectHref: string
}) {
  const model = useNewSuppliers(rows)
  return <KnownBefore model={model} lookup={lookup} connectHref={connectHref} />
}
