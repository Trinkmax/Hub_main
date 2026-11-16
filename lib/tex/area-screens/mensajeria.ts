import type { TexScreenDef } from '../screen-types'

/**
 * Mensajería y Marketing. Todas fuera de Administración (`root`).
 *
 * El tablero de Tareas filtra con `?persona=` y cambia de vista con `?vista=`, que no son parámetros de
 * Tex: «Mis tareas» y la rutina son pantallas con su `query` fija. `?tarea=` sí lo es: abre el panel de
 * una tarea. `/mensajeria` solo redirige a la bandeja: no hace falta una pantalla más.
 */
export const mensajeriaScreens: readonly TexScreenDef[] = [
  {
    id: 'mensajeria.inbox',
    label: 'Mensajería › Chats',
    what: 'La bandeja de WhatsApp e Instagram: leer y contestarle a cada cliente. Con chat (el id de la conversación) abre esa charla.',
    path: '/mensajeria/inbox',
    root: true,
    params: ['chat'],
  },
  {
    id: 'mensajeria.difusiones',
    label: 'Mensajería › Difusiones',
    what: 'Las campañas masivas: lo programado, lo que salió y cómo le fue a cada una.',
    path: '/mensajeria/difusiones',
    root: true,
  },
  {
    id: 'mensajeria.difusion',
    label: 'Una difusión',
    what: 'Los resultados de una difusión, sus destinatarios y por qué falló lo que falló.',
    path: '/mensajeria/difusiones/:id',
    root: true,
    params: ['id'],
  },
  {
    id: 'mensajeria.difusion_nueva',
    label: 'Nueva difusión',
    what: 'El formulario paso a paso, con la prueba a tu propio WhatsApp.',
    path: '/mensajeria/difusiones/nueva',
    root: true,
  },
  {
    id: 'mensajeria.audiencias',
    label: 'Mensajería › Audiencias',
    what: 'Las listas de clientes para las difusiones, con cuántos son.',
    path: '/mensajeria/audiencias',
    root: true,
  },
  {
    id: 'mensajeria.audiencia',
    label: 'Una audiencia',
    what: 'Las condiciones de una audiencia, para editarla.',
    path: '/mensajeria/audiencias/:id',
    root: true,
    params: ['id'],
  },
  {
    id: 'mensajeria.audiencia_nueva',
    label: 'Nueva audiencia',
    what: 'Armar una lista con grupos listos o condiciones a medida.',
    path: '/mensajeria/audiencias/nueva',
    root: true,
  },
  {
    id: 'mensajeria.plantillas',
    label: 'Mensajería › Plantillas',
    what: 'Los mensajes de WhatsApp y su aprobación: escribir, sincronizar y borrar.',
    path: '/mensajeria/plantillas',
    root: true,
  },
  {
    id: 'mensajeria.flows',
    label: 'Mensajería › Automatizaciones',
    what: 'Los mensajes que salen solos (flows) y si están prendidos.',
    path: '/mensajeria/flows',
    root: true,
  },
  {
    id: 'mensajeria.flow',
    label: 'Editor de una automatización',
    what: 'Los pasos de una automatización: cambiarlos se hace acá.',
    path: '/mensajeria/flows/:id',
    root: true,
    params: ['id'],
  },
  {
    id: 'mensajeria.flow_registros',
    label: 'Registros de una automatización',
    what: 'Qué hizo una automatización, paso a paso, con cada cliente.',
    path: '/mensajeria/flows/:id/registros',
    root: true,
    params: ['id', 'desde', 'hasta'],
  },
  {
    id: 'mensajeria.flow_nuevo',
    label: 'Nueva automatización',
    what: 'El editor para armar una automatización desde cero.',
    path: '/mensajeria/flows/nuevo',
    root: true,
  },
  {
    id: 'mensajeria.mensajes_rapidos',
    label: 'Mensajería › Mensajes rápidos',
    what: 'Las respuestas guardadas con su atajo para el chat.',
    path: '/mensajeria/mensajes-rapidos',
    root: true,
  },
  {
    id: 'mensajeria.etiquetas',
    label: 'Mensajería › Etiquetas',
    what: 'Las etiquetas para ordenar los chats.',
    path: '/mensajeria/etiquetas',
    root: true,
  },
  {
    id: 'mensajeria.canales',
    label: 'Mensajería › Canales',
    what: 'Conectar, reconectar o desconectar WhatsApp e Instagram.',
    path: '/mensajeria/canales',
    root: true,
  },
  {
    id: 'marketing.tareas',
    label: 'Marketing › Tareas',
    what: 'El tablero de tareas de marketing: los grupos, quién hace qué, para cuándo y lo terminado. Con tarea (su id) abre el panel de esa tarea, con sus actualizaciones y archivos.',
    path: '/tareas',
    root: true,
    params: ['tarea'],
  },
  {
    id: 'marketing.tareas_mias',
    label: 'Marketing › Tareas › Mis tareas',
    what: 'El tablero con solo las tareas de quien mira: las que lleva y en las que está metido.',
    path: '/tareas',
    query: 'persona=yo',
    root: true,
  },
  {
    id: 'marketing.tareas_organico',
    label: 'Marketing › Tareas › Rutina de la semana',
    what: 'Lo que se repite todas las semanas (historias, reels), con sus tildes. Antes se llamaba Orgánico.',
    path: '/tareas',
    query: 'vista=rutina',
    root: true,
    params: ['semana'],
  },
]
