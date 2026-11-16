'use client'

import {
  Download,
  ExternalLink,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Link2,
  Loader2,
  Play,
  Presentation,
  Trash2,
  Upload,
} from 'lucide-react'
import { useRef, useState, useTransition } from 'react'
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
  addTaskLink,
  deleteTaskFile,
  getTaskFileDownloadUrl,
  registerTaskFiles,
} from '@/lib/marketing/actions'
import { formatBytes, TASK_FILE_ACCEPT, taskFileKind } from '@/lib/marketing/files'
import type { TaskFileRow } from '@/lib/marketing/queries'
import { cn } from '@/lib/utils'
import { useBoard } from './board-context'
import { CONNECTION_ERROR, guard } from './guard'
import { discardUploads, uploadTaskFiles } from './upload'

/** Avisa qué se subió y qué no (con el motivo de cada uno). */
export function reportUpload(saved: number, failed: Array<{ name: string; message: string }>) {
  if (saved > 0 && failed.length === 0) {
    toast.success(saved === 1 ? 'Archivo subido.' : `${saved} archivos subidos.`)
    return
  }
  if (failed.length > 0) {
    const first = failed[0]
    toast.error(
      failed.length === 1 && first
        ? `${first.name}: ${first.message}`
        : `No se subieron ${failed.length} archivos. ${first?.message ?? ''}`,
    )
  }
}

/**
 * La pestaña «Archivos» del panel: arrastrar (o elegir) desde la compu o el
 * celular, pegar un link de Drive, y ver todo lo de la tarea, también lo que
 * llegó adentro de una actualización.
 */
export function TaskFiles({
  taskId,
  files,
  onChanged,
}: {
  taskId: string
  files: TaskFileRow[]
  onChanged: () => void
}) {
  const board = useBoard()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [link, setLink] = useState('')
  const [savingLink, startLink] = useTransition()

  async function upload(list: File[]) {
    if (list.length === 0) return
    setUploading(list.length)
    let pending: string[] = []
    try {
      const result = await uploadTaskFiles(board.tenantSlug, taskId, list)
      pending = result.uploaded.map((file) => file.path)
      let saved = 0
      if (result.uploaded.length > 0) {
        const registered = await registerTaskFiles(board.tenantSlug, {
          taskId,
          files: result.uploaded,
        })
        if (registered.ok) {
          saved = registered.data.saved
          pending = []
        } else result.failed.push({ name: 'Archivos', message: registered.message })
      }
      reportUpload(saved, result.failed)
      if (saved > 0) onChanged()
    } catch {
      toast.error(CONNECTION_ERROR)
    } finally {
      await discardUploads(pending)
      setUploading(0)
    }
  }

  function addLink() {
    const url = link.trim()
    if (!url) return
    startLink(() =>
      guard(async () => {
        const result = await addTaskLink(board.tenantSlug, { taskId, url })
        if (result.ok) {
          setLink('')
          toast.success('Link guardado.')
          onChanged()
        } else toast.error(result.message)
      }),
    )
  }

  return (
    <div className="space-y-4">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: soltar archivos es un atajo del mouse; con teclado se usa el botón «elegilos» de adentro. */}
      <div
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragOver(false)
          void upload(Array.from(event.dataTransfer.files))
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-border bg-secondary/30',
        )}
      >
        {uploading > 0 ? (
          <p className="inline-flex items-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Subiendo {uploading} {uploading === 1 ? 'archivo' : 'archivos'}…
          </p>
        ) : (
          <>
            <Upload className="size-5 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Arrastrá fotos, videos o PDF acá, o{' '}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="font-semibold text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                elegilos
              </button>
              .
            </p>
            <p className="text-xs text-muted-foreground/80">
              Hasta 50 MB cada uno. Lo más pesado, como link.
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={TASK_FILE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const list = Array.from(event.target.files ?? [])
            event.target.value = ''
            void upload(list)
          }}
        />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          addLink()
        }}
        className="flex items-center gap-2"
      >
        <div className="relative min-w-0 flex-1">
          <Link2
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            inputMode="url"
            placeholder="Pegá un link (Drive, Canva…)"
            aria-label="Link"
            className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={!link.trim() || savingLink}>
          Agregar
        </Button>
      </form>

      {files.length === 0 ? (
        <p className="py-2 text-center text-sm text-muted-foreground">Todavía no hay archivos.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {files.map((file) => (
            <li key={file.id}>
              <FileTile file={file} onDeleted={onChanged} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const KIND_ICON = {
  pdf: FileText,
  doc: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  zip: FileArchive,
  link: Link2,
} as const

/** Un archivo: miniatura si es foto, cuadro con ícono si no. Abrir, bajar y sacar. */
export function FileTile({
  file,
  onDeleted,
  compact = false,
}: {
  file: TaskFileRow
  onDeleted: () => void
  compact?: boolean
}) {
  const board = useBoard()
  const kind = taskFileKind(file.kind, file.mimeType)
  const [confirm, setConfirm] = useState(false)
  const [busy, startBusy] = useTransition()
  const canDelete = board.canManage || file.createdBy === board.currentUserId
  const href = file.url ?? undefined

  function download() {
    startBusy(() =>
      guard(async () => {
        const result = await getTaskFileDownloadUrl(board.tenantSlug, file.id)
        if (result.ok) window.location.assign(result.data.url)
        else toast.error(result.message)
      }),
    )
  }

  function remove() {
    startBusy(() =>
      guard(async () => {
        const result = await deleteTaskFile(board.tenantSlug, file.id)
        if (result.ok) {
          toast.success('Archivo sacado.')
          onDeleted()
        } else toast.error(result.message)
      }),
    )
  }

  const Icon = kind === 'image' || kind === 'video' ? null : KIND_ICON[kind]
  const extension =
    file.kind === 'file' ? (file.name.split('.').pop()?.toUpperCase().slice(0, 4) ?? '') : ''

  return (
    <div
      className={cn(
        'group/file relative overflow-hidden rounded-lg border border-border/80 bg-card',
        busy && 'opacity-60',
      )}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={`Abrir ${file.name}`}
      >
        <div
          className={cn(
            'relative flex items-center justify-center overflow-hidden bg-secondary/50',
            compact ? 'aspect-[4/3]' : 'aspect-square',
          )}
        >
          {kind === 'image' && (file.thumbUrl ?? file.url) ? (
            // biome-ignore lint/performance/noImgElement: URL firmada de un bucket privado (el optimizador no la puede pedir).
            <img
              src={file.thumbUrl ?? file.url ?? ''}
              alt=""
              loading="lazy"
              className="size-full object-cover transition-transform duration-300 group-hover/file:scale-[1.03]"
            />
          ) : kind === 'video' && file.url ? (
            <>
              <video
                src={`${file.url}#t=0.1`}
                preload="metadata"
                muted
                playsInline
                className="size-full object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex size-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                  <Play className="size-4 translate-x-px" aria-hidden />
                </span>
              </span>
            </>
          ) : Icon ? (
            <span className="flex flex-col items-center gap-1 text-muted-foreground">
              <Icon className="size-7" aria-hidden strokeWidth={1.5} />
              {extension ? (
                <span className="rounded bg-background px-1.5 text-[10px] font-bold tracking-wide">
                  {extension}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      </a>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={file.name}>
            {file.name}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {file.kind === 'link' ? 'Link' : file.sizeBytes ? formatBytes(file.sizeBytes) : ''}
          </p>
        </div>
        {file.kind === 'link' ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Abrir el link ${file.name}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : (
          <button
            type="button"
            onClick={download}
            disabled={busy}
            aria-label={`Bajar ${file.name}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download className="size-3.5" aria-hidden />
          </button>
        )}
        {canDelete ? (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            disabled={busy}
            aria-label={`Sacar ${file.name}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Sacar «{file.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {file.kind === 'link'
                ? 'Se saca el link de la tarea.'
                : 'Se borra el archivo de la tarea y no se puede recuperar.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={remove}
            >
              Sacar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
