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
