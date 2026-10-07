'use client'

import { Pencil, Plus, UserRoundCog } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldRow, FormError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { StatusBadge, type StatusMap } from '@/components/ui/status-badge'
import { Switch } from '@/components/ui/switch'
import { upsertManager } from '@/lib/salon/actions'
import type { ReservationManagerRow } from '@/lib/salon/types'

export type TeamMemberOption = {
  user_id: string
  email: string
  full_name: string | null
}

const UNLINKED = 'none'

type ManagerState = 'activo' | 'inactivo'

/** Si toma reservas hoy. Un gestor inactivo no se borra: sus comisiones viejas quedan. */
const MANAGER_STATE: StatusMap<ManagerState> = {
  activo: { label: 'Activo', tone: 'success' },
  inactivo: {
    label: 'Inactivo',
    tone: 'neutral',
    description: 'No aparece en el combo de reservas. Sus comisiones viejas quedan.',
  },
}

/** Una fila de la lista. `_key` es la clave de React, estable aunque el id llegue después. */
type Row = Partial<ReservationManagerRow> & { _key: string }

/** Lo que se edita en la hoja (los textos tal cual se tipean). */
type EditorState = {
  key: string | null
  id: string | null
  display_name: string
  phone: string | null
  email: string | null
  user_id: string | null
  commission_eligible: boolean
  active: boolean
  notes: string | null
}

type EditorErrors = { display_name?: string; phone?: string; email?: string; form?: string }

function toEditor(row: Row | null): EditorState {
  return {
    key: row?._key ?? null,
    id: row?.id ?? null,
    display_name: row?.display_name ?? '',
    phone: row?.phone ?? null,
    email: row?.email ?? null,
    user_id: row?.user_id ?? null,
    commission_eligible: row?.commission_eligible ?? false,
    active: row?.active ?? true,
    notes: row?.notes ?? null,
  }
}

/**
 * Gestores de reservas: una lista para ver de un vistazo quién toma reservas,
 * quién cobra comisión y con qué cuenta del equipo está vinculado, y una hoja
 * al costado para cargar o editar uno sin perder la lista. Antes era una
 * tabla de 880 px con campos en cada celda: en el celular había que
 * desplazarla de costado para llegar a «Guardar».
 */
export function ManagersList({
  tenantSlug,
  initial,
  members,
  membersUnavailable = false,
}: {
  tenantSlug: string
  initial: ReservationManagerRow[]
  members: TeamMemberOption[]
  /** No se pudieron leer las cuentas del equipo: el combo de vincular queda corto. */
  membersUnavailable?: boolean
}) {
  const [rows, setRows] = useState<Row[]>(() => initial.map((m) => ({ ...m, _key: m.id })))
  const [editor, setEditor] = useState<EditorState>(() => toEditor(null))
  const [sheetOpen, setSheetOpen] = useState(false)
  const [errors, setErrors] = useState<EditorErrors>({})
  const [pending, startTransition] = useTransition()
  const keySeq = useRef(0)
  const nameRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const memberName = (userId: string | null | undefined): string | null => {
    if (!userId) return null
    const member = members.find((m) => m.user_id === userId)
    return member ? (member.full_name ?? member.email) : 'Cuenta fuera del equipo'
  }

  function openEditor(row: Row | null) {
    setEditor(toEditor(row))
    setErrors({})
    setSheetOpen(true)
  }

  function patch<K extends keyof EditorState>(field: K, value: EditorState[K]) {
    setEditor((prev) => ({ ...prev, [field]: value }))
    if (field === 'display_name' || field === 'phone' || field === 'email') {
      setErrors((prev) => ({ ...prev, [field]: undefined, form: undefined }))
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor.display_name.trim()) {
      setErrors({ display_name: 'Poné un nombre: es como aparece en el combo de reservas.' })
      nameRef.current?.focus()
      return
    }
    const sent = editor
    const payload = {
      ...(sent.id ? { id: sent.id } : {}),
      display_name: sent.display_name,
      phone: sent.phone ?? null,
      email: sent.email ?? null,
      commission_eligible: sent.commission_eligible,
      active: sent.active,
      notes: sent.notes ?? null,
      user_id: sent.user_id ?? null,
    }
    startTransition(async () => {
      const r = await upsertManager(tenantSlug, payload as Record<string, unknown>)
      if (!r.ok) {
        if (r.field === 'display_name' || r.field === 'phone' || r.field === 'email') {
          setErrors({ [r.field]: r.message })
        } else {
          setErrors({ form: r.message })
        }
        return
      }
      const id = (r.data?.id as string | undefined) ?? sent.id ?? undefined
      const saved: Partial<ReservationManagerRow> = {
        id,
        display_name: sent.display_name,
        phone: sent.phone,
        email: sent.email,
        commission_eligible: sent.commission_eligible,
        active: sent.active,
        notes: sent.notes,
        user_id: sent.user_id,
      }
      if (sent.key) {
        setRows((prev) => prev.map((x) => (x._key === sent.key ? { ...x, ...saved } : x)))
      } else {
        keySeq.current += 1
        const key = id ?? `nuevo-${keySeq.current}`
        // Los nuevos van arriba, como antes: es donde se los busca después de guardar.
        setRows((prev) => [{ ...saved, _key: key }, ...prev])
      }
      setSheetOpen(false)
      toast.success('Gestor guardado.')
    })
  }

  const isNew = editor.key === null
  const linkedOutsideTeam =
    editor.user_id !== null && !members.some((m) => m.user_id === editor.user_id)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex max-w-prose flex-col gap-1 text-pretty type-small text-muted-foreground">
          <p>
            Todo el que entra al equipo aparece acá solo y queda disponible en el combo de reservas.
            Al que ya no tome reservas, ponelo como inactivo: no se borra y sus comisiones viejas
            quedan.
          </p>
          <p>
            Con la cuenta del equipo vinculada, esa persona ve sus comisiones en{' '}
            <span className="font-medium text-foreground">Mis números</span>. Si alguien ya estaba
            cargado a mano y después le diste cuenta, vinculásela en vez de dejar dos filas con el
            mismo nombre.
          </p>
        </div>
        <Button type="button" onClick={() => openEditor(null)} className="shrink-0 max-sm:w-full">
          <Plus aria-hidden />
          Nuevo gestor
        </Button>
      </div>

      {membersUnavailable ? (
        <Callout
          tone="warning"
          title="No pudimos leer las cuentas del equipo"
          action={
            <Button type="button" size="sm" variant="secondary" onClick={() => router.refresh()}>
              Reintentar
            </Button>
          }
        >
          Podés editar a los gestores, pero el combo para vincular una cuenta va a aparecer vacío
          hasta que se puedan leer.
        </Callout>
      ) : null}

      <DataTable
        caption="Gestores de reservas"
        rows={rows}
        getRowId={(row) => row._key}
        empty={
          <EmptyState
            size="sm"
            icon={UserRoundCog}
            title="Todavía no hay gestores"
            description="Los que entran al equipo aparecen acá solos. También podés cargar uno a mano."
            action={
              <Button type="button" size="sm" onClick={() => openEditor(null)}>
                <Plus aria-hidden />
                Nuevo gestor
              </Button>
            }
          />
        }
        columns={[
          {
            id: 'gestor',
            header: 'Gestor',
            // Toma el ancho que sobra y recorta el teléfono y el mail largos: sin
            // esto su línea sin cortes empujaba al resto («Sin / vincular» en dos
            // renglones) y la tabla se pasaba del borde.
            className: 'w-full max-w-0',
            cell: (row) => (
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{row.display_name || 'Sin nombre'}</span>
                {row.phone || row.email ? (
                  <span className="truncate type-small font-normal text-muted-foreground max-md:hidden">
                    {[row.phone, row.email].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            id: 'cuenta',
            header: 'Cuenta del equipo',
            className: 'whitespace-nowrap',
            cell: (row) =>
              memberName(row.user_id) ?? (
                <span className="text-subtle-foreground">Sin vincular</span>
              ),
          },
          {
            id: 'comision',
            header: 'Comisión',
            className: 'whitespace-nowrap',
            cell: (row) =>
              row.commission_eligible ? (
                <Badge tone="brand">Cobra</Badge>
              ) : (
                <span className="text-muted-foreground">No cobra</span>
              ),
          },
          {
            id: 'estado',
            header: 'Estado',
            className: 'whitespace-nowrap',
            cell: (row) => (
              <StatusBadge
                status={row.active === false ? 'inactivo' : 'activo'}
                map={MANAGER_STATE}
              />
            ),
          },
          {
            id: 'acciones',
            header: 'Acciones',
            headerHidden: true,
            align: 'end',
            cell: (row) => (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => openEditor(row)}
                aria-label={`Editar a ${row.display_name || 'este gestor'}`}
              >
                <Pencil aria-hidden />
                Editar
              </Button>
            ),
          },
        ]}
      />

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (pending) return
          setSheetOpen(open)
        }}
      >
        <SheetContent size="md" className="gap-0">
          <SheetHeader>
            <SheetTitle>{isNew ? 'Nuevo gestor' : 'Editar gestor'}</SheetTitle>
            <SheetDescription>
              {isNew
                ? 'Queda disponible en el combo de reservas apenas lo guardás.'
                : `Los cambios se ven en el combo de reservas y en las comisiones de ${editor.display_name || 'este gestor'}.`}
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={save} noValidate className="flex min-h-0 flex-1 flex-col">
            <SheetBody className="flex flex-col gap-4">
              <FormError message={errors.form} />
              <Field label="Nombre" error={errors.display_name} required>
                <Input
                  ref={nameRef}
                  value={editor.display_name}
                  onChange={(e) => patch('display_name', e.target.value)}
                  placeholder="Luz"
                  maxLength={80}
                  autoComplete="off"
                />
              </Field>
              <FieldRow>
                <Field label="Teléfono" error={errors.phone} optional>
                  <Input
                    type="tel"
                    inputMode="tel"
                    value={editor.phone ?? ''}
                    onChange={(e) => patch('phone', e.target.value)}
                    placeholder="+54 9 351…"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Email" error={errors.email} optional>
                  <Input
                    type="email"
                    inputMode="email"
                    value={editor.email ?? ''}
                    onChange={(e) => patch('email', e.target.value)}
                    placeholder="luz@hub.com"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                </Field>
              </FieldRow>
              <Field
                label="Cuenta del equipo"
                hint="Vinculada, la persona ve sus comisiones en «Mis números»."
              >
                <Select
                  value={editor.user_id ?? UNLINKED}
                  onValueChange={(v) => patch('user_id', v === UNLINKED ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sin vincular" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNLINKED}>Sin vincular</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.full_name ?? m.email}
                      </SelectItem>
                    ))}
                    {editor.user_id && linkedOutsideTeam ? (
                      <SelectItem value={editor.user_id}>Cuenta fuera del equipo</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex flex-col divide-y divide-border border-y border-border">
                <Field
                  layout="toggle"
                  label="Cobra comisión"
                  hint="Suma comisión por las reservas que carga, según las tarifas."
                  className="py-3"
                >
                  <Switch
                    checked={editor.commission_eligible}
                    onCheckedChange={(v) => patch('commission_eligible', v)}
                  />
                </Field>
                <Field
                  layout="toggle"
                  label="Activo"
                  hint="Apagalo si ya no toma reservas: sale del combo, pero no se borra y sus comisiones viejas quedan."
                  className="py-3"
                >
                  <Switch checked={editor.active} onCheckedChange={(v) => patch('active', v)} />
                </Field>
              </div>
            </SheetBody>
            <SheetFooter className="sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSheetOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button type="submit" loading={pending} loadingText="Guardando…">
                {isNew ? 'Guardar gestor' : 'Guardar cambios'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
