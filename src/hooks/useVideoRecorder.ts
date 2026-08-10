import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'

export type VideoRecorderStatus = 'idle' | 'recording' | 'error'

interface UseVideoRecorderResult {
  status: VideoRecorderStatus
  errorMessage: string | null
  /** Ref para el <video> de vista previa: úsalo para encuadrar la cámara mientras grabas. */
  videoPreviewRef: RefObject<HTMLVideoElement>
  /** Blob de la última toma grabada, pendiente de revisión en el modal de vista previa. */
  previewBlob: Blob | null
  /** MIME type real con el que se grabó el blob (determina la extensión al guardar). */
  previewMimeType: string | null
  /** true si el navegador puede abrir la hoja de compartir nativa con el archivo de video (iOS/Android). */
  canShareFiles: boolean
  start: () => Promise<void>
  stop: () => void
  /** Abre la hoja de compartir/guardar nativa (navigator.share) con el video como archivo adjunto. */
  shareVideo: () => Promise<boolean>
  /** Descarga el blob en vista previa (fallback tradicional de escritorio) y limpia el estado. */
  confirmDownload: () => void
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

/** Empaqueta el blob grabado como File, con nombre/tipo consistentes con el MIME real detectado. */
function buildVideoFile(blob: Blob, mimeType: string): File {
  const extension = extensionForMimeType(mimeType)
  return new File([blob], `teleprompter-video.${extension}`, { type: mimeType })
}

function downloadBlob(blob: Blob, mimeType: string): void {
  const extension = extensionForMimeType(mimeType)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `teleprompter-grabacion-${timestamp}.${extension}`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  URL.revokeObjectURL(url)
}

/** Cuadros por segundo fijos para el lienzo de captura: estable y suficiente para lectura en cámara. */
const CANVAS_CAPTURE_FPS = 30
/** Intervalo mínimo entre dibujados reales (~33.3ms): en pantallas ProMotion de iPhone (120Hz)
 *  requestAnimationFrame dispara hasta 4x más seguido de lo necesario; sin este throttle explícito
 *  con performance.now(), drawImage se ejecuta en cada uno de esos frames y satura la GPU/CPU hasta
 *  provocar el thermal throttling que congela la grabación en sesiones largas. */
const CANVAS_DRAW_INTERVAL_MS = 1000 / CANVAS_CAPTURE_FPS
/** Resolución de respaldo si el <video> aún no reporta sus dimensiones reales al momento de crear el canvas. */
const FALLBACK_CANVAS_WIDTH = 1280
const FALLBACK_CANVAS_HEIGHT = 720

/**
 * Grabación de video independiente del teleprónpter: captura cámara + mic
 * con getUserMedia, pero el video que efectivamente graba MediaRecorder no
 * sale directo de ese MediaStream, sino de un <canvas> oculto (nunca se monta
 * en el DOM) sobre el que se redibuja cada fotograma del <video> de vista
 * previa vía requestAnimationFrame + drawImage, y de ahí se extrae con
 * `canvas.captureStream()`. Ese desacople entre "lo que la cámara entrega" y
 * "lo que el encoder consume" es justamente lo que se busca: en algunas
 * versiones de Safari/iOS, MediaRecorder sobre el track de cámara crudo se
 * ha visto detenerse en grabaciones largas; pasar por canvas es un workaround
 * conocido para ese caso a cambio de un dibujado por frame en el hilo
 * principal. El texto del teleprónpter nunca se dibuja en este canvas
 * (vive en un módulo de DOM aparte, ver App.tsx), así que la toma grabada
 * sigue siendo cámara + mic limpios. Al detener, el blob queda en
 * `previewBlob` para que la UI muestre un modal de revisión antes de
 * guardar nada en disco.
 */
export function useVideoRecorder(): UseVideoRecorderResult {
  const [status, setStatus] = useState<VideoRecorderStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const [previewMimeType, setPreviewMimeType] = useState<string | null>(null)

  const videoPreviewRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // Motor de renderizado por canvas: nunca se agrega al DOM, solo existe
  // como superficie de dibujo intermedia para alimentar al MediaRecorder.
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Contexto 2D obtenido una sola vez en start() y reutilizado en cada frame:
  // llamar a getContext() dentro del loop de dibujo (aunque devuelva el mismo
  // objeto) es trabajo redundante en el hilo principal en cada frame.
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const canvasStreamRef = useRef<MediaStream | null>(null)
  const animationFrameIdRef = useRef<number | null>(null)
  const isStreamingRef = useRef(false)
  const lastDrawTimeRef = useRef(0)

  const stopDrawLoop = useCallback(() => {
    isStreamingRef.current = false
    if (animationFrameIdRef.current !== null) {
      cancelAnimationFrame(animationFrameIdRef.current)
      animationFrameIdRef.current = null
    }
  }, [])

  // Ciclo continuo de dibujo: se relanza a sí mismo con requestAnimationFrame
  // (para heredar el pausado automático del navegador en pestañas ocultas),
  // pero el propio drawImage se throttlea manualmente a CANVAS_CAPTURE_FPS
  // con performance.now(). Sin este control, en pantallas ProMotion (120Hz)
  // rAF dispara 4x más seguido de lo que el encoder necesita, generando
  // trabajo de GPU/CPU redundante que dispara el thermal throttling de iOS
  // en sesiones largas.
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
      const ctx = canvasCtxRef.current
      // readyState >= 2 (HAVE_CURRENT_DATA): el <video> ya tiene un fotograma
      // decodificado disponible para copiar; por debajo de eso drawImage
      // pintaría un cuadro vacío/obsoleto.
      if (video && canvas && ctx && video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      }
    }
    animationFrameIdRef.current = requestAnimationFrame(drawFrame)
  }, [])

  const releaseStream = useCallback(() => {
    // Cancela el rAF del canvas y suelta sus tracks antes que los de la
    // cámara: si se hiciera al revés, el drawImage del siguiente frame
    // encontraría un <video> ya sin stream.
    stopDrawLoop()
    canvasStreamRef.current?.getTracks().forEach((track) => track.stop())
    canvasStreamRef.current = null

    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null
    }
  }, [stopDrawLoop])

  const start = useCallback(async () => {
    setErrorMessage(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      streamRef.current = stream

      const video = videoPreviewRef.current
      if (!video) throw new Error('No se encontró el elemento de video de vista previa.')

      // 'webkit-playsinline' es el atributo legacy que Safari iOS (<14)
      // necesita además del estándar `playsinline`/`playsInline`: sin él,
      // iOS puede forzar la reproducción a pantalla completa o bloquear la
      // captura de video, entregando solo el track de audio.
      video.setAttribute('webkit-playsinline', 'true')
      video.srcObject = stream
      await video.play().catch(() => undefined)

      // El canvas nunca se monta en el DOM (no necesita estar ahí para
      // captureStream/drawImage); se reutiliza entre grabaciones si ya existe.
      // Las dimensiones se fijan aquí UNA SOLA VEZ (no en cada frame del
      // loop de dibujo): redimensionar un canvas reinicializa su backing
      // store en cada asignación, así que hacerlo por frame forzaría al
      // GC/GPU de iOS a reservar memoria de video nueva 30 veces por segundo.
      const canvas = canvasRef.current ?? document.createElement('canvas')
      canvasRef.current = canvas
      canvas.width = video.videoWidth || FALLBACK_CANVAS_WIDTH
      canvas.height = video.videoHeight || FALLBACK_CANVAS_HEIGHT

      // `alpha: false` le dice a WebKit que el canvas siempre es opaco, así
      // se salta la composición de transparencias y pinta por hardware en la
      // GPU de iOS. `willReadFrequently: false` evita que el navegador
      // fuerce un backend por software (solo leeríamos con getImageData si
      // hiciéramos post-procesado por pixel, que no es el caso aquí). El
      // contexto se obtiene una sola vez y se reutiliza en cada frame del
      // loop de dibujo, en vez de volver a pedirlo con cada drawImage.
      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false })
      canvasCtxRef.current = ctx

      isStreamingRef.current = true
      startDrawLoop()

      const canvasStream = canvas.captureStream(CANVAS_CAPTURE_FPS)
      canvasStreamRef.current = canvasStream

      const audioTrack = stream.getAudioTracks()[0]
      const combinedStream = new MediaStream([
        canvasStream.getVideoTracks()[0],
        ...(audioTrack ? [audioTrack] : []),
      ])

      const mimeType = pickSupportedMimeType()
      const recorder = mimeType ? new MediaRecorder(combinedStream, { mimeType }) : new MediaRecorder(combinedStream)
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
  }, [releaseStream, startDrawLoop])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      // El propio evento 'onstop' del recorder deja el blob listo en
      // previewBlob y libera la cámara (y el canvas); la descarga ahora es
      // manual desde el modal de vista previa (VideoPreviewModal).
      recorder.stop()
    } else {
      releaseStream()
      setStatus('idle')
    }
  }, [releaseStream])

  // Se recalcula solo cuando cambia el blob/mimeType en vista previa: navigator.canShare
  // exige un File real (con el tamaño/tipo final) para decidir si la hoja nativa
  // soporta adjuntar video, algo que en la práctica solo Safari/Chrome en
  // iOS y Android exponen; en escritorio normalmente da false.
  const canShareFiles = useMemo(() => {
    if (!previewBlob || !previewMimeType) return false
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false
    try {
      return navigator.canShare({ files: [buildVideoFile(previewBlob, previewMimeType)] })
    } catch {
      return false
    }
  }, [previewBlob, previewMimeType])

  const shareVideo = useCallback(async () => {
    if (!previewBlob || !previewMimeType) return false

    const file = buildVideoFile(previewBlob, previewMimeType)
    if (!navigator.canShare?.({ files: [file] })) return false

    try {
      await navigator.share({
        files: [file],
        title: 'Mi Grabación',
        text: 'Video grabado con Teleprónpter',
      })
      setPreviewBlob(null)
      setPreviewMimeType(null)
      return true
    } catch (error) {
      // AbortError = el usuario cerró la hoja de compartir sin elegir nada:
      // no es un error real, dejamos el preview intacto para que pueda reintentar.
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('No se pudo compartir el video:', error)
      }
      return false
    }
  }, [previewBlob, previewMimeType])

  const confirmDownload = useCallback(() => {
    if (previewBlob && previewMimeType) {
      downloadBlob(previewBlob, previewMimeType)
    }
    setPreviewBlob(null)
    setPreviewMimeType(null)
  }, [previewBlob, previewMimeType])

  const discardPreview = useCallback(() => {
    setPreviewBlob(null)
    setPreviewMimeType(null)
  }, [])

  // Al desmontar, cortar cualquier grabación en curso y apagar la cámara.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop()
      }
      releaseStream()
    }
  }, [releaseStream])

  return {
    status,
    errorMessage,
    videoPreviewRef,
    previewBlob,
    previewMimeType,
    canShareFiles,
    start,
    stop,
    shareVideo,
    confirmDownload,
    discardPreview,
  }
}
