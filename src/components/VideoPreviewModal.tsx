import { Download, Share2, Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface VideoPreviewModalProps {
  blob: Blob
  mimeType: string
  /** true si el navegador soporta compartir el archivo por navigator.share (iOS/Android). */
  canShare: boolean
  onShare: () => void
  onDownload: () => void
  onDiscard: () => void
}

/**
 * Modal de revisión que se abre al detener la grabación: el video ya no se
 * descarga solo, así el usuario puede repetir la toma sin llenar la carpeta
 * de descargas con clips fallidos. En iOS/Android, el botón principal abre
 * la hoja de compartir nativa (Guardar en Fotos, WhatsApp, Instagram, etc.)
 * en vez de forzar una descarga que en iOS termina en iCloud Drive.
 */
export function VideoPreviewModal({ blob, mimeType, canShare, onShare, onDownload, onDiscard }: VideoPreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const url = URL.createObjectURL(blob)
    if (videoRef.current) {
      videoRef.current.src = url
    }
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [blob])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div>
          <h2 className="text-base font-semibold text-white">Vista previa de la grabación</h2>
          <p className="text-xs text-slate-400">Revisa la toma antes de guardarla · formato {mimeType.split(';')[0]}</p>
        </div>

        <video ref={videoRef} controls playsInline className="w-full rounded-lg bg-black" />

        <div className="flex flex-col gap-2 sm:flex-row">
          {canShare && (
            <button
              type="button"
              onClick={onShare}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              <Share2 className="h-4 w-4" />
              Guardar / Compartir Video
            </button>
          )}
          <button
            type="button"
            onClick={onDownload}
            className={[
              'flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition',
              canShare
                ? 'border border-slate-700 text-slate-300 hover:bg-slate-800'
                : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400',
            ].join(' ')}
          >
            <Download className="h-4 w-4" />
            Descargar Archivo Directo
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
          >
            <Trash2 className="h-4 w-4" />
            Descartar y Volver a Grabar
          </button>
        </div>
      </div>
    </div>
  )
}
