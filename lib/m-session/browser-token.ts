'use client'

const STORAGE_KEY = 'hub:browser_token'
const TOKEN_LENGTH = 24

function generateToken(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(TOKEN_LENGTH)
    crypto.getRandomValues(bytes)
    let out = ''
    for (let i = 0; i < TOKEN_LENGTH; i++) {
      const byte = bytes[i] ?? 0
      out += alphabet[byte % alphabet.length]
    }
    return out
  }
  // Fallback (no debería usarse en navegadores modernos)
  let out = ''
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

export function getOrCreateBrowserToken(): string {
  if (typeof window === 'undefined') {
    throw new Error('getOrCreateBrowserToken must be called in the browser')
  }
  let token = window.localStorage.getItem(STORAGE_KEY)
  if (!token || token.length < 16 || token.length > 64) {
    token = generateToken()
    window.localStorage.setItem(STORAGE_KEY, token)
  }
  return token
}

export function clearBrowserToken(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY)
  }
}
