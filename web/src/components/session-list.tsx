'use client'

import React, { useEffect, useState } from 'react'
import { Card as CardComponent, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Card } from '../types'

interface SessionListProps {
  sessions?: Card[]
  isLoading?: boolean
}

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateString
  }
}

export default function SessionList({ sessions = [], isLoading = false }: SessionListProps) {
  const [sortedSessions, setSortedSessions] = useState<Card[]>([])

  useEffect(() => {
    // Sort sessions: by most recent
    const sorted = [...sessions].sort((a, b) => new Date(b.time_updated).getTime() - new Date(a.time_updated).getTime())
    setSortedSessions(sorted)
  }, [sessions])

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        {[...Array(3)].map((_, i) => (
          <CardComponent key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-4 bg-muted rounded w-1/2" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="h-3 bg-muted rounded w-3/4" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </div>
            </CardContent>
          </CardComponent>
        ))}
      </div>
    )
  }

  if (sortedSessions.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 text-center">
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">No sessions yet</h3>
          <p className="text-sm text-muted-foreground">
            Sessions will appear here as they are created
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      {sortedSessions.map((session) => (
        <CardComponent key={session.session_id}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base line-clamp-1">
                {session.directory}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created:</span>
              <span>{formatDate(session.time_created)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Updated:</span>
              <span>{formatDate(session.time_updated)}</span>
            </div>
            {session.description && (
              <div className="mt-3 pt-3 border-t">
                <p className="text-muted-foreground line-clamp-3">
                  {session.description}
                </p>
              </div>
            )}
          </CardContent>
        </CardComponent>
      ))}
    </div>
  )
}
