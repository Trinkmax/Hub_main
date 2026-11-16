'use client'

import { formatDistanceToNowStrict } from 'date-fns'
import { es } from 'date-fns/locale'
import { formatInTimeZone } from 'date-fns-tz'
import { Loader2, MoreHorizontal, Paperclip, Pencil, Send, Trash2, X } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, useTransition } from 'react'
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
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { deleteTaskUpdate, editTaskUpdate, postTaskUpdate } from '@/lib/marketing/actions'
import type { BoardTask } from '@/lib/marketing/board'
import { STATUS_LABELS, STATUS_SOLID, type TaskStatus } from '@/lib/marketing/constants'
import { formatBytes, TASK_FILE_ACCEPT } from '@/lib/marketing/files'
import type { TaskUpdateRow } from '@/lib/marketing/queries'
import { MARKETING_TZ } from '@/lib/marketing/week'
import { cn } from '@/lib/utils'
import { useBoard } from './board-context'
import { CONNECTION_ERROR, guard } from './guard'
import { PersonAvatar } from './person-avatar'
import { FileTile, reportUpload } from './task-files'
import { discardUploads, uploadTaskFiles } from './upload'

/**
 * Las actualizaciones de una tarea, como en Monday: quien la carga deja el
 * detalle (los guiones, los textos) y quien la hace deja lo entregado ahí mismo y
 * la marca. Por eso, después de publicar, el atajo para cambiar el estado.
 */
export function TaskUpdates({
  task,
  updates,
  onChanged,
}: {
  task: BoardTask
  updates: TaskUpdateRow[]
  onChanged: () => void
}) {
  const board = useBoard()
  const [suggest, setSuggest] = useState(false)

  const quickStatuses: TaskStatus[] = ['waiting_feedback', 'done']
  const showSuggest = suggest && !quickStatuses.includes(task.status)

  return (
    <div className="space-y-4">
      <Composer
        taskId={task.id}
        onPosted={() => {
          onChanged()
          setSuggest(true)
        }}
      />

      {showSuggest ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-secondary/40 px-3 py-2.5">
          <span className="text-sm text-muted-foreground">¿Cambiás el estado?</span>
          {quickStatuses.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => {
                board.changeStatus(task, status)
                setSuggest(false)
              }}
              className={cn(
                'h-7 rounded-full px-3 text-xs font-semibold outline-none hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring',
                STATUS_SOLID[status],
              )}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSuggest(false)}
            aria-label="No, dejarlo así"
            className="ml-auto rounded-full p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      {updates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm font-medium">Todavía no hay actualizaciones</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Dejá acá el detalle (textos, guiones, referencias) o lo que entregaste, con sus
            archivos.
          </p>
        </div>
      ) : (
        <ol className="space-y-3">
          {updates.map((update) => (
            <li key={update.id}>
              <UpdateItem update={update} onChanged={onChanged} />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** Cada archivo elegido con su clave propia (la lista se puede achicar desde el medio). */
let fileCounter = 0
function withKey(file: File) {
  fileCounter += 1
  return { key: `${fileCounter}-${file.name}-${file.size}`, file }
}

function Composer({ taskId, onPosted }: { taskId: string; onPosted: () => void }) {
  const board = useBoard()
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<Array<{ key: string; file: File }>>([])
  const [posting, setPosting] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // El cuadro crece con el texto (hasta un tope) en vez de una barra de scroll chiquita.
  // biome-ignore lint/correctness/useExhaustiveDependencies: se mide cada vez que cambia el texto.
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [body])

  const canPost = (body.trim().length > 0 || files.length > 0) && !posting

  async function post() {
    if (!canPost) return
    setPosting(true)
    // Lo subido que todavía no quedó registrado: si algo falla, se borra (ver `discardUploads`).
    let pending: string[] = []
    try {
      let uploaded: Awaited<ReturnType<typeof uploadTaskFiles>>['uploaded'] = []
      if (files.length > 0) {
        const result = await uploadTaskFiles(
          board.tenantSlug,
          taskId,
          files.map((item) => item.file),
        )
        uploaded = result.uploaded
        pending = uploaded.map((file) => file.path)
        if (result.failed.length > 0) {
          reportUpload(0, result.failed)
          // Si no subió nada y no había texto, no hay nada para publicar.
          if (uploaded.length === 0 && body.trim().length === 0) return
        }
      }
      const result = await postTaskUpdate(board.tenantSlug, {
        taskId,
        body,
        files: uploaded,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      pending = []
      setBody('')
      setFiles([])
      onPosted()
    } catch {
      toast.error(CONNECTION_ERROR)
    } finally {
      await discardUploads(pending)
      setPosting(false)
    }
  }

  return (
    <div className="rounded-xl border border-input bg-background focus-within:ring-2 focus-within:ring-ring/40">
      <textarea
        ref={textRef}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void post()
          }
        }}
        onPaste={(event) => {
          const pasted = Array.from(event.clipboardData.files)
          if (pasted.length > 0) {
            event.preventDefault()
            setFiles((prev) => [...prev, ...pasted.map(withKey)].slice(0, 10))
          }
        }}
        rows={2}
        maxLength={10000}
        placeholder="Escribí una actualización…"
        aria-label="Nueva actualización"
        className="block max-h-80 min-h-16 w-full resize-none rounded-t-xl bg-transparent px-3 pt-2.5 text-sm outline-none placeholder:text-muted-foreground"
      />
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 px-3 pb-1">
          {files.map(({ key, file }) => (
            <li
              key={key}
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs"
            >
              <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="max-w-40 truncate">{file.name}</span>
              <span className="text-muted-foreground">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((item) => item.key !== key))}
                aria-label={`Sacar ${file.name}`}
                className="rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2 border-t border-border/60 px-2 py-1.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Paperclip className="size-3.5" aria-hidden />
          Adjuntar
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={TASK_FILE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? [])
            event.target.value = ''
            setFiles((prev) => [...prev, ...picked.map(withKey)].slice(0, 10))
          }}
        />
        <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">⌘ Enter</span>
        <Button
          size="sm"
          className="ml-auto sm:ml-0"
          onClick={() => void post()}
          disabled={!canPost}
        >
          {posting ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Send className="size-3.5" aria-hidden />
          )}
          {posting ? 'Publicando…' : 'Publicar'}
        </Button>
      </div>
    </div>
  )
}

/** Texto con los links clickeables (sin HTML: no se inyecta nada). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g)
  return (
    <>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: los pedazos de un texto fijo no se reordenan.
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all font-medium text-primary underline underline-offset-2"
          >
            {part}
          </a>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: idem.
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  )
}

function UpdateItem({ update, onChanged }: { update: TaskUpdateRow; onChanged: () => void }) {
  const board = useBoard()
  const author = board.team.find((member) => member.id === update.authorId)
  const authorName = author?.name ?? 'Alguien que ya no está'
  const mine = update.authorId === board.currentUserId
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(update.body)
  const [confirm, setConfirm] = useState(false)
  const [busy, startBusy] = useTransition()

  const created = new Date(update.createdAt)
  const relative = formatDistanceToNowStrict(created, { addSuffix: true, locale: es })
  const absolute = formatInTimeZone(created, MARKETING_TZ, 'dd/MM/yyyy HH:mm')

  function save() {
    const next = draft.trim()
    if (!next || next === update.body) {
      setEditing(false)
      setDraft(update.body)
      return
    }
    startBusy(() =>
      guard(async () => {
        const result = await editTaskUpdate(board.tenantSlug, { id: update.id, body: next })
        if (result.ok) {
          setEditing(false)
          onChanged()
        } else toast.error(result.message)
      }),
    )
  }

  function remove() {
    startBusy(() =>
      guard(async () => {
        const result = await deleteTaskUpdate(board.tenantSlug, update.id)
        if (result.ok) {
          toast.success('Actualización borrada.')
          onChanged()
        } else toast.error(result.message)
      }),
    )
  }

  return (
    <article
      className={cn('rounded-xl border border-border/70 bg-card p-3', busy && 'opacity-60')}
      aria-label={`Actualización de ${authorName}`}
    >
      <header className="flex items-center gap-2">
        <PersonAvatar
          person={{ id: update.authorId ?? 'nadie', name: authorName, inTeam: Boolean(author) }}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{authorName}</p>
          <p className="text-[11px] text-muted-foreground">
            <time dateTime={update.createdAt} title={absolute}>
              {relative}
            </time>
            {update.edited ? ' · editada' : ''}
          </p>
        </div>
        {mine || board.canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Opciones de la actualización"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {mine ? (
                <DropdownMenuItem
                  onSelect={() => {
                    setDraft(update.body)
                    setEditing(true)
                  }}
                >
                  <Pencil aria-hidden />
                  Editar
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
                <Trash2 aria-hidden />
                Borrar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            // biome-ignore lint/a11y/noAutofocus: se abre para editar.
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                save()
              }
              if (event.key === 'Escape') {
                setEditing(false)
                setDraft(update.body)
              }
            }}
            rows={4}
            maxLength={10000}
            aria-label="Editar actualización"
            className="block w-full resize-y rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false)
                setDraft(update.body)
              }}
            >
              Cancelar
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              Guardar
            </Button>
          </div>
        </div>
      ) : update.body ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          <Linkified text={update.body} />
        </p>
      ) : null}

      {update.files.length > 0 ? (
        <ul className="mt-2.5 grid grid-cols-3 gap-2">
          {update.files.map((file) => (
            <li key={file.id}>
              <FileTile file={file} onDeleted={onChanged} compact />
            </li>
          ))}
        </ul>
      ) : null}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar esta actualización?</AlertDialogTitle>
            <AlertDialogDescription>
              {update.files.length > 0
                ? `Se borran también sus ${update.files.length} ${update.files.length === 1 ? 'archivo' : 'archivos'}. No se puede deshacer.`
                : 'No se puede deshacer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={remove}
            >
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}
