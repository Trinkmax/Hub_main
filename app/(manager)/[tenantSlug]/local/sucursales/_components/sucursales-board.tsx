'use client'

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  LoaderCircle,
  Plus,
  Star,
  Store,
  Trash2,
  Tv,
  Wrench,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { Panel } from '@/components/administracion/kit/panel'
import { PillLink } from '@/components/administracion/kit/pill'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { setPractice } from '@/lib/pos/actions'
import {
  createBranch,
  deleteBranch,
  reorderBranches,
  setDefaultBranch,
  updateBranch,
} from '@/lib/pos/branches/actions'
import {
  buildOpening,
  type Opening,
  type OpeningStep,
  openingHeadline,
} from '@/lib/pos/branches/checklist'
import { branchHref, settingsHref, stepAnchor, stepLinks } from '@/lib/pos/branches/links'
import {
  emptyFacts,
  fieldKey,
  liveBranches,
  liveSettings,
  rowKey,
  settingKey,
} from '@/lib/pos/branches/live'
import {
  ADDRESS_MAX,
  chipLabel,
  cleanText,
  NAME_MAX,
  SHORT_NAME_MAX,
} from '@/lib/pos/branches/naming'
import {
  canBeDefault,
  canDeactivate,
  canDelete,
  moveBranch,
  moveOptions,
  splitBranches,
} from '@/lib/pos/branches/order'
import { colorChoices } from '@/lib/pos/branches/palette'
import { describeBranchChange, invertBranchChanges } from '@/lib/pos/branches/patch'
import type {
  Branch,
  BranchBoardSnapshot,
  BranchChange,
  BranchField,
  BranchWriteResult,
} from '@/lib/pos/branches/types'
import { clockAt } from '@/lib/pos/order/clock'
import { savePosSettings } from '@/lib/pos/settings/actions'
import { describeChanges } from '@/lib/pos/settings/describe'
import {
  EMPTY_OVERLAY,
  type Overlay,
  overlayDrop,
  overlaySaving,
  overlaySettle,
  overlayStart,
  overlaySync,
} from '@/lib/pos/settings/overlay'
import { invertChanges } from '@/lib/pos/settings/patch'
import type { SettingChange, SettingKey, SettingsWriteResult } from '@/lib/pos/settings/types'
import { cn } from '@/lib/utils'
import { AutosaveField, type FieldRead } from './autosave-field'
import { notify } from './notify'
import { SettingsPane } from './settings-pane'
import { Storefront } from './storefront'
import './sucursales.css'

/**
 * «Sucursales»: cada local del bar con su vidriera. La persiana está tan levantada como
 * avanzada está su lista de apertura (el plano, la carta, la cocina, la caja, el equipo y el
 * cobro), y cada paso lleva a donde se resuelve, ya parado en esa sucursal.
 *
 * Nada tiene botón de guardar: se toca y queda, con «Deshacer». Lo que se acaba de cambiar se
 * ve al instante (`lib/pos/settings/overlay.ts`) y la base tiene la última palabra: si otro
 * dueño lo cambió recién, se muestra cómo quedó y no se pisa.
 *
 * `?sucursal=<slug>` elige la sucursal; `?ver=ajustes` muestra los ajustes del punto de venta,
 * que valen para todo el bar.
 */

const OFFLINE = 'No hay conexión: no se guardó. Probá de nuevo cuando vuelva.'

type TeleLink = { url: string; qr: string | null }

const readName = (text: string): FieldRead<string> => {
  const clean = cleanText(text)
  if (clean === '') return { kind: 'ignore' }
  if (clean.length > NAME_MAX) {
    return { kind: 'error', message: `El nombre entra en ${NAME_MAX} letras.` }
  }
  return { kind: 'ok', value: clean }
}

const readOptional =
  (max: number, tooLong: string) =>
  (text: string): FieldRead<string | null> => {
    const clean = cleanText(text)
    if (clean.length > max) return { kind: 'error', message: tooLong }
    return { kind: 'ok', value: clean === '' ? null : clean }
  }

const readShortName = readOptional(
  SHORT_NAME_MAX,
  `El nombre corto entra en ${SHORT_NAME_MAX} letras.`,
)
const readAddress = readOptional(ADDRESS_MAX, `La dirección entra en ${ADDRESS_MAX} letras.`)
const orEmpty = (value: string | null) => value ?? ''
const TEXT_FIELDS: ReadonlyArray<BranchField> = ['name', 'shortName', 'address']

export function SucursalesBoard({
  tenantSlug,
  snapshot,
  selectedSlug,
  view,
  timeZone,
  tele,
}: {
  tenantSlug: string
  snapshot: BranchBoardSnapshot
  /** `?sucursal=`: la que se está mirando. Sin dato, la principal. */
  selectedSlug: string | null
  view: 'sucursales' | 'ajustes'
  timeZone: string
  /** El link de la pantalla de cocina de cada sucursal (y su QR), por id. */
  tele: Readonly<Record<string, TeleLink>>
}) {
  const router = useRouter()
  const [overlay, setOverlay] = useState<Overlay>(EMPTY_OVERLAY)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [settingErrors, setSettingErrors] = useState<Readonly<Partial<Record<SettingKey, string>>>>(
    {},
  )
  const [busy, setBusy] = useState<'create' | 'default' | 'order' | 'delete' | 'practice' | null>(
    null,
  )
  // Lo que se acaba de prender o apagar, hasta que la próxima lectura lo traiga.
  const [practiceNow, setPracticeNow] = useState<Readonly<Record<string, string | null>>>({})
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const token = useRef(0)
  const loadedAt = useRef(snapshot.loadedAt)

  // Llegó una lectura nueva: lo que esa lectura ya incluye deja de hacer falta encima.
  useEffect(() => {
    loadedAt.current = snapshot.loadedAt
    setOverlay((current) => overlaySync(current, snapshot.loadedAt))
  }, [snapshot.loadedAt])

  const branches = useMemo(() => liveBranches(snapshot.branches, overlay), [snapshot, overlay])
  const settings = useMemo(() => liveSettings(snapshot.settings, overlay), [snapshot, overlay])
  const { active, inactive } = useMemo(() => splitBranches(branches), [branches])
  const alone = branches.length === 1
  // La caja ya existe en este bar: una sucursal recién creada arranca con «falta abrirla».
  const cashReady = Object.values(snapshot.facts).some((facts) => facts.registers !== null)

  const openings = useMemo(() => {
    const now = new Date(snapshot.loadedAt)
    const map = new Map<string, Opening>()
    for (const branch of branches) {
      map.set(
        branch.id,
        buildOpening({
          facts: snapshot.facts[branch.id] ?? emptyFacts(cashReady),
          menu: snapshot.menu,
          team: snapshot.team,
          settings,
          now,
          timeZone,
        }),
      )
    }
    return map
  }, [branches, snapshot, settings, cashReady, timeZone])

  const selected =
    branches.find((branch) => branch.slug === selectedSlug) ??
    branches.find((branch) => branch.isDefault) ??
    branches[0] ??
    null

  // ── Guardar un dato de una sucursal ──
  const saveBranch = async (branch: Branch, changes: BranchChange[], isUndo = false) => {
    const mine = ++token.current
    const keys = changes.map((change) => fieldKey(branch.id, change.field))
    setOverlay((current) =>
      overlayStart(
        current,
        mine,
        changes.map((change) => [fieldKey(branch.id, change.field), change.value] as const),
      ),
    )
    setFieldErrors((current) => {
      const next = { ...current }
      for (const key of keys) delete next[key]
      return next
    })

    let result: BranchWriteResult
    try {
      result = await updateBranch(tenantSlug, { branchId: branch.id, changes })
    } catch {
      result = { ok: false, code: 'error', message: OFFLINE }
    }

    if (result.ok) {
      const { branch: saved, savedAt } = result
      setOverlay((current) =>
        overlaySettle(current, mine, {
          savedAt,
          loadedAt: loadedAt.current,
          values: Object.fromEntries(
            changes.map((change) => [fieldKey(branch.id, change.field), saved[change.field]]),
          ),
        }),
      )
      if (isUndo) {
        notify.ok('Listo: quedó como estaba.')
      } else {
        notify.undoable(
          changes.map((change) => describeBranchChange(change, saved.name)).join(' · '),
          {
            id: `sucursal:${branch.id}`,
            onUndo: () => void saveBranch(saved, invertBranchChanges(changes), true),
          },
        )
      }
      router.refresh()
      return
    }

    const { current: now, message, code } = result
    setOverlay((current) =>
      overlayDrop(
        current,
        mine,
        now
          ? {
              at: Date.now(),
              loadedAt: loadedAt.current,
              values: Object.fromEntries(
                changes.map((change) => [fieldKey(branch.id, change.field), now[change.field]]),
              ),
            }
          : undefined,
      ),
    )
    const only = changes.length === 1 ? changes[0] : undefined
    if (only && TEXT_FIELDS.includes(only.field) && (code === 'invalid' || code === 'changed')) {
      setFieldErrors((current) => ({ ...current, [fieldKey(branch.id, only.field)]: message }))
    } else {
      notify.error(message)
    }
    if (code === 'changed' || code === 'gone') router.refresh()
  }

  // ── Guardar ajustes del punto de venta ──
  const saveSettings = async (changes: SettingChange[], isUndo = false) => {
    if (changes.length === 0) return
    const mine = ++token.current
    setOverlay((current) =>
      overlayStart(
        current,
        mine,
        changes.map((change) => [settingKey(change.key), change.value] as const),
      ),
    )
    setSettingErrors((current) => {
      const next = { ...current }
      for (const change of changes) delete next[change.key]
      return next
    })

    let result: SettingsWriteResult
    try {
      result = await savePosSettings(tenantSlug, { changes })
    } catch {
      result = { ok: false, code: 'error', message: OFFLINE }
    }

    if (result.ok) {
      const { settings: saved, savedAt } = result
      setOverlay((current) =>
        overlaySettle(current, mine, {
          savedAt,
          loadedAt: loadedAt.current,
          values: Object.fromEntries(
            changes.map((change) => [settingKey(change.key), saved[change.key]]),
          ),
        }),
      )
      if (isUndo) {
        notify.ok('Listo: quedó como estaba.')
      } else {
        notify.undoable(describeChanges(changes, saved), {
          id: 'ajustes',
          onUndo: () => void saveSettings(invertChanges(changes), true),
        })
      }
      router.refresh()
      return
    }

    const { current: now, message, code } = result
    setOverlay((current) =>
      overlayDrop(
        current,
        mine,
        now
          ? {
              at: Date.now(),
              loadedAt: loadedAt.current,
              values: Object.fromEntries(
                changes.map((change) => [settingKey(change.key), now[change.key]]),
              ),
            }
          : undefined,
      ),
    )
    const only = changes.length === 1 ? changes[0] : undefined
    if (only && code === 'invalid') {
      setSettingErrors((current) => ({ ...current, [only.key]: message }))
    } else {
      notify.error(message)
    }
    if (code === 'changed') router.refresh()
  }

  /** Una lista entera que volvió del servidor (cambió el orden o la principal): se ve ya. */
  const showList = (list: ReadonlyArray<Branch>, savedAt: number) => {
    const mine = ++token.current
    setOverlay((current) =>
      overlaySettle(
        overlayStart(
          current,
          mine,
          list.map((branch) => [rowKey(branch.id), branch] as const),
        ),
        mine,
        { savedAt, loadedAt: loadedAt.current },
      ),
    )
  }

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const name = cleanText(newName)
    if (name === '') {
      setCreateError('Ponele un nombre a la sucursal.')
      return
    }
    setBusy('create')
    let result: BranchWriteResult
    try {
      result = await createBranch(tenantSlug, { name })
    } catch {
      result = { ok: false, code: 'error', message: OFFLINE }
    }
    setBusy(null)
    if (!result.ok) {
      setCreateError(result.message)
      return
    }
    showList([result.branch], result.savedAt)
    setAdding(false)
    setNewName('')
    setCreateError(null)
    notify.ok(`${result.branch.name} ya está en la lista. Lo primero: su plano.`)
    router.push(branchHref(tenantSlug, result.branch.slug), { scroll: false })
    router.refresh()
  }

  const makeDefault = async (branch: Branch) => {
    const current = branches.find((item) => item.isDefault)
    if (!current || busy) return
    setBusy('default')
    try {
      const result = await setDefaultBranch(tenantSlug, {
        branchId: branch.id,
        expectedDefaultId: current.id,
      })
      if (result.ok) {
        showList(result.branches, result.savedAt)
        notify.ok(`${branch.name} es ahora la principal.`)
      } else {
        notify.error(result.message)
      }
    } catch {
      notify.error(OFFLINE)
    }
    setBusy(null)
    router.refresh()
  }

  const move = async (branch: Branch, direction: -1 | 1) => {
    const order = moveBranch(branches, branch.id, direction)
    if (!order || busy) return
    setBusy('order')
    try {
      const result = await reorderBranches(tenantSlug, { order })
      if (result.ok) showList(result.branches, result.savedAt)
      else notify.error(result.message)
    } catch {
      notify.error(OFFLINE)
    }
    setBusy(null)
    router.refresh()
  }

  const togglePractice = async (branch: Branch, on: boolean) => {
    if (busy) return
    setBusy('practice')
    try {
      const result = await setPractice(tenantSlug, branch.id, on)
      if (result.ok) {
        const { practiceUntil, cleared } = result.data
        setPracticeNow((current) => ({ ...current, [branch.id]: practiceUntil }))
        notify.ok(
          on
            ? `${branch.name} está en modo práctica: lo que se abra ahora no cuenta. Se apaga solo a las 5 de la mañana.`
            : cleared > 0
              ? `Práctica terminada en ${branch.name}. Se ${cleared === 1 ? 'levantó 1 mesa' : `levantaron ${cleared} mesas`} de prueba.`
              : `Práctica terminada en ${branch.name}.`,
        )
      } else {
        notify.error(result.message)
      }
    } catch {
      notify.error(OFFLINE)
    }
    setBusy(null)
    router.refresh()
  }

  const remove = async (branch: Branch) => {
    if (busy) return
    setBusy('delete')
    try {
      const result = await deleteBranch(tenantSlug, { branchId: branch.id })
      if (result.ok) {
        const mine = ++token.current
        const savedAt = result.savedAt
        setOverlay((current) =>
          overlaySettle(overlayStart(current, mine, [[rowKey(branch.id), null] as const]), mine, {
            savedAt,
            loadedAt: loadedAt.current,
          }),
        )
        setConfirmDelete(false)
        notify.ok(`${branch.name} se borró.`)
        router.push(branchHref(tenantSlug), { scroll: false })
      } else {
        setConfirmDelete(false)
        notify.error(result.message)
      }
    } catch {
      notify.error(OFFLINE)
    }
    setBusy(null)
    router.refresh()
  }

  const ratio = (branch: Branch) => {
    const opening = openings.get(branch.id)
    return opening && opening.counted > 0 ? opening.done / opening.counted : 0
  }

  return (
    <AdmPage width="comfortable">
      <AdmHeader
        title="Sucursales"
        description="Cada local con su plano, su cocina y su caja. La carta, el club y el equipo son de todo el bar."
        actions={
          <>
            <PillLink
              href={branchHref(tenantSlug, selected?.slug)}
              active={view === 'sucursales'}
              icon={Store}
              scroll={false}
            >
              Sucursales
            </PillLink>
            <PillLink
              href={settingsHref(tenantSlug)}
              active={view === 'ajustes'}
              icon={Wrench}
              scroll={false}
              data-testid="ver-ajustes"
            >
              Ajustes del punto de venta
            </PillLink>
          </>
        }
      />

      {view === 'ajustes' ? (
        <SettingsPane
          settings={settings}
          borrowed={snapshot.borrowed}
          multiBranch={!alone}
          saving={(key) => overlaySaving(overlay, settingKey(key))}
          errors={settingErrors}
          onChange={(changes) => void saveSettings(changes)}
          onClearError={(key) =>
            setSettingErrors((current) => {
              const next = { ...current }
              delete next[key]
              return next
            })
          }
        />
      ) : (
        <>
          {/* La cuadra: una vidriera por sucursal. */}
          <nav
            aria-label="Sucursales del bar"
            className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2"
          >
            {[...active, ...inactive].map((branch) => {
              const opening = openings.get(branch.id)
              const current = selected?.id === branch.id
              return (
                <Link
                  key={branch.id}
                  href={branchHref(tenantSlug, branch.slug)}
                  scroll={false}
                  aria-current={current ? 'page' : undefined}
                  data-testid={`sucursal-${branch.slug}`}
                  className={cn(
                    'flex w-36 shrink-0 flex-col items-center gap-1 rounded-2xl border px-3 pb-3 pt-2 text-center outline-none transition-colors duration-(--duration-fast) focus-visible:ring-[3px] focus-visible:ring-ring/40',
                    current
                      ? 'card-hairline border-border bg-card shadow-xs'
                      : 'border-transparent hover:bg-muted/60',
                  )}
                >
                  <Storefront
                    size="mini"
                    label={chipLabel(branch)}
                    color={branch.color}
                    open={ratio(branch)}
                    muted={!branch.active}
                    className="w-24"
                  />
                  <span className="flex max-w-full items-center gap-1 text-sm font-semibold leading-tight">
                    {branch.isDefault ? (
                      <Star aria-label="Principal" className="size-3 shrink-0 fill-current" />
                    ) : null}
                    <span className="truncate">{branch.name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {branch.active
                      ? opening
                        ? openingHeadline(opening, branch, alone).short
                        : ''
                      : 'Desactivada'}
                  </span>
                </Link>
              )
            })}
            {adding ? null : (
              <button
                type="button"
                onClick={() => {
                  notify.clear()
                  setAdding(true)
                }}
                data-testid="sucursal-nueva"
                className="flex w-36 shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border px-3 py-4 text-sm font-medium text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:border-foreground/30 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                <Plus aria-hidden className="size-5" />
                Nueva sucursal
              </button>
            )}
          </nav>

          {adding ? (
            <Panel
              title="Nueva sucursal"
              description="Alcanza con el nombre. El color, el nombre corto y la dirección se cambian después."
            >
              <form
                onSubmit={submitCreate}
                className="flex flex-col gap-3 sm:flex-row sm:items-start"
              >
                <div className="min-w-0 flex-1">
                  <label htmlFor="sucursal-nombre" className="sr-only">
                    Nombre de la sucursal
                  </label>
                  <input
                    id="sucursal-nombre"
                    // biome-ignore lint/a11y/noAutofocus: el formulario se abre porque la persona tocó «Nueva sucursal»; el foco va donde va a escribir.
                    autoFocus
                    value={newName}
                    onChange={(event) => {
                      setNewName(event.target.value)
                      if (createError) setCreateError(null)
                    }}
                    maxLength={NAME_MAX}
                    autoComplete="off"
                    placeholder="Por ejemplo: Cerro"
                    aria-invalid={createError ? true : undefined}
                    aria-describedby={createError ? 'sucursal-nombre-error' : undefined}
                    data-testid="sucursal-nombre"
                    className="h-11 w-full rounded-lg border border-input bg-background/60 px-3 text-base shadow-2xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:border-destructive sm:h-10 sm:text-sm"
                  />
                  {createError ? (
                    <p
                      id="sucursal-nombre-error"
                      role="alert"
                      className="mt-1.5 text-sm text-destructive text-pretty"
                    >
                      {createError}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy === 'create'} data-testid="sucursal-crear">
                    {busy === 'create' ? (
                      <LoaderCircle aria-hidden className="size-4 animate-spin" />
                    ) : null}
                    Crear
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy === 'create'}
                    onClick={() => {
                      setAdding(false)
                      setNewName('')
                      setCreateError(null)
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            </Panel>
          ) : null}

          {selected ? (
            <BranchSheet
              key={selected.id}
              tenantSlug={tenantSlug}
              branch={selected}
              branches={branches}
              opening={openings.get(selected.id) ?? null}
              facts={snapshot.facts[selected.id] ?? emptyFacts(cashReady)}
              alone={alone}
              tele={tele[selected.id] ?? null}
              saving={(field) => overlaySaving(overlay, fieldKey(selected.id, field))}
              errors={fieldErrors}
              busy={busy}
              onChange={(changes) => void saveBranch(selected, changes)}
              onClearError={(field) =>
                setFieldErrors((current) => {
                  const next = { ...current }
                  delete next[fieldKey(selected.id, field)]
                  return next
                })
              }
              onDefault={() => void makeDefault(selected)}
              onMove={(direction) => void move(selected, direction)}
              practiceUntil={
                selected.id in practiceNow
                  ? (practiceNow[selected.id] ?? null)
                  : (selected.practiceUntil ?? null)
              }
              now={snapshot.loadedAt}
              timeZone={timeZone}
              onPractice={(on) => void togglePractice(selected, on)}
              onAskDelete={() => {
                notify.clear()
                setConfirmDelete(true)
              }}
            />
          ) : null}

          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Borrar {selected?.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  No tiene plano, mesas ni historia, así que no se pierde nada. No se puede
                  deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy === 'delete'}>No, dejarla</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy === 'delete'}
                  onClick={(event) => {
                    event.preventDefault()
                    if (selected) void remove(selected)
                  }}
                  data-testid="sucursal-borrar-si"
                >
                  Sí, borrarla
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </AdmPage>
  )
}

/** La ficha de una sucursal: su vidriera, lo que le falta para abrir y sus datos. */
function BranchSheet({
  tenantSlug,
  branch,
  branches,
  opening,
  facts,
  alone,
  tele,
  saving,
  errors,
  busy,
  onChange,
  onClearError,
  onDefault,
  onMove,
  onAskDelete,
  practiceUntil,
  now,
  timeZone,
  onPractice,
}: {
  tenantSlug: string
  branch: Branch
  branches: ReadonlyArray<Branch>
  opening: Opening | null
  facts: BranchBoardSnapshot['facts'][string]
  alone: boolean
  tele: TeleLink | null
  saving: (field: BranchField) => boolean
  errors: Readonly<Record<string, string>>
  busy: string | null
  onChange: (changes: BranchChange[]) => void
  onClearError: (field: BranchField) => void
  onDefault: () => void
  onMove: (direction: -1 | 1) => void
  onAskDelete: () => void
  /** Hasta cuándo está en práctica; `null` = no está. */
  practiceUntil: string | null
  /** Reloj del servidor de la última lectura (ms). */
  now: number
  timeZone: string
  onPractice: (on: boolean) => void
}) {
  const headline = opening ? openingHeadline(opening, branch, alone) : null
  const open = opening && opening.counted > 0 ? opening.done / opening.counted : 0
  const deactivate = canDeactivate(branch, facts)
  const principal = canBeDefault(branch)
  const erase = canDelete(branch, facts)
  const moves = moveOptions(branches, branch.id)
  const error = (field: BranchField) => errors[fieldKey(branch.id, field)] ?? null
  const inPractice = practiceUntil !== null && new Date(practiceUntil).getTime() > now

  return (
    // En el teléfono la lista de apertura va justo después de la vidriera (es lo que hay que hacer);
    // en la compu, al lado. Por eso la columna izquierda se «desarma» en pantallas chicas.
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
      <div className="contents lg:block lg:space-y-6">
        <section
          aria-label={`La vidriera de ${branch.name}`}
          className="card-hairline order-1 rounded-2xl border bg-card p-5 shadow-xs"
        >
          <Storefront
            label={chipLabel(branch)}
            color={branch.color}
            open={open}
            muted={!branch.active}
            principal={branch.isDefault}
            className="mx-auto w-full max-w-[17rem]"
          />
          <div className="mt-4 space-y-1.5 text-center">
            <h2
              className="font-serif text-2xl font-semibold leading-tight tracking-tight text-balance"
              data-testid="sucursal-titular"
            >
              {branch.active ? (headline?.title ?? branch.name) : 'Desactivada'}
            </h2>
            <p className="mx-auto max-w-prose text-sm text-muted-foreground text-pretty">
              {branch.active
                ? headline?.sentence
                : 'No aparece en el salón ni en la caja. Sus datos y su historia siguen guardados.'}
            </p>
          </div>
        </section>

        <Panel
          title="Sus datos"
          description="Se guardan solos, y cada cambio se puede deshacer."
          className="order-3"
        >
          <div className="space-y-4">
            <AutosaveField<string>
              label="Nombre"
              testId="sucursal-campo-nombre"
              value={branch.name}
              format={(value) => value}
              read={readName}
              maxLength={NAME_MAX}
              autoCapitalize="words"
              saving={saving('name')}
              error={error('name')}
              onEdit={() => onClearError('name')}
              onCommit={(value) => onChange([{ field: 'name', value, expected: branch.name }])}
            />
            <AutosaveField<string | null>
              label="Nombre corto"
              hint="Es lo que se lee arriba en el salón y en el cartel. Vacío, va el nombre entero."
              testId="sucursal-campo-corto"
              value={branch.shortName}
              format={orEmpty}
              read={readShortName}
              maxLength={SHORT_NAME_MAX}
              autoCapitalize="words"
              saving={saving('shortName')}
              error={error('shortName')}
              onEdit={() => onClearError('shortName')}
              onCommit={(value) =>
                onChange([{ field: 'shortName', value, expected: branch.shortName }])
              }
            />
            <AutosaveField<string | null>
              label="Dirección"
              testId="sucursal-campo-direccion"
              value={branch.address}
              format={orEmpty}
              read={readAddress}
              maxLength={ADDRESS_MAX}
              saving={saving('address')}
              error={error('address')}
              onEdit={() => onClearError('address')}
              onCommit={(value) =>
                onChange([{ field: 'address', value, expected: branch.address }])
              }
            />

            <fieldset>
              <legend className="text-sm font-medium leading-snug">Color</legend>
              <p className="mt-1 text-sm text-muted-foreground text-pretty">
                Es el de su cartel, y el que se ve arriba en el salón para saber dónde estás.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {colorChoices(branch.color).map((choice) => {
                  const chosen = choice.hex.toLowerCase() === branch.color.toLowerCase()
                  return (
                    <button
                      key={choice.hex}
                      type="button"
                      aria-pressed={chosen}
                      title={choice.name}
                      disabled={saving('color')}
                      onClick={() => {
                        if (chosen) return
                        onChange([{ field: 'color', value: choice.hex, expected: branch.color }])
                      }}
                      className={cn(
                        'relative flex size-11 items-center justify-center rounded-full outline-none transition-transform duration-(--duration-fast) focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95 motion-reduce:transition-none',
                        chosen && 'ring-2 ring-foreground ring-offset-2 ring-offset-card',
                      )}
                      style={{ backgroundColor: choice.hex }}
                    >
                      <span className="sr-only">{choice.name}</span>
                      {chosen ? <Check aria-hidden className="size-4 text-white" /> : null}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          </div>
        </Panel>

        <Panel
          title="Modo práctica"
          description="Para enseñar a usar el sistema sin ensuciar los números."
          className="order-4"
        >
          <div className="flex items-start justify-between gap-4">
            <p
              className="min-w-0 text-sm text-muted-foreground text-pretty"
              data-testid="practica-texto"
            >
              {inPractice
                ? `Prendido hasta las ${clockAt(practiceUntil, timeZone)}. Cada mesa que se abra ahora es de prueba: se carga, sale en cocina con su cinta de «Prueba» y se cobra, pero no entra en la caja ni suma puntos. Al apagarlo, las mesas de prueba se levantan.`
                : 'Con la práctica prendida, cada mesa que se abra en esta sucursal es de prueba: se carga, sale en cocina y se cobra, pero no entra en la caja, no suma puntos y no toca las reservas. Se apaga sola a las 5 de la mañana.'}
            </p>
            <Switch
              checked={inPractice}
              disabled={busy !== null || !branch.active}
              aria-label={`Modo práctica en ${branch.name}`}
              data-testid="sucursal-practica"
              onCheckedChange={onPractice}
            />
          </div>
        </Panel>

        {alone ? null : (
          <Panel title="Su lugar en el bar" className="order-5">
            <div className="divide-y divide-border/60">
              <Row
                title="Principal"
                text={
                  branch.isDefault
                    ? 'Es la principal: la que se abre primero en un dispositivo que todavía no eligió.'
                    : principal.ok
                      ? 'La principal es la que se abre primero en un dispositivo que todavía no eligió.'
                      : principal.why
                }
              >
                {branch.isDefault ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                    <Star aria-hidden className="size-4 fill-current" />
                    Principal
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!principal.ok || busy !== null}
                    onClick={onDefault}
                    data-testid="sucursal-principal"
                  >
                    Hacerla principal
                  </Button>
                )}
              </Row>

              {branch.active && !branch.isDefault ? (
                <Row
                  title="Orden"
                  text={`Va ${moves.place}.ª de ${moves.of} en la lista y donde se elige sucursal.`}
                >
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Antes"
                      disabled={!moves.earlier || busy !== null}
                      onClick={() => onMove(-1)}
                    >
                      <ArrowLeft aria-hidden className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Después"
                      disabled={!moves.later || busy !== null}
                      onClick={() => onMove(1)}
                    >
                      <ArrowRight aria-hidden className="size-4" />
                    </Button>
                  </div>
                </Row>
              ) : null}

              <Row
                title="Activa"
                text={
                  branch.active
                    ? deactivate.ok
                      ? 'Desactivada no aparece en el salón ni en la caja. No se pierde nada.'
                      : deactivate.why
                    : 'Activala para que vuelva a aparecer en el salón y en la caja.'
                }
              >
                <Switch
                  checked={branch.active}
                  disabled={saving('active') || (branch.active && !deactivate.ok)}
                  aria-label={`${branch.name} activa`}
                  data-testid="sucursal-activa"
                  onCheckedChange={(value) =>
                    onChange([{ field: 'active', value, expected: branch.active }])
                  }
                />
              </Row>

              <Row
                title="Borrar"
                text={
                  erase.ok
                    ? 'Todavía no tiene plano, mesas ni historia: se puede borrar.'
                    : erase.why
                }
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!erase.ok || busy !== null}
                  onClick={onAskDelete}
                  data-testid="sucursal-borrar"
                >
                  <Trash2 aria-hidden className="size-4" />
                  Borrar
                </Button>
              </Row>
            </div>
          </Panel>
        )}
      </div>

      <Panel
        className="order-2 lg:order-none"
        title="Lista de apertura"
        description={
          opening
            ? `${opening.done} de ${opening.counted} listos. Nadie tilda nada a mano: cada paso se tilda solo cuando está cargado.`
            : undefined
        }
      >
        <ol className="divide-y divide-border/60">
          {(opening?.steps ?? []).map((step, index) => (
            <Step
              key={step.id}
              step={step}
              number={index + 1}
              tenantSlug={tenantSlug}
              branchSlug={branch.slug}
              tele={tele}
            />
          ))}
        </ol>
      </Panel>
    </div>
  )
}

function Row({
  title,
  text,
  children,
}: {
  title: string
  text: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold leading-snug">{title}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground text-pretty">{text}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** Un paso de la lista: hecho (tilde), falta (su número) o todavía no se puede. */
function Step({
  step,
  number,
  tenantSlug,
  branchSlug,
  tele,
}: {
  step: OpeningStep
  number: number
  tenantSlug: string
  branchSlug: string
  tele: TeleLink | null
}) {
  const links = stepLinks(step, { tenantSlug, branchSlug })
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    if (!tele) return
    try {
      await navigator.clipboard.writeText(tele.url)
      setCopied(true)
    } catch {
      notify.error('No se pudo copiar. Mantené apretado el link y copialo a mano.')
    }
  }

  return (
    <li
      id={stepAnchor(step.id)}
      data-state={step.state}
      data-testid={`paso-${step.id}`}
      className="flex scroll-mt-28 gap-3.5 py-4 first:pt-0 last:pb-0"
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
          step.state === 'done' && 'bg-success/15 text-success',
          step.state === 'todo' && 'bg-foreground text-background',
          step.state === 'soon' && 'border border-dashed border-border text-muted-foreground',
        )}
      >
        {step.state === 'done' ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.5 8.5l3 3 6-7" className="suc-tick" />
          </svg>
        ) : (
          number
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold leading-snug">
          {step.title}
          <span className="sr-only">
            {step.state === 'done'
              ? ': listo'
              : step.state === 'todo'
                ? ': falta'
                : ': más adelante'}
          </span>
          {step.shared ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">de todo el bar</span>
          ) : null}
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground text-pretty">{step.detail}</p>
        {step.notes.map((note) => (
          <p key={note} className="mt-1 text-sm text-warning-text text-pretty">
            {note}
          </p>
        ))}

        {step.id === 'kitchen' && tele ? (
          <div className="mt-3 flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/40 p-3 sm:flex-row sm:items-center">
            {tele.qr ? (
              <div
                className="suc-qr w-24 shrink-0 rounded-lg bg-white p-1.5"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: el SVG del QR lo arma el servidor (`renderQrSvg`) a partir de un link propio; no lleva nada escrito por una persona.
                dangerouslySetInnerHTML={{ __html: tele.qr }}
              />
            ) : null}
            <div className="min-w-0 space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Tv aria-hidden className="size-4" />
                La pantalla de cocina de esta sucursal
              </p>
              <p className="break-all text-xs text-muted-foreground">{tele.url}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void copy()}>
                  {copied ? (
                    <Check aria-hidden className="size-4" />
                  ) : (
                    <Copy aria-hidden className="size-4" />
                  )}
                  {copied ? 'Copiado' : 'Copiar el link'}
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <a href={tele.url} target="_blank" rel="noopener noreferrer">
                    Abrirla acá
                  </a>
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {links.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {links.map((link, index) => (
              <Button
                key={link.href}
                asChild
                size="sm"
                variant={index === 0 && step.state === 'todo' ? 'default' : 'outline'}
              >
                <Link
                  href={link.href}
                  target={link.newTab ? '_blank' : undefined}
                  rel={link.newTab ? 'noopener noreferrer' : undefined}
                >
                  {link.label}
                </Link>
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  )
}
