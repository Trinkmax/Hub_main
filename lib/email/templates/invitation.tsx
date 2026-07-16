import 'server-only'
import {
  Body,
  Button,
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

export type InvitationEmailProps = {
  tenantName: string
  inviterName: string | null
  role: TenantRole
  acceptUrl: string
}

function InvitationEmail({ tenantName, inviterName, role, acceptUrl }: InvitationEmailProps) {
  const roleLabel = ROLE_LABELS[role]
  const inviter = inviterName?.trim() ? `${inviterName} (${tenantName})` : tenantName
  const previewText = `${inviter} te invitó al equipo de ${tenantName} como ${roleLabel}.`

  return (
    <Html lang="es-AR">
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={card}>
            <Text style={eyebrow}>Invitación al equipo</Text>
            <Heading style={heading}>{tenantName}</Heading>
            <Text style={paragraph}>
              <strong>{inviter}</strong> te sumó al equipo con el rol de{' '}
              <strong>{roleLabel}</strong>.
            </Text>
            <Text style={paragraph}>
              Aceptá la invitación para acceder a tu panel desde tu celular o computadora.
            </Text>
            <Section style={btnWrapper}>
              <Button href={acceptUrl} style={button}>
                Aceptar invitación
              </Button>
            </Section>
            <Hr style={hr} />
            <Text style={smallNote}>
              Si el botón no funciona, copiá y pegá este link en tu navegador:
              <br />
              <Link href={acceptUrl} style={smallLink}>
                {acceptUrl}
              </Link>
            </Text>
          </Section>
          <Text style={footer}>Si no esperabas esta invitación, podés ignorar este email.</Text>
        </Container>
      </Body>
    </Html>
  )
}

// Cream + forest palette resuelto a hex (los clientes de email no soportan CSS vars).
const body: React.CSSProperties = {
  margin: 0,
  padding: 0,
  background: '#f5edd7',
  fontFamily:
    "Georgia, 'Times New Roman', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  color: '#1f4d38',
}
const container: React.CSSProperties = {
  maxWidth: 520,
  margin: '32px auto',
  padding: '0 16px',
}
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
const btnWrapper: React.CSSProperties = {
  textAlign: 'center',
  margin: '28px 0',
}
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
const hr: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid #e8dec2',
  margin: '24px 0',
}
const smallNote: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: '#5b6f63',
  lineHeight: 1.5,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif",
}
const smallLink: React.CSSProperties = {
  color: '#2d6a4f',
  wordBreak: 'break-all',
}
const footer: React.CSSProperties = {
  margin: '16px 0 0',
  textAlign: 'center',
  fontSize: 11,
  color: '#5b6f63',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif",
}

export type RenderedInvitation = {
  subject: string
  html: string
  text: string
  reactElement: React.ReactElement
}

export async function renderInvitationEmail(
  input: InvitationEmailProps & { to: string },
): Promise<RenderedInvitation> {
  const roleLabel = ROLE_LABELS[input.role]
  const subject = `Te invitaron a ${input.tenantName} como ${roleLabel}`
  const inviter = input.inviterName?.trim()
    ? `${input.inviterName} (${input.tenantName})`
    : input.tenantName
  const text = `Hola,

${inviter} te invitó al equipo de ${input.tenantName} con el rol de ${roleLabel}.

Para aceptar la invitación y empezar a usar tu panel, abrí este link:
${input.acceptUrl}

Si no esperabas esta invitación, podés ignorar este email.

— Plataforma HUB`

  const reactElement = (
    <InvitationEmail
      tenantName={input.tenantName}
      inviterName={input.inviterName}
      role={input.role}
      acceptUrl={input.acceptUrl}
    />
  )
  const html = await render(reactElement)

  return { subject, html, text, reactElement }
}

export { InvitationEmail }
