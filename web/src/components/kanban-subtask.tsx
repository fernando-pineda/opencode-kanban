'use client'

import React from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Subtask } from '../types'
import {
  Clock,
  Send,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react'

interface KanbanSubtaskProps {
  subtask: Subtask
}

const agentColorMap: Record<string, string> = {
  'plan': 'bg-blue-500',
  'build': 'bg-purple-500',
  'builder': 'bg-green-500',
  'debugger': 'bg-amber-500',
  'ask': 'bg-teal-500',
}

const statusIconMap: Record<string, React.ReactNode> = {
  'pending': <Clock className="h-4 w-4 text-slate-400" />,
  'dispatched': <Send className="h-4 w-4 text-blue-400" />,
  'started': <Play className="h-4 w-4 text-blue-500" />,
  'progress': <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />,
  'completed': <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  'failed': <XCircle className="h-4 w-4 text-destructive" />,
  'escalated': <AlertTriangle className="h-4 w-4 text-amber-600" />,
}

export default function KanbanSubtask({ subtask }: KanbanSubtaskProps) {
  const agentType = subtask.agent_name.toLowerCase()
  const bgColor = agentColorMap[agentType] || 'bg-gray-500'
  const statusIcon = statusIconMap[subtask.status] || statusIconMap['pending']

  return (
    <div className="flex gap-2 p-2 bg-accent rounded-md">
      {/* Agent Avatar */}
      <Avatar size="sm" className="h-6 w-6 flex-shrink-0">
        <AvatarFallback className={`text-xs text-white ${bgColor}`}>
          {subtask.agent_name.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        {/* Header: Agent + Status + Badge */}
        <div className="flex items-center gap-1 mb-1">
          <span className="text-xs font-medium truncate">{subtask.agent_name}</span>
          <Badge variant="outline" className="text-xs h-fit">
            {subtask.agent_type === 'primary' ? 'PRIMARY' : 'SUBAGENT'}
          </Badge>
          {statusIcon}
        </div>

        {/* Title */}
        <div className="text-xs font-medium line-clamp-1 mb-1">{subtask.title}</div>

        {/* Progress */}
        {subtask.progress > 0 && (
          <div className="flex justify-between items-center text-xs mb-1">
            <span className="text-muted-foreground">{subtask.progress}%</span>
          </div>
        )}
        <Progress value={subtask.progress} className="h-1 mb-1" />

        {/* Details */}
        {subtask.details && (
          <div className="text-xs text-muted-foreground line-clamp-1">
            {subtask.details}
          </div>
        )}
      </div>
    </div>
  )
}
