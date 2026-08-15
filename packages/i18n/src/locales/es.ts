import type { Catalog } from './en.ts';

/**
 * Spanish.
 *
 * Written in neutral Latin-American/peninsular Spanish, addressing the reader
 * as *tú* — the register every consumer media app in the language uses, and the
 * one that keeps an empty state from reading like a bank letter.
 */
export const es: Catalog = {
  'nav.main': 'Principal',
  'nav.listen': 'Escuchar',
  'nav.home': 'Inicio',
  'nav.search': 'Buscar',
  'nav.library': 'Biblioteca',
  'nav.queue': 'Cola',
  'nav.settings': 'Ajustes',
  'nav.player': 'Reproductor',
  'nav.downloads': 'Descargas',
  'nav.playlists': 'Listas',

  'common.loading': 'Cargando…',
  'common.retry': 'Reintentar',
  'common.signIn': 'Iniciar sesión',
  'common.signOut': 'Cerrar sesión',
  'common.cancel': 'Cancelar',
  'common.remove': 'Quitar',
  'common.save': 'Guardar',
  'common.offline': 'El servidor no respondió. Puede que solo necesite un momento.',
  'common.unreachable': 'No se pudo conectar con el servidor',
  'common.checkConnection': 'Revisa la conexión e inténtalo de nuevo.',

  'home.title': 'Escuchar',
  'home.empty': 'Todavía no hay nada aquí',
  'home.emptyBody': 'Llena la base de datos local con: npm run seed -w @cue/api',
  'home.continue': 'Seguir escuchando',
  'home.latest': 'Últimos episodios',

  'library.title': 'Biblioteca',
  'library.signedOut': 'Aquí viven tus programas',
  'library.signedOutBody':
    'Inicia sesión para seguir programas y retomar donde lo dejaste en cualquier dispositivo.',
  'library.empty': 'Aún no sigues nada',
  'library.emptyBody':
    'Busca un programa y síguelo: los episodios nuevos se irán juntando aquí.',
  'library.searchShows': 'Buscar programas',
  'library.failed': 'No se pudo cargar tu biblioteca',
  'library.newEpisodes': '{count, plural, one {# episodio nuevo} other {# episodios nuevos}}',
  'library.groupUnplayed': 'Te están esperando',
  'library.groupActive': 'Siguen activos',
  'library.groupQuiet': 'Sin novedades',

  'search.title': 'Buscar',
  'search.placeholder': 'Programas, temas, personas',
  'search.placeholderShort': 'Buscar pódcast…',
  'search.prompt': 'Encuentra un programa',
  'search.promptBody': 'Busca en el directorio por nombre, tema o quien lo presenta.',
  'search.searching': 'Buscando…',
  'search.noResults': 'Ningún programa coincide',
  'search.noResultsBody': 'Prueba con otra grafía o con el nombre de quien lo presenta.',
  'search.filterLanguage': 'Filtrar por idioma',
  'search.anyLanguage': 'Cualquier idioma',
  'search.trending': 'En tendencia',
  'search.add': 'Añadir',
  'search.adding': 'Añadiendo…',
  'search.added': 'Añadido',

  'podcast.failed': 'No se pudo cargar este programa',
  'podcast.failedBody': 'Puede que lo hayan quitado o que se cortara la conexión.',
  'podcast.empty': 'Todavía no hay episodios',
  'podcast.emptyBody': 'La editorial no ha publicado nada en este feed.',
  'podcast.episodes': 'Episodios',
  'podcast.loadingEpisodes': 'Cargando episodios…',
  'podcast.follow': 'Seguir',
  'podcast.following': 'Siguiendo',
  'podcast.signInToFollow': 'Inicia sesión para seguir',
  'podcast.episodeCount': '{count, plural, one {# episodio} other {# episodios}}',

  'episode.failed': 'No se pudo cargar este episodio',
  'episode.failedBody': 'Puede que lo hayan quitado o que se cortara la conexión.',
  'episode.showNotes': 'Notas del episodio',
  'episode.noNotes': 'La editorial no incluyó notas para este episodio.',
  'episode.play': 'Reproducir',
  'episode.pause': 'Pausar',
  'episode.addToQueue': 'Añadir a la cola',
  'episode.inQueue': 'En la cola',
  'episode.back': 'Atrás',

  'player.nothingPlaying': 'No suena nada',
  'player.nothingPlayingBody': 'Elige un episodio y aparecerá aquí.',
  'player.open': 'Abrir el reproductor',
  'player.close': 'Cerrar el reproductor',
  'player.seek': 'Buscar posición',
  'player.position': 'Posición de reproducción',
  'player.skipBack': 'Retroceder {seconds} segundos',
  'player.skipForward': 'Avanzar {seconds} segundos',
  'player.speed': 'Velocidad',
  'player.sleepTimer': 'Temporizador',
  'player.sleepOff': 'Apagado',
  'player.sleepMinutes': '{count} min',
  'player.stoppingAt': 'Se detiene a las {time}',
  'player.nowPlaying': 'Sonando: {title}. Abrir el reproductor.',
  'player.loading': 'Cargando…',
  'player.volume': 'Volumen',
  'player.mute': 'Silenciar',
  'player.unmute': 'Activar el sonido',
  'player.openQueue': 'Abrir la cola',

  'queue.title': 'Cola',
  'queue.empty': 'No hay nada en la cola',
  'queue.emptyBody': 'Añade un episodio y sonará después de este.',
  'queue.waiting':
    '{count, plural, =0 {Cola, vacía} one {Cola, # en espera} other {Cola, # en espera}}',
  'queue.remove': 'Quitar de la cola',
  'queue.clear': 'Vaciar la cola',

  'downloads.title': 'Descargas',
  'downloads.save': 'Guardar sin conexión',
  'downloads.saved': 'Guardado en este dispositivo',
  'downloads.remove': 'Eliminar la descarga',
  'downloads.cancel': 'Detener la descarga',
  'downloads.retry': 'Volver a intentar la descarga',
  'downloads.waiting': 'En espera',
  'downloads.working': 'Descargando',
  'downloads.failed': 'No se guardó',
  'downloads.empty': 'Todavía no hay nada guardado',
  'downloads.emptyBody':
    'Guarda un episodio y se reproduce sin ninguna conexión: en un avión, en el metro o donde se caiga la señal.',
  'downloads.usage': '{size} en este dispositivo',
  'downloads.count': '{count, plural, one {# episodio} other {# episodios}}',
  'downloads.removeTitle': 'Eliminar la descarga de {title}',
  'downloads.saveTitle': 'Guardar {title} sin conexión',
  'downloads.pending': 'Esperando una conexión',

  'offline.banner': 'Sin conexión: tus descargas se siguen reproduciendo.',
  'offline.bannerWeb': 'Sin conexión: mostrando lo que ya se había cargado.',
  'offline.pageBody':
    'Esta página todavía no se ha abierto en este dispositivo, así que no hay copia que mostrar. Todo donde ya has estado sigue funcionando.',
  'offline.title': 'Estás sin conexión',
  'offline.body':
    'Los episodios guardados se reproducen con normalidad. Todo lo demás espera a que vuelva la conexión.',
  'offline.openDownloads': 'Abrir descargas',
  'offline.willSync': 'Dónde te quedaste en cada episodio se sincroniza al volver.',
  'offline.nothingSaved':
    'Aún no hay nada guardado en este dispositivo, así que no hay nada que reproducir.',

  'playlists.title': 'Listas',
  'playlists.empty': 'Todavía no hay listas',
  'playlists.emptyBody':
    'La cola responde qué suena después. Una lista responde para qué: viajes largos, las que merecen una segunda escucha, las cuatro que alguien te insistió.',
  'playlists.create': 'Nueva lista',
  'playlists.creating': 'Creando…',
  'playlists.name': 'Nombre',
  'playlists.namePlaceholder': 'Viajes largos',
  'playlists.describe': 'Descripción',
  'playlists.describePlaceholder': 'Opcional',
  'playlists.count': '{count, plural, =0 {Vacía} one {# episodio} other {# episodios}}',
  'playlists.addTo': 'Añadir a una lista',
  'playlists.inPlaylist': 'En {count, plural, one {# lista} other {# listas}}',
  'playlists.remove': 'Quitar de esta lista',
  'playlists.removeTitle': 'Quitar {title} de esta lista',
  'playlists.playAll': 'Reproducir todo',
  'playlists.rename': 'Renombrar',
  'playlists.save': 'Guardar',
  'playlists.delete': 'Eliminar esta lista',
  'playlists.deleteConfirm': '¿Eliminar «{title}»? Los episodios se quedan donde están.',
  'playlists.noEpisodes': 'Aquí todavía no hay nada',
  'playlists.noEpisodesBody':
    'Añade un episodio desde cualquier parte de la app y se recogerá aquí, en el orden en que lo pongas.',
  'playlists.failed': 'No se pudieron cargar tus listas',
  'playlists.notFound': 'Esa lista ya no está',
  'playlists.signedOut': 'Las listas necesitan una cuenta',
  'playlists.signedOutBody':
    'Viven con tu biblioteca, así que la lista que armas en un dispositivo está en el siguiente.',
  'playlists.moveUp': 'Subir {title}',
  'playlists.moveDown': 'Bajar {title}',
  'playlists.full': 'Esa lista está llena',

  'share.action': 'Compartir',
  'share.episode': 'Compartir este episodio',
  'share.fromHere': 'Compartir desde {time}',
  'share.copied': 'Enlace copiado',
  'share.failed': 'No se pudo copiar el enlace',
  'share.playFrom': 'Reproducir desde {time}',
  'share.sharedFrom': 'Compartido desde {time}',

  'captions.show': 'Mostrar subtítulos',
  'captions.hide': 'Ocultar subtítulos',
  'captions.none': 'Sin subtítulos para este episodio',
  'captions.noneBody':
    'La editorial no incluyó una transcripción. Cue puede escuchar el episodio y escribir una.',
  'captions.generate': 'Generar subtítulos',
  'captions.generating': 'Escribiendo subtítulos…',
  'captions.working':
    'Escuchando el episodio. En uno largo tarda unos minutos; puedes seguir reproduciéndolo mientras tanto.',
  'captions.cost':
    'Usa una de tus {remaining, plural, one {# solicitud restante} other {# solicitudes restantes}} de hoy.',
  'captions.costUnknown': 'Usa una de tus solicitudes diarias.',
  'captions.noAllowance':
    'Has agotado el límite de hoy. Añade tu propia clave de API en Ajustes para continuar.',
  'captions.signInToGenerate':
    'Inicia sesión para generar subtítulos: el límite diario es por cuenta.',
  'captions.failed': 'No se pudieron empezar los subtítulos.',
  'captions.untimed': 'Esta transcripción no tiene marcas de tiempo, así que no puede seguir el audio.',

  'transcript.title': 'Transcripción',
  'transcript.read': 'Leer la transcripción',
  'transcript.available': 'Este episodio incluye una transcripción de la editorial.',
  'transcript.loading': 'Cargando la transcripción…',
  'transcript.failed': 'No se pudo cargar la transcripción',
  'transcript.none': 'Sin transcripción',
  'transcript.noneBody': 'Esta editorial no ofrece una para este episodio.',
  'transcript.unreadable': 'No llegó nada legible desde la editorial.',
  'transcript.search': 'Buscar en esta transcripción…',
  'transcript.searchLabel': 'Buscar en esta transcripción',
  'transcript.noMatches': 'Sin coincidencias',
  'transcript.matchCount': '{count, plural, one {# línea} other {# líneas}}',
  'transcript.follow': 'Seguir',
  'transcript.followLabel': 'Seguir el audio',
  'transcript.playFrom': 'Reproducir desde {time}',
  'transcript.translated': 'Traducida al {language}',
  'transcript.translate': 'Traducir esta transcripción',
  'transcript.translating': 'Traduciendo…',
  'transcript.showOriginal': 'Ver el original',

  'ai.title': 'Sobre este episodio',
  'ai.open': 'Resumen, capítulos y preguntas',
  'ai.signedOut': 'Inicia sesión para usar esto',
  'ai.signedOutBody':
    'Los resúmenes, los capítulos y las preguntas dependen del límite diario de tu cuenta.',
  'ai.signedOutWeb':
    'Inicia sesión para resumir este episodio, sacar los capítulos o preguntar sobre él.',

  'ai.noTranscript': 'Todavía no hay transcripción',
  'ai.noTranscriptBody':
    'Esta editorial no incluyó ninguna. Generar una transcripción habilita el resumen, los capítulos y las preguntas.',
  'ai.transcribing':
    'Escuchando el episodio y poniéndolo por escrito. Tarda un par de minutos: puedes salir de esta pantalla.',
  'ai.transcribingShort': 'Transcribiendo…',
  'ai.generateTranscript': 'Generar una transcripción',

  'ai.summary': 'Resumen',
  'ai.summaryBody':
    'Unas frases sobre lo que trató este episodio, más los puntos que vale la pena recordar.',
  'ai.summarise': 'Resumir este episodio',

  'ai.chapters': 'Capítulos',
  'ai.chaptersBody': 'Divide el episodio en secciones para saltar entre ellas.',
  'ai.chaptersUntimed':
    'Los capítulos necesitan una transcripción con marcas de tiempo. Esta es la prosa de la editorial, que no las tiene.',
  'ai.findChapters': 'Buscar los capítulos',

  'ai.ask': 'Pregunta sobre este episodio',
  'ai.askBody':
    'Se responde solo a partir de la transcripción, citando las líneas usadas. Si el episodio no lo trata, lo dice.',
  'ai.askPlaceholder': '¿Qué dijeron sobre…?',
  'ai.askAction': 'Preguntar',
  'ai.asking': 'Preguntando…',
  'ai.fromTranscript': 'DE LA TRANSCRIPCIÓN',
  'ai.failed': 'Eso no funcionó',
  'ai.answerStopped': 'La respuesta se cortó de forma inesperada',

  'ai.quotaByok': 'Usando tu propia clave de Groq (…{hint}). Sin límite por nuestra parte.',
  'ai.quotaLeft':
    '{count, plural, one {Queda # petición de IA hoy} other {Quedan # peticiones de IA hoy}}',
  'ai.quotaSpent':
    'Has agotado las peticiones de IA de hoy. Añade tu propia clave de Groq en Ajustes para usarla sin límite.',
  'ai.quotaNoOperator':
    'Añade una clave de API de Groq en Ajustes para usar esto: el plan gratuito basta.',

  'settings.title': 'Ajustes',
  'settings.playback': 'Reproducción',
  'settings.playbackCaption':
    'Se guarda en este dispositivo: unos auriculares en el tren y un altavoz de cocina no piden la misma velocidad.',
  'settings.speed': 'Velocidad',
  'settings.speedHint': 'Se aplica a todo lo que reproduzcas.',
  'settings.skipBack': 'Retroceder',
  'settings.skipBackHint': 'Retrocedes para volver a oír algo concreto.',
  'settings.skipForward': 'Avanzar',
  'settings.skipForwardHint': 'Y avanzas para escapar de un anuncio.',

  'settings.language': 'Idioma',
  'settings.languageCaption':
    'Cambia el texto de la app. Tus programas siguen en el idioma en que se publicaron.',
  'settings.languageHint':
    'Se aplica en todas partes, en este dispositivo y en cualquier otro donde inicies sesión.',

  'settings.ai': 'IA',
  'settings.aiCaption':
    'Los resúmenes, los capítulos y las respuestas vienen de Groq. Hay un límite diario compartido; tu propia clave lo elimina y te lo factura a ti, y el plan gratuito cubre el uso normal.',
  'settings.apiKey': 'Clave de API de Groq',
  'settings.saveKey': 'Guardar la clave',
  'settings.checkingKey': 'Comprobando…',
  'settings.keySaved': 'Tu clave está guardada (…{hint})',
  'settings.keySavedHint': 'La IA no tiene límite y se factura a tu cuenta de Groq.',
  'settings.keyFailed': 'No se pudo guardar esa clave',
  'settings.removingKey': 'Quitando…',
  'settings.quotaWithout':
    'Sin ella tienes {limit} peticiones de IA al día (quedan {remaining}).',
  'settings.noOperatorKey':
    'Este servidor no tiene clave compartida, así que la IA necesita la tuya.',

  'settings.account': 'Cuenta',
  'settings.accountCaption':
    'Explorar, buscar y reproducir funcionan sin ella. La cuenta es lo que lleva tu biblioteca y tu punto en cada episodio de un dispositivo a otro.',
  'settings.signedIn': 'Sesión iniciada',
  'settings.signingOut': 'Cerrando sesión…',

  'auth.email': 'Correo electrónico',
  'auth.password': 'Contraseña',
  'auth.name': 'Nombre',
  'auth.signIn': 'Iniciar sesión',
  'auth.signUp': 'Crear una cuenta',
  'auth.signingIn': 'Iniciando sesión…',
  'auth.noAccount': 'Crear una cuenta',
  'auth.haveAccount': 'Iniciar sesión',

  'library.latest': 'Último {date}',
  'search.resultCount': '{count, plural, one {# resultado} other {# resultados}}',
  'queue.after': '{count, plural, one {# episodio después de este.} other {# episodios después de este.}}',
  'queue.reorder': 'Reordenar {title}',
  'queue.removeTitle': 'Quitar {title} de la cola',
  'home.timeLeft': 'Quedan {duration}',
  'home.resume': 'Reanudar {title}',

  'settings.restartForDirection': 'Reinicia la app para que la disposición siga al nuevo idioma.',

  'format.today': 'Hoy',
  'format.yesterday': 'Ayer',
  'format.minutes': '{count} min',
  'format.hours': '{count} h',
  'format.hoursMinutes': '{hours} h {minutes} min',
};
