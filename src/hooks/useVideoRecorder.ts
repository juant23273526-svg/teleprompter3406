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

/**
 * Grabación de video independiente del teleprónpter: captura cámara + mic
 * directamente con getUserMedia/MediaRecorder (nunca el texto en pantalla,
 * porque no se compone con ningún canvas ni captura de la ventana). Al
 * detener, el blob queda en `previewBlob` para que la UI muestre un modal de
 * revisión antes de guardar nada en disco.
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

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null
    }
  }, [])

  const start = useCallback(async () => {
    setErrorMessage(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      streamRef.current = stream

      if (videoPreviewRef.current) {
        // 'webkit-playsinline' es el atributo legacy que Safari iOS (<14)
        // necesita además del estándar `playsinline`/`playsInline`: sin él,
        // iOS puede forzar la reproducción a pantalla completa o bloquear la
        // captura de video, entregando solo el track de audio.
        videoPreviewRef.current.setAttribute('webkit-playsinline', 'true')
        videoPreviewRef.current.srcObject = stream
        await videoPreviewRef.current.play().catch(() => undefined)
      }

      const mimeType = pickSupportedMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
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
      recorder.start()
      setStatus('recording')
    } catch (error) {
      console.error('No se pudo iniciar la grabación de video:', error)
      setErrorMessage('No se pudo acceder a la cámara o el micrófono. Revisa los permisos del navegador.')
      setStatus('error')
      releaseStream()
    }
  }, [releaseStream])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      // El propio evento 'onstop' del recorder deja el blob listo en
      // previewBlob y libera la cámara; la descarga ahora es manual desde
      // el modal de vista previa (VideoPreviewModal).
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
