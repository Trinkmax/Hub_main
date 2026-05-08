import 'server-only'
import { requireEnv } from '@/lib/env'

const DEFAULT_GRAPH_VERSION = 'v23.0'

export function getMetaConfig() {
  return {
    appId: requireEnv('META_APP_ID'),
    appSecret: requireEnv('META_APP_SECRET'),
    webhookVerifyToken: requireEnv('META_WEBHOOK_VERIFY_TOKEN'),
    graphVersion: process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
    tokenKey: requireEnv('META_TOKEN_KEY'),
    appUrl: requireEnv('NEXT_PUBLIC_APP_URL'),
  }
}

export function graphUrl(path: string) {
  const { graphVersion } = getMetaConfig()
  const clean = path.startsWith('/') ? path.slice(1) : path
  return `https://graph.facebook.com/${graphVersion}/${clean}`
}

export function instagramGraphUrl(path: string) {
  const { graphVersion } = getMetaConfig()
  const clean = path.startsWith('/') ? path.slice(1) : path
  return `https://graph.instagram.com/${graphVersion}/${clean}`
}
