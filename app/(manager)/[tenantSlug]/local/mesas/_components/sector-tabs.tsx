'use client'

import { ArrowLeft, ArrowRight, Plus, Settings2, Trash2 } from 'lucide-react'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  createAreaAction,
  deleteAreaAction,
  renameAreaAction,
  reorderAreasAction,
  updateAreaCanvasAction,
} from '@/lib/floor-plan/actions'
import { isSectorNameTaken } from '@/lib/floor-plan/branches'
import { GRID } from '@/lib/floor-plan/grid'
import type { AreaRow } from '@/lib/floor-plan/queries'
import { cn } from '@/lib/utils'
import { PAPEL } from './papel'

// Nombres con los que suele arrancar un bar: se ofrecen los que todavía no usó.
const NAME_IDEAS = ['Salón', 'Planta alta', 'Planta baja', 'Terraza', 'Vereda', 'Patio']

/** El piso mide entre 10 y 300 cuadros de lado (200 a 6000 en la base). */
const MIN_CELLS = 10
const MAX_CELLS = 300
/** El tope que acepta la base para «numerar desde». */
const MAX_NUMBER_START = 100000

const takenMessage = (multiBranch: boolean) =>
  multiBranch
    ? 'Ya hay un sector con ese nombre en esta sucursal. Probá con otro.'
    : 'Ya hay un sector con ese nombre. Probá con otro.'

// ─── Crear un sector ─────────────────────────────────────────────────────────

export type SectorCreateFormProps = {
  slug: string
  /** La sucursal donde se crea. `null` = el bar no tiene sucursales cargadas (cae en la principal). */
  branchId: string | null
  /** Los sectores de ESTA sucursal (el nombre no se puede repetir entre ellos). */
  sectors: readonly { id: string; name: string }[]
  multiBranch: boolean
  /** Desde qué número conviene numerar las mesas del sector nuevo. */
  suggestedStart: number
  autoFocus?: boolean
  onCreated: (areaId: string | null) => void
}

export function SectorCreateForm({
  slug,
  branchId,
  sectors,
  multiBranch,
  suggestedStart,
  autoFocus,
  onCreated,
}: SectorCreateFormProps) {
  const id = useId()
  const [name, setName] = useState('')
  const [start, setStart] = useState(String(suggestedStart))
  const [error, setError] = useState<string | null>(null)
  const [pending, run] = useTransition()

  const taken = isSectorNameTaken(sectors, name)
  const ideas = NAME_IDEAS.filter((idea) => !isSectorNameTaken(sectors, idea)).slice(0, 4)
  const problem = taken ? takenMessage(multiBranch) : error

  const submit = () => {
    const clean = name.trim()
    if (!clean) {
      setError('Ponele un nombre al sector.')
      return
    }
    if (taken) return
    // Vacío = lo sugerido. Lo demás tiene que ser un número de mesa posible.
    const parsedStart = start.trim() === '' ? suggestedStart : Number.parseInt(start, 10)
    if (!Number.isFinite(parsedStart) || parsedStart < 0 || parsedStart > MAX_NUMBER_START) {
      setError(`El primer número de mesa va de 0 a ${MAX_NUMBER_START}.`)
      return
    }
    run(async () => {
      const result = await createAreaAction(slug, {
        name: clean,
        number_start: parsedStart,
        ...(branchId ? { branch_id: branchId } : {}),
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      const created = (result.data as { id?: string } | undefined)?.id ?? null
      toast.success(`Listo: ya podés dibujar «${clean}».`)
      setName('')
      setError(null)
      onCreated(created)
    })
  }

  return (
    <form
      className="fpe-form"
      // Los avisos los da el formulario, con la voz del producto (no el globo del navegador).
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="fpe-field">
        <label className="fpe-label" htmlFor={`${id}-name`}>
          Nombre del sector
        </label>
        <input
          id={`${id}-name`}
          className="fpe-input"
          value={name}
          maxLength={40}
          // biome-ignore lint/a11y/noAutofocus: la ventanita se abre para escribir el nombre
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder="Salón, Planta alta, Terraza…"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-error` : undefined}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
        />
        {problem ? (
          <p id={`${id}-error`} className="fpe-error" role="alert">
            {problem}
          </p>
        ) : null}
        {ideas.length > 0 && name.trim() === '' ? (
          <div className="fpe-chips">
            {ideas.map((idea) => (
              <button key={idea} type="button" className="fpe-chip" onClick={() => setName(idea)}>
                {idea}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="fpe-field">
        <label className="fpe-label" htmlFor={`${id}-start`}>
          Numerar las mesas desde
        </label>
        <input
          id={`${id}-start`}
          className="fpe-input fpe-input-num"
          type="number"
          inputMode="numeric"
          min={0}
          max={100000}
          value={start}
          onChange={(e) => {
            setStart(e.target.value)
            setError(null)
          }}
        />
        <p className="fpe-hint">
          Así cada sector tiene sus números y ninguna mesa se repite: el salón del 1 al 19, la
          terraza desde el 20.
        </p>
      </div>

      <button type="submit" className="fpe-btn fpe-btn-primary fpe-btn-block" disabled={pending}>
        {pending ? 'Creando…' : 'Crear sector'}
      </button>
    </form>
  )
}

// ─── Ajustes de un sector ────────────────────────────────────────────────────

type SectorSettingsProps = {
  slug: string
  area: AreaRow
  index: number
  sectors: readonly AreaRow[]
  multiBranch: boolean
  /** Hasta dónde llega lo dibujado: el piso no se puede achicar por debajo de eso. */
  extent: { width: number; height: number }
  onChanged: () => void
  onClose: () => void
}

function SectorSettings({
  slug,
  area,
  index,
  sectors,
  multiBranch,
  extent,
  onChanged,
  onClose,
}: SectorSettingsProps) {
  const id = useId()
  const initialCols = Math.ceil(area.width / GRID)
  const initialRows = Math.ceil(area.height / GRID)
  const [name, setName] = useState(area.name)
  const [cols, setCols] = useState(String(initialCols))
  const [rows, setRows] = useState(String(initialRows))
  const [start, setStart] = useState(String(area.number_start))
  const [error, setError] = useState<string | null>(null)
  const [pending, run] = useTransition()

  const taken = isSectorNameTaken(sectors, name, area.id)
  const minCols = Math.max(MIN_CELLS, Math.ceil(extent.width / GRID))
  const minRows = Math.max(MIN_CELLS, Math.ceil(extent.height / GRID))

  const save = () => {
    const clean = name.trim()
    if (!clean) {
      setError('El sector necesita un nombre.')
      return
    }
    if (taken) return
    const nextCols = Number.parseInt(cols, 10)
    const nextRows = Number.parseInt(rows, 10)
    const nextStart = Number.parseInt(start, 10)
    if (!Number.isFinite(nextCols) || !Number.isFinite(nextRows)) {
      setError('Decime cuántos cuadros mide el piso.')
      return
    }
    if (nextCols > MAX_CELLS || nextRows > MAX_CELLS) {
      setError(`El piso puede medir hasta ${MAX_CELLS} cuadros de lado.`)
      return
    }
    if (nextCols < minCols || nextRows < minRows) {
      setError(
        `Hay cosas dibujadas hasta ahí: el piso no puede medir menos de ${minCols} × ${minRows} cuadros. Movelas antes de achicarlo.`,
      )
      return
    }
    if (!Number.isFinite(nextStart) || nextStart < 0 || nextStart > MAX_NUMBER_START) {
      setError(`El primer número de mesa va de 0 a ${MAX_NUMBER_START}.`)
      return
    }
    const nameChanged = clean !== area.name
    const floorChanged =
      nextCols !== initialCols || nextRows !== initialRows || nextStart !== area.number_start
    if (!nameChanged && !floorChanged) {
      onClose()
      return
    }
    run(async () => {
      if (nameChanged) {
        const renamed = await renameAreaAction(slug, { id: area.id, name: clean })
        if (!renamed.ok) {
          setError(renamed.message)
          return
        }
      }
      if (floorChanged) {
        const resized = await updateAreaCanvasAction(slug, {
          id: area.id,
          // Si no tocó el tamaño se conserva el exacto (puede no ser múltiplo del cuadro).
          width: nextCols === initialCols ? area.width : nextCols * GRID,
          height: nextRows === initialRows ? area.height : nextRows * GRID,
          number_start: nextStart,
        })
        if (!resized.ok) {
          setError(resized.message)
          return
        }
      }
      toast.success('Sector guardado.')
      onChanged()
      onClose()
    })
  }

  const move = (dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= sectors.length) return
    const ids = sectors.map((s) => s.id)
    const [moved] = ids.splice(index, 1)
    if (!moved) return
    ids.splice(target, 0, moved)
    run(async () => {
      const result = await reorderAreasAction(slug, ids)
      if (result.ok) onChanged()
      else toast.error(result.message)
    })
  }

  const remove = () => {
    run(async () => {
      const result = await deleteAreaAction(slug, area.id)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(`Sector «${area.name}» borrado.`)
      onChanged()
      onClose()
    })
  }

  const problem = taken ? takenMessage(multiBranch) : error

  return (
    <form
      className="fpe-form"
      // Los avisos los da el formulario, con la voz del producto (no el globo del navegador).
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <h2 className="fpe-pop-title">Ajustes de {area.name}</h2>

      <div className="fpe-field">
        <label className="fpe-label" htmlFor={`${id}-name`}>
          Nombre
        </label>
        <input
          id={`${id}-name`}
          className="fpe-input"
          value={name}
          maxLength={40}
          autoComplete="off"
          aria-invalid={taken ? true : undefined}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
        />
      </div>

      <div className="fpe-field">
        <span className="fpe-label">Tamaño del piso, en cuadros</span>
        <div className="fpe-grid-2">
          <div className="fpe-field">
            <label className="fpe-sr" htmlFor={`${id}-cols`}>
              Ancho del piso, en cuadros
            </label>
            <input
              id={`${id}-cols`}
              className="fpe-input fpe-input-num"
              type="number"
              inputMode="numeric"
              min={minCols}
              max={MAX_CELLS}
              value={cols}
              onChange={(e) => {
                setCols(e.target.value)
                setError(null)
              }}
            />
            <span className="fpe-hint">de ancho</span>
          </div>
          <div className="fpe-field">
            <label className="fpe-sr" htmlFor={`${id}-rows`}>
              Fondo del piso, en cuadros
            </label>
            <input
              id={`${id}-rows`}
              className="fpe-input fpe-input-num"
              type="number"
              inputMode="numeric"
              min={minRows}
              max={MAX_CELLS}
              value={rows}
              onChange={(e) => {
                setRows(e.target.value)
                setError(null)
              }}
            />
            <span className="fpe-hint">de fondo</span>
          </div>
        </div>
        <p className="fpe-hint">Una mesa de cuatro ocupa 4 × 4 cuadros.</p>
      </div>

      <div className="fpe-field">
        <label className="fpe-label" htmlFor={`${id}-start`}>
          Numerar las mesas nuevas desde
        </label>
        <input
          id={`${id}-start`}
          className="fpe-input fpe-input-num"
          type="number"
          inputMode="numeric"
          min={0}
          max={100000}
          value={start}
          onChange={(e) => {
            setStart(e.target.value)
            setError(null)
          }}
        />
      </div>

      {problem ? (
        <p className="fpe-error" role="alert">
          {problem}
        </p>
      ) : null}

      <button type="submit" className="fpe-btn fpe-btn-primary fpe-btn-block" disabled={pending}>
        {pending ? 'Guardando…' : 'Guardar'}
      </button>

      {sectors.length > 1 ? (
        <div className="fpe-field">
          <span className="fpe-label">Orden de las pestañas</span>
          <div className="fpe-grid-2">
            <button
              type="button"
              className="fpe-btn fpe-btn-quiet fpe-btn-sm"
              disabled={pending || index === 0}
              onClick={() => move(-1)}
            >
              <ArrowLeft aria-hidden />
              Antes
            </button>
            <button
              type="button"
              className="fpe-btn fpe-btn-quiet fpe-btn-sm"
              disabled={pending || index === sectors.length - 1}
              onClick={() => move(1)}
            >
              Después
              <ArrowRight aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button type="button" className="fpe-btn fpe-btn-danger fpe-btn-sm" disabled={pending}>
            <Trash2 aria-hidden />
            Borrar este sector
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent className={cn(PAPEL, 'fpe-dialog')}>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar el sector «{area.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra con sus paredes y todo lo que no sea una mesa. Si tiene mesas dibujadas,
              primero quitalas del plano o pasalas a otro sector. No tiene vuelta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="fpe-btn fpe-btn-quiet">Dejarlo</AlertDialogCancel>
            <AlertDialogAction className="fpe-btn fpe-btn-danger-solid" onClick={remove}>
              Borrar el sector
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}

// ─── Las pestañas ────────────────────────────────────────────────────────────

export type SectorTabsProps = {
  slug: string
  branchId: string | null
  multiBranch: boolean
  areas: readonly AreaRow[]
  activeAreaId: string
  /** Mesas dibujadas en cada sector. */
  counts: Readonly<Record<string, number>>
  /** En vivo: mesas con algo pendiente por sector (reemplaza a la cuenta de mesas). */
  pending?: Readonly<Record<string, number>> | null
  /** Editando se puede agregar un sector y cambiar sus ajustes. */
  editable: boolean
  suggestedStart: number
  /** Hasta dónde llega lo dibujado en el sector activo. */
  extent: { width: number; height: number }
  onSelect: (areaId: string) => void
  onCreated: (areaId: string | null) => void
  onChanged: () => void
}

/**
 * Los sectores de la sucursal como solapas de fichero pegadas al paño (igual
 * que en el salón). Un sector es un piso o un ambiente: «Salón», «Planta alta»,
 * «Terraza». Al final, la solapa punteada para agregar uno y los ajustes del
 * que se está mirando. No trae su propia franja: va adentro de la barra del
 * editor (`fpe-bar`), al lado de «Editar · En vivo · Lista».
 */
export function SectorTabs({
  slug,
  branchId,
  multiBranch,
  areas,
  activeAreaId,
  counts,
  pending,
  editable,
  suggestedStart,
  extent,
  onSelect,
  onCreated,
  onChanged,
}: SectorTabsProps) {
  const [adding, setAdding] = useState(false)
  const [settings, setSettings] = useState(false)
  const activeIndex = areas.findIndex((a) => a.id === activeAreaId)
  const active = activeIndex >= 0 ? areas[activeIndex] : undefined

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: un grupo de botones con nombre, no un formulario */}
      <div className="fpe-tabs" role="group" aria-label="Sectores">
        {areas.map((area) => {
          const selected = area.id === activeAreaId
          const waiting = pending?.[area.id] ?? 0
          const tables = counts[area.id] ?? 0
          return (
            <button
              key={area.id}
              type="button"
              className={cn('fpe-tab', selected && 'is-active')}
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelect(area.id)}
            >
              {area.name}
              {pending ? (
                waiting > 0 ? (
                  <span className="fpe-tab-count is-pending">
                    {waiting}
                    <span className="fpe-sr"> con algo pendiente</span>
                  </span>
                ) : null
              ) : (
                <span className="fpe-tab-count">
                  {tables}
                  <span className="fpe-sr"> {tables === 1 ? 'mesa' : 'mesas'}</span>
                </span>
              )}
            </button>
          )
        })}

        {editable ? (
          <Popover open={adding} onOpenChange={setAdding}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="fpe-tab fpe-tab-add"
                aria-label="Agregar un sector"
                title="Agregar un sector"
              >
                <Plus aria-hidden />
                <span className="fpe-wide-only">Sector</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={8} className={cn(PAPEL, 'fpe-pop')}>
              <div className="fpe-form">
                <div className="fpe-field">
                  <h2 className="fpe-pop-title">Un sector nuevo</h2>
                  <p className="fpe-hint">
                    Un piso o un ambiente del local, con su propio plano y sus mesas.
                  </p>
                </div>
                <SectorCreateForm
                  slug={slug}
                  branchId={branchId}
                  sectors={areas}
                  multiBranch={multiBranch}
                  suggestedStart={suggestedStart}
                  autoFocus
                  onCreated={(areaId) => {
                    setAdding(false)
                    onCreated(areaId)
                  }}
                />
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>

      {editable && active ? (
        <Popover open={settings} onOpenChange={setSettings}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="fpe-boardbtn"
              aria-label={`Ajustes del sector ${active.name}`}
              title={`Ajustes de ${active.name}: nombre, tamaño y numeración`}
            >
              <Settings2 aria-hidden />
              <span className="fpe-wide-only">Ajustes</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} className={cn(PAPEL, 'fpe-pop')}>
            <SectorSettings
              // Otra pestaña, otro formulario: no se arrastran los datos del sector anterior.
              key={`${active.id}:${active.name}:${active.width}:${active.height}:${active.number_start}`}
              slug={slug}
              area={active}
              index={activeIndex}
              sectors={areas}
              multiBranch={multiBranch}
              extent={extent}
              onChanged={onChanged}
              onClose={() => setSettings(false)}
            />
          </PopoverContent>
        </Popover>
      ) : null}
    </>
  )
}
