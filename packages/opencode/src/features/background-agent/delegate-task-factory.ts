import type { ToolDefinition } from "../../plugin/sdk"
import { tool } from "../../plugin/sdk"
import { BackgroundManager } from "./"

/**
 * Delegate-task tool with BackgroundManager integration
 * Supports both synchronous and asynchronous (background) execution
 */
export function createDelegateTask(
  client: any,
  backgroundManager: BackgroundManager
): ToolDefinition {
  return tool({
    description: `Delegate a task to a specialized agent or category.

Use this to:
- Delegate complex tasks to specialist agents
- Run tasks in parallel (background execution)
- Leverage category-specific expertise

Available agents:
- manon-explorer: Code search and analysis
- librarian: Documentation and reference search
- sisyphus-junior: General task execution

Categories:
- quick: Fast, simple tasks
- research: Deep investigation
- implementation: Code changes`,

    args: {
      description: tool.schema.string().describe("Short task description (3-5 words)"),
      instruction: tool.schema.string().describe("Detailed task instruction with context"),
      agent: tool.schema.string().optional().describe("Specific agent name (optional)"),
      category: tool.schema.string().optional().describe("Task category (optional)"),
      run_in_background: tool.schema.boolean().optional().describe("Run asynchronously in background"),
    },

    execute: async (args, context) => {
      const {
        description,
        instruction,
        agent = "sisyphus-junior",
        category,
        run_in_background = false,
      } = args

      try {
        if (run_in_background) {
          // Background execution via BackgroundManager
          const task = await backgroundManager.launch({
            description,
            prompt: instruction,
            agent,
            category,
            parentSessionID: context.sessionID,
            parentMessageID: context.messageID || "unknown",
          })

          return `⏳ Task delegated to ${agent} (background)

Task ID: ${task.id}
Description: ${description}
Status: ${task.status}
${category ? `Category: ${category}` : ""}

The task is running in the background. You will be notified when it completes.`
        }

        // Synchronous execution
        const result = await client.session.prompt({
          sessionID: context.sessionID,
          prompt: instruction,
          agent,
        })

        return `✅ Task completed by ${agent}

Task: ${description}
Result: ${result?.data?.content || "Task executed successfully"}`

      } catch (error: any) {
        return `❌ Task delegation failed

Task: ${description}
Agent: ${agent}
Error: ${error.message || "Unknown error"}

Please try again or use a different agent.`
      }
    },
  })
}
