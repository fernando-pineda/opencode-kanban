import * as React from "react"

interface UseSpeechRecognitionOptions {
  lang?: string
  onFinalTranscript?: (text: string) => void
}

interface UseSpeechRecognitionReturn {
  isListening: boolean
  transcript: string
  interimTranscript: string
  supported: boolean
  error: string | null
  startListening: () => void
  stopListening: () => void
}

// Using `any` for the SpeechRecognition type because the Web Speech API
// types are inconsistent across browsers. Chrome exposes `webkitSpeechRecognition`
// while the standard spec defines `SpeechRecognition`, and neither has stable
// TypeScript definitions that cover all implementations reliably.
/* eslint-disable @typescript-eslint/no-explicit-any */
function createRecognition(lang: string): any {
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SpeechRecognition) return null
  const recognition = new SpeechRecognition()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = lang
  return recognition
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useSpeechRecognition(
  options?: UseSpeechRecognitionOptions,
): UseSpeechRecognitionReturn {
  const lang = options?.lang ?? navigator.language
  const onFinalTranscriptRef = React.useRef(options?.onFinalTranscript)
  onFinalTranscriptRef.current = options?.onFinalTranscript

  const recognitionRef = React.useRef<any>(null)
  const transcriptRef = React.useRef("")
  const [isListening, setIsListening] = React.useState(false)
  const [transcript, setTranscript] = React.useState("")
  const [interimTranscript, setInterimTranscript] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const errorRef = React.useRef<string | null>(null)
  const networkRetryRef = React.useRef(0)

  const supported = React.useMemo(() => {
    return !!(
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    )
  }, [])

  // Keep a ref to isListening so the onend handler reads the latest value
  // without needing to re-create the recognition instance.
  const isListeningRef = React.useRef(isListening)
  isListeningRef.current = isListening

  const startListening = React.useCallback(() => {
    // Reset error and transcript refs for a fresh session
    errorRef.current = null
    networkRetryRef.current = 0
    transcriptRef.current = ""
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        // Already stopped or never started — ignore
      }
    }

    setError(null)
    setInterimTranscript("")

    const recognition = createRecognition(lang)
    if (!recognition) {
      setError("Speech recognition is not supported in this browser")
      return
    }

    recognitionRef.current = recognition

    recognition.onresult = (event: any) => {
      let finalChunk = ""
      let interimChunk = ""

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalChunk += result[0].transcript
        } else {
          interimChunk += result[0].transcript
        }
      }

      if (finalChunk) {
        transcriptRef.current += finalChunk
        setTranscript((prev) => prev + finalChunk)
      }
      setInterimTranscript(interimChunk)
    }

    recognition.onerror = (event: any) => {
      const errorType = event.error

      // Chrome fires "no-speech" when the user stays silent — just stop quietly.
      if (errorType === "no-speech") {
        isListeningRef.current = false
        setIsListening(false)
        setInterimTranscript("")
        return
      }

      // "not-allowed" means the user denied or the page lacks permissions.
      if (errorType === "not-allowed") {
        setError("Microphone access was denied. Please allow microphone permissions.")
        errorRef.current = "Microphone access was denied. Please allow microphone permissions."
      } else if (errorType === "network") {
        // Network errors to Google's speech servers can be transient — retry once
        if (networkRetryRef.current < 1) {
          networkRetryRef.current++
          // Don't set error, just let onend auto-restart
          isListeningRef.current = true
          return
        }
        setError("Unable to reach Google's speech service. This may be caused by an ad blocker, VPN, or firewall blocking speech recognition.")
        errorRef.current = "network"
      } else if (errorType === "aborted") {
        // Aborted is usually benign — recognition was stopped or superseded
        isListeningRef.current = false
        setIsListening(false)
        setInterimTranscript("")
        return
      } else if (errorType === "audio-capture") {
        setError("No microphone found. Please connect a microphone and try again.")
        errorRef.current = "audio-capture"
      } else if (errorType === "service-not-allowed") {
        setError("Speech recognition service is not allowed. Please check your browser settings.")
        errorRef.current = "service-not-allowed"
      } else {
        setError(`Speech recognition error: ${errorType}`)
        errorRef.current = errorType
      }

      isListeningRef.current = false
      setIsListening(false)
      setInterimTranscript("")
    }

    recognition.onend = () => {
      // If the user hasn't explicitly stopped and no error occurred,
      // auto-restart. Chrome ends recognition after a period of silence.
      // Don't auto-restart if the session ended due to an error (network, etc.)
      if (isListeningRef.current && !errorRef.current) {
        try {
          recognition.start()
          networkRetryRef.current = 0
        } catch {
          // If start fails (e.g. recognition was aborted), stay stopped.
          setIsListening(false)
        }
        return
      }

      setIsListening(false)
      setInterimTranscript("")

      // Fire the callback with the final accumulated transcript,
      // then reset for the next dictation session.
      // Snapshot and clear immediately to prevent double-fire if onend
      // triggers more than once (common with Chrome's continuous mode).
      const finalText = transcriptRef.current
      transcriptRef.current = ""
      setTranscript("")

      if (finalText && onFinalTranscriptRef.current) {
        queueMicrotask(() => {
          onFinalTranscriptRef.current?.(finalText)
        })
      }
    }

    try {
      recognition.start()
      setIsListening(true)
    } catch (err: any) {
      setError(err?.message ?? "Failed to start speech recognition")
      setIsListening(false)
    }
  }, [lang])

  const stopListening = React.useCallback(() => {
    isListeningRef.current = false
    setIsListening(false)
    setInterimTranscript("")

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        // Already stopped — ignore
      }
    }
  }, [])

  // Stop recognition on unmount to clean up.
  React.useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch {
          // Component unmounting — ignore cleanup errors
        }
      }
    }
  }, [])

  return {
    isListening,
    transcript,
    interimTranscript,
    supported,
    error,
    startListening,
    stopListening,
  }
}
