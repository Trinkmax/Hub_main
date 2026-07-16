import 'server-only'
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { render } from '@react-email/render'
import { ROLE_LABELS } from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'

export type CredentialsEmailProps = {
  tenantName: string
  fullName: string | null
  email: string
  password: string
  role: TenantRole
  loginUrl: string
}

function CredentialsEmail({
  tenantName,
  fullName,
  email,
  password,
  role,
  loginUrl,
}: CredentialsEmailProps) {
  const roleLabel = ROLE_LABELS[role]
  const greeting = fullName?.trim() ? `Hola ${fullName}` : 'Hola'
  const previewText = `Tus credenciales para acceder a ${tenantName} como ${roleLabel}.`

  return (
    <Html lang="es-AR">
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={card}>
            <Text style={eyebrow}>Bienvenido al equipo</Text>
            <Heading style={heading}>{tenantName}</Heading>
            <Text style={paragraph}>
              {greeting}, te sumamos al equipo con el rol de <strong>{roleLabel}</strong>.
            </Text>
            <Text style={paragraph}>
              Estas son tus credenciales para acceder al panel desde tu celular o computadora.
              Guardalas en un lugar seguro.
            </Text>
            <Section style={credBox}>
              <Text style={credLabel}>Email</Text>
              <Text style={credValue}>{email}</Text>
              <Text style={credLabel}>Contraseña</Text>
              <Text style={credValue}>{password}</Text>
            </Section>
            <Section style={btnWrapper}>
              <Link href={loginUrl} style={button}>
                Iniciar sesión
              </Link>
            </Section>
            <Hr style={hr} />
            <Text style={smallNote}>
              Si el botón no funciona, copiá y pegá esta URL en tu navegador:
              <br />
              <Link href={loginUrl} style={smallLink}>
                {loginUrl}
              </Link>
            </Text>
            <Text style={smallNote}>Cualquier duda sobre tu rol, hablá con el dueño del bar.</Text>
          </Section>
          <Text style={footer}>
            Este email contiene credenciales privadas. Si no esperabas este mensaje, ignoralo.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

// Cream + forest palette (los clientes de email no soportan CSS vars).
const body: React.CSSProperties = {
  margin: 0,
  padding: 0,
  background: '#f5edd7',
  fontFamily:
    "Georgia, 'Times New Roman', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  color: '#1f4d38',
}
const container: React.CSSProperties = { maxWidth: 520, margin: '32px auto', padding: '0 16px' }
const card: React.CSSProperties = {
  background: '#fffaee',
  borderRadius: 14,
  padding: '32px 28px',
  border: '1px solid #d9cfae',
  boxShadow: '0 1px 3px rgba(31,77,56,0.08)',
}
const eyebrow: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '2px',
  color: '#5b6f63',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif",
}
const heading: React.CSSProperties = {
  margin: '8px 0 16px',
  fontSize: 28,
  lineHeight: 1.2,
  color: '#1f4d38',
  fontWeight: 700,
  fontFamily: "Georgia, 'Times New Roman', serif",
  letterSpacing: '-0.02em',
}
const paragraph: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 14,
  color: '#1f4d38',
  lineHeight: 1.55,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif",
}
const credBox: React.CSSProperties = {
  background: '#f5edd7',
  border: '1px solid #d9cfae',
  borderRadius: 10,
  padding: '16px 20px',
  margin: '20px 0',
}
const credLabel: React.CSSProperties = {
  margin: '8px 0 2px',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: '#5b6f63',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif",
}
const credValue: React.CSSProperties = {
  margin: '0 0 4px',
  fontSize: 15,
  fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  color: '#1f4d38',
  fontWeight: 600,
  wordBreak: 'break-all',
}
const btnWrapper: React.CSSProperties = { textAlign: 'center', margin: '24px 0' }
const button: React.CSSProperties = {
  display: 'inline-block',
  padding: '14px 32px',
  background: '#1f4d38',
  color: '#f5edd7',
  textDecoration: 'none',
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif",
}
const hr: React.CSSProperties = { border: 'none', borderTop: '1px solid #e8dec2', margin: '24px 0' }
const smallNote: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 12,
  color: '#5b6f63',
  lineHeight: 1.5,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif",
}
const smallLink: React.CSSProperties = { color: '#2d6a4f', wordBreak: 'break-all' }
const footer: React.CSSProperties = {
  margin: '16px 0 0',
  textAlign: 'center',
  fontSize: 11,
  color: '#5b6f63',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif",
}

export type RenderedCredentials = { subject: string; html: string; text: string }

export async function renderCredentialsEmail(
  input: CredentialsEmailProps,
): Promise<RenderedCredentials> {
  const roleLabel = ROLE_LABELS[input.role]
  const subject = `Tus credenciales para ${input.tenantName} (${roleLabel})`
  const greeting = input.fullName?.trim() ? `Hola ${input.fullName}` : 'Hola'
  const text = `${greeting},

Te sumamos al equipo de ${input.tenantName} con el rol de ${roleLabel}.

Tus credenciales:
  Email: ${input.email}
  Contraseña: ${input.password}

Iniciá sesión: ${input.loginUrl}

Cualquier duda sobre tu rol, hablá con el dueño del bar.

— Plataforma HUB`

  const html = await render(
    <CredentialsEmail
      tenantName={input.tenantName}
      fullName={input.fullName}
      email={input.email}
      password={input.password}
      role={input.role}
      loginUrl={input.loginUrl}
    />,
  )
  return { subject, html, text }
}
