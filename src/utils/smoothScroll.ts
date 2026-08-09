/**
 * Animación de scroll manual con requestAnimationFrame, en vez de depender
 * de `scrollIntoView({ behavior: 'smooth' })`: el nativo se corta en seco y
 * "brinca" a la posición final si se le llama de nuevo antes de terminar
 * (por ejemplo, cuando el motor de voz actualiza currentIndex varias veces
 * seguidas). Aquí cada llamada puede cancelar limpiamente la anterior.
 */

export interface ScrollAnimationHandle {
  cancel: () => void
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/** Anima `container.scrollTop` hasta `targetScrollTop` con easing suave. */
export function animateScrollTop(
  container: HTMLElement,
  targetScrollTop: number,
  durationMs = 450,
): ScrollAnimationHandle {
  const startScrollTop = container.scrollTop
  const distance = targetScrollTop - startScrollTop
  const startTime = performance.now()
  let frameId = 0
  let cancelled = false

  const step = (now: number) => {
    if (cancelled) return

    const elapsed = now - startTime
    const progress = Math.min(1, elapsed / durationMs)
    container.scrollTop = startScrollTop + distance * easeInOutCubic(progress)

    if (progress < 1) {
      frameId = requestAnimationFrame(step)
    }
  }

  frameId = requestAnimationFrame(step)

  return {
    cancel: () => {
      cancelled = true
      cancelAnimationFrame(frameId)
    },
  }
}

/** Anima el scroll del contenedor para centrar verticalmente `element` dentro de él. */
export function scrollElementToCenter(
  container: HTMLElement,
  element: HTMLElement,
  durationMs = 450,
): ScrollAnimationHandle {
  const containerRect = container.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const offsetWithinContainer = elementRect.top - containerRect.top + container.scrollTop
  const target = offsetWithinContainer - container.clientHeight / 2 + elementRect.height / 2

  return animateScrollTop(container, target, durationMs)
}
