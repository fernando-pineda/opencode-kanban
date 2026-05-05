import { Bot, BotMessageSquare, FlaskConical, Settings } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  useAgentsData,
  AgentsLoadingSkeleton,
  AgentsError,
  AgentsList,
} from "./settings-agents-tab";
import SettingsExperimentalTab from "./settings-experimental-tab";
import SettingsGeneralTab from "./settings-general-tab";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const {
    loading,
    error,
    primaryAgents,
    subagents,
    agentFiles,
    agentFileExists,
    dirtyFiles,
    saving,
    handleContentChange,
    handleSave,
  } = useAgentsData();

  const content = loading ? (
    <AgentsLoadingSkeleton />
  ) : error ? (
    <AgentsError error={error} />
  ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure your workspace</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="general" className="flex-1 min-h-0">
          <TabsList variant="line">
            <TabsTrigger value="general">
              <Settings className="h-4 w-4 mr-1.5" />
              General
            </TabsTrigger>
            <TabsTrigger value="agents">
              <Bot className="h-4 w-4 mr-1.5" />
              Agents
            </TabsTrigger>
            <TabsTrigger value="subagents">
              <BotMessageSquare className="h-4 w-4 mr-1.5" />
              Subagents
            </TabsTrigger>
            <TabsTrigger value="experimental">
              <FlaskConical className="h-4 w-4 mr-1.5" />
              Experimental
            </TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="overflow-y-auto max-h-[calc(85vh-8rem)] mt-4">
            <SettingsGeneralTab />
          </TabsContent>
          <TabsContent value="agents" className="overflow-y-auto max-h-[calc(85vh-8rem)] mt-4">
            {content ?? (
              <AgentsList
                agents={primaryAgents}
                agentFiles={agentFiles}
                agentFileExists={agentFileExists}
                dirtyFiles={dirtyFiles}
                saving={saving}
                onContentChange={handleContentChange}
                onSave={handleSave}
              />
            )}
          </TabsContent>
          <TabsContent value="subagents" className="overflow-y-auto max-h-[calc(85vh-8rem)] mt-4">
            {content ?? (
              <AgentsList
                agents={subagents}
                agentFiles={agentFiles}
                agentFileExists={agentFileExists}
                dirtyFiles={dirtyFiles}
                saving={saving}
                onContentChange={handleContentChange}
                onSave={handleSave}
              />
            )}
          </TabsContent>
          <TabsContent value="experimental" className="overflow-y-auto max-h-[calc(85vh-8rem)] mt-4">
            <SettingsExperimentalTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
