import 'server-only'
import {
  Body,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'
import { render } from '@react-email/render'
import { formatCentsShort } from '@/lib/money'
import { type ShiftReport, shiftShareText } from '@/lib/pos/cash/report'

/**
 * El cierre de caja que les llega a los socios cuando alguien cierra un turno (pedido del 22/11/2026:
 * «que cuando cierre la caja esto nos lo mande a nosotros y que no lo manipule el encargado»).
 *
 * Es el mismo resumen que se ve en la caja (`buildShiftReport`), con forma de comprobante: arriba el
 * número del turno y cómo dio el arqueo, que es lo que se quiere saber con el celular en la mano, y
 * abajo el detalle. Lo arma el sistema con lo que quedó en la base: nadie lo escribe ni lo reenvía.
 */
export type ShiftCloseEmailProps = {
  barName: string
  /** «Cerro, noche». */
  place: string
  report: ShiftReport
  /** El turno en la caja, para verlo entero (y corregir un cobro). */
  shiftUrl: string
  /** Para reenviarlo al grupo: abre WhatsApp con el resumen corto ya escrito. */
  shareUrl: string
}

const TONE_COLOR = { strong: '#16302a', good: '#1f6b46', warn: '#8a5a00', bad: '#b3261e' } as const

function verdictOf(
  report: ShiftReport,
): { text: string; color: string; background: string } | null {
  const difference = report.difference
  if (!difference) return null
  if (difference.kind === 'exact') {
    return { text: 'El cajón cuadró', color: '#1f6b46', background: '#e3f1e6' }
  }
  return difference.kind === 'short'
    ? { text: difference.text, color: '#b3261e', background: '#fbe4e1' }
    : { text: difference.text, color: '#8a5a00', background: '#fbefd0' }
}

function ShiftCloseEmail({ barName, place, report, shiftUrl, shareUrl }: ShiftCloseEmailProps) {
  const verdict = verdictOf(report)
  const preview = `${report.headline}${verdict ? ` · ${verdict.text}` : ''}`
  return (
    <Html lang="es-AR">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={card}>
            <Text style={eyebrow}>Cierre de caja · {barName}</Text>
            <Text style={placeLine}>{place}</Text>
            <Text style={hero}>{formatCentsShort(report.hero.cents)}</Text>
            <Text style={sentence}>{report.hero.sentence}</Text>
            {verdict ? (
              <Text
                style={{ ...verdictChip, color: verdict.color, background: verdict.background }}
              >
                {verdict.text}
              </Text>
            ) : null}
            <Text style={meta}>{report.meta}</Text>

            {report.sections.map((section) => (
              <Section key={section.key}>
                <Hr style={hr} />
                <Text style={sectionTitle}>{section.title}</Text>
                {section.lines.map((line) => (
                  <Row key={`${line.label}:${line.value ?? ''}:${line.detail ?? ''}`} style={row}>
                    <Column style={labelCell}>
                      <Text
                        style={{
                          ...label,
                          fontWeight: line.tone === 'strong' ? 700 : 400,
                          color: line.tone ? TONE_COLOR[line.tone] : '#16302a',
                        }}
                      >
                        {line.label}
                      </Text>
                      {line.detail ? <Text style={detail}>{line.detail}</Text> : null}
                    </Column>
                    {line.value ? (
                      <Column style={valueCell}>
                        <Text
                          style={{
                            ...value,
                            fontWeight: line.tone === 'strong' || line.tone === 'bad' ? 700 : 600,
                            color: line.tone ? TONE_COLOR[line.tone] : '#16302a',
                          }}
                        >
                          {line.value}
                        </Text>
                      </Column>
                    ) : null}
                  </Row>
                ))}
                {section.foot ? <Text style={foot}>{section.foot}</Text> : null}
              </Section>
            ))}

            {report.note ? (
              <Section>
                <Hr style={hr} />
                <Text style={sectionTitle}>Nota de quien cerró</Text>
                <Text style={note}>«{report.note}»</Text>
              </Section>
            ) : null}

            <Section style={actions}>
              <Link href={shiftUrl} style={button}>
                Ver el turno en la caja
              </Link>
            </Section>
            <Text style={shareLine}>
              <Link href={shareUrl} style={shareLink}>
                Mandarlo al grupo de WhatsApp
              </Link>
            </Text>
          </Section>
          <Text style={footer}>
            Este resumen lo arma el sistema al cerrar el turno, con lo que quedó registrado. Quien
            cierra la caja no lo ve ni lo puede cambiar. Lo reciben los socios de {barName}.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

// Papel crema y tinta verde: los clientes de mail no entienden variables de CSS.
const sans =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif" as const
const body: React.CSSProperties = {
  margin: 0,
  padding: 0,
  background: '#16302a',
  fontFamily: sans,
  color: '#16302a',
}
const container: React.CSSProperties = { maxWidth: 520, margin: '24px auto', padding: '0 12px' }
const card: React.CSSProperties = {
  background: '#fffaee',
  borderRadius: 14,
  padding: '26px 22px 22px',
}
const eyebrow: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '1.6px',
  textTransform: 'uppercase',
  color: '#5b6f63',
}
const placeLine: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 17,
  fontWeight: 700,
  color: '#16302a',
  textTransform: 'capitalize',
}
const hero: React.CSSProperties = {
  margin: '14px 0 0',
  fontSize: 44,
  lineHeight: 1,
  fontWeight: 800,
  letterSpacing: '-0.02em',
  color: '#16302a',
}
const sentence: React.CSSProperties = {
  margin: '8px 0 0',
  fontSize: 14,
  lineHeight: 1.45,
  color: '#3d5148',
}
const verdictChip: React.CSSProperties = {
  display: 'inline-block',
  margin: '14px 0 0',
  padding: '7px 12px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 700,
}
const meta: React.CSSProperties = { margin: '12px 0 0', fontSize: 12, color: '#5b6f63' }
const hr: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid #e2d8bd',
  margin: '18px 0 0',
}
const sectionTitle: React.CSSProperties = {
  margin: '14px 0 4px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '1.4px',
  textTransform: 'uppercase',
  color: '#5b6f63',
}
const row: React.CSSProperties = { width: '100%' }
const labelCell: React.CSSProperties = { verticalAlign: 'top', padding: '5px 8px 5px 0' }
const valueCell: React.CSSProperties = {
  verticalAlign: 'top',
  padding: '5px 0',
  textAlign: 'right',
  whiteSpace: 'nowrap',
  width: 130,
}
const label: React.CSSProperties = { margin: 0, fontSize: 14, lineHeight: 1.35 }
const detail: React.CSSProperties = {
  margin: '1px 0 0',
  fontSize: 12,
  lineHeight: 1.35,
  color: '#5b6f63',
}
const value: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.35,
  fontVariantNumeric: 'tabular-nums',
}
const foot: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 12,
  lineHeight: 1.4,
  color: '#5b6f63',
}
const note: React.CSSProperties = {
  margin: '2px 0 0',
  fontSize: 14,
  lineHeight: 1.45,
  color: '#16302a',
}
const actions: React.CSSProperties = { textAlign: 'center', margin: '24px 0 0' }
const button: React.CSSProperties = {
  display: 'inline-block',
  padding: '13px 26px',
  background: '#16302a',
  color: '#fffaee',
  textDecoration: 'none',
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 700,
}
const shareLine: React.CSSProperties = { margin: '12px 0 0', textAlign: 'center', fontSize: 13 }
const shareLink: React.CSSProperties = { color: '#1f6b46', fontWeight: 600 }
const footer: React.CSSProperties = {
  margin: '14px 6px 0',
  textAlign: 'center',
  fontSize: 11,
  lineHeight: 1.5,
  color: '#b9c7bd',
}

export type RenderedShiftClose = { subject: string; html: string; text: string }

/** «Cierre de caja · Cerro, noche: $ 2.340.000 · faltaron $ 3.000». */
export function shiftCloseSubject(place: string, report: ShiftReport): string {
  const verdict = report.difference
    ? report.difference.kind === 'exact'
      ? 'cuadró'
      : report.difference.text.toLowerCase()
    : null
  const amount = formatCentsShort(report.hero.cents)
  return `Cierre de caja · ${place}: ${amount}${verdict ? ` · ${verdict}` : ''}`
}

export async function renderShiftCloseEmail(
  input: ShiftCloseEmailProps,
): Promise<RenderedShiftClose> {
  const html = await render(<ShiftCloseEmail {...input} />)
  const text = `${shiftShareText(input.report)}

Ver el turno en la caja: ${input.shiftUrl}

Este resumen lo arma el sistema al cerrar el turno. Quien cierra la caja no lo ve ni lo puede cambiar.`
  return { subject: shiftCloseSubject(input.place, input.report), html, text }
}
