import type { PluginInput } from "../../plugin/sdk";
import { createDynamicTruncator } from "../shared/dynamic-truncator";
import { createSessionCacheStore } from "./storage";
import { createRuleInjectionProcessor } from "./injector";

interface ToolExecuteOutputShape {
  title: string;
  metadata: unknown;
}

export function getRuleInjectionFilePath(
  output: ToolExecuteOutputShape
): string | null {
  const metadata = output.metadata as Record<string, unknown> | null;
  const metadataFilePath =
    metadata && typeof metadata === "object" ? metadata.filePath : undefined;

  if (typeof metadataFilePath === "string" && metadataFilePath.length > 0) {
    return metadataFilePath;
  }

  if (typeof output.title === "string" && output.title.length > 0) {
    return output.title;
  }

  return null;
}

interface ToolExecuteInput {
  tool: string;
  sessionID: string;
  callID: string;
}

interface ToolExecuteOutput {
  title: string;
  output: string;
  metadata: unknown;
}

interface ToolExecuteBeforeOutput {
  args: unknown;
}

interface EventInput {
  event: {
    type: string;
    properties?: unknown;
  };
}

const TRACKED_TOOLS = ["read", "write", "edit", "multiedit"];

export function createRulesInjectorHook(
  ctx: PluginInput,
  modelCacheState?: { anthropicContext1MEnabled: boolean },
) {
  const truncator = createDynamicTruncator(ctx, modelCacheState);
  const { getSessionCache, clearSessionCache } = createSessionCacheStore();
  const { processFilePathForInjection } = createRuleInjectionProcessor({
    workspaceDirectory: ctx.directory,
    truncator,
    getSessionCache,
  });

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ) => {
    const toolName = input.tool.toLowerCase();

    if (TRACKED_TOOLS.includes(toolName)) {
      const filePath = getRuleInjectionFilePath(output);
      if (!filePath) return;
      await processFilePathForInjection(filePath, input.sessionID, output);
      return;
    }
  };

  const toolExecuteBefore = async (
    input: ToolExecuteInput,
    output: ToolExecuteBeforeOutput
  ): Promise<void> => {
    void input;
    void output;
  };

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined;

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id) {
        clearSessionCache(sessionInfo.id);
      }
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined;
      if (sessionID) {
        clearSessionCache(sessionID);
      }
    }
  };

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}
