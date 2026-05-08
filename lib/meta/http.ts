import 'server-only'
import { MetaApiError, type MetaApiErrorPayload } from './errors'

type RequestInitJson = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  accessToken?: string
  body?: unknown
  headers?: Record<string, string>
}

export async function metaFetch<T = unknown>(url: string, init: RequestInitJson = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.headers ?? {}),
  }
  if (init.accessToken) headers.Authorization = `Bearer ${init.accessToken}`
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })

  const text = await res.text()
  let payload: unknown
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }

  if (!res.ok) {
    const errBody = (payload as { error?: MetaApiErrorPayload })?.error ?? {
      message: typeof payload === 'string' ? payload : 'Unknown error',
    }
    throw new MetaApiError(res.status, errBody)
  }
  return payload as T
}
