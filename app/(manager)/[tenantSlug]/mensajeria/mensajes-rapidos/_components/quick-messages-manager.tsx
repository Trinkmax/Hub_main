'use client'

import { Pencil, Plus, Trash2, Zap } from 'lucide-react'
import { useActionState, useEffect, useEffectEvent, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FormError } from '@/components/ui/field'
import { Input, InputAddon, InputGroup } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { SubmitButton } from '@/components/ui/submit-button'
import { Textarea } from '@/components/ui/textarea'
import {
  createQuickMessage,
  deleteQuickMessage,
  type QuickMessageActionState,
  updateQuickMessage,
} from '@/lib/quick-messages/actions'
import type { QuickMessageRow } from '@/lib/quick-messages/queries'

const initial: QuickMessageActionState = { ok: false, message: '' }

/** Ejemplos que se muestran en el estado vacío (solo texto ilustrativo). */
const EXAMPLES = [
  { shortcut: 'gracias', body: '¡Mil gracias por venir! Los esperamos de nuevo pronto.' },
  { shortcut: 'horarios', body: 'Abrimos de martes a domingo, desde las 18 h.' },
  { shortcut: 'reserva', body: '¡Listo! Tu mesa quedó reservada. Te esperamos.' },
] as const

function ShortcutChip({ shortcut }: { shortcut: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-sm bg-secondary px-1.5 py-0.5 font-mono type-caption font-medium text-foreground">
      /{shortcut}
    </span>
  )
}

function QuickMessageForm({
  tenantSlug,
  message,
  onSuccess,
  onCancel,
}: {
  tenantSlug: string
  message?: QuickMessageRow
  onSuccess: () => void
  onCancel: () => void
}) {
  const isEdit = !!message

  const action = isEdit
    ? updateQuickMessage.bind(null, tenantSlug)
    : createQuickMessage.bind(null, tenantSlug)

  const [state, formAction] = useActionState(
    (prev: QuickMessageActionState, fd: FormData) => action(prev, fd),
    initial,
  )
  // Solo la respuesta del server cierra el diálogo (no un nuevo dibujo del padre).
  const succeed = useEffectEvent(onSuccess)

  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? 'Mensaje rápido actualizado.' : 'Mensaje rápido creado.')
      succeed()
    }
  }, [state, isEdit])

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {isEdit && <input type="hidden" name="id" value={message.id} />}
      <FormError message={!state.ok ? state.message : null} />
      <Field label="Título" hint="Es solo para vos: el cliente no lo ve.">
        <Input
          name="title"
          autoFocus
          required
          maxLength={80}
          defaultValue={message?.title ?? ''}
          placeholder="Bienvenida, Consulta horarios…"
        />
      </Field>
      <Field
        label="Atajo"
        hint="En el chat escribí / y el atajo para usarlo. Solo minúsculas, números, - y _, sin espacios."
      >
        <InputGroup>
          <InputAddon aria-hidden className="font-mono">
            /
          </InputAddon>
          <Input
            name="shortcut"
            required
            maxLength={40}
            defaultValue={message?.shortcut ?? ''}
            placeholder="bienvenida"
            pattern="^[a-z0-9_-]{1,40}$"
            title="Solo minúsculas, números, guion (-) y guion bajo (_), sin espacios"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono"
          />
        </InputGroup>
      </Field>
      <Field label="Mensaje" hint="Esto es lo que se manda tal cual al cliente.">
        <Textarea
          name="body"
          required
          maxLength={1024}
          showCount
          rows={4}
          defaultValue={message?.body ?? ''}
          placeholder="¡Hola! Gracias por escribirnos…"
          className="resize-none"
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <SubmitButton pendingText={isEdit ? 'Guardando…' : 'Creando…'}>
          {isEdit ? 'Guardar' : 'Crear atajo'}
        </SubmitButton>
      </DialogFooter>
    </form>
  )
}

export function QuickMessagesManager({
  tenantSlug,
  initialMessages,
}: {
  tenantSlug: string
  initialMessages: QuickMessageRow[]
}) {
  // `null` cerrado · `'new'` creando · un mensaje: editándolo. Un solo diálogo.
  const [dialog, setDialog] = useState<'new' | QuickMessageRow | null>(null)
  const editing = dialog !== null && dialog !== 'new' ? dialog : undefined
  const close = () => setDialog(null)

  const count = initialMessages.length

  return (
    <>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar mensaje rápido' : 'Nuevo mensaje rápido'}</DialogTitle>
          </DialogHeader>
          {dialog !== null ? (
            <QuickMessageForm
              key={editing?.id ?? 'new'}
              tenantSlug={tenantSlug}
              message={editing}
              onSuccess={close}
              onCancel={close}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {count === 0 ? (
        <EmptyState
          variant="dashed"
          icon={Zap}
          title="Ahorrá tiempo con atajos"
          description={
            <>
              <span className="block">
                Guardá las respuestas que escribís siempre y mandalas en un toque. Por ejemplo:
              </span>
              <ul className="mt-4 flex flex-col gap-2 text-left">
                {EXAMPLES.map((e) => (
                  <li
                    key={e.shortcut}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <ShortcutChip shortcut={e.shortcut} />
                    <span className="truncate type-small text-muted-foreground">{e.body}</span>
                  </li>
                ))}
              </ul>
            </>
          }
          action={
            <Button onClick={() => setDialog('new')}>
              <Plus aria-hidden />
              Crear mi primer atajo
            </Button>
          }
        />
      ) : (
        <Section
          title="Tus atajos"
          description={count === 1 ? '1 atajo guardado' : `${count} atajos guardados`}
          actions={
            <Button onClick={() => setDialog('new')}>
              <Plus aria-hidden />
              Nuevo atajo
            </Button>
          }
        >
          <DataTable
            caption="Mensajes rápidos"
            rows={initialMessages}
            getRowId={(msg) => msg.id}
            columns={[
              {
                id: 'title',
                header: 'Atajo',
                cell: (msg) => (
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate">{msg.title}</span>
                    <ShortcutChip shortcut={msg.shortcut} />
                  </span>
                ),
              },
              {
                id: 'body',
                header: 'Mensaje',
                cell: (msg) => (
                  <span className="line-clamp-2 whitespace-pre-wrap text-muted-foreground">
                    {msg.body}
                  </span>
                ),
              },
              {
                id: 'actions',
                header: 'Acciones',
                headerHidden: true,
                align: 'end',
                width: '6rem',
                cell: (msg) => (
                  <QuickMessageActions
                    tenantSlug={tenantSlug}
                    message={msg}
                    onEdit={() => setDialog(msg)}
                  />
                ),
              },
            ]}
          />
        </Section>
      )}
    </>
  )
}

function QuickMessageActions({
  tenantSlug,
  message,
  onEdit,
}: {
  tenantSlug: string
  message: QuickMessageRow
  onEdit: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Editar ${message.title}`}
        onClick={onEdit}
      >
        <Pencil aria-hidden />
      </Button>
      <ConfirmDialog
        tone="danger"
        icon={Trash2}
        title={`¿Borrar el atajo «${message.title}»?`}
        description={`El atajo /${message.shortcut} deja de funcionar en el chat. No se puede deshacer.`}
        confirmLabel="Borrar atajo"
        pendingLabel="Borrando…"
        onConfirm={async () => {
          const result = await deleteQuickMessage(tenantSlug, message.id)
          if (!result.ok) return result
          toast.success(`Atajo «${message.title}» borrado.`)
        }}
        trigger={
          <Button variant="danger-ghost" size="icon-sm" aria-label={`Borrar ${message.title}`}>
            <Trash2 aria-hidden />
          </Button>
        }
      />
    </div>
  )
}
