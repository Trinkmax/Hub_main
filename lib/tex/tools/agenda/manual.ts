/**
 * Cómo funciona el área, para cuando alguien pregunta. Solo lo que el sistema hace, y sin nada de un bar
 * en particular: sale de `docs/reservas.md`, `docs/features/entradas-online.md` y del código.
 */
export const agendaManual = `# Reservas, Calendario y Entradas

Una reserva es una mesa anotada para un día, una hora y un servicio. Se carga desde la lista de Reservas o desde el Calendario.

## El cupo es por servicio
- Hay almuerzo, merienda y cena, más desayuno el día que tiene algo. No hay un total del día contra un cupo: cada servicio se mide contra el suyo.
- La hora decide el servicio: hasta las 5, la cena de esa noche; de 5 a 12, desayuno; de 12 a 15, almuerzo; de 15 a 19, merienda; después, cena. Si cambia la hora de una reserva sin evento, cambia su servicio y la tarifa de su comisión. Una reserva en un evento cuenta en el servicio del evento, por la hora a la que arranca.
- Se cuentan personas: las que vinieron si ya se contaron; si no, las reservadas. Las canceladas y las que no vinieron no ocupan lugar.
- De dónde sale el cupo, en orden: cupo especial de esa fecha, cupo de ese día de la semana, cupo general (la suma de las plantas). Si no hay nada, no hay tope. Cupo 0 es cerrado.
- Cada evento aparta su cupo adentro de su servicio: lo apartado ocupa aunque esté vacío. Por eso «58 de 120» puede estar en rojo, y los «libres» son lo que queda para reservas normales.
- Rojo: se pasó. Ámbar: llegó al aviso del servicio o al 90 %.
- Pasarse avisa, no bloquea: el tique lo dice y la persona decide. Reservar adentro de un evento con lugar no avisa nada: ese lugar ya estaba apartado.

## Estados
Pendiente → Llegó → Sentada → Cerrada, o No vino, o Cancelada. Se puede volver atrás: de Llegó a Pendiente, de Sentada a Llegó, de Cerrada a Sentada, de No vino a Pendiente o a Llegó. Cancelada no vuelve. El tablero no deja marcar un día que todavía no llegó, y yo tampoco.
Al marcar Llegó se anota cuántos vinieron y en qué mesa. La mesa es texto libre («12», «12+13», «Barra») y no toca el cupo ni la comisión. Si tiene ficha y el evento da puntos por asistir, se acreditan una vez, al llegar.

## El día de servicio
El tablero Operativo sigue en la noche anterior hasta las 5 de la mañana. La lista y el Calendario usan el día del calendario. Una reserva a las 00:30 es el final de esa noche.

## Dónde se sienta
Planta Alta o Planta Baja. Una reserva de evento puede no tener planta: es «Sin ubicar». Que sea de evento lo dice el evento, no la planta. Sin planta ni evento no se puede.

## Clientes y mensajes
Con un teléfono, la reserva se vincula a la ficha de ese cliente o le crea una; sin teléfono queda suelta. Los avisos (celíaco, alergia, vegetariano, vegano, movilidad reducida, silla de bebé) se ven en la lista y el tablero; salvo la silla de bebé, quedan también en la ficha.
Cargar una reserva no le manda nada al cliente. La excepción: con un flow «Se acerca un evento» prendido, a quienes tienen ficha y reserva en ese evento les puede llegar un WhatsApp unas horas antes. El tique lo avisa.

## Comisiones
- El gestor es quien tomó la reserva. Todo el equipo tiene su gestor, pero cobra solo el que un dueño habilitó. Por defecto queda el último que se usó en ese dispositivo y, si no, quien la carga: si la tomó otro, hay que decirlo.
- Se cobra por persona, según el servicio y el tamaño de la mesa. El escalón lo fija lo reservado; se pagan las personas que vinieron si se contaron y, si no, las reservadas («sin contar»).
- Si el evento tiene el bonus prendido y lo reservado llega al cupo, se suma un bonus por persona. Con asistente y si los dos cobran, se reparte a medias.
- Se calcula al marcar Llegó y se recalcula al cambiar la reserva. No vino y Cancelada la sacan. Lo ya pagado no se toca.
- El sistema propone y los dueños aprueban. No se paga una reserva que todavía no pasó. Cada gestor ve lo suyo en Mis números.

## Señas
Es un monto anotado en la reserva: el sistema no guarda cuándo se cobró ni si se devolvió. El reporte se lee por día de la reserva o por día de carga, y dan distinto. Las canceladas y las que no vinieron suman, y van aparte. Cancelar no devuelve ni borra la seña.

## Eventos y formatos
Un formato es el molde, con su nombre y su cupo; un evento es ese formato en una fecha, con su propio cupo. Un formato va una vez por día. Un evento con reservas activas no se mueve de día ni se borra. Cancelar un evento es borrarlo; si tiene pauta cargada, la saca primero un dueño.
Grupo privado: ocupa cupo, pero no sale en los reportes de eventos. Un cumple o una reserva especial pueden pedir un formato que ese día no está: se programa solo, como grupo privado.

## Entradas online
Solo las ven los dueños. Cada formato puede tener una página de venta (la «película»). Se venden sus fechas desde hoy, sin grupos privados y hasta la hora de arranque: programar una fecha alcanza para que salga en la cartelera.
- Precio y seña son por persona, con un mínimo y un máximo. Según la película, se paga la seña o todo.
- Quedan = cupo − reservas en pie − lugares guardados por compras en curso. Con menos lugares que el mínimo, figura agotada. Las reservas a mano solo avisan; la venta online corta.
- Al aprobarse el pago, la reserva se crea sola: sin planta, a nombre del gestor de venta online y con una nota de cuánto resta cobrar. La entrada lleva un QR para la puerta.
- Si Mercado Pago rechaza, se puede transferir: alguien del bar lo confirma a mano.
- Cancelar la reserva de una compra deja sin valor la entrada, pero no devuelve la plata.

## Lo que no hago y llevo a la pantalla
Devolver plata, confirmar transferencias y anular entradas (Entradas › Ventas online); conectar Mercado Pago y editar una película (Entradas); cargar fechas con Excel (Calendario); Pasar lista de toda una noche (Reservas); marcar comisiones pagadas (Estadísticas › Comisiones); tarifas y qué gestores cobran (Configuración › Comisiones); sumar puntos a una mesa (Operativo). Tampoco borro nada en bloque.

## Palabras
Cubierto = persona. Reserva normal = sin evento. Apartado = lo que se guarda un evento. Función = una fecha de una película. Sin contar = nadie cargó cuántos vinieron.
`
