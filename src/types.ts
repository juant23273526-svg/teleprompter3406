/** Ajustes de imagen aplicados en tiempo real al video (vista previa y grabación). */
export interface VideoFilters {
  /** 80–150, default 100. */
  brightness: number
  /** 80–150, default 100. También percibido como nitidez/enfoque de la imagen. */
  contrast: number
  /** 80–140, default 100. */
  saturate: number
  /** 0–2 (px de blur), default 0. Suavizado de piel / beauty effect. */
  skinSmooth: number
}

export const DEFAULT_VIDEO_FILTERS: VideoFilters = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  skinSmooth: 0,
}

/** Calidad de grabación: 'high' prioriza nitidez, 'social' prioriza tamaño de archivo liviano para compartir. */
export type VideoQuality = 'high' | 'social'

export interface VideoQualityPreset {
  label: string
  /** Ancho/alto "ideal" pedidos a getUserMedia (no "exact"): la cámara puede negociar algo distinto sin fallar. */
  width: number
  height: number
  /** Tasa de bits objetivo para MediaRecorder (videoBitsPerSecond). */
  bitrate: number
}

export const VIDEO_QUALITY_PRESETS: Record<VideoQuality, VideoQualityPreset> = {
  high: { label: 'Alta Calidad · 1080p', width: 1920, height: 1080, bitrate: 8_000_000 },
  social: { label: 'Redes Sociales · 720p', width: 1280, height: 720, bitrate: 2_500_000 },
}

export const DEFAULT_VIDEO_QUALITY: VideoQuality = 'high'
