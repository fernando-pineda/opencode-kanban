'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface ProjectSummarySheetProps {
  directory: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SummaryState = 'idle' | 'loading' | 'streaming' | 'complete' | 'error'

export default function ProjectSummarySheet({
  directory,
  open,
  onOpenChange,
}: ProjectSummarySheetProps) {
  const [state, setState] = useState<SummaryState>('idle')
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollCountRef = useRef(0)
  const MAX_POLLS = 120 // 120 * 2s = 240s max wait
  const mountedRef = useRef(true)

  const cleanup = useCallback(async () => {
    // Stop polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    // Delete ephemeral session
    const sid = sessionIdRef.current
    if (sid) {
      sessionIdRef.current = null
      try {
        await fetch(`/api/sessions/${sid}`, { method: 'DELETE' })
      } catch {
        // non-critical
      }
    }
  }, [])

  const startGeneration = useCallback(async () => {
    setState('loading')
    setError(null)
    setSummaryText(null)
    pollCountRef.current = 0

    try {
      const res = await fetch('/api/project-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      sessionIdRef.current = data.session_id

      // Start polling for messages
      setState('streaming')
      pollIntervalRef.current = setInterval(async () => {
        pollCountRef.current++
        if (pollCountRef.current > MAX_POLLS) {
          cleanup()
          setState('error')
          setError('Generation timed out. Try refreshing.')
          return
        }

        const sid = sessionIdRef.current
        if (!sid) return

        try {
          const msgRes = await fetch(`/api/sessions/${sid}/messages?limit=50&offset=0`)
          if (!msgRes.ok) return
          const msgData = await msgRes.json()

          // Find assistant messages
          const assistantMessages = (msgData.messages || []).filter(
            (m: any) => m.role === 'assistant' && m.text
          )

          if (assistantMessages.length > 0) {
            // Combine all assistant message text
            const text = assistantMessages.map((m: any) => m.text).join('\n\n')
            setSummaryText(text)

            // Check if agent is done — if total hasn't changed for a few polls, mark complete
            // Simple heuristic: if we have assistant text and the session isn't busy, we're done
            // For now, just keep updating — the user can read as it streams
          }
        } catch {
          // ignore poll errors
        }
      }, 2000)
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Failed to generate summary')
    }
  }, [directory, cleanup])

  // Auto-start when sheet opens
  useEffect(() => {
    mountedRef.current = true
    if (open && !summaryText && state === 'idle') {
      startGeneration()
    }
    return () => {
      mountedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Cleanup on close or unmount
  useEffect(() => {
    if (!open) {
      cleanup()
      // Don't reset summaryText on close — keep cache
      // Don't reset state — keep 'complete' or 'error' state
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
    return () => {
      cleanup()
    }
  }, [open, cleanup])

  const handleRefresh = () => {
    cleanup()
    setSummaryText(null)
    setState('idle')
    setError(null)
    // Will auto-start via the useEffect
    setTimeout(() => startGeneration(), 100)
  }

  const isLoading = state === 'loading' || state === 'streaming'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg w-full flex flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
          <div>
            <SheetTitle className="text-lg">Project Summary</SheetTitle>
            <SheetDescription className="text-xs font-mono truncate mt-0.5">
              {directory}
            </SheetDescription>
          </div>
          {(state === 'complete' || state === 'error' || summaryText) && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              className="h-8 w-8 shrink-0"
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1 px-4 pb-4">
          <div className="max-w-none">
            {state === 'loading' && (
              <div className="space-y-3 py-4">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <div className="flex items-center gap-2 pt-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-xs">Generating summary...</span>
                </div>
              </div>
            )}

            {state === 'error' && !summaryText && (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <p className="text-sm text-destructive text-center">
                  {error || 'Failed to generate summary'}
                </p>
                <Button variant="outline" size="sm" onClick={handleRefresh}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Retry
                </Button>
              </div>
            )}

            {summaryText && (
              <div className="py-2">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code: ({ className, children, ...props }) => {
                      const match = /language-(\w+)/.exec(className || '')
                      if (match) {
                        return (
                          <SyntaxHighlighter
                            style={oneDark}
                            language={match[1]}
                            PreTag="div"
                            className="rounded my-2 text-xs"
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        )
                      }
                      return (
                        <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                          {children}
                        </code>
                      )
                    },
                    pre: ({ children }) => <>{children}</>,
                    p: ({ children }) => <p className="leading-relaxed mb-3">{children}</p>,
                    a: ({ children, href }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {children}
                      </a>
                    ),
                    ul: ({ children }) => <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal list-inside mb-3 space-y-1">{children}</ol>,
                    li: ({ children }) => <li className="leading-snug">{children}</li>,
                    h1: ({ children }) => (
                      <h1 className="text-base font-semibold mt-3 mb-1">{children}</h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="text-sm font-semibold mt-2 mb-1">{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-sm font-medium mt-2 mb-1">{children}</h3>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-4 border-muted pl-3 italic text-muted-foreground my-2">
                        {children}
                      </blockquote>
                    ),
                    table: ({ children }) => (
                      <table className="border-collapse border border-border w-full text-xs my-2">
                        {children}
                      </table>
                    ),
                    th: ({ children }) => (
                      <th className="border border-border bg-muted px-2 py-1 text-left font-semibold">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="border border-border px-2 py-1">{children}</td>
                    ),
                  }}
                >
                  {summaryText}
                </ReactMarkdown>
                {state === 'streaming' && (
                  <div className="flex items-center gap-2 pt-3 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span className="text-xs">Still generating...</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
