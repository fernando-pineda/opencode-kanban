import { Bot, BotMessageSquare, FlaskConical, Settings } from "lucide-react";
import {
  Dialog,
  DialogContent,
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
    deleting,
    handleContentChange,
    handleSave,
    handleDelete,
    handleAgentCreated,
  } = useAgentsData();

  const content = loading ? (
    <AgentsLoadingSkeleton />
  ) : error ? (
    <AgentsError error={error} />
  ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl h-[85vh] flex flex-col">
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
          <TabsContent value="general" className="flex-1 min-h-0 overflow-y-auto mt-4">
            <SettingsGeneralTab />
          </TabsContent>
          <TabsContent value="agents" className="flex-1 min-h-0 overflow-y-auto mt-4">
            {content ?? (
              <AgentsList
                agents={primaryAgents}
                agentFiles={agentFiles}
                agentFileExists={agentFileExists}
                dirtyFiles={dirtyFiles}
                saving={saving}
                deleting={deleting}
                mode="primary"
                onContentChange={handleContentChange}
                onSave={handleSave}
                onDelete={handleDelete}
                onAgentCreated={handleAgentCreated}
              />
            )}
          </TabsContent>
          <TabsContent value="subagents" className="flex-1 min-h-0 overflow-y-auto mt-4">
            {content ?? (
              <AgentsList
                agents={subagents}
                agentFiles={agentFiles}
                agentFileExists={agentFileExists}
                dirtyFiles={dirtyFiles}
                saving={saving}
                deleting={deleting}
                mode="subagent"
                onContentChange={handleContentChange}
                onSave={handleSave}
                onDelete={handleDelete}
                onAgentCreated={handleAgentCreated}
              />
            )}
          </TabsContent>
          <TabsContent value="experimental" className="flex-1 min-h-0 overflow-y-auto mt-4">
            <SettingsExperimentalTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
