'use client'

import { usePathname, useRouter } from 'next/navigation'
import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react'
import { readyFile } from '@/components/administracion/adjuntos/ready-file'
import { attachPendingFiles } from '@/components/administracion/adjuntos/upload'
import type { TenantRole } from '@/lib/tenant/types'
import { undoTexAction } from '@/lib/tex/actions'
import {
  parseTexEvents,
  TEX_ATTACHMENT_MAX_BASE64,
  TEX_SCREEN_TEXT_MAX,
  type TexDecision,
  type TexDisplayItem,
  type TexDisplayStep,
  type TexEvent,
  type TexGuideStep,
  type TexHistory,
  type TexMood,
  type TexScreen,
  type TexTicket,
} from '@/lib/tex/protocol'
import { TEX_OPEN_EVENT } from './open-tex'
import { isPhoneScreen } from './use-phone'

/**
 * El estado de Tex en el navegador: la charla, cómo está de ánimo y qué está señalando. Vive en el
 * marco de Administración, así la charla sigue cuando la persona cambia de pantalla.
 */

export type TexPointing = { text: string; note: string | null; id: number }
export type TexGuide = { title: string; steps: TexGuideStep[]; index: number }
export type TexError = { message: string; retry: boolean; restart: boolean }

type TexState = {
  open: boolean
  threadId: string | null
  items: TexDisplayItem[]
  loaded: boolean
  busy: boolean
  mood: TexMood
  talking: boolean
  error: TexError | null
  pointing: TexPointing | null
  guide: TexGuide | null
  /** Sube cada vez que algo salió bien: dispara el festejo. */
  cheers: number
  /** La foto o el PDF que va con el próximo mensaje. */
  attachment: { name: string } | null
}

export const INITIAL_TEX_STATE: TexState = {
  open: false,
  threadId: null,
  items: [],
  loaded: false,
  busy: false,
  mood: 'listening',
  talking: false,
  error: null,
  pointing: null,
  guide: null,
  cheers: 0,
  attachment: null,
}

type TexAction =
  | { type: 'open'; open: boolean }
  | { type: 'loaded'; history: TexHistory }
  | { type: 'user'; id: string; text: string; attachment: string | null }
  | { type: 'busy'; busy: boolean }
  | { type: 'talking'; talking: boolean }
  | { type: 'clear' }
  | { type: 'ticket'; ticket: TexTicket }
  | { type: 'server'; event: TexEvent }
  | { type: 'error'; error: TexError | null }
  | { type: 'point'; pointing: TexPointing | null }
  | { type: 'guide'; guide: TexGuide | null }
  | { type: 'attachment'; attachment: { name: string } | null }

/** El último renglón de Tex; si no hay uno abierto, abre uno. */
function withTexItem(
  items: TexDisplayItem[],
  change: (
    item: Extract<TexDisplayItem, { kind: 'tex' }>,
  ) => Extract<TexDisplayItem, { kind: 'tex' }>,
): TexDisplayItem[] {
  const last = items.at(-1)
  if (last?.kind === 'tex') return [...items.slice(0, -1), change(last)]
  return [...items, change({ kind: 'tex', id: `tex-${items.length}`, text: '', steps: [] })]
}

function upsertTicket(items: TexDisplayItem[], ticket: TexTicket): TexDisplayItem[] {
  const index = items.findIndex((i) => i.kind === 'ticket' && i.ticket.actionId === ticket.actionId)
  if (index === -1) return [...items, { kind: 'ticket', id: ticket.actionId, ticket }]
  const next = [...items]
  next[index] = { kind: 'ticket', id: ticket.actionId, ticket }
  return next
}

function upsertStep(steps: TexDisplayStep[], step: TexDisplayStep): TexDisplayStep[] {
  const index = steps.findIndex((s) => s.id === step.id)
  if (index === -1) return [...steps, step]
  const next = [...steps]
  next[index] = step
  return next
}

/** Puro: lo prueba `tex-provider.test.ts`. */
export function texReducer(state: TexState, action: TexAction): TexState {
  switch (action.type) {
    case 'open':
      return { ...state, open: action.open }
    case 'loaded':
      return {
        ...state,
        loaded: true,
        threadId: action.history.threadId,
        items: action.history.items,
      }
    case 'user':
      return {
        ...state,
        error: null,
        mood: 'thinking',
        attachment: null,
        items: [
          ...state.items,
          { kind: 'user', id: action.id, text: action.text, attachment: action.attachment },
        ],
      }
    case 'busy':
      return { ...state, busy: action.busy }
    case 'talking':
      return { ...state, talking: action.talking }
    case 'clear':
      return { ...state, threadId: null, items: [], error: null, mood: 'listening' }
    case 'ticket':
      return { ...state, items: upsertTicket(state.items, action.ticket) }
    case 'error':
      return { ...state, error: action.error }
    case 'point':
      return { ...state, pointing: action.pointing }
    case 'guide':
      return { ...state, guide: action.guide }
    case 'attachment':
      return { ...state, attachment: action.attachment, error: null }
    case 'server': {
      const event = action.event
      switch (event.type) {
        case 'thread':
          return { ...state, threadId: event.threadId }
        case 'mood':
          return {
            ...state,
            mood: event.mood,
            cheers: event.mood === 'happy' ? state.cheers + 1 : state.cheers,
          }
        case 'text':
          return {
            ...state,
            items: withTexItem(state.items, (item) => ({ ...item, text: item.text + event.delta })),
          }
        case 'step':
          return {
            ...state,
            items: withTexItem(state.items, (item) => ({
              ...item,
              steps: upsertStep(item.steps, {
                id: event.id,
                label: event.label,
                state: event.state,
              }),
            })),
          }
        case 'ticket':
          return { ...state, items: upsertTicket(state.items, event.ticket) }
        case 'error':
          return {
            ...state,
            error: { message: event.message, retry: event.retry, restart: event.restart ?? false },
          }
        default:
          return state
      }
    }
  }
}

type TexContextValue = TexState & {
  slug: string
  role: TenantRole
  /** Puede pasarle papeles: es de quien carga en Administración. */
  canAttach: boolean
  pathname: string
  setOpen: (open: boolean) => void
  send: (text: string) => void
  attach: (file: File | null) => void
  decide: (decisions: TexDecision[]) => void
  undo: (actionId: string) => Promise<void>
  retry: () => void
  stop: () => void
  restart: () => void
  showWhere: (href: string, point: string | null) => void
  /** Se tocó un link adentro de la hoja: en el celular se cierra, para ver a dónde llevó. */
  followLink: (event: MouseEvent<HTMLAnchorElement>, href: string) => void
  clearPoint: () => void
  guideNext: () => void
  guideClose: () => void
}

const TexContext = createContext<TexContextValue | null>(null)

export function useTex(): TexContextValue {
  const value = useContext(TexContext)
  if (!value) throw new Error('useTex: falta <TexProvider>.')
  return value
}

/** El ancho que ocupa el panel con sus manos, y lo mínimo que tiene que quedarle a la página. */
const PANEL_SPACE_PX = 512
const PAGE_MIN_PX = 640

const READABLE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
type ReadableMime = (typeof READABLE_MIMES)[number]

/** La foto achicada (la misma de los adjuntos) en base64, lista para que Tex la lea. */
async function texAttachmentOf(
  file: File,
): Promise<{ name: string; mime: ReadableMime; data: string } | { error: string }> {
  const ready = await readyFile(file)
  if ('message' in ready) return { error: ready.message }
  const mime = READABLE_MIMES.find((m) => m === ready.mimeType)
  if (!mime) return { error: 'Ese formato no lo puedo leer. Probá con una foto JPG o un PDF.' }
  const bytes = new Uint8Array(await ready.blob.arrayBuffer())
  if (bytes.length * 4 > TEX_ATTACHMENT_MAX_BASE64 * 3) {
    return {
      error: 'Ese archivo es muy grande para leerlo acá. Cargalo desde «+ Cargar › Compra».',
    }
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32_768))
  }
  return { name: file.name.slice(0, 120), mime, data: btoa(binary) }
}

/**
 * Lo que se lee en pantalla sin los teléfonos y mails de los clientes: Tex no los necesita y no tienen
 * por qué salir del sistema. Puro.
 */
export function maskPersonal(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[mail]')
    .replace(/(?<![\d.,$/])\+?(?:\d[\s-]?){8,14}\d(?![\d.,/])/g, '[teléfono]')
    .replace(
      // Lo de salud, hasta el final de esa celda: «alérgica al maní» no sale de la pantalla.
      /(?:cel[ií]ac|sin tacc|alerg|al[eé]rgic|intoleran|diab[eé]tic|embaraz|discapacid|silla de ruedas|movilidad reducida)[^\n\t]*/gi,
      '[aviso de salud]',
    )
}

/** Lo que se lee en pantalla: Tex ve lo mismo que la persona. Tex y las hojas de arriba no cuentan. */
function captureScreen(): TexScreen {
  const main = document.querySelector('main')
  const heading = main?.querySelector('h1')?.textContent ?? document.title
  const seen = main instanceof HTMLElement ? main.innerText : ''
  // En Administración los números de comprobante y de CUIT hacen falta; en el resto, no los de la gente.
  const text = (
    window.location.pathname.includes('/administracion') ? seen : maskPersonal(seen)
  ).slice(0, TEX_SCREEN_TEXT_MAX)
  return {
    path: `${window.location.pathname}${window.location.search}`.slice(0, 600),
    title: heading.trim().slice(0, 200),
    text,
  }
}

export function TexProvider({
  slug,
  role,
  canAttach,
  children,
}: {
  slug: string
  role: TenantRole
  canAttach: boolean
  children: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [state, dispatch] = useReducer(texReducer, INITIAL_TEX_STATE)
  const abortRef = useRef<AbortController | null>(null)
  const talkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointId = useRef(0)
  const threadRef = useRef<string | null>(null)
  threadRef.current = state.threadId
  const busyRef = useRef(false)
  /** «Charla nueva»: el próximo mensaje no sigue la anterior aunque esté reciente. */
  const freshRef = useRef(false)
  /** El archivo elegido, y después el ya leído: se suma al comprobante que salga de él. */
  const fileRef = useRef<File | null>(null)
  const readFileRef = useRef<File | null>(null)
  /** La hoja del celular dejó una entrada en el historial: «atrás» la cierra en vez de irse. */
  const sheetEntry = useRef(false)

  // La charla se trae la primera vez que se abre.
  useEffect(() => {
    if (!state.open || state.loaded) return
    let cancelled = false
    fetch(`/api/tex?slug=${encodeURIComponent(slug)}`)
      .then(async (res) => {
        const history: TexHistory = res.ok ? await res.json() : { threadId: null, items: [] }
        if (!cancelled) dispatch({ type: 'loaded', history })
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'loaded', history: { threadId: null, items: [] } })
      })
    return () => {
      cancelled = true
    }
  }, [state.open, state.loaded, slug])

  /**
   * Tex lleva a otra pantalla. En el celular la hoja tapa todo, así que se cierra para que se vea a dónde
   * llegó. Si la hoja había dejado su entrada en el historial, la nueva pantalla ocupa ese lugar: «atrás»
   * vuelve a donde estaba la persona, sin pasar por una pantalla repetida.
   */
  const goTo = useCallback(
    (href: string) => {
      if (sheetEntry.current) {
        sheetEntry.current = false
        router.replace(href)
      } else {
        router.push(href)
      }
      if (isPhoneScreen()) dispatch({ type: 'open', open: false })
    },
    [router],
  )

  const handle = useCallback(
    (event: TexEvent): boolean => {
      dispatch({ type: 'server', event })
      switch (event.type) {
        case 'ticket': {
          // Un tique espera una respuesta: tiene que estar a la vista.
          if (event.ticket.status === 'pending') dispatch({ type: 'open', open: true })
          // El comprobante que salió de la foto se queda con la foto.
          const documentId = event.ticket.result?.documentId
          const file = readFileRef.current
          if (event.ticket.status === 'done' && documentId && file) {
            readFileRef.current = null
            void attachPendingFiles({
              tenantSlug: slug,
              documentId,
              files: [file],
              openDocument: (id) => router.push(`/${slug}/administracion/comprobantes/${id}`),
            })
          }
          break
        }
        case 'text':
          dispatch({ type: 'talking', talking: true })
          if (talkTimer.current) clearTimeout(talkTimer.current)
          talkTimer.current = setTimeout(() => dispatch({ type: 'talking', talking: false }), 260)
          break
        case 'navigate':
          goTo(event.href)
          break
        case 'point':
          // Sin lugar al costado, lo señalado podría quedar abajo del panel.
          if (!document.documentElement.dataset.texPush) dispatch({ type: 'open', open: false })
          pointId.current += 1
          dispatch({
            type: 'point',
            pointing: { text: event.text, note: event.note, id: pointId.current },
          })
          break
        case 'guide': {
          if (!document.documentElement.dataset.texPush) dispatch({ type: 'open', open: false })
          const first = event.steps[0]
          dispatch({ type: 'guide', guide: { title: event.title, steps: event.steps, index: 0 } })
          if (first?.href) goTo(first.href)
          if (first?.point) {
            pointId.current += 1
            dispatch({
              type: 'point',
              pointing: { text: first.point, note: null, id: pointId.current },
            })
          }
          break
        }
        case 'refresh':
          router.refresh()
          break
        case 'continue':
          return true
        case 'done':
          // Lo que falta del pedido es anotar lo consumido: ya se puede escribir de nuevo.
          busyRef.current = false
          dispatch({ type: 'busy', busy: false })
          break
        default:
      }
      return false
    },
    [router, slug, goTo],
  )

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      if (busyRef.current) return
      busyRef.current = true
      dispatch({ type: 'busy', busy: true })
      const controller = new AbortController()
      abortRef.current = controller
      const fresh = freshRef.current && 'message' in body
      if (fresh) freshRef.current = false
      let again = false
      try {
        const response = await fetch(`/api/tex?slug=${encodeURIComponent(slug)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadId: threadRef.current,
            screen: captureScreen(),
            fresh,
            ...body,
          }),
          signal: controller.signal,
        })
        if (!response.ok || !response.body) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null
          dispatch({
            type: 'error',
            error: {
              message: data?.error ?? 'Se me cortó la conexión. Probá de nuevo.',
              retry: response.status !== 403,
              restart: response.status === 409,
            },
          })
          dispatch({ type: 'server', event: { type: 'mood', mood: 'sad' } })
          return
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parsed = parseTexEvents(buffer)
          buffer = parsed.rest
          for (const event of parsed.events) {
            if (handle(event)) again = true
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          dispatch({
            type: 'error',
            error: {
              message: 'Se me cortó la conexión. Probá de nuevo.',
              retry: true,
              restart: false,
            },
          })
          dispatch({ type: 'server', event: { type: 'mood', mood: 'sad' } })
        }
      } finally {
        busyRef.current = false
        dispatch({ type: 'busy', busy: false })
        abortRef.current = null
      }
      if (again) void post({ resume: true })
    },
    [handle, slug],
  )

  const send = useCallback(
    (text: string) => {
      const file = fileRef.current
      const clean = text.trim() || (file ? 'Te paso este comprobante.' : '')
      if (!clean || busyRef.current) return
      dispatch({
        type: 'user',
        id: `u-${Date.now()}`,
        text: clean,
        attachment: file?.name ?? null,
      })
      dispatch({ type: 'point', pointing: null })
      if (!file) {
        void post({ message: clean })
        return
      }
      fileRef.current = null
      readFileRef.current = file
      void (async () => {
        const attachment = await texAttachmentOf(file)
        if ('error' in attachment) {
          readFileRef.current = null
          dispatch({
            type: 'error',
            error: { message: attachment.error, retry: false, restart: false },
          })
          return
        }
        void post({ message: clean, attachment })
      })()
    },
    [post],
  )

  const attach = useCallback((file: File | null) => {
    fileRef.current = file
    dispatch({ type: 'attachment', attachment: file ? { name: file.name } : null })
    if (file) dispatch({ type: 'open', open: true })
  }, [])

  const decide = useCallback(
    (decisions: TexDecision[]) => {
      if (decisions.length === 0 || busyRef.current) return
      void post({ decisions })
    },
    [post],
  )

  const undo = useCallback(
    async (actionId: string) => {
      const outcome = await undoTexAction(slug, actionId)
      if (outcome.ticket) dispatch({ type: 'ticket', ticket: outcome.ticket })
      if (!outcome.ok) {
        dispatch({
          type: 'error',
          error: { message: outcome.message, retry: false, restart: false },
        })
      }
    },
    [slug],
  )

  const retry = useCallback(() => {
    dispatch({ type: 'error', error: null })
    void post({ resume: true })
  }, [post])

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const restart = useCallback(() => {
    abortRef.current?.abort()
    dispatch({ type: 'clear' })
    threadRef.current = null
    freshRef.current = true
  }, [])

  const showWhere = useCallback(
    (href: string, point: string | null) => {
      goTo(href)
      if (point) {
        pointId.current += 1
        dispatch({ type: 'point', pointing: { text: point, note: null, id: pointId.current } })
      }
    },
    [goTo],
  )

  const followLink = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, href: string) => {
      if (!isPhoneScreen()) return
      event.preventDefault()
      goTo(href)
    },
    [goTo],
  )

  const clearPoint = useCallback(() => dispatch({ type: 'point', pointing: null }), [])

  const guideNext = useCallback(() => {
    if (!state.guide) return
    const index = state.guide.index + 1
    const step = state.guide.steps[index]
    if (!step) {
      dispatch({ type: 'guide', guide: null })
      dispatch({ type: 'point', pointing: null })
      return
    }
    dispatch({ type: 'guide', guide: { ...state.guide, index } })
    if (step.href) goTo(step.href)
    pointId.current += 1
    dispatch({
      type: 'point',
      pointing: step.point ? { text: step.point, note: null, id: pointId.current } : null,
    })
  }, [state.guide, goTo])

  const guideClose = useCallback(() => {
    dispatch({ type: 'guide', guide: null })
    dispatch({ type: 'point', pointing: null })
  }, [])

  const setOpen = useCallback((open: boolean) => {
    dispatch({ type: 'open', open })
    // El foco vuelve a quien abrió: Tex en su esquina.
    if (!open) {
      setTimeout(() => document.querySelector<HTMLElement>('.tex-dock-button')?.focus(), 80)
    }
  }, [])

  // ⌘J abre y cierra; también lo abren ⌘K y el lanzador.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        dispatch({ type: 'open', open: !stateOpen.current })
      }
    }
    const onOpen = (event: Event) => {
      dispatch({ type: 'open', open: true })
      const message = (event as CustomEvent<{ message: string | null }>).detail?.message
      if (message) send(message)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener(TEX_OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(TEX_OPEN_EVENT, onOpen)
    }
  }, [send])

  const stateOpen = useRef(state.open)
  stateOpen.current = state.open

  // En el celular, el «atrás» del teléfono cierra la hoja en vez de irse de la pantalla.
  useEffect(() => {
    if (!state.open || !isPhoneScreen()) return
    window.history.pushState(window.history.state, '')
    sheetEntry.current = true
    const onBack = () => {
      sheetEntry.current = false
      dispatch({ type: 'open', open: false })
    }
    window.addEventListener('popstate', onBack)
    return () => {
      window.removeEventListener('popstate', onBack)
      // Se cerró con la X o deslizando: se saca la entrada que había dejado.
      if (sheetEntry.current) {
        sheetEntry.current = false
        window.history.back()
      }
    }
  }, [state.open])

  // Para que ⌘K y el lanzador sepan que Tex está en esta pantalla.
  useEffect(() => {
    document.documentElement.dataset.tex = ''
    return () => {
      delete document.documentElement.dataset.tex
    }
  }, [])

  // Con el panel abierto, la página le hace lugar si le alcanza. Si no, el panel va encima y se
  // achica para mostrar lo que señala.
  useEffect(() => {
    const root = document.documentElement
    const update = () => {
      const width = document.querySelector('main')?.getBoundingClientRect().width ?? 0
      if (state.open && !isPhoneScreen() && width - PANEL_SPACE_PX >= PAGE_MIN_PX)
        root.dataset.texPush = '1'
      else delete root.dataset.texPush
    }
    update()
    if (!state.open) return
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      delete root.dataset.texPush
    }
  }, [state.open])

  const value = useMemo<TexContextValue>(
    () => ({
      ...state,
      slug,
      role,
      canAttach,
      pathname,
      setOpen,
      send,
      attach,
      decide,
      undo,
      retry,
      stop,
      restart,
      showWhere,
      followLink,
      clearPoint,
      guideNext,
      guideClose,
    }),
    [
      state,
      slug,
      role,
      canAttach,
      pathname,
      setOpen,
      send,
      attach,
      decide,
      undo,
      retry,
      stop,
      restart,
      showWhere,
      followLink,
      clearPoint,
      guideNext,
      guideClose,
    ],
  )

  return <TexContext.Provider value={value}>{children}</TexContext.Provider>
}
