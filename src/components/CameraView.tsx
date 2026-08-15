import { SlidersHorizontal, Video, X } from 'lucide-react'
import { memo, useState } from 'react'
import type { RefObject } from 'react'
import type { VideoFilters } from '../types'
import { buildFilterString, FILTER_SLIDER_CONFIGS } from '../utils/videoFilters'

interface CameraViewProps {
  videoPreviewRef: RefObject<HTMLVideoElement>
  canvasRef: RefObject<HTMLCanvasElement>
  isRecording: boolean
  filters: VideoFilters
  onFiltersChange: (filters: VideoFilters) => void
}

/**
 * Memoizado: App.tsx re-renderiza seguido mientras el motor de auto-scroll
 * corre, lo cual no debe repintar este módulo (ni el <video> ni el <canvas>
 * dependen de esos valores). Sin memo, cada uno de esos renders de App
 * recorría también este árbol de cámara por nada, compitiendo por el hilo
 * principal con el drawImage por frame de useVideoRecorder.ts mientras graba
 * en paralelo. `videoPreviewRef` y `canvasRef` son refs (identidad estable)
 * e `isRecording`/`filters` solo cambian al iniciar/detener grabación o
 * mover un slider de filtro, así que memo bloquea el resto de los renders de App.
 */
export const CameraView = memo(function CameraView({ videoPreviewRef, canvasRef, isRecording, filters, onFiltersChange }: CameraViewProps) {
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false)

  return (
    <div className="app-grid-camera relative overflow-hidden rounded-2xl bg-black">
      <video
        ref={videoPreviewRef}
        muted
        playsInline
        autoPlay
        // object-contain (no object-cover): la vista previa nunca recorta el
        // frame de la cámara para "llenar" su contenedor. Igual que el
        // canvas de grabación (ver useVideoRecorder.ts), muestra el campo de
        // visión 1x real de la lente completo, con barras negras si el
        // aspect ratio del contenedor no coincide exactamente.
        className="pointer-events-none absolute inset-0 z-0 h-full w-full object-contain will-change-transform"
        style={{
          // Capa de composición propia, aislada de la del contenedor con
          // scroll del teleprónpter (que ahora ni siquiera es su vecino de
          // DOM): promoverlo a su propia capa GPU evita que el compositor
          // tenga que repintarlo junto con el resto de la interfaz.
          transform: 'translateZ(0)',
          WebkitTransform: 'translateZ(0)',
          // Mismo filtro que useVideoRecorder.ts aplica al canvas de
          // grabación: la vista previa en vivo debe verse igual a lo grabado.
          filter: buildFilterString(filters),
        }}
      />

      {!isRecording && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-700">
          <Video className="h-10 w-10" />
        </div>
      )}

      {/* Acceso rápido a los filtros de imagen directamente sobre la vista
          previa de cámara: esquina superior izquierda, lejos del botón de
          ajustes (fixed, top-right, ver App.tsx) para no competir con él. */}
      <button
        type="button"
        onClick={() => setIsFilterPanelOpen((open) => !open)}
        aria-label={isFilterPanelOpen ? 'Cerrar ajustes de imagen' : 'Ajustes de imagen'}
        className="absolute left-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white shadow-lg backdrop-blur transition hover:bg-black/70"
      >
        {isFilterPanelOpen ? <X className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
      </button>

      {isFilterPanelOpen && (
        <div className="absolute left-3 top-14 z-20 flex w-56 flex-col gap-3 rounded-xl border border-white/10 bg-black/70 p-3 backdrop-blur">
          {FILTER_SLIDER_CONFIGS.map((filter) => (
            <div key={filter.key} className="flex flex-col gap-1">
              <label
                htmlFor={`quick-filter-${filter.key}`}
                className="flex items-center justify-between text-[11px] font-medium text-white/90"
              >
                <span>{filter.label}</span>
                <span className="text-white/60">
                  {filters[filter.key].toFixed(filter.step < 1 ? 1 : 0)}
                  {filter.unit}
                </span>
              </label>
              <input
                id={`quick-filter-${filter.key}`}
                type="range"
                min={filter.min}
                max={filter.max}
                step={filter.step}
                value={filters[filter.key]}
                onChange={(event) => onFiltersChange({ ...filters, [filter.key]: Number(event.target.value) })}
                className="w-full accent-cyan-400"
              />
            </div>
          ))}
        </div>
      )}

      {/* Canvas de captura para MediaRecorder (ver useVideoRecorder.ts):
          DEBE ser un nodo real y montado del DOM, nunca uno creado con
          document.createElement y mantenido solo en memoria — WebKit en iOS
          suspende/descarta silenciosamente el MediaStream de captureStream()
          de un canvas "huérfano" del árbol de render en tomas largas, lo que
          congela el video (dejando solo audio) a los pocos segundos. Se
          mantiene fuera de la vista con posición fija fuera de pantalla, NO
          con display:none/visibility:hidden: ambas sí detienen el pintado
          en WebKit, lo cual reintroduciría el mismo problema. */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed -top-[9999px] left-0 opacity-0"
      />
    </div>
  )
})
