/**
 * Lo que Tex lee con `leer_manual`: cómo funciona de verdad esta parte del panel. Sale del código de cada
 * pantalla y vale para cualquier bar. Solo lo que el sistema hace.
 */
export const negocioManual = `## La Carta
- Categorías, con subcategorías adentro (Bebidas › Vinos), y productos. Un producto tiene nombre, precio en pesos enteros, descripción, foto, video, etiquetas, puntos extra, destacado y disponible.
- No hay stock. «Sin stock» es pausarlo: se oculta al cliente, no se borra y vuelve cuando quieras.
- Lo que ve el cliente («Ver carta», se actualiza al instante): productos disponibles de categorías activas. Una categoría sin productos a la vista no aparece. Pausar una categoría oculta sus productos, pero sus subcategorías activas siguen a la vista y pasan al primer nivel: para ocultarlas hay que pausarlas también. Los destacados salen arriba, en Recomendados; los puntos extra, como «+N pts», y se suman a los normales.
- Las etiquetas (Vegano, Sin TACC) se ven en el producto y sirven para las tarjetas de sellos.
- Con un tique: productos (alta, cambios, sacarlos y volverlos a poner), precios, categorías y etiquetas.
- Subir precios (de una categoría con sus subcategorías, de varios productos o de toda la carta): en % o en pesos, con redondeo si lo pide. Se aplica de a un producto: la pantalla no tiene aumento en bloque. Si un precio cambió mientras tanto no se toca, y los de $ 0 quedan igual. Si se corta a la mitad, el resultado dice cuáles faltan: se completa con preparar_precios y productos, solo esos, para no aumentar dos veces. No tiene «Deshacer».
- Solo en la pantalla: fotos y videos, ordenar arrastrando, borrar productos, categorías o etiquetas, mover o desetiquetar varios a la vez y un precio en $ 0.

## Resumen (la portada)
Hoy en el salón: reservas en pie, personas y pico estimado (asume 1h30 por reserva). Clientes, activos, visitas y facturación, contra el período anterior. El top de clientes es por consumo de toda su historia, aunque la tarjeta diga «del mes». Y lo que falta de los primeros pasos.

## Estadísticas
- Visitas y facturación salen de lo que se carga a un cliente al cerrar una mesa o acreditar. No es la venta del bar: esa está en Administración › Ventas. Se actualizan cada 10 minutos.
- Activos 30d: el día con más clientes distintos de los últimos 30, no el total del mes. Ticket promedio: facturación ÷ visitas.
- En riesgo de irse: 3 visitas o más, venía al menos cada 30 días y ya pasó más del doble de su frecuencia.
- Eventos: los últimos 20 del calendario, con su % de no-show.
- Comunicación: cada destinatario de una difusión cuenta una vez, en su último estado.
- Mozos: las mesas pagadas del período, repartidas en partes iguales entre quienes hicieron algo en cada una.

## Cómo nos fue
Cuatro vistas: Por día, Por evento, Pauta y Cumpleaños.
- Personas, reservas y promedio cuentan solo las reservas en pie; canceladas y no-show van aparte. Personas es lo reservado. Contadas es lo anotado al cerrar cada mesa. Nunca se da un % de asistencia.
- La noche se parte por evento y «Sin evento». Un grupo privado suma en la noche, pero no es un evento: no está en Por evento ni en Pauta.
- La pauta se carga a mano por fecha de evento, desde Ads Manager: gasto en dólares, mensajes, alcance. Sin cargar o «No tuvo pauta» no son cero.
- De cierre: reservas en pie ÷ mensajes. Es un techo: cuenta también las que llegaron por otro lado.
- Retorno: facturación de la caja pasada a dólares ÷ gasto. Es facturación, no ganancia.
- La cuenta de la noche: ingreso (la facturación real si se cargó; si no, personas × ingreso por persona y bebida), menos costo (personas × costo por persona y bebida), menos pauta en pesos (gasto × dólar del día). Personas: las contadas y, en las mesas sin cerrar, las reservadas. No es la ganancia del bar: no descuenta sueldos, alquiler ni impuestos.
- Hoy y lo que viene dicen «Por ahora» y no entran en los promedios.
- Cumpleaños: reservas de cumpleaños en pie, por día de festejo. Su pauta se mide contra los reservados en el mes, para la fecha que sea.
- La pauta y la cuenta se cargan en la pantalla.

## Reseñas (si el bar las tiene prendidas)
Las deja el cliente desde su panel del club: de 1 a 5 estrellas y un comentario. Con «Derivar solo las de 5 estrellas», esas van a Google y el resto queda como feedback privado. Sin esa opción, todas van a Google; sin enlace de Google, ninguna. Los puntos por opinar se dan una vez por cliente. El sistema no responde ni marca reseñas. El enlace, el WhatsApp de feedback y los puntos se cambian en su pantalla.

## Marketing y Configuración
- Páginas (landings en HTML con link propio) y Link de Instagram (un link para la bio, con botones): se miran acá y se editan en la pantalla.
- No hay una ficha con dirección o teléfono del local: los datos fiscales están en Administración › Ajustes.
- Capacidad: con tique, la capacidad total y las plantas; las dos plantas suman el cupo de los servicios sin cupo propio. El cupo por servicio y por fecha, en la pantalla.
- Bienvenida (está en Club › Bienvenida): con tique, título, texto, puntos de regalo y activar o apagar. La recompensa se elige en la pantalla.
- Solo en la pantalla: Equipo y roles, logo y color, plano de mesas, auto-aceptación.

## Dónde está cada cosa (menú lateral)
- Resumen: la portada.
- Operativo: el tablero de la noche.
- Mensajería: bandeja, difusiones, flows, audiencias y plantillas.
- Reservas: lista, alta y ficha.
- Calendario: eventos y formatos.
- Ventas online: las compras de la cartelera de entradas, día por día, y «Confirmar transferencia».
- Clientes: personas, Acreditar y el QR del club.
- Carta.
- Club: puntos y niveles, aliados, bienvenida y tarjetas de sellos.
- Marketing: Tareas, Link de Instagram, Páginas y Entradas (la cartelera, Mercado Pago y las películas).
- Estadísticas: Resumen, Cómo nos fue, Señas, Comisiones y Reseñas.
- Mis números: lo que va ganando quien gestiona reservas.
- Administración: compras, gastos, sueldos, ventas, caja y contabilidad.
- Compras (pedidos a proveedores), Salón en vivo, Cocina, Plano y QRs de mesa, Auto-aceptación: si el bar los tiene prendidos.
- Configuración (abajo): Equipo, Comisiones, Capacidad, Tortas de cumpleaños, Reseñas, Apariencia y Documentación.
El rol Contenido solo ve la Carta; Anfitrión, Operativo, Reservas, Calendario, Ventas online (confirma transferencias, no devuelve ni anula) y Mis números; Contabilidad, Administración. Lo demás es del dueño.`
