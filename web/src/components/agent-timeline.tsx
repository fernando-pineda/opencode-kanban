'use client'

import React from 'react'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card as CardType } from '../types'

interface AgentTimelineProps {
  card: CardType
}

const agentColorMap: Record<string, string> = {
  'plan': 'bg-blue-500',
  'build': 'bg-purple-500',
  'builder': 'bg-green-500',
  'debugger': 'bg-amber-500',
  'ask': 'bg-teal-500',
}

function formatTime(timestamp: string): string {
  try {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return timestamp
  }
}

export default function AgentTimeline({ card }: AgentTimelineProps) {
  const logs = card.agent_logs || []

  return (
    <div className="flex flex-col gap-4 h-full">
      <SheetHeader>
        <SheetTitle className="line-clamp-2">{card.title}</SheetTitle>
      </SheetHeader>

      <ScrollArea className="flex-1">
        <div className="space-y-4 pr-4">
          {logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No activity yet
            </div>
          ) : (
            logs.map((log, index) => {
              const agentType = log.agent_name.toLowerCase()
              const bgColor = agentColorMap[agentType] || 'bg-gray-500'

              return (
                <div key={log.id} className="flex gap-3">
                  {/* Timeline Line */}
                  <div className="flex flex-col items-center">
                    <Avatar size="sm" className="h-8 w-8">
                      <AvatarFallback className={`text-xs text-white ${bgColor}`}>
                        {log.agent_name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {index < logs.length - 1 && (
                      <div className="w-0.5 h-12 bg-border mt-2" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 pt-0.5 pb-2">
                    {/* Time */}
                    <div className="text-xs text-muted-foreground">
                      {formatTime(log.timestamp)}
                    </div>

                    {/* Agent Info */}
                    <div className="flex items-center gap-2 mt-1 mb-1">
                      <span className="text-sm font-semibold">{log.agent_name}</span>
                      <Badge variant="outline" className="text-xs h-fit">
                        {log.agent_type === 'primary' ? 'PRIMARY' : 'SUBAGENT'}
                      </Badge>
                    </div>

                    {/* Action Text */}
                    <div className="text-sm font-medium mb-1">
                      {log.action}
                    </div>

                    {/* Details */}
                    {log.details && (
                      <div className="text-xs text-muted-foreground mb-2">
                        {log.details}
                      </div>
                    )}

                    {/* Subtask Context */}
                    {log.subtask_id && (
                      <div className="text-xs bg-accent p-2 rounded mt-2">
                        <div className="text-muted-foreground">
                          Subtask #{log.subtask_id}
                        </div>
                      </div>
                    )}

                    {index < logs.length - 1 && (
                      <Separator className="mt-3" />
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
