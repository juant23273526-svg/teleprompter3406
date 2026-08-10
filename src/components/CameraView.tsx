import { Video } from 'lucide-react'
import { memo } from 'react'
import type { RefObject } from 'react'

interface CameraViewProps {
  videoPreviewRef: RefObject<HTMLVideoElement>
  isRecording: boolean
}

/**
 * Memoizado: en modo voz, App.tsx actualiza currentIndex/lastTranscript con
 * cada frase reconocida, lo cual no debe repintar este módulo (el <video> no
 * depende de ninguno de esos valores). Sin memo, cada uno de esos renders de
 * App recorría también este árbol de cámara por nada, compitiendo por el
 * hilo principal con el drawImage por frame de useVideoRecorder.ts mientras
 * graba en paralelo. `videoPreviewRef` es un ref (identidad estable) e
 * `isRecording` solo cambia al iniciar/detener grabación, así que memo
 * bloquea el resto de los renders de App.
 */
export const CameraView = memo(function CameraView({ videoPreviewRef, isRecording }: CameraViewProps) {
  return (
    <div className="app-grid-camera relative overflow-hidden rounded-2xl bg-black">
      <video
        ref={videoPreviewRef}
        muted
        playsInline
        autoPlay
        className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover will-change-transform"
        style={{
          // Capa de composición propia, aislada de la del contenedor con
          // scroll del teleprónpter (que ahora ni siquiera es su vecino de
          // DOM): promoverlo a su propia capa GPU evita que el compositor
          // tenga que repintarlo junto con el resto de la interfaz.
          transform: 'translateZ(0)',
          WebkitTransform: 'translateZ(0)',
        }}
      />

      {!isRecording && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-700">
          <Video className="h-10 w-10" />
        </div>
      )}
    </div>
  )
})
