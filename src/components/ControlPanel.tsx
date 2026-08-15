import { Eraser } from 'lucide-react'
import { memo } from 'react'
import type { VideoFilters } from '../types'

interface ControlPanelProps {
  script: string
  onScriptChange: (value: string) => void
  onClearScript: () => void
  fontSize: number
  onFontSizeChange: (value: number) => void
  isActive: boolean
  autoScrollSpeed: number
  onAutoScrollSpeedChange: (speed: number) => void
  videoFilters: VideoFilters
  onVideoFiltersChange: (filters: VideoFilters) => void
}

const MIN_FONT_SIZE = 20
const MAX_FONT_SIZE = 64

/** Rango decimal de alta precisión (paso 0.05): micro-ajustes ultrasuaves de velocidad, ver reshapeSensitivityCurve en App.tsx. */
const MIN_AUTO_SCROLL_SPEED = 0.05
const MAX_AUTO_SCROLL_SPEED = 5
const AUTO_SCROLL_SPEED_STEP = 0.05

interface FilterSliderConfig {
  key: keyof VideoFilters
  label: string
  hint: string
  min: number
  max: number
  step: number
  unit: string
}

const FILTER_SLIDERS: FilterSliderConfig[] = [
  { key: 'brightness', label: 'Brillo', hint: '', min: 80, max: 150, step: 1, unit: '%' },
  { key: 'contrast', label: 'Contraste / Nitidez', hint: 'También ajusta la nitidez percibida de la imagen.', min: 80, max: 150, step: 1, unit: '%' },
  { key: 'saturate', label: 'Saturación', hint: '', min: 80, max: 140, step: 1, unit: '%' },
  { key: 'skinSmooth', label: 'Suavizado de piel', hint: 'Beauty effect: desenfoque sutil.', min: 0, max: 2, step: 0.1, unit: 'px' },
]

/**
 * Memoizado: App.tsx re-renderiza seguido mientras el teleprónpter está
 * activo (el motor de auto-scroll no toca ninguna prop de este panel), pero
 * ninguno de esos cambios afecta las props de este panel. Sin memo, cada uno
 * de esos renders recorría también este árbol entero por nada mientras la
 * cámara graba en paralelo.
 */
export const ControlPanel = memo(function ControlPanel({
  script,
  onScriptChange,
  onClearScript,
  fontSize,
  onFontSizeChange,
  isActive,
  autoScrollSpeed,
  onAutoScrollSpeedChange,
  videoFilters,
  onVideoFiltersChange,
}: ControlPanelProps) {
  const updateFilter = (key: keyof VideoFilters, value: number) => {
    onVideoFiltersChange({ ...videoFilters, [key]: value })
  }

  return (
    // Contenido del drawer de ajustes: App.tsx es quien lo posiciona flotando
    // (fixed) y lo muestra/oculta con el botón de engrane; este panel solo
    // necesita llenar ese contenedor con su propio scroll.
    <aside className="flex h-full w-full flex-col gap-5 overflow-y-auto bg-slate-900 p-5">
      <div>
        <h1 className="text-lg font-semibold text-white">Teleprónpter Inteligente</h1>
        <p className="text-sm text-slate-400">Scroll automático · filtros de video en tiempo real</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="script-input" className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Guion
          </label>
          <button
            type="button"
            onClick={onClearScript}
            disabled={!script.trim()}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-slate-800 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Eraser className="h-3.5 w-3.5" />
            Limpiar
          </button>
        </div>
        <textarea
          id="script-input"
          value={script}
          onChange={(event) => onScriptChange(event.target.value)}
          disabled={isActive}
          rows={10}
          placeholder="Pega o escribe aquí el guion..."
          className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100 outline-none transition focus:border-cyan-500 disabled:opacity-50"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="font-size-input" className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-400">
          <span>Tamaño de fuente</span>
          <span className="text-slate-300">{fontSize}px</span>
        </label>
        <input
          id="font-size-input"
          type="range"
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          step={1}
          value={fontSize}
          onChange={(event) => onFontSizeChange(Number(event.target.value))}
          className="w-full accent-cyan-500"
        />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-950 p-3">
        <label htmlFor="auto-scroll-speed-input" className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-400">
          <span>Velocidad de scroll</span>
          <span className="text-slate-300">{autoScrollSpeed.toFixed(2)}/{MAX_AUTO_SCROLL_SPEED.toFixed(2)}</span>
        </label>
        <input
          id="auto-scroll-speed-input"
          type="range"
          min={MIN_AUTO_SCROLL_SPEED}
          max={MAX_AUTO_SCROLL_SPEED}
          step={AUTO_SCROLL_SPEED_STEP}
          value={autoScrollSpeed}
          onChange={(event) => onAutoScrollSpeedChange(Number(event.target.value))}
          className="w-full accent-cyan-500"
        />
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-950 p-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Filtros de video en tiempo real</span>
        {FILTER_SLIDERS.map((filter) => (
          <div key={filter.key} className="flex flex-col gap-1">
            <label
              htmlFor={`filter-${filter.key}`}
              className="flex items-center justify-between text-xs font-medium text-slate-300"
            >
              <span>{filter.label}</span>
              <span className="text-slate-400">
                {videoFilters[filter.key].toFixed(filter.step < 1 ? 1 : 0)}
                {filter.unit}
              </span>
            </label>
            <input
              id={`filter-${filter.key}`}
              type="range"
              min={filter.min}
              max={filter.max}
              step={filter.step}
              value={videoFilters[filter.key]}
              onChange={(event) => updateFilter(filter.key, Number(event.target.value))}
              className="w-full accent-cyan-500"
            />
            {filter.hint && <p className="text-[11px] text-slate-500">{filter.hint}</p>}
          </div>
        ))}
      </div>
    </aside>
  )
})
