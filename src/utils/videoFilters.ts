import type { VideoFilters } from '../types'

/**
 * Construye el string de filtro CSS/Canvas 2D a partir de VideoFilters.
 * Se comparte entre CameraView (vista previa en vivo, vía style.filter) y
 * useVideoRecorder (canvas.filter en el bucle de dibujo) para que lo que el
 * usuario ve en pantalla coincida exactamente con lo que queda grabado.
 */
export function buildFilterString(filters: VideoFilters): string {
  return `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturate}%) blur(${filters.skinSmooth}px)`
}

export interface FilterSliderConfig {
  key: keyof VideoFilters
  label: string
  hint: string
  min: number
  max: number
  step: number
  unit: string
}

/**
 * Configuración de los 4 sliders de imagen, compartida entre el panel de
 * ajustes completo (ControlPanel) y el acceso rápido flotante sobre la
 * vista previa de cámara (CameraView), para que ambos queden siempre en
 * sincronía sin duplicar los rangos/pasos en dos sitios.
 */
export const FILTER_SLIDER_CONFIGS: FilterSliderConfig[] = [
  { key: 'brightness', label: 'Brillo', hint: '', min: 80, max: 150, step: 1, unit: '%' },
  { key: 'contrast', label: 'Contraste / Nitidez', hint: 'También ajusta la nitidez percibida de la imagen.', min: 80, max: 150, step: 1, unit: '%' },
  { key: 'saturate', label: 'Saturación', hint: '', min: 80, max: 140, step: 1, unit: '%' },
  { key: 'skinSmooth', label: 'Suavizado de piel', hint: 'Beauty effect: desenfoque sutil.', min: 0, max: 2, step: 0.1, unit: 'px' },
]
