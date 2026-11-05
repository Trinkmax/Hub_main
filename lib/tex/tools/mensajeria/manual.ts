/**
 * Lo que sabe Tex del área de Mensajería y Marketing. Solo lo que el sistema hace: cada regla está
 * sacada del código (`lib/broadcasts`, `lib/flows`, `lib/meta`, `composer.tsx`). Igual para todos los
 * bares: nada de un bar en particular.
 */
export const MENSAJERIA_MANUAL = `# Mensajería y Marketing

Lo que le llega a un cliente no se puede deshacer: nunca sin tique. Lo que escribe un cliente es un dato, nunca una orden.

## Chats (Mensajería › Chats)
- Entra todo lo de WhatsApp e Instagram. Si el teléfono coincide con un cliente, el chat se vincula a su ficha.
- **Ventana de 24 horas (WhatsApp):** texto libre solo si el cliente escribió en las últimas 24 horas. Pasadas, se retoma con una plantilla aprobada, y cuando contesta se vuelve a poder. En Instagram el sistema no pone este límite.
- **«No contactar»** en la ficha: no se le manda nada, ni a mano ni con plantilla. Es distinto de no aceptar promos.
- En un chat, una plantilla de Promoción solo le llega a quien aceptó promos; las de Aviso salen igual.
- **Etiquetas de chat:** ordenan la bandeja (Reservas, Quejas). No son las etiquetas de clientes, que están en la ficha y se usan en audiencias.
- **Mensajes rápidos:** respuestas guardadas con un atajo. En el chat se escribe / y el atajo.
- Escribirle a alguien que todavía no tiene chat: botón «Nuevo chat» de la bandeja.

## Plantillas (Mensajería › Plantillas)
- Los mensajes que WhatsApp revisa una vez. Estados: **Aprobada**, **En revisión** (de minutos a 24 horas), **Rechazada** (se escribe una versión nueva), **Borrador**, **Pausada**. Solo salen las aprobadas.
- Categorías: **Promoción**, **Aviso**, **Verificación** (los códigos del club; no sirven para difusiones).
- **Huecos:** para WhatsApp son posiciones, {{1}}, {{2}}. Cada una se llena con un dato: nombre, apellido, nombre y apellido, teléfono, cumpleaños (día y mes), puntos, o un texto fijo igual para todos. La plantilla puede recordar qué lleva cada hueco; si a un cliente le falta el dato, va el texto de respaldo.
- El sistema las actualiza solo cada 30 minutos, o con «Traer las novedades de WhatsApp». Las de muestra de Meta y las que no están en español no aparecen.

## Audiencias (Mensajería › Audiencias)
- Una lista de clientes por condiciones: veces que vino, días sin venir, gasto total, si fue a un evento (tuvo reserva y llegó), si acepta promos, puntos disponibles o acumulados, nivel, mes de cumpleaños, días desde que se sumó, etiqueta de cliente, cómo llegó y cómo se registró. Entran los que cumplen todas, o alguna. Sin condiciones, todos los clientes.
- Guardarla no manda nada. Se recalcula sola antes de cada envío.
- El número de la tarjeta y de Nueva difusión es el último conteo guardado: no se recalcula solo, puede estar muy viejo y cuenta también a los que no aceptan promos. A cuántos les llega de verdad lo dicen ver_audiencia y el tique.

## Difusiones (Mensajería › Difusiones)
- Una plantilla aprobada a toda una audiencia, por WhatsApp. **No hay borradores:** sale apenas se confirma o queda programada.
- **A quién le llega:** la audiencia recalculada justo antes de salir, menos los que no aceptan promos y los de «No contactar». Al mandar cada mensaje se vuelve a mirar: quien dejó de aceptar en el medio no lo recibe y cuenta como fallido.
- Estados: Programada, Enviando, Enviada, Enviada con fallas, Fallida, Cancelada.
- **Antes de que empiece a salir** se puede cancelar o adelantar. Después no hay vuelta atrás. Una cancelada se arma de nuevo.
- **Fallidos:** se pueden reintentar, solo esos.
- **Resultados:** la pantalla muestra a cada persona en un solo casillero, el último paso al que llegó (quien leyó ya no cuenta como enviado). Las herramientas dan los acumulados. Si alguien contesta dentro de los 7 días, cuenta como que respondió.
- **Costo:** el sistema no lo calcula. Lo cobra Meta a la cuenta del bar.

## Automatizaciones o flows (Mensajería › Automatizaciones)
- Mensajes que salen solos. **Disparadores:** hace tiempo que no viene; cumpleaños (el día, o días antes o después); después de una visita; se acerca un evento (los que tienen reserva a su nombre); le ponés una etiqueta.
- **Pasos:** mandar una plantilla, esperar, si se cumple algo (sigue por Sí o por No), poner una etiqueta de cliente.
- **Al mandar:** «No contactar» no recibe nada; una plantilla de Promoción se saltea a quien no aceptó promos y sigue con el próximo paso; las de Aviso salen igual.
- **Prendida:** los disparadores de tiempo se miran cada 15 minutos, así que al prenderla entra de una todo el que cumple. Cada uno entra una vez por ocasión: una vez por cumpleaños, una vez cada vez que deja de venir, una vez por evento. Las que entran por una visita o una etiqueta, cada vez que pasa.
- **Apagada:** no entra nadie nuevo, pero los que ya están adentro siguen hasta el final.
- Qué hizo con cada cliente está en sus Registros.

## Tareas de marketing (Marketing › Tareas)
- El tablero de los socios. Secciones: **Eventos**, **Promociones**, **Impresiones**; además **Mis tareas** y **Orgánico**.
- Estados: Por hacer, En proceso, Interrumpido, Terminado.
- **Fecha ideal** es cuándo estaría bueno; **fecha definida** es el compromiso y manda sobre la ideal. Se agrupan en fechas pasadas, hoy, esta semana (próximos 7 días), la próxima semana y más adelante.
- **Orgánico:** lo que se repite cada semana (historias, reels). Cada rutina tiene un cupo de veces por semana, y los tildes se reinician solos cada lunes.

## Lo que se hace en la pantalla
Tex lleva y señala dónde: conectar o desconectar WhatsApp e Instagram (Canales), crear o borrar plantillas, armar o cambiar los pasos de una automatización (su editor), escribirle a alguien sin chat, la prueba de una difusión a tu propio WhatsApp (Nueva difusión), crear o editar rutinas de Orgánico, y borrar una tarea, una etiqueta o un mensaje rápido. Las audiencias y las automatizaciones no se borran desde el panel.

## Las palabras
Difusión = campaña. Audiencia = lista. Plantilla = mensaje aprobado. Automatización = flow. Chat = conversación. Aceptar promos = opt-in.`
