'use client'

import { Pencil, Plus, Trash2, Zap } from 'lucide-react'
import { useActionState, useEffect, useState, useTransition } from 'react'
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

/** Ejemplos que se muestran en el estado vacío (solo texto ilustrativo). */
const EXAMPLES = [
  { shortcut: 'gracias', body: '¡Mil gracias por venir! Los esperamos de nuevo pronto.' },
  { shortcut: 'horarios', body: 'Abrimos de martes a domingo, desde las 18 h.' },
  { shortcut: 'reserva', body: '¡Listo! Tu mesa quedó reservada. Te esperamos.' },
] as const

function ShortcutChip({ shortcut }: { shortcut: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[11px] font-medium text-secondary-foreground">
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
        <p className="text-xs text-muted-foreground">Es solo para vos, el cliente no lo ve.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="shortcut">Atajo</Label>
        <div className="flex">
          <span
            aria-hidden
            className="flex h-10 items-center rounded-l-md border border-r-0 border-input bg-secondary/60 px-3 font-mono text-sm text-muted-foreground"
          >
            /
          </span>
          <Input
            id="shortcut"
            name="shortcut"
            required
            maxLength={40}
            defaultValue={message?.shortcut ?? ''}
            placeholder="bienvenida"
            pattern="^[a-z0-9_-]{1,40}$"
            title="Solo minúsculas, números, guion (-) y guion bajo (_), sin espacios"
            className="rounded-l-none font-mono"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          En el chat escribí <span className="font-mono text-foreground/80">/</span> y el atajo para
          usarlo. Solo minúsculas, números, - y _, sin espacios.
        </p>
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
          placeholder="¡Hola! Gracias por escribirnos…"
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground">
          Esto es lo que se manda tal cual al cliente.
        </p>
      </div>
      {!state.ok && state.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? (isEdit ? 'Guardando…' : 'Creando…') : isEdit ? 'Guardar' : 'Crear atajo'}
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
      if (r.ok) toast.success(`Atajo "${msg.title}" eliminado.`)
      else toast.error(r.message)
    })
  }

  const count = initialMessages.length

  return (
    <div className="space-y-4">
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
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

      {count > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {count === 1 ? '1 atajo guardado' : `${count} atajos guardados`}
          </p>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 size-4" aria-hidden />
            Nuevo atajo
          </Button>
        </div>
      )}

      {count === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border/80 bg-card/50 px-6 py-10 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-border/70 bg-secondary/60 text-muted-foreground">
            <Zap className="size-5" aria-hidden />
          </div>
          <p className="text-base font-medium">Ahorrá tiempo con atajos</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground text-pretty">
            Guardá las respuestas que escribís siempre y mandalas en un toque. Por ejemplo:
          </p>
          <ul className="mx-auto mt-4 w-full max-w-sm space-y-2 text-left">
            {EXAMPLES.map((e) => (
              <li
                key={e.shortcut}
                className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2"
              >
                <ShortcutChip shortcut={e.shortcut} />
                <span className="truncate text-xs text-muted-foreground">{e.body}</span>
              </li>
            ))}
          </ul>
          <Button className="mt-6" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 size-4" aria-hidden />
            Crear mi primer atajo
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {initialMessages.map((msg) => (
            <li
              key={msg.id}
              className="rounded-xl border border-border/70 bg-card p-4 transition-colors hover:border-border"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium leading-tight">{msg.title}</h3>
                  <ShortcutChip shortcut={msg.shortcut} />
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
                        className="size-8"
                        aria-label={`Editar ${msg.title}`}
                        onClick={() => setEditingMessage(msg)}
                      >
                        <Pencil className="size-4" aria-hidden />
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
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        aria-label={`Eliminar ${msg.title}`}
                        disabled={pending}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar “{msg.title}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                          El atajo /{msg.shortcut} va a dejar de funcionar en el chat. Esta acción
                          no se puede deshacer.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(msg)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20"
                        >
                          Eliminar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-muted-foreground">
                {msg.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
