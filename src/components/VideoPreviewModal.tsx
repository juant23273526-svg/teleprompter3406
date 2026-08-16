import { Share2, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ShareResult } from '../hooks/useVideoRecorder'

interface VideoPreviewModalProps {
  blob: Blob
  mimeType: string
  /** true si `navigator.share` existe en este navegador (vale la pena ofrecer el botón). */
  canShare: boolean
  onShare: () => Promise<ShareResult>
  onDiscard: () => void
}

/**
 * Modal de revisión que se abre al detener la grabación: el video ya no se
 * descarga solo, así el usuario puede repetir la toma sin llenar la carpeta
 * de descargas con clips fallidos. Solo ofrece dos acciones: guardar/
 * compartir vía la hoja nativa (Guardar en Fotos, WhatsApp, Instagram, etc.)
 * o descartar la toma — sin una descarga de archivo directa como alternativa.
 */
export function VideoPreviewModal({ blob, mimeType, canShare, onShare, onDiscard }: VideoPreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isSharing, setIsSharing] = useState(false)
  // Guía en pantalla cuando compartir no funciona: en vez de ocultar el
  // botón sin explicación cuando el navegador está en un contexto no
  // compatible, se intenta primero y solo entonces se explica qué pasó.
  const [shareNotice, setShareNotice] = useState<string | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(blob)
    if (videoRef.current) {
      videoRef.current.src = url
    }
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [blob])

  const handleShareClick = async () => {
    setIsSharing(true)
    setShareNotice(null)
    const result = await onShare()
    setIsSharing(false)
    if (result === 'unsupported') {
      setShareNotice('Este navegador no admite guardar video directo en Fotos. Ábrelo en Safari en un iPhone/iPad para poder compartirlo.')
    } else if (result === 'error') {
      setShareNotice('No se pudo abrir el panel para compartir. Intenta de nuevo.')
    }
    // 'shared' cierra el modal solo (el padre limpia previewBlob); 'cancelled' no necesita aviso.
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      {/* pb-[...+2rem] + mb-6: además del padding normal de la tarjeta, deja
          un margen de seguridad extra por debajo de los botones para que
          nunca choquen con los controles de gestos de iOS, y separa la
          tarjeta del borde inferior de la pantalla (donde vive la barra de
          acciones de la pantalla principal, ya oculta detrás del backdrop
          borroso de este overlay a pantalla completa). */}
      <div className="mb-6 flex w-full max-w-lg flex-col gap-4 rounded-xl border border-slate-700 bg-slate-900 p-5 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] shadow-2xl">
        <div>
          <h2 className="text-base font-semibold text-white">Vista previa de la grabación</h2>
          <p className="text-xs text-slate-400">Revisa la toma antes de guardarla · formato {mimeType.split(';')[0]}</p>
        </div>

        <video ref={videoRef} controls playsInline className="w-full rounded-lg bg-black" />

        {/* Dos únicas acciones, una sola fila, distribución equitativa. */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleShareClick}
            disabled={isSharing}
            className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-blue-500 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:from-blue-600 hover:to-blue-700 disabled:cursor-wait disabled:opacity-70"
          >
            <Share2 className="h-4 w-4 shrink-0" />
            {isSharing ? 'Abriendo…' : 'Guardar y Compartir'}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-red-500 to-red-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-red-500/25 transition hover:from-red-600 hover:to-red-700"
          >
            <Trash2 className="h-4 w-4 shrink-0" />
            Descartar Grabación
          </button>
        </div>

        {shareNotice && <p className="text-xs text-amber-400">{shareNotice}</p>}
        {!canShare && !shareNotice && (
          <p className="text-xs text-slate-500">Este navegador no admite guardar video directo en Fotos desde aquí.</p>
        )}
      </div>
    </div>
  )
}
