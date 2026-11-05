'use client'

import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleSlash2,
  FileText,
  Loader,
  Paperclip,
  Plus,
  TriangleAlert,
  X,
} from 'lucide-react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import {
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Button } from '@/components/ui/button'
import type { TexDisplayItem } from '@/lib/tex/protocol'
import { cn } from '@/lib/utils'
import { texSuggestions } from './suggestions'
import { TexCheer, useCheering } from './tex-cheer'
import { TEX_FACE_H, TEX_FACE_W, TexFace } from './tex-face'
import { TexMarkdown } from './tex-markdown'
import { useTex } from './tex-provider'
import { TexPart, useTexFace, useTexLook } from './tex-sprite'
import { TexTicket } from './tex-ticket'

/**
 * Tex se agranda y la charla pasa adentro de su cara: el marco azul es su cuerpo, la crema es su cara,
 * arriba va la gorra y abajo las zapatillas. La cara no es un adorno: mira al puntero, habla mientras
 * escribe, se concentra mientras busca y festeja cuando algo sale bien. Sin charla, ocupa toda la cara;
 * al empezar, sube y queda en el encabezado.
 */

const STATUS_WORDS = {
  listening: 'Te escucho',
  thinking: 'Pensando…',
  reading: 'Mirando…',
  working: 'En eso…',
  happy: '¡Listo!',
  sad: 'Algo no salió',
} as const

const FACE_SPRING = { type: 'spring', stiffness: 300, damping: 30 } as const

function StepList({ steps }: { steps: Extract<TexDisplayItem, { kind: 'tex' }>['steps'] }) {
  const running = steps.some((s) => s.state === 'running')
  const [open, setOpen] = useState(false)
  if (steps.length === 0) return null
  const showAll = running || open || steps.length === 1
  return (
    <div className="mb-1.5 grid gap-0.5 font-mono text-[11px] leading-snug text-(--tex-muted)">
      {showAll ? (
        steps.map((step) => (
          <p key={step.id} className="flex items-center gap-1.5">
            {step.state === 'running' ? (
              <Loader
                aria-hidden
                className="size-3 shrink-0 animate-spin motion-reduce:animate-none"
              />
            ) : step.state === 'error' ? (
              <CircleSlash2 aria-hidden className="size-3 shrink-0 text-destructive" />
            ) : (
              <Check aria-hidden className="size-3 shrink-0 text-success" />
            )}
            <span className="min-w-0">{step.label}</span>
          </p>
        ))
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-fit items-center gap-1 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Check aria-hidden className="size-3 text-success" />
          Miré {steps.length} cosas
          <ChevronDown aria-hidden className="size-3" />
        </button>
      )}
    </div>
  )
}

function Conversation() {
  const { items, slug, busy, mood, error, retry, restart, decide } = useTex()
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  // Sigue lo último mientras llega, salvo que la persona haya subido a leer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tiene que correr cuando cambia la charla.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items, busy, error])

  const pending = items.filter((i) => i.kind === 'ticket' && i.ticket.status === 'pending')
  const last = items.at(-1)
  const quiet = busy && (last?.kind !== 'tex' || (last.text === '' && last.steps.length === 0))

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="tex-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-3"
    >
      <div className="grid gap-3" aria-live="polite">
        {items.map((item) => {
          if (item.kind === 'user') {
            return (
              <div key={item.id} className="grid justify-items-end gap-1">
                {item.attachment ? (
                  <p className="flex max-w-[85%] items-center gap-1 text-xs text-(--tex-muted)">
                    <FileText aria-hidden className="size-3.5 shrink-0" />
                    <span className="truncate">{item.attachment}</span>
                  </p>
                ) : null}
                <p className="tex-bubble-user max-w-[85%] px-3 py-2 text-sm leading-snug text-pretty whitespace-pre-wrap text-white">
                  {item.text}
                </p>
              </div>
            )
          }
          if (item.kind === 'ticket') return <TexTicket key={item.id} ticket={item.ticket} />
          return (
            <div key={item.id} className="min-w-0">
              <StepList steps={item.steps} />
              {item.text ? <TexMarkdown text={item.text} slug={slug} /> : null}
            </div>
          )
        })}

        {pending.length > 1 ? (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() =>
              decide(
                pending.flatMap((i) =>
                  i.kind === 'ticket' ? [{ actionId: i.ticket.actionId, approve: true }] : [],
                ),
              )
            }
            className="h-9 pointer-coarse:h-11"
          >
            Hacer los {pending.length}
          </Button>
        ) : null}

        {quiet ? (
          <p className="flex h-5 items-center gap-1" role="status">
            <span className="tex-dot" />
            <span className="tex-dot [animation-delay:150ms]" />
            <span className="tex-dot [animation-delay:300ms]" />
            <span className="sr-only">{STATUS_WORDS[mood]}</span>
          </p>
        ) : null}

        {error ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-pretty">
            <TriangleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
            <span className="min-w-0 flex-1">{error.message}</span>
            {error.retry ? (
              <Button type="button" size="sm" variant="outline" onClick={retry} className="h-8">
                Reintentar
              </Button>
            ) : null}
            {error.restart ? (
              <Button type="button" size="sm" variant="outline" onClick={restart} className="h-8">
                Charla nueva
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Hello() {
  const { pathname, role, send, loaded } = useTex()
  const suggestions = texSuggestions(pathname, role)
  return (
    <div className="tex-scroll flex min-h-0 flex-1 flex-col justify-center gap-4 overflow-y-auto px-5 py-4">
      <div className="text-center">
        <p className="font-mono text-lg font-bold">¿Qué hacemos?</p>
        <p className="mx-auto mt-1 max-w-[19rem] text-sm text-pretty text-(--tex-muted)">
          Contame qué pasó o qué querés ver. Yo lo hago, te llevo a la pantalla y te muestro cómo
          quedó.
        </p>
      </div>
      <div className={cn('flex flex-wrap justify-center gap-2', !loaded && 'invisible')}>
        {suggestions.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => send(text)}
            className="tex-chip min-h-9 px-3 py-1.5 text-left text-[13px] leading-snug outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

function Composer() {
  const { send, busy, stop, open, attachment, attach, setOpen, canAttach } = useTex()
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // biome-ignore lint/correctness/useExhaustiveDependencies: crece con lo que se escribe.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [text])

  const canSend = (text.trim() !== '' || attachment !== null) && !busy

  const submit = () => {
    if (!canSend) return
    send(text)
    setText('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && !text) {
      setOpen(false)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="p-2.5 pt-1">
      <AnimatePresence initial={false}>
        {attachment ? (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-1.5 flex items-center gap-1.5 overflow-hidden px-1 text-xs text-(--tex-muted)"
          >
            <FileText aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
            <button
              type="button"
              onClick={() => attach(null)}
              aria-label="Sacar el archivo"
              className="grid size-6 place-items-center rounded-sm outline-none hover:bg-current/10 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </motion.p>
        ) : null}
      </AnimatePresence>
      <div className="tex-input flex items-end gap-1 p-1">
        {canAttach ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) attach(file)
                event.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Pasarle una foto o un PDF"
              title="Pasarle una foto o un PDF"
              className="grid size-10 shrink-0 place-items-center rounded-sm text-(--tex-muted) outline-none hover:text-(--tex-ink) focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Paperclip aria-hidden className="size-[18px]" />
            </button>
          </>
        ) : null}
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Contale a Tex…"
          aria-label="Contale a Tex"
          maxLength={4000}
          className="min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 text-base leading-snug outline-none placeholder:text-(--tex-muted) sm:text-sm"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Frenar"
            className="tex-send grid size-10 shrink-0 place-items-center text-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span aria-hidden className="size-3 bg-white" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Mandar"
            className="tex-send grid size-10 shrink-0 place-items-center text-white outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
          >
            <ArrowUp aria-hidden className="size-5" />
          </button>
        )}
      </div>
    </div>
  )
}

/** Los bordes del panel reciben un archivo: Tex abre la boca y lo lee. */
function useDropOnPanel() {
  const { attach, canAttach } = useTex()
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const hasFiles = (event: DragEvent) =>
    canAttach && Array.from(event.dataTransfer.types).includes('Files')
  return {
    over,
    handlers: {
      onDragEnter: (event: DragEvent) => {
        if (!hasFiles(event)) return
        depth.current += 1
        setOver(true)
      },
      onDragOver: (event: DragEvent) => {
        if (hasFiles(event)) event.preventDefault()
      },
      onDragLeave: (event: DragEvent) => {
        if (!hasFiles(event)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      },
      onDrop: (event: DragEvent) => {
        if (!hasFiles(event)) return
        // Es de Tex: el arrastre general de Administración no se entera.
        event.preventDefault()
        event.stopPropagation()
        depth.current = 0
        setOver(false)
        const file = event.dataTransfer.files[0]
        if (file) attach(file)
      },
    },
  }
}

export function TexPanel() {
  const { items, mood, talking, setOpen, restart, busy, cheers } = useTex()
  const cheering = useCheering(cheers)
  const baseFace = useTexFace({ talking, mood })
  const { ref, look } = useTexLook()
  const reduced = useReducedMotion()
  const { over, handlers } = useDropOnPanel()
  const empty = items.length === 0
  const face = over ? 'o' : cheering ? 'happy' : baseFace

  const status =
    items
      .flatMap((item) => (item.kind === 'tex' ? item.steps : []))
      .filter((step) => step.state === 'running')
      .at(-1)?.label ?? STATUS_WORDS[busy && mood === 'listening' ? 'thinking' : mood]

  return (
    <motion.div
      data-tex-ui
      role="dialog"
      aria-label="Tex"
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.26, x: 60, y: 90 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, x: 0, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.26, x: 60, y: 90 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }}
      className="tex-panel fixed z-40 flex origin-bottom-right"
      {...handlers}
    >
      <TexPart name="cap" w={24} h={8} scale={4} className="tex-limb tex-cap z-10" />
      <TexPart
        name="hand-left"
        w={12}
        h={16}
        scale={4}
        className="tex-limb tex-hand-left tex-wave"
      />
      <TexPart name="hand-right" w={10} h={10} scale={4} className="tex-limb tex-hand-right" />
      <TexPart name="tail" w={14} h={5} scale={4} className="tex-limb tex-tail" />
      <TexPart name="legs" w={39} h={8} scale={4} className="tex-limb tex-legs" />
      <div aria-hidden className="tex-panel-shadow absolute inset-3 -z-10" />

      <div className="tex-frame-outline tex-steps flex min-h-0 w-full">
        <div className="tex-frame-body tex-steps flex min-h-0 w-full">
          <div className="tex-screen tex-steps flex min-h-0 w-full flex-col">
            <LayoutGroup>
              <header className="flex min-h-14 items-center gap-3 py-2 pr-2 pl-4">
                {empty ? null : (
                  <motion.div
                    layoutId="tex-face"
                    transition={reduced ? { duration: 0 } : FACE_SPRING}
                    ref={ref as React.RefObject<HTMLDivElement>}
                    className="tex-face-plate tex-steps shrink-0"
                    style={{ width: TEX_FACE_W * 2.4, height: TEX_FACE_H * 2.4 }}
                  >
                    <TexFace name={face} look={look} className="size-full" />
                  </motion.div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm leading-tight font-bold tracking-wide">Tex</p>
                  <p className="truncate text-xs leading-tight text-(--tex-muted)">{status}</p>
                </div>
                {items.length > 0 ? (
                  <button
                    type="button"
                    onClick={restart}
                    aria-label="Charla nueva"
                    title="Charla nueva"
                    className="grid size-9 place-items-center rounded-sm text-(--tex-muted) outline-none hover:bg-current/5 hover:text-(--tex-ink) focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Plus aria-hidden className="size-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Cerrar Tex"
                  title="Cerrar (⌘J)"
                  className="grid size-9 place-items-center rounded-sm text-(--tex-muted) outline-none hover:bg-current/5 hover:text-(--tex-ink) focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </header>
              <div aria-hidden className="tex-rule mx-4" />
              {empty ? (
                <div className="flex shrink-0 justify-center pt-6">
                  <motion.div
                    layoutId="tex-face"
                    transition={reduced ? { duration: 0 } : FACE_SPRING}
                    ref={ref as React.RefObject<HTMLDivElement>}
                    className="tex-face-plate tex-steps"
                    style={{ width: TEX_FACE_W * 7, height: TEX_FACE_H * 7 }}
                  >
                    <TexFace name={face} look={look} className="size-full" />
                  </motion.div>
                </div>
              ) : null}
            </LayoutGroup>
            {empty ? <Hello /> : <Conversation />}
            <Composer />
          </div>
        </div>
      </div>
      <TexCheer count={cheers} />
      <AnimatePresence>
        {over ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-x-8 top-16 z-20 bg-(--tex-mid) px-3 py-2 text-center text-sm font-medium text-white"
          >
            Soltalo acá y lo leo
          </motion.p>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}
