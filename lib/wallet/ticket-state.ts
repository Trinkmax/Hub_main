/**
 * Qué se muestra arriba de la billetera: el QR vivo, el festejo de "canjeado", o
 * nada. Vive acá y no adentro del componente porque es la lógica que se rompió.
 *
 * EL BUG QUE ARREGLA: la wallet guardaba en estado local el canje que acababa de
 * pedir (`issued`) para mostrar el QR en el acto, sin esperar el refresh del
 * server. Pero nada lo borraba nunca salvo "Cancelar canje". Cuando el mozo
 * validaba, el server dejaba de mandar `activeRedemption` — y el estado local
 * seguía pintando el mismo QR para siempre. Peor: como todo lo que puede
 * generar un canje se bloquea mientras haya uno activo, el socio quedaba
 * encerrado sin poder pedir otro beneficio.
 *
 * LA REGLA: el optimista sólo vale mientras el server todavía no lo vio. En
 * cuanto un payload confirma el canje (lo "acusa"), la verdad pasa a ser el
 * server: si en un payload posterior ya no está, es que se entregó, se venció o
 * se canceló → fuera de pantalla.
 */

/** Lo mínimo que necesita la máquina; el ticket real trae mucho más. */
export type IdentifiableTicket = { redemptionId: string }

/** Canje entregado hace poco, para el festejo. Lo manda el server. */
export type DeliveredRedemption = {
  redemptionId: string
  rewardName: string
  pointsSpent: number
  deliveredAt: string
}

export type TicketResolution<T extends IdentifiableTicket> = {
  /** El canje a mostrar con su QR, o `null`. */
  ticket: T | null
  /**
   * El id que el server ya confirmó al menos una vez. El llamador lo persiste:
   * es lo que distingue "todavía no llegó el refresh" de "ya no existe".
   */
  acknowledgedId: string | null
}

export function resolveActiveTicket<T extends IdentifiableTicket>(input: {
  /** Canje pedido en esta pantalla, mostrado antes del refresh. */
  issued: T | null
  /** `activeRedemption` del último payload del server. */
  fromServer: T | null
  /** Id que el server ya confirmó en algún payload anterior. */
  acknowledgedId: string | null
  /** Cancelado recién: tapa al payload viejo que todavía lo trae. */
  cancelledId: string | null
}): TicketResolution<T> {
  const { issued, fromServer, acknowledgedId, cancelledId } = input

  // El server manda cuando tiene algo que decir.
  if (fromServer && fromServer.redemptionId !== cancelledId) {
    return { ticket: fromServer, acknowledgedId: fromServer.redemptionId }
  }

  // Sin canje del lado del server: el optimista sobrevive sólo hasta que un
  // payload lo haya confirmado. Después de eso, su ausencia es información.
  if (issued && issued.redemptionId !== cancelledId && acknowledgedId !== issued.redemptionId) {
    return { ticket: issued, acknowledgedId }
  }

  return { ticket: null, acknowledgedId }
}

/** Ventana en la que un canje entregado todavía merece festejo. */
const CELEBRATION_WINDOW_MS = 2 * 60 * 1000

/**
 * ¿Corresponde mostrar el tilde verde? Sólo si el canje se entregó recién y no
 * lo festejamos ya. La lista de festejados se persiste por pestaña, así un F5
 * no vuelve a tirar la animación de algo que el socio ya vio.
 */
export function shouldCelebrateDelivery(
  delivered: DeliveredRedemption | null,
  celebratedIds: readonly string[],
  nowMs: number,
): boolean {
  if (!delivered) return false
  if (celebratedIds.includes(delivered.redemptionId)) return false
  const at = new Date(delivered.deliveredAt).getTime()
  if (Number.isNaN(at)) return false
  // `at > nowMs` puede pasar por deriva de reloj entre el celular y el server:
  // no es motivo para no festejar, sí lo es un canje viejo.
  return nowMs - at <= CELEBRATION_WINDOW_MS
}
