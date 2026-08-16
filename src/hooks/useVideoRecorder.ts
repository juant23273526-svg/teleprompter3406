import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { VideoFilters, VideoQuality } from '../types'
import { VIDEO_QUALITY_PRESETS } from '../types'
import { buildFilterString } from '../utils/videoFilters'

export type VideoRecorderStatus = 'idle' | 'recording' | 'error'

/**
 * Resultado de un intento de compartir/guardar el video grabado.
 * 'shared': el usuario completó la hoja de compartir (p.ej. eligió "Guardar video" en Fotos).
 * 'cancelled': el usuario cerró la hoja sin elegir nada — no es un error.
 * 'unsupported': este navegador/contexto no ofrece compartir archivos nativo.
 * 'error': navigator.share existía pero la llamada falló por otra razón.
 */
export type ShareResult = 'shared' | 'cancelled' | 'unsupported' | 'error'

interface UseVideoRecorderResult {
  status: VideoRecorderStatus
  errorMessage: string | null
  /** Ref para el <video> de vista previa: úsalo para encuadrar la cámara mientras grabas. */
  videoPreviewRef: RefObject<HTMLVideoElement>
  /**
   * Ref para el <canvas> de captura: DEBE montarse en el JSX (CameraView.tsx),
   * nunca crearse con `document.createElement` en memoria — WebKit/iOS
   * suspende o descarta silenciosamente el MediaStream de `captureStream()`
   * de un canvas que no forma parte del árbol de render del documento, lo
   * cual corta la grabación de video (dejando solo audio) en tomas largas.
   */
  canvasRef: RefObject<HTMLCanvasElement>
  /** Blob de la última toma grabada, pendiente de revisión en el modal de vista previa. */
  previewBlob: Blob | null
  /** MIME type real con el que se grabó el blob (determina la extensión al guardar). */
  previewMimeType: string | null
  /** true si `navigator.share` existe en este navegador (vale la pena mostrar el botón de compartir). */
  canAttemptShare: boolean
  start: () => Promise<void>
  stop: () => void
  /** Intenta abrir la hoja de compartir/guardar nativa (navigator.share) con el video como archivo adjunto. */
  shareVideo: () => Promise<ShareResult>
  /** Descarta el blob en vista previa sin guardarlo, liberando la memoria. */
  discardPreview: () => void
}

/**
 * Orden de preferencia estricto de MIME types para MediaRecorder, priorizando
 * el H.264/AAC nativo de Safari/iOS (necesario para que el clip se reproduzca
 * y se pueda guardar directamente en Fotos / redes sociales). Si ninguno es
 * compatible (navegadores Chromium/Firefox sin soporte de MP4), MediaRecorder
 * se instancia sin `mimeType` y el propio navegador cae a su formato por
 * defecto (típicamente WebM), que ya queda cubierto por `extensionForMimeType`.
 */
const PREFERRED_MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
]

function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
}

/** iOS/Safari solo puede reproducir y guardar .mp4; el resto usa .webm como fallback. */
function extensionForMimeType(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : 'webm'
}

/**
 * Quita los parámetros de códec (";codecs=avc1...") del MIME type, dejando
 * solo el tipo base (p.ej. 'video/mp4'). El File que se entrega a
 * navigator.share/canShare DEBE llevar este tipo "limpio": la hoja de
 * compartir nativa de iOS reconoce 'video/mp4' para habilitar la opción
 * "Guardar video" en Fotos, pero no reconoce de forma fiable la variante
 * completa con codecs que reporta MediaRecorder (`recorder.mimeType`).
 */
function bareMimeType(mimeType: string): string {
  return mimeType.split(';')[0].trim()
}

/** Empaqueta el blob grabado como File, con nombre/tipo consistentes con el MIME real detectado. */
function buildVideoFile(blob: Blob, mimeType: string): File {
  const extension = extensionForMimeType(mimeType)
  return new File([blob], `teleprompter-video.${extension}`, { type: bareMimeType(mimeType) })
}

/** true si `navigator.share` existe: vale la pena intentar compartir, sin garantizar que tenga éxito. */
const SHARE_API_AVAILABLE = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

/** Cuadros por segundo fijos para el lienzo de captura: estable y suficiente para lectura en cámara. */
const CANVAS_CAPTURE_FPS = 30
/** Intervalo mínimo entre dibujados reales (~33.3ms): en pantallas ProMotion de iPhone (120Hz)
 *  requestAnimationFrame dispara hasta 4x más seguido de lo necesario; sin este throttle explícito
 *  con performance.now(), cada frame se procesa 4x de lo necesario y satura la GPU/CPU hasta
 *  provocar el thermal throttling que congela la grabación en sesiones largas. Este límite aplica
 *  por igual al pipeline WebGL y al de respaldo Canvas2D (ver drawFrame). */
const CANVAS_DRAW_INTERVAL_MS = 1000 / CANVAS_CAPTURE_FPS
/** Resolución de respaldo si el <video> aún no reporta sus dimensiones reales al momento de crear el canvas. */
const FALLBACK_CANVAS_WIDTH = 1280
const FALLBACK_CANVAS_HEIGHT = 720

/**
 * Espera a que el <video> reporte metadata real (HAVE_METADATA, readyState
 * >= 1) antes de leer videoWidth/videoHeight: leerlas antes de este punto
 * devuelve 0 y forzaría el fallback, grabando en una resolución que no
 * coincide con la real de la cámara. El timeout es una salvaguarda para no
 * bloquear la grabación indefinidamente si el evento nunca llega (stream ya
 * "caliente" en algún caso raro de iOS).
 */
function waitForVideoMetadata(video: HTMLVideoElement, timeoutMs = 1500): Promise<void> {
  if (video.readyState >= 1) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      video.removeEventListener('loadedmetadata', finish)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    video.addEventListener('loadedmetadata', finish, { once: true })
  })
}

// ---------------------------------------------------------------------------
// Motor de filtros por WebGL: aplica brillo/contraste/saturación/suavizado
// de piel como una transformación REAL de píxeles en un shader, dibujada
// directamente en el backing store del <canvas> que alimenta
// canvas.captureStream(). Esto reemplaza depender de la propiedad
// `CanvasRenderingContext2D.filter` (ctx.filter): su soporte/fiabilidad
// combinado con captureStream() es inconsistente entre versiones de
// WebKit/iOS — algunas compilan y aceptan el valor pero el frame que
// finalmente entrega captureStream() no refleja el filtro aplicado. Un
// shader WebGL no depende de esa propiedad en absoluto: el color ya sale
// transformado del propio pase de render, así que lo que se ve en pantalla
// (si se mostrara) y lo que captureStream() extrae son exactamente lo
// mismo. Es además el camino más barato en CPU/GPU posible (un solo
// triángulo, un texSubImage2D por frame sobre una textura reservada una
// única vez — ver allocateGlVideoTexture —, un fragment shader de pocas
// líneas), por lo que no reintroduce el riesgo de congelamiento por
// saturación de recursos en tomas largas.
// ---------------------------------------------------------------------------

const VERTEX_SHADER_SOURCE = `
  attribute vec2 aPosition;
  varying vec2 vTexCoord;
  void main() {
    vTexCoord = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`

const FRAGMENT_SHADER_SOURCE = `
  precision mediump float;
  varying vec2 vTexCoord;
  uniform sampler2D uTexture;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uSaturate;
  uniform float uBlur;
  uniform vec2 uTexelSize;

  void main() {
    vec3 sharpColor = texture2D(uTexture, vTexCoord).rgb;
    vec3 color = sharpColor;

    if (uBlur > 0.0) {
      // Suavizado de piel: promedio barato de 5 muestras (cruz), suficiente
      // para un desenfoque sutil de 0-2px sin el costo de un blur gaussiano
      // multi-pase.
      vec2 o = uTexelSize * uBlur;
      vec3 sum = sharpColor
        + texture2D(uTexture, vTexCoord + vec2(o.x, 0.0)).rgb
        + texture2D(uTexture, vTexCoord - vec2(o.x, 0.0)).rgb
        + texture2D(uTexture, vTexCoord + vec2(0.0, o.y)).rgb
        + texture2D(uTexture, vTexCoord - vec2(0.0, o.y)).rgb;
      color = sum / 5.0;
    }

    color *= uBrightness;
    color = (color - 0.5) * uContrast + 0.5;

    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, uSaturate);

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`

interface GlFilterPipeline {
  gl: WebGLRenderingContext
  program: WebGLProgram
  positionBuffer: WebGLBuffer
  texture: WebGLTexture
  aPosition: number
  uniforms: {
    texture: WebGLUniformLocation
    brightness: WebGLUniformLocation
    contrast: WebGLUniformLocation
    saturate: WebGLUniformLocation
    blur: WebGLUniformLocation
    texelSize: WebGLUniformLocation
  }
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

/**
 * Crea y enlaza el programa de shaders + buffer de geometría (un solo
 * triangle strip a pantalla completa) + textura de video, todo UNA VEZ. Se
 * cachea junto al contexto (ver glPipelineRef) y se reutiliza en cada frame
 * y en cada grabación subsecuente: recompilar shaders por frame sería
 * absurdamente costoso.
 */
function createGlFilterPipeline(gl: WebGLRenderingContext): GlFilterPipeline | null {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE)
  if (!vertexShader || !fragmentShader) return null

  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null

  const positionBuffer = gl.createBuffer()
  const texture = gl.createTexture()
  if (!positionBuffer || !texture) return null

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

  gl.bindTexture(gl.TEXTURE_2D, texture)
  // NPOT-safe: sin mipmaps ni wrap repetido, así el video puede tener
  // cualquier resolución (no necesariamente potencia de 2) sin restricciones.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  // El origen de textura de WebGL es abajo-izquierda; el de video/imagen es
  // arriba-izquierda. Sin este flip, el video graba al revés verticalmente.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)

  const aPosition = gl.getAttribLocation(program, 'aPosition')
  const uTexture = gl.getUniformLocation(program, 'uTexture')
  const uBrightness = gl.getUniformLocation(program, 'uBrightness')
  const uContrast = gl.getUniformLocation(program, 'uContrast')
  const uSaturate = gl.getUniformLocation(program, 'uSaturate')
  const uBlur = gl.getUniformLocation(program, 'uBlur')
  const uTexelSize = gl.getUniformLocation(program, 'uTexelSize')
  if (!uTexture || !uBrightness || !uContrast || !uSaturate || !uBlur || !uTexelSize) return null

  return {
    gl,
    program,
    positionBuffer,
    texture,
    aPosition,
    uniforms: {
      texture: uTexture,
      brightness: uBrightness,
      contrast: uContrast,
      saturate: uSaturate,
      blur: uBlur,
      texelSize: uTexelSize,
    },
  }
}

/**
 * Reserva (o re-reserva) el backing store de la textura de video a un
 * tamaño fijo. Se llama UNA VEZ por tamaño de canvas (al iniciar una
 * grabación, o si la resolución cambia entre tomas por el selector de
 * calidad), nunca por frame: es la única llamada que usa `texImage2D`
 * (que reserva memoria nueva en la GPU). El bucle de dibujo por frame usa
 * `texSubImage2D` en su lugar (ver drawGlFrame), que solo actualiza los
 * píxeles ya reservados sin reasignar memoria — en una grabación de
 * 15+ minutos a 30fps eso es la diferencia entre ~27,000 reasignaciones de
 * memoria de GPU (con texImage2D por frame) y una sola.
 */
function allocateGlVideoTexture(gl: WebGLRenderingContext, texture: WebGLTexture, width: number, height: number): void {
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
}

/**
 * Sube el fotograma actual del <video> a la textura ya reservada (vía
 * `texSubImage2D`, sin reasignar memoria de GPU) y dibuja el quad filtrado
 * sobre todo el canvas. Los ajustes de imagen (brillo/contraste/saturación/
 * suavizado) llegan aquí solo como `gl.uniform1f`/`uniform2f`: no tocan el
 * programa compilado ni la textura, así que mover un slider durante una
 * grabación en curso nunca dispara una recompilación ni una reasignación.
 */
function drawGlFrame(pipeline: GlFilterPipeline, video: HTMLVideoElement, canvasWidth: number, canvasHeight: number, filters: VideoFilters): void {
  const { gl } = pipeline
  gl.viewport(0, 0, canvasWidth, canvasHeight)
  gl.useProgram(pipeline.program)

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, pipeline.texture)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video)

  gl.bindBuffer(gl.ARRAY_BUFFER, pipeline.positionBuffer)
  gl.enableVertexAttribArray(pipeline.aPosition)
  gl.vertexAttribPointer(pipeline.aPosition, 2, gl.FLOAT, false, 0, 0)

  gl.uniform1i(pipeline.uniforms.texture, 0)
  gl.uniform1f(pipeline.uniforms.brightness, filters.brightness / 100)
  gl.uniform1f(pipeline.uniforms.contrast, filters.contrast / 100)
  gl.uniform1f(pipeline.uniforms.saturate, filters.saturate / 100)
  gl.uniform1f(pipeline.uniforms.blur, filters.skinSmooth)
  gl.uniform2f(pipeline.uniforms.texelSize, 1 / canvasWidth, 1 / canvasHeight)

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

/**
 * Grabación de video independiente del teleprónpter: captura cámara + mic
 * con getUserMedia, pero el video que efectivamente graba MediaRecorder no
 * sale directo de ese MediaStream, sino de un <canvas> montado en el DOM
 * (ver CameraView.tsx, fuera de la vista pero como nodo real del árbol de
 * render) sobre el que se redibuja cada fotograma del <video> de vista
 * previa vía requestAnimationFrame, y de ahí se extrae con
 * `canvas.captureStream()`. Ese desacople entre "lo que la cámara entrega" y
 * "lo que el encoder consume" es justamente lo que se busca: en algunas
 * versiones de Safari/iOS, MediaRecorder sobre el track de cámara crudo se
 * ha visto detenerse en grabaciones largas; pasar por canvas es un workaround
 * conocido para ese caso. Crítico: el canvas tiene que ser un nodo real del
 * DOM, no uno creado con `document.createElement` y mantenido solo en
 * memoria — WebKit en iOS suspende/descarta el MediaStream de ese tipo de
 * canvas "huérfano" en sesiones largas (la causa raíz del congelamiento a
 * los ~15s). El texto del teleprónpter nunca se dibuja en este canvas (vive
 * en un módulo de DOM aparte, ver App.tsx), así que la toma grabada sigue
 * siendo cámara + mic limpios (con los filtros de imagen horneados encima,
 * ver el pipeline WebGL arriba). Al detener, el blob queda en `previewBlob`
 * para que la UI muestre un modal de revisión antes de guardar nada en disco.
 */
export function useVideoRecorder(filters: VideoFilters, quality: VideoQuality): UseVideoRecorderResult {
  const [status, setStatus] = useState<VideoRecorderStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const [previewMimeType, setPreviewMimeType] = useState<string | null>(null)

  // Ref para leer los filtros más recientes dentro del bucle de dibujo sin
  // tener que recrear ese rAF (que vive fuera del ciclo de render de React)
  // cada vez que el usuario mueve un slider.
  const filtersRef = useRef(filters)
  filtersRef.current = filters

  const videoPreviewRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // Motor de renderizado por canvas: el nodo <canvas> lo monta CameraView.tsx
  // en el JSX (nunca se crea aquí con document.createElement), este ref solo
  // lo referencia como superficie de dibujo intermedia para MediaRecorder.
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Pipeline WebGL (camino primario): se crea una única vez en todo el
  // ciclo de vida del hook y se reutiliza en cada frame y en cada grabación
  // subsecuente. Un <canvas> solo puede entregar un tipo de contexto para
  // siempre (2d XOR webgl), así que esta elección se fija en el primer
  // start() y se cachea aquí.
  const glPipelineRef = useRef<GlFilterPipeline | null>(null)
  // Referencia cruda al contexto WebGL, independiente de glPipelineRef: si
  // se pierde el contexto (ver handleContextLost más abajo), glPipelineRef
  // se anula porque sus recursos (shaders/buffers/textura) ya no sirven,
  // pero el objeto WebGLRenderingContext en sí sigue siendo válido y es lo
  // que necesita handleContextRestored para reconstruir todo sobre él.
  const glContextRef = useRef<WebGLRenderingContext | null>(null)
  // Tamaño al que está reservado el backing store de la textura de video
  // (ver allocateGlVideoTexture): permite detectar cuándo hace falta
  // re-reservarlo (cambió la resolución de la cámara entre tomas) en vez de
  // reasignar memoria de GPU en cada frame.
  const textureSizeRef = useRef<{ width: number; height: number } | null>(null)
  // Los listeners de pérdida/recuperación de contexto se enganchan UNA SOLA
  // vez sobre el <canvas> (que vive todo el ciclo de vida de la app):
  // engancharlos de nuevo en cada start() los iría acumulando duplicados.
  const glContextListenersAttachedRef = useRef(false)
  // Contexto 2D (camino de respaldo): solo se usa si WebGL no está
  // disponible en este navegador/dispositivo. Mismo criterio de "una sola
  // vez" que el pipeline WebGL.
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const canvasStreamRef = useRef<MediaStream | null>(null)
  const animationFrameIdRef = useRef<number | null>(null)
  const isStreamingRef = useRef(false)
  const lastDrawTimeRef = useRef(0)
  // Resuelve la promesa de "primer frame dibujado" (ver waitForFirstFrame):
  // se consume y limpia en cuanto drawFrame pinta el primer fotograma real.
  const firstFrameResolverRef = useRef<(() => void) | null>(null)

  const stopDrawLoop = useCallback(() => {
    isStreamingRef.current = false
    if (animationFrameIdRef.current !== null) {
      cancelAnimationFrame(animationFrameIdRef.current)
      animationFrameIdRef.current = null
    }
  }, [])

  // Ciclo continuo de dibujo: se relanza a sí mismo con requestAnimationFrame
  // (para heredar el pausado automático del navegador en pestañas ocultas),
  // pero el propio dibujado se throttlea manualmente a CANVAS_CAPTURE_FPS
  // con performance.now(). Sin este control, en pantallas ProMotion (120Hz)
  // rAF dispara 4x más seguido de lo que el encoder necesita, generando
  // trabajo de GPU/CPU redundante que dispara el thermal throttling de iOS
  // en sesiones largas. Aplica por igual al camino WebGL y al de respaldo
  // Canvas2D.
  const startDrawLoop = useCallback(() => {
    lastDrawTimeRef.current = 0
    const drawFrame = (now: number) => {
      animationFrameIdRef.current = requestAnimationFrame(drawFrame)
      if (!isStreamingRef.current) return

      const elapsed = now - lastDrawTimeRef.current
      if (elapsed < CANVAS_DRAW_INTERVAL_MS) return
      // Resta el remanente (en vez de asignar `now` directo) para que el
      // intervalo promedie exactamente CANVAS_DRAW_INTERVAL_MS incluso si
      // este frame llegó tarde, sin ir acumulando drift a lo largo de la toma.
      lastDrawTimeRef.current = now - (elapsed % CANVAS_DRAW_INTERVAL_MS)

      const video = videoPreviewRef.current
      const canvas = canvasRef.current
      // readyState >= 2 (HAVE_CURRENT_DATA): el <video> ya tiene un fotograma
      // decodificado disponible para copiar; por debajo de eso se pintaría
      // un cuadro vacío/obsoleto.
      if (!video || !canvas || video.readyState < 2) return

      const pipeline = glPipelineRef.current
      if (pipeline) {
        drawGlFrame(pipeline, video, canvas.width, canvas.height, filtersRef.current)
      } else {
        const ctx = canvasCtxRef.current
        if (!ctx) return
        // Camino de respaldo (sin WebGL disponible): ctx.filter aplica
        // brillo/contraste/saturación/suavizado de piel sobre cada
        // fotograma; se resetea a 'none' justo después.
        ctx.filter = buildFilterString(filtersRef.current)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        ctx.filter = 'none'
      }

      if (firstFrameResolverRef.current) {
        firstFrameResolverRef.current()
        firstFrameResolverRef.current = null
      }
    }
    animationFrameIdRef.current = requestAnimationFrame(drawFrame)
  }, [])

  /**
   * Se resuelve en cuanto el loop de dibujo pinta un primer fotograma real
   * sobre el canvas (o tras `timeoutMs` como salvaguarda). `start()` espera
   * esta promesa antes de llamar a `canvas.captureStream()`/`recorder.start()`:
   * si el MediaRecorder arranca sobre un canvas todavía en blanco, algunas
   * versiones de Safari/iOS reciben una pista de video "vacía" y abortan la
   * grabación a los 1-2 segundos en vez de solo entregar un primer cuadro negro.
   */
  const waitForFirstFrame = useCallback((timeoutMs = 1000): Promise<void> => {
    return new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      firstFrameResolverRef.current = finish
      setTimeout(finish, timeoutMs)
    })
  }, [])

  const releaseStream = useCallback(() => {
    // Cancela el rAF del canvas y suelta sus tracks antes que los de la
    // cámara: si se hiciera al revés, el drawImage/drawGlFrame del
    // siguiente frame encontraría un <video> ya sin stream.
    stopDrawLoop()
    canvasStreamRef.current?.getTracks().forEach((track) => track.stop())
    canvasStreamRef.current = null

    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null
    }
  }, [stopDrawLoop])

  /**
   * WebGL puede perder su contexto en sesiones largas si el sistema
   * reclama memoria de GPU bajo presión (más probable en iPhones con poca
   * RAM tras 15+ minutos grabando) — el síntoma es exactamente una imagen
   * que se congela u oscurece de golpe. `preventDefault()` es obligatorio
   * para indicarle al navegador que SÍ queremos intentar recuperarlo;
   * `glPipelineRef` se anula porque todos sus recursos de GPU (shaders,
   * buffers, textura) quedaron inválidos, pero drawFrame ya comprueba
   * `glPipelineRef.current` antes de dibujar, así que simplemente deja de
   * dibujar (en vez de lanzar) hasta que llegue 'webglcontextrestored'.
   */
  const handleContextLost = useCallback((event: Event) => {
    event.preventDefault()
    glPipelineRef.current = null
    textureSizeRef.current = null
  }, [])

  /** Reconstruye shaders/buffers/textura sobre el mismo WebGLRenderingContext una vez que el navegador lo restaura. */
  const handleContextRestored = useCallback(() => {
    const gl = glContextRef.current
    const canvas = canvasRef.current
    if (!gl || !canvas) return

    const pipeline = createGlFilterPipeline(gl)
    if (!pipeline) return

    allocateGlVideoTexture(gl, pipeline.texture, canvas.width, canvas.height)
    textureSizeRef.current = { width: canvas.width, height: canvas.height }
    glPipelineRef.current = pipeline
  }, [])

  const start = useCallback(async () => {
    setErrorMessage(null)

    try {
      // width/height "ideal" (no "exact"): le sugieren a la cámara la
      // resolución del preset de calidad elegido sin forzarla — si el
      // sensor no puede entregarla exactamente, el navegador negocia lo
      // más cercano posible en vez de fallar o recortar agresivamente
      // (a diferencia de forzar un aspect ratio distinto al nativo, que sí
      // provocaba zoom/recorte; 16:9 en 1920x1080/1280x720 coincide con la
      // proporción nativa de la mayoría de sensores, así que el riesgo es mucho menor).
      const qualityPreset = VIDEO_QUALITY_PRESETS[quality]
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: qualityPreset.width }, height: { ideal: qualityPreset.height } },
        audio: true,
      })
      streamRef.current = stream

      const video = videoPreviewRef.current
      if (!video) throw new Error('No se encontró el elemento de video de vista previa.')

      const canvas = canvasRef.current
      // Si esto dispara, CameraView.tsx no montó el <canvas> antes de que se
      // pudiera grabar: a diferencia del <video>, este nodo NO debe crearse
      // dinámicamente con document.createElement como fallback, porque un
      // canvas fuera del árbol del DOM es exactamente lo que hace que WebKit
      // en iOS descarte su MediaStream en tomas largas.
      if (!canvas) throw new Error('No se encontró el canvas de captura de video.')

      // 'webkit-playsinline' es el atributo legacy que Safari iOS (<14)
      // necesita además del estándar `playsinline`/`playsInline`: sin él,
      // iOS puede forzar la reproducción a pantalla completa o bloquear la
      // captura de video, entregando solo el track de audio.
      video.setAttribute('webkit-playsinline', 'true')
      video.srcObject = stream

      // Espera metadata real antes de tocar el canvas: hacerlo antes de
      // play() evita una carrera donde el primer frame ya se dibujó (con las
      // dimensiones de fallback) antes de fijar el tamaño definitivo.
      await waitForVideoMetadata(video)
      await video.play().catch(() => undefined)

      // Dimensiones fijadas aquí UNA SOLA VEZ (no en cada frame del loop de
      // dibujo) e iguales 1:1 a la resolución real reportada por el <video>
      // tras 'loadedmetadata' (sin recortar ni forzar ningún aspect ratio):
      // redimensionar un canvas reinicializa su backing store en cada
      // asignación, así que hacerlo por frame forzaría al GC/GPU de iOS a
      // reservar memoria de video nueva 30 veces/segundo.
      canvas.width = video.videoWidth || FALLBACK_CANVAS_WIDTH
      canvas.height = video.videoHeight || FALLBACK_CANVAS_HEIGHT

      // Elección de motor de dibujo: se decide UNA SOLA VEZ en todo el
      // ciclo de vida del hook (un <canvas> solo puede entregar un tipo de
      // contexto para siempre). Se intenta WebGL primero (filtros horneados
      // como transformación real de píxeles, sin depender de ctx.filter);
      // si el navegador no lo soporta, cae al Canvas2D + ctx.filter como
      // respaldo para que la grabación nunca deje de funcionar.
      if (!glContextRef.current && !canvasCtxRef.current) {
        try {
          const gl = canvas.getContext('webgl', {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            // Sin esto, algunos navegadores pueden entregarle a
            // captureStream() fotogramas en blanco de un canvas WebGL: el
            // backing buffer se limpiaba antes de que captureStream lo leyera.
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance',
          })
          if (gl) {
            glContextRef.current = gl
            const pipeline = createGlFilterPipeline(gl)
            if (pipeline) glPipelineRef.current = pipeline
          }
        } catch {
          // Se ignora: cae al respaldo de Canvas2D de abajo.
        }

        if (!glContextRef.current) {
          // `alpha: false` le dice a WebKit que el canvas siempre es opaco,
          // así se salta la composición de transparencias.
          // `willReadFrequently: false` evita que el navegador fuerce un
          // backend por software (aquí nunca se lee el canvas con getImageData).
          canvasCtxRef.current = canvas.getContext('2d', { alpha: false, willReadFrequently: false })
        }
      }

      // Reserva (o re-reserva si la resolución cambió entre tomas, p.ej. al
      // alternar el selector de calidad) el backing store de la textura de
      // video UNA VEZ por tamaño de canvas — nunca por frame, ver
      // allocateGlVideoTexture. Los listeners de pérdida/recuperación de
      // contexto se enganchan una única vez sobre el propio <canvas>.
      if (glContextRef.current && glPipelineRef.current) {
        const size = textureSizeRef.current
        if (!size || size.width !== canvas.width || size.height !== canvas.height) {
          allocateGlVideoTexture(glContextRef.current, glPipelineRef.current.texture, canvas.width, canvas.height)
          textureSizeRef.current = { width: canvas.width, height: canvas.height }
        }

        if (!glContextListenersAttachedRef.current) {
          canvas.addEventListener('webglcontextlost', handleContextLost, false)
          canvas.addEventListener('webglcontextrestored', handleContextRestored, false)
          glContextListenersAttachedRef.current = true
        }
      }

      isStreamingRef.current = true
      // Arranca el loop de dibujo y espera a que pinte al menos un fotograma
      // real ANTES de pedir captureStream()/arrancar el MediaRecorder: así
      // el encoder nunca ve una pista de video en blanco en su primer chunk,
      // que es lo que provoca el aborto a 1-2s visto en algunos intentos.
      const firstFramePromise = waitForFirstFrame()
      startDrawLoop()
      await firstFramePromise

      // MediaRecorder graba directamente el stream del <canvas> filtrado
      // (canvas.captureStream(30), nunca el MediaStream crudo de la cámara)
      // para que el filtro quede horneado en cada fotograma del archivo
      // final. La pista de audio del micrófono se adjunta con addTrack()
      // mutando este mismo stream, en vez de construir un MediaStream nuevo
      // con `new MediaStream([...])`: ese constructor por arreglo es una
      // API más reciente con soporte históricamente menos consistente en
      // WebKit/iOS que mutar un stream ya existente vía addTrack().
      const canvasStream = canvas.captureStream(CANVAS_CAPTURE_FPS)
      canvasStreamRef.current = canvasStream

      const audioTrack = stream.getAudioTracks()[0]
      if (audioTrack) {
        canvasStream.addTrack(audioTrack)
      }

      const mimeType = pickSupportedMimeType()
      // videoBitsPerSecond del preset de calidad elegido: MediaRecorder lo
      // toma como objetivo (no garantía exacta del encoder), pero es lo que
      // efectivamente separa "Alta Calidad" de "Redes Sociales" en tamaño
      // de archivo final, además de la resolución ya pedida arriba.
      const recorderOptions: MediaRecorderOptions = { videoBitsPerSecond: qualityPreset.bitrate }
      if (mimeType) recorderOptions.mimeType = mimeType
      const recorder = new MediaRecorder(canvasStream, recorderOptions)
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = () => {
        const finalMimeType = recorder.mimeType || mimeType || 'video/webm'
        const blob = new Blob(chunksRef.current, { type: finalMimeType })
        chunksRef.current = []
        if (blob.size > 0) {
          setPreviewBlob(blob)
          setPreviewMimeType(finalMimeType)
        }
        // Desengancha los handlers y suelta la referencia al recorder ya
        // detenido: sus closures retenían `chunksRef`/`mimeType`/`stream`,
        // y en iOS dejar ese objeto colgado hasta el próximo start() es
        // justamente el tipo de referencia viva que retrasa al Garbage
        // Collector en un dispositivo con memoria ya bajo presión.
        recorder.ondataavailable = null
        recorder.onstop = null
        recorderRef.current = null
        releaseStream()
        setStatus('idle')
      }

      recorderRef.current = recorder
      // El timeslice de 1000ms hace que ondataavailable dispare cada
      // segundo (en vez de solo al final): así una toma larga no pierde
      // todo el material grabado si algo falla a mitad de camino.
      recorder.start(1000)
      setStatus('recording')
    } catch (error) {
      console.error('No se pudo iniciar la grabación de video:', error)
      setErrorMessage('No se pudo acceder a la cámara o el micrófono. Revisa los permisos del navegador.')
      setStatus('error')
      releaseStream()
    }
  }, [releaseStream, startDrawLoop, waitForFirstFrame, quality, handleContextLost, handleContextRestored])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      // El propio evento 'onstop' del recorder deja el blob listo en
      // previewBlob y libera la cámara (y el canvas); guardar/compartir o
      // descartar la toma ahora se decide desde el modal de vista previa
      // (VideoPreviewModal).
      recorder.stop()
    } else {
      releaseStream()
      setStatus('idle')
    }
  }, [releaseStream])

  /**
   * Intenta compartir/guardar el video con la Web Share API. En vez de
   * pre-validar con navigator.canShare() y ocultar el botón por completo si
   * devuelve false (ese chequeo puede ser demasiado estricto/inconsistente
   * en algunas versiones de iOS y dejaba al usuario sin ninguna pista de
   * qué pasó), se intenta directamente y se reporta un resultado tipado
   * para que la UI pueda mostrar una indicación clara cuando no funcione.
   */
  const shareVideo = useCallback(async (): Promise<ShareResult> => {
    if (!previewBlob || !previewMimeType) return 'error'
    if (!SHARE_API_AVAILABLE) return 'unsupported'

    const file = buildVideoFile(previewBlob, previewMimeType)

    try {
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        return 'unsupported'
      }
      await navigator.share({
        files: [file],
        title: 'Mi Grabación',
        text: 'Video grabado con Teleprónpter',
      })
      setPreviewBlob(null)
      setPreviewMimeType(null)
      return 'shared'
    } catch (error) {
      // AbortError = el usuario cerró la hoja de compartir sin elegir nada:
      // no es un error real, dejamos el preview intacto para que pueda reintentar.
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
      console.error('No se pudo compartir el video:', error)
      return 'error'
    }
  }, [previewBlob, previewMimeType])

  const discardPreview = useCallback(() => {
    setPreviewBlob(null)
    setPreviewMimeType(null)
  }, [])

  // Al desmontar, cortar cualquier grabación en curso, apagar la cámara y
  // desenganchar los listeners de contexto WebGL (si se llegaron a adjuntar).
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop()
      }
      releaseStream()

      if (glContextListenersAttachedRef.current) {
        canvasRef.current?.removeEventListener('webglcontextlost', handleContextLost)
        canvasRef.current?.removeEventListener('webglcontextrestored', handleContextRestored)
      }
    }
  }, [releaseStream, handleContextLost, handleContextRestored])

  return {
    status,
    errorMessage,
    videoPreviewRef,
    canvasRef,
    previewBlob,
    previewMimeType,
    canAttemptShare: SHARE_API_AVAILABLE,
    start,
    stop,
    shareVideo,
    discardPreview,
  }
}
