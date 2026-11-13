import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * El service worker del salón (`public/sw.js`) guarda las páginas para poder mostrarlas sin conexión.
 * Esas páginas traen nombres de clientes: cuando la sesión termina tienen que borrarse.
 *
 * Se lo corre en un mundo de mentira (un `self`, un `caches` y un `fetch` armados acá) para comprobar
 * lo que hace con cada pedido.
 */
const SOURCE = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8')
const ORIGIN = 'https://bar.example'

type FakeResponse = { ok: boolean; redirected: boolean; body: string; clone: () => FakeResponse }
const response = (body: string, extra: Partial<FakeResponse> = {}): FakeResponse => {
  const self: FakeResponse = { ok: true, redirected: false, body, clone: () => self, ...extra }
  return self
}
type FakeRequest = {
  url: string
  method: string
  headers: { get: (name: string) => string | null }
}
const request = (path: string, accept = 'text/html', method = 'GET'): FakeRequest => ({
  url: `${ORIGIN}${path}`,
  method,
  headers: { get: (name) => (name.toLowerCase() === 'accept' ? accept : null) },
})

function boot() {
  const stores = new Map<string, Map<string, FakeResponse>>()
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name) as Map<string, FakeResponse>
      return {
        match: async (req: FakeRequest) => store.get(req.url),
        put: async (req: FakeRequest, res: FakeResponse) => void store.set(req.url, res),
      }
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  }
  const listeners = new Map<string, (event: unknown) => void>()
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: unknown) => void) => void listeners.set(type, fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  }
  let network: (req: FakeRequest) => Promise<FakeResponse> = async () => response('página')
  const fetch = (req: FakeRequest) => network(req)
  new Function('self', 'caches', 'fetch', 'URL', SOURCE)(self, caches, fetch, URL)

  /** Manda un pedido y espera todo lo que el worker dejó pendiente. Devuelve lo que respondió (o nada). */
  const send = async (req: FakeRequest): Promise<FakeResponse | undefined> => {
    const waits: Promise<unknown>[] = []
    let answer: Promise<FakeResponse> | undefined
    listeners.get('fetch')?.({
      request: req,
      respondWith: (value: Promise<FakeResponse>) => {
        answer = value
      },
      waitUntil: (value: Promise<unknown>) => void waits.push(value),
    })
    const result = answer ? await answer : undefined
    await Promise.all(waits)
    return result
  }
  const pages = () => [...stores.entries()].find(([name]) => name.endsWith('-shell'))?.[1]
  return {
    send,
    pages,
    offline: () => {
      network = async () => {
        throw new Error('sin red')
      }
    },
    online: (fn: (req: FakeRequest) => Promise<FakeResponse>) => {
      network = fn
    },
  }
}

describe('service worker del salón — las páginas guardadas', () => {
  it('guarda una página que cargó bien y la muestra si después no hay conexión', async () => {
    const sw = boot()
    sw.online(async () => response('el mapa con las reservas'))
    await sw.send(request('/hub/salon/mapa'))
    sw.offline()
    const shown = await sw.send(request('/hub/salon/mapa'))
    expect(shown?.body).toBe('el mapa con las reservas')
  })

  it('al llegar a la pantalla de entrar, borra todas las páginas guardadas', async () => {
    const sw = boot()
    await sw.send(request('/hub/salon/mapa'))
    await sw.send(request('/hub/salon/mesa/abc'))
    expect(sw.pages()?.size).toBe(2)

    const answered = await sw.send(request('/login'))
    expect(answered).toBeUndefined() // pasa derecho a la red: no se guarda ni se sirve de lo guardado
    expect(sw.pages()).toBeUndefined()

    sw.offline()
    await expect(sw.send(request('/hub/salon/mapa'))).rejects.toThrow('sin red')
  })

  it('también cuando se llega ahí navegando dentro de la app (no pide HTML)', async () => {
    const sw = boot()
    await sw.send(request('/hub/salon/mapa'))
    await sw.send(request('/login?_rsc=1x2y3', 'text/x-component'))
    expect(sw.pages()).toBeUndefined()
  })

  it('no guarda lo que llegó después de una redirección', async () => {
    const sw = boot()
    sw.online(async () => response('la pantalla de entrar', { redirected: true }))
    await sw.send(request('/hub/salon/mapa'))
    expect(sw.pages()?.size ?? 0).toBe(0)
  })

  it('no toca lo que no es GET ni lo de otro sitio', async () => {
    const sw = boot()
    expect(await sw.send(request('/hub/salon/mapa', 'text/html', 'POST'))).toBeUndefined()
    const other = { ...request('/x'), url: 'https://otro.example/x' }
    expect(await sw.send(other)).toBeUndefined()
    expect(sw.pages()?.size ?? 0).toBe(0)
  })
})
