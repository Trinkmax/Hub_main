import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isPublicWorkspacePath, updateSession, workspaceForPath } from '@/lib/supabase/middleware'
import { RESERVED_SLUGS } from '@/lib/tenant/types'
import {
  htmlThemeClass,
  PATH_HEADER,
  PUBLIC_WORKSPACE_SEGMENTS,
  parseWorkspace,
  WORKSPACE_HEADER,
} from '@/lib/workspace'

// El proxy instancia el cliente de Supabase para refrescar la sesión: acá
// alcanza con uno sin sesión (los headers se setean antes de todo eso).
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: { claims: null } }) },
  }),
}))

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** Carpetas de primer nivel de `app/` que NO son del workspace público. */
const NON_PUBLIC_APP_DIRS = new Set(['accept-invite', 'api', 'auth', 'onboarding'])

describe('workspaceForPath', () => {
  it('el salón del tenant es `salon`', () => {
    expect(workspaceForPath('/hub/salon')).toBe('salon')
    expect(workspaceForPath('/hub/salon/mesas/abc')).toBe('salon')
    expect(workspaceForPath('/hub/salones')).toBe('manager')
  })

  it('las rutas públicas son `public`', () => {
    for (const path of [
      '/carta/hub',
      '/carta',
      '/c/token',
      '/m/qr-token',
      '/r/token',
      '/v/token',
      '/l/hub',
      '/p/halloween-2026',
      '/print/qr/abc',
      '/print/carta/hub',
      '/capture/link',
    ]) {
      expect(workspaceForPath(path), path).toBe('public')
      expect(isPublicWorkspacePath(path), path).toBe(true)
    }
    // Un segmento público nunca es un tenant, ni con /salon atrás.
    expect(workspaceForPath('/c/salon')).toBe('public')
  })

  it('el resto es `manager`, aunque empiece con las mismas letras', () => {
    for (const path of [
      '/',
      '/hub',
      '/hub/clientes',
      '/hub/administracion/libros',
      '/login',
      '/onboarding',
      '/accept-invite/abc',
      '/admin',
      '/cartas/clientes',
      '/cx',
      '/printer/x',
    ]) {
      expect(workspaceForPath(path), path).toBe('manager')
    }
  })
})

describe('parseWorkspace', () => {
  it('acepta salon y public; todo lo demás es manager', () => {
    expect(parseWorkspace('salon')).toBe('salon')
    expect(parseWorkspace('public')).toBe('public')
    expect(parseWorkspace('manager')).toBe('manager')
    expect(parseWorkspace(null)).toBe('manager')
    expect(parseWorkspace(undefined)).toBe('manager')
    expect(parseWorkspace('PUBLIC')).toBe('manager')
  })
})

describe('htmlThemeClass', () => {
  it('el salón es siempre claro', () => {
    expect(htmlThemeClass('salon', 'dark')).toBe('force-light')
    expect(htmlThemeClass('salon', 'auto')).toBe('force-light')
  })

  it('lo público lleva legacy-theme, más dark si la cookie lo pide', () => {
    expect(htmlThemeClass('public', 'dark')).toBe('legacy-theme dark')
    expect(htmlThemeClass('public', 'light')).toBe('legacy-theme')
    // `auto` lo resuelve el script no-flash antes del primer paint.
    expect(htmlThemeClass('public', 'auto')).toBe('legacy-theme')
  })

  it('el panel solo lleva dark si la cookie lo pide', () => {
    expect(htmlThemeClass('manager', 'dark')).toBe('dark')
    expect(htmlThemeClass('manager', 'light')).toBe('')
    expect(htmlThemeClass('manager', 'auto')).toBe('')
  })
})

describe('la lista de rutas públicas', () => {
  const topLevelAppDirs = readdirSync(join(ROOT, 'app')).filter(
    (name) => statSync(join(ROOT, 'app', name)).isDirectory() && !name.startsWith('('),
  )

  it('cada segmento público es un slug reservado y tiene su carpeta en app/', () => {
    for (const segment of PUBLIC_WORKSPACE_SEGMENTS) {
      expect(RESERVED_SLUGS.has(segment), segment).toBe(true)
      expect(topLevelAppDirs, segment).toContain(segment)
    }
  })

  it('cada carpeta de primer nivel de app/ está clasificada', () => {
    // Una ruta nueva en app/ se clasifica: pública (PUBLIC_WORKSPACE_SEGMENTS +
    // RESERVED_SLUGS) o del panel (NON_PUBLIC_APP_DIRS). Si no, la página nueva
    // sale con un tema que nadie eligió.
    for (const dir of topLevelAppDirs) {
      const classified = PUBLIC_WORKSPACE_SEGMENTS.has(dir) || NON_PUBLIC_APP_DIRS.has(dir)
      expect(classified, `app/${dir} sin clasificar`).toBe(true)
      expect(RESERVED_SLUGS.has(dir), `app/${dir} no está en RESERVED_SLUGS`).toBe(true)
    }
  })
})

describe('updateSession marca el request para el render', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function headersFor(path: string, init?: Record<string, string>) {
    const request = new NextRequest(`https://app.example.com${path}`, { headers: init })
    await updateSession(request)
    return {
      workspace: request.headers.get(WORKSPACE_HEADER),
      path: request.headers.get(PATH_HEADER),
    }
  }

  it('usa los nombres que leen el root layout y el backstop del panel', () => {
    expect(WORKSPACE_HEADER).toBe('x-hub-workspace')
    expect(PATH_HEADER).toBe('x-hub-path')
  })

  it('lo público, también las landings (que salen antes por ser de máquina)', async () => {
    expect(await headersFor('/p/halloween-2026')).toEqual({
      workspace: 'public',
      path: '/p/halloween-2026',
    })
    expect(await headersFor('/carta/hub')).toEqual({ workspace: 'public', path: '/carta/hub' })
  })

  it('el salón, aunque después rebote al login por falta de sesión', async () => {
    expect(await headersFor('/hub/salon/mesas')).toEqual({
      workspace: 'salon',
      path: '/hub/salon/mesas',
    })
  })

  it('pisa lo que mande el cliente con el mismo nombre', async () => {
    expect(
      await headersFor('/login', {
        [WORKSPACE_HEADER]: 'public',
        [PATH_HEADER]: '/hub/administracion',
      }),
    ).toEqual({ workspace: 'manager', path: '/login' })
  })
})
