'use client'

import React from 'react'
import { BoardFull } from '../types'
import KanbanColumn from './kanban-column'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Brain, PlusCircle, FileText } from 'lucide-react'

interface KanbanBoardProps {
  board: BoardFull
  onCardClick?: (sessionId: string) => void
  onNewSession?: () => void
}

export default function KanbanBoard({ board, onCardClick, onNewSession }: KanbanBoardProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Board Header — fixed, full width */}
      <div className="flex-shrink-0 px-6 pt-3 pb-2 flex items-start justify-between border-b">
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">{board.board.name}</h1>
          <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">{board.board.repo_path}</p>
        </div>
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
            {[
              { icon: Brain, label: 'Memories', onClick: () => {} },
              { icon: PlusCircle, label: 'New Session', onClick: onNewSession || (() => {}) },
              { icon: FileText, label: 'Project Summary', onClick: () => {} },
            ].map(({ icon: Icon, label, onClick }) => (
              <Tooltip key={label}>
                <TooltipTrigger asChild>
                  <button
                    onClick={onClick}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Icon className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {label}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </div>

      {/* Columns Container — scrollable horizontally */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden min-h-0">
        <div className="flex gap-6 px-6 pb-4 h-full min-h-0">
          {board.columns.map((column) => {
            const columnCards = board.cards.filter(card => card.column_name === column.name)
            return (
              <KanbanColumn
                key={column.id}
                column={column}
                cards={columnCards}
                onCardClick={onCardClick}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
