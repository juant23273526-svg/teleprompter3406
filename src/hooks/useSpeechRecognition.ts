import { useCallback, useEffect, useRef, useState } from 'react'

export type SpeechRecognitionStatus = 'idle' | 'listening' | 'error' | 'unsupported'

interface UseSpeechRecognitionOptions {
  /** Se invoca con cada resultado reconocido, parcial o final. */
  onResult: (transcript: string, isFinal: boolean) => void
  lang?: string
}

interface UseSpeechRecognitionResult {
  status: SpeechRecognitionStatus
  errorMessage: string | null
  /** Empieza (o reanuda) la escucha continua del micrófono. */
  start: () => void
  /** Detiene la escucha de forma intencional: no se reinicia sola. */
  stop: () => void
  /** Limpia el estado de error, sin afectar si está escuchando o no. */
  reset: () => void
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

/**
 * Reconocimiento de voz continuo con la Web Speech API nativa del navegador
 * (Chrome/Edge/Brave). Es 100% nativo: no requiere Web Workers, binarios
 * .wasm ni descargar ningún modelo.
 */
export function useSpeechRecognition({
  onResult,
  lang = 'es-MX',
}: UseSpeechRecognitionOptions): UseSpeechRecognitionResult {
  const [status, setStatus] = useState<SpeechRecognitionStatus>(() =>
    getSpeechRecognitionConstructor() ? 'idle' : 'unsupported',
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  // Distingue un stop() intencional (botón "Detener") de un cierre
  // inesperado del motor: solo en el segundo caso se reinicia solo la
  // escucha para mantener el flujo activo.
  const intentionalStopRef = useRef(false)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  const createRecognition = useCallback((): SpeechRecognition | null => {
    const SpeechRecognitionCtor = getSpeechRecognitionConstructor()
    if (!SpeechRecognitionCtor) return null

    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = lang

    recognition.onresult = (event) => {
      let latestTranscript = ''
      let isFinal = false

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        latestTranscript = result[0].transcript
        isFinal = result.isFinal
      }

      if (latestTranscript.trim()) {
        onResultRef.current(latestTranscript.trim(), isFinal)
      }
    }

    recognition.onerror = (event) => {
      // 'no-speech' (silencio) y 'aborted' (llamado a stop/abort) son parte
      // del funcionamiento normal, no errores que deban mostrarse.
      if (event.error === 'no-speech' || event.error === 'aborted') return
      setStatus('error')
      setErrorMessage(event.message || `Error de reconocimiento de voz: ${event.error}`)
    }

    recognition.onend = () => {
      if (intentionalStopRef.current) {
        setStatus('idle')
        return
      }
      // Chrome corta la sesión de reconocimiento periódicamente incluso con
      // continuous = true; se reinicia sola para mantener la escucha activa.
      try {
        recognition.start()
      } catch {
        // Ya estaba iniciada o el navegador rechazó el reinicio inmediato;
        // no es un error real, se comporta bien en el próximo onend.
      }
    }

    return recognition
  }, [lang])

  const start = useCallback(() => {
    if (status === 'unsupported') return

    intentionalStopRef.current = false
    setErrorMessage(null)

    const recognition = recognitionRef.current ?? createRecognition()
    if (!recognition) {
      setStatus('unsupported')
      return
    }
    recognitionRef.current = recognition

    try {
      recognition.start()
    } catch {
      // InvalidStateError: ya estaba escuchando. No es un error real.
    }
    setStatus('listening')
  }, [createRecognition, status])

  const stop = useCallback(() => {
    intentionalStopRef.current = true
    recognitionRef.current?.stop()
    setStatus('idle')
  }, [])

  const reset = useCallback(() => {
    setErrorMessage(null)
  }, [])

  // Al desmontar, detener de forma intencional para no dejar el micrófono
  // activo ni reintentos de reinicio en segundo plano.
  useEffect(() => {
    return () => {
      intentionalStopRef.current = true
      recognitionRef.current?.stop()
      recognitionRef.current = null
    }
  }, [])

  return { status, errorMessage, start, stop, reset }
}
