'use client'

import type { RegisterCustomerResult } from '@/lib/m-session/actions'
import { CaptureHero } from './capture-hero'
import { RegisterForm } from './register-form'

export function CapturePromptCard({
  qrToken,
  browserToken,
  tenantName,
  headline,
  subtext,
  onDismiss,
  onRegistered,
}: {
  qrToken: string
  browserToken: string
  tenantName: string
  headline: string
  subtext: string
  onDismiss: () => void
  onRegistered: (result: Extract<RegisterCustomerResult, { ok: true }>) => void
}) {
  return (
    <div className="card-hairline overflow-hidden rounded-2xl border border-border/60 bg-card shadow-md">
      <CaptureHero headline={headline} subtext={subtext} />
      <RegisterForm
        qrToken={qrToken}
        browserToken={browserToken}
        tenantName={tenantName}
        submitLabel="Sumar mis puntos"
        onDismiss={onDismiss}
        onRegistered={onRegistered}
      />
    </div>
  )
}
