'use client'

import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useActionState, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  createQuickMessage,
  deleteQuickMessage,
  type QuickMessageActionState,
  updateQuickMessage,
} from '@/lib/quick-messages/actions'
import type { QuickMessageRow } from '@/lib/quick-messages/queries'

const initial: QuickMessageActionState = { ok: false, message: '' }

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

  const [state, formAction, pending] = useActionState(
    (prev: QuickMessageActionState, fd: FormData) => action(prev, fd),
    initial,
  )

  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? 'Mensaje actualizado.' : 'Mensaje creado.')
      onSuccess()
    }
  }, [state.ok, isEdit, onSuccess])

  return (
    <form action={formAction} className="space-y-4">
      {isEdit && <input type="hidden" name="id" value={message.id} />}
      <div className="space-y-1.5">
        <Label htmlFor="title">Título</Label>
        <Input
          id="title"
          name="title"
          autoFocus
          required
          maxLength={80}
          defaultValue={message?.title ?? ''}
          placeholder="Bienvenida, Consulta horarios…"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="shortcut">
          Atajo{' '}
          <span className="ml-1 text-xs text-muted-foreground">
            (solo minúsculas, números, - y _)
          </span>
        </Label>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">/</span>
          <Input
            id="shortcut"
            name="shortcut"
            required
            maxLength={40}
            defaultValue={message?.shortcut ?? ''}
            placeholder="bienvenida"
            pattern="^[a-z0-9_-]{1,40}$"
            className="font-mono"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="body">Mensaje</Label>
        <Textarea
          id="body"
          name="body"
          required
          maxLength={1024}
          rows={4}
          defaultValue={message?.body ?? ''}
          placeholder="Hola! Gracias por escribirnos…"
          className="resize-none"
        />
      </div>
      {!state.ok && state.message && <p className="text-sm text-destructive">{state.message}</p>}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? (isEdit ? 'Guardando…' : 'Creando…') : isEdit ? 'Guardar' : 'Crear'}
        </Button>
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
  const [showCreate, setShowCreate] = useState(false)
  const [editingMessage, setEditingMessage] = useState<QuickMessageRow | null>(null)
  const [pending, startTransition] = useTransition()

  const handleDelete = (msg: QuickMessageRow) => {
    startTransition(async () => {
      const r = await deleteQuickMessage(tenantSlug, msg.id)
      if (r.ok) toast.success(`Mensaje "${msg.title}" eliminado.`)
      else toast.error(r.message)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {initialMessages.length === 0
            ? 'No hay mensajes rápidos todavía.'
            : `${initialMessages.length} mensaje${initialMessages.length === 1 ? '' : 's'} rápido${initialMessages.length === 1 ? '' : 's'}`}
        </p>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1.5 size-4" />
              Nuevo
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nuevo mensaje rápido</DialogTitle>
            </DialogHeader>
            <QuickMessageForm
              tenantSlug={tenantSlug}
              onSuccess={() => setShowCreate(false)}
              onCancel={() => setShowCreate(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {initialMessages.length > 0 && (
        <div className="divide-y divide-border/60 rounded-lg border border-border/70 bg-card">
          {initialMessages.map((msg) => (
            <div key={msg.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm leading-tight">{msg.title}</span>
                  <span className="font-mono rounded bg-secondary/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    /{msg.shortcut}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{msg.body}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Dialog
                  open={editingMessage?.id === msg.id}
                  onOpenChange={(open) => {
                    if (!open) setEditingMessage(null)
                  }}
                >
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => setEditingMessage(msg)}
                    >
                      <Pencil className="size-3.5" />
                      <span className="sr-only">Editar {msg.title}</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Editar mensaje rápido</DialogTitle>
                    </DialogHeader>
                    {editingMessage?.id === msg.id && (
                      <QuickMessageForm
                        tenantSlug={tenantSlug}
                        message={editingMessage}
                        onSuccess={() => setEditingMessage(null)}
                        onCancel={() => setEditingMessage(null)}
                      />
                    )}
                  </DialogContent>
                </Dialog>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  disabled={pending}
                  onClick={() => handleDelete(msg)}
                >
                  <Trash2 className="size-3.5" />
                  <span className="sr-only">Eliminar {msg.title}</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
