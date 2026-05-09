import * as React from "react"

import { AudioCapture } from "@/lib/audio-capture"
import { WhisperTranscriber } from "@/lib/whisper-transcriber"

interface UseSpeechRecognitionOptions {
  onFinalTranscript?: (text: string) => void
  /** Called with interim (real-time) transcription results while recording. */
  onInterimTranscript?: (text: string) => void
}

interface UseSpeechRecognitionReturn {
  isListening: boolean
  isProcessing: boolean
  isModelLoading: boolean
  modelLoadProgress: number
  supported: boolean
  error: string | null
  startListening: () => void
  stopListening: () => void
}

// ---------------------------------------------------------------------------
// Module-level singleton — persists across re-renders and component mounts so
// the (potentially large) Whisper model is only loaded once.
// ---------------------------------------------------------------------------
let transcriberInstance: WhisperTranscriber | null = null
function getTranscriber(): WhisperTranscriber {
  if (!transcriberInstance) transcriberInstance = new WhisperTranscriber()
  return transcriberInstance
}

/** Read the STT language preference from localStorage. Defaults to auto-detect. */
function getSTTLanguage(): string {
  try {
    return localStorage.getItem("stt_language") || "any"
  } catch {
    return "any"
  }
}

export function useSpeechRecognition(
  options?: UseSpeechRecognitionOptions,
): UseSpeechRecognitionReturn {
  const onFinalTranscriptRef = React.useRef(options?.onFinalTranscript)
  onFinalTranscriptRef.current = options?.onFinalTranscript

  const onInterimTranscriptRef = React.useRef(options?.onInterimTranscript)
  onInterimTranscriptRef.current = options?.onInterimTranscript

  const captureRef = React.useRef<AudioCapture | null>(null)
  const interimTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const isTranscribingRef = React.useRef(false)

  const [isListening, setIsListening] = React.useState(false)
  const [isProcessing, setIsProcessing] = React.useState(false)
  const [isModelLoading, setIsModelLoading] = React.useState(false)
  const [modelLoadProgress, setModelLoadProgress] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)

  const supported = React.useMemo(
    () => !!(window.AudioContext && navigator.mediaDevices?.getUserMedia),
    [],
  )

  const startListening = React.useCallback(async () => {
    setError(null)

    const transcriber = getTranscriber()

    // Load the model if it isn't ready yet.
    if (transcriber.getState() !== "ready") {
      setIsModelLoading(true)
      setModelLoadProgress(0)
      try {
        await transcriber.loadModel((p) => {
          setModelLoadProgress(p.progress)
        })
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err)
        setError(`Failed to load Whisper model: ${msg}`)
        setIsModelLoading(false)
        return
      }
      setIsModelLoading(false)
    }

    try {
      const capture = new AudioCapture()
      captureRef.current = capture
      await capture.start()
      setIsListening(true)

      // Start periodic interim transcriptions every 2 seconds
      interimTimerRef.current = setInterval(async () => {
        if (isTranscribingRef.current) return // skip if previous transcription still running
        try {
          const peekAudio = await capture.peekAudio()
          if (peekAudio.length < 8000) return // less than ~0.5s of 16kHz audio — skip

          const nativeSampleRate = 48000
          const resampled = await capture.resampleTo16kHz(peekAudio, nativeSampleRate)
          if (resampled.length < 8000) return // too short after resampling

          isTranscribingRef.current = true
          const transcriber = getTranscriber()
          const text = await transcriber.transcribe(resampled, getSTTLanguage())
          if (text && onInterimTranscriptRef.current) {
            onInterimTranscriptRef.current(text)
          }
        } catch {
          // interim transcription failed — non-critical, ignore
        } finally {
          isTranscribingRef.current = false
        }
      }, 1000)
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err)
      setError(`Failed to start recording: ${msg}`)
      captureRef.current = null
    }
  }, [])

  const stopListening = React.useCallback(async () => {
    // Stop interim transcription timer
    if (interimTimerRef.current) {
      clearInterval(interimTimerRef.current)
      interimTimerRef.current = null
    }

    const capture = captureRef.current
    if (!capture) return

    setIsListening(false)
    setIsProcessing(true)

    try {
      const audio = await capture.stop()

      // AudioCapture creates an AudioContext at the browser's native sample rate
      // (typically 48 kHz). We use 48 000 as the default since AudioCapture does
      // not expose the actual rate.
      const nativeSampleRate = 48000
      const resampled = await capture.resampleTo16kHz(audio, nativeSampleRate)

      const transcriber = getTranscriber()
      const text = await transcriber.transcribe(resampled, getSTTLanguage())

      if (text && onFinalTranscriptRef.current) {
        onFinalTranscriptRef.current(text)
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err)
      setError(`Transcription failed: ${msg}`)
    } finally {
      setIsProcessing(false)
      capture.destroy()
      captureRef.current = null
    }
  }, [])

  // Clean up on unmount — stop recording if active and release resources.
  React.useEffect(() => {
    return () => {
      if (interimTimerRef.current) {
        clearInterval(interimTimerRef.current)
        interimTimerRef.current = null
      }
      if (captureRef.current) {
        captureRef.current.destroy()
        captureRef.current = null
      }
    }
  }, [])

  return {
    isListening,
    isProcessing,
    isModelLoading,
    modelLoadProgress,
    supported,
    error,
    startListening,
    stopListening,
  }
}
