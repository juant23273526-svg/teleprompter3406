import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { ScrollMode } from '../types'
import { scrollElementToCenter, type ScrollAnimationHandle } from '../utils/smoothScroll'

interface PrompterScreenProps {
  lines: string[]
  currentIndex: number
  fontSize: number
  onLineClick: (index: number) => void
  scrollMode: ScrollMode
  scrollContainerRef: RefObject<HTMLDivElement>
}

export function PrompterScreen({
  lines,
  currentIndex,
  fontSize,
  onLineClick,
  scrollMode,
  scrollContainerRef,
}: PrompterScreenProps) {
  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([])
  const activeAnimationRef = useRef<ScrollAnimationHandle | null>(null)

  // Centra el renglón indicado con una animación propia (rAF + easing) en
  // vez de scrollIntoView nativo, cancelando cualquier animación anterior
  // aún en curso para que nunca se pisen entre sí ("saltos" bruscos).
  const scrollLineIntoView = useCallback(
    (index: number) => {
      const container = scrollContainerRef.current
      const line = lineRefs.current[index]
      if (!container || !line) return

      activeAnimationRef.current?.cancel()
      activeAnimationRef.current = scrollElementToCenter(container, line)
    },
    [scrollContainerRef],
  )

  // El centrado automático sobre currentIndex solo aplica en modo voz: en
  // 'auto' el motor de scroll continuo mueve el contenedor directamente, y en
  // 'manual' el usuario controla el scroll nativo sin interferencias.
  useEffect(() => {
    if (scrollMode !== 'voice') return
    scrollLineIntoView(currentIndex)
  }, [currentIndex, scrollMode, scrollLineIntoView])

  useEffect(() => {
    return () => {
      activeAnimationRef.current?.cancel()
    }
  }, [])

  const handleLineClick = (index: number) => {
    onLineClick(index)
    // Saltar directamente al renglón elegido, sin importar el modo activo.
    scrollLineIntoView(index)
  }

  return (
    <div className="relative z-10 flex-1 overflow-hidden bg-slate-950/60">
      {/* Capa semi-transparente para legibilidad: cuando la cámara está activa de
          fondo (position: fixed, z-index: 0, en App), este contenedor flota
          encima (z-index: 10) y oscurece un poco el video para que el texto
          siga siendo legible. */}
      <div className="pointer-events-none absolute inset-0 bg-black/35" />

      {/* Overlay de la línea de lectura central: guía visual fija en medio de la pantalla,
          independiente del scroll del guion. */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-24 -translate-y-1/2 border-y border-cyan-400/20 bg-cyan-400/5" />

      <div
        ref={scrollContainerRef}
        tabIndex={0}
        className="h-full overflow-y-auto outline-none"
      >
        <div className="mx-auto max-w-4xl space-y-6 px-8 py-[42vh] md:px-16">
          {lines.map((line, index) => {
            if (!line.trim()) {
              return <div key={index} aria-hidden className="h-4" />
            }

            const isActive = scrollMode === 'voice' && index === currentIndex
            const isPast = scrollMode === 'voice' && index < currentIndex

            return (
              <p
                key={index}
                ref={(el) => {
                  lineRefs.current[index] = el
                }}
                onClick={() => handleLineClick(index)}
                className={[
                  'cursor-pointer rounded-lg px-2 py-1 text-center font-medium transition-all duration-300 ease-out',
                  isActive
                    ? 'scale-105 text-white opacity-100 drop-shadow-[0_0_18px_rgba(34,211,238,0.45)]'
                    : isPast
                      ? 'text-slate-600 opacity-40 hover:opacity-70'
                      : 'text-slate-300 opacity-60 hover:opacity-90',
                ].join(' ')}
                style={{ fontSize: `${fontSize}px`, lineHeight: 1.5 }}
              >
                {line}
              </p>
            )
          })}
        </div>
      </div>
    </div>
  )
}
