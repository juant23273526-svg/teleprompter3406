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
