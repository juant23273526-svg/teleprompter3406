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

        {/* pb-[env(safe-area-inset-bottom)] + grid de 1 columna en móvil (3 en
            sm+): en iPhone con home indicator, los botones nunca quedan
            pegados/tapados por la barra de gestos inferior, y en pantallas
            angostas se apilan en vez de comprimirse hasta ser ilegibles. */}
        <div className="grid grid-cols-1 gap-2 pb-[env(safe-area-inset-bottom,20px)] sm:grid-cols-3">
          {canShare && (
            <button
              type="button"
              onClick={onShare}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              <Share2 className="h-4 w-4 shrink-0" />
              Compartir
            </button>
          )}
          <button
            type="button"
            onClick={onDownload}
            className={[
              'flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition',
              canShare
                ? 'border border-slate-700 text-slate-300 hover:bg-slate-800'
                : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400',
            ].join(' ')}
          >
            <Download className="h-4 w-4 shrink-0" />
            Descargar
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
          >
            <Trash2 className="h-4 w-4 shrink-0" />
            Descartar
          </button>
        </div>
      </div>
    </div>
  )
}
