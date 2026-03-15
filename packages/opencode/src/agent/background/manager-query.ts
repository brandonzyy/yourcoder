import type { LaunchInput, BackgroundTask } from "./types"

export function getTask(tasks: Map<string, BackgroundTask>, id: string): BackgroundTask | undefined {
  return tasks.get(id)
}

export function getTasksByParentSession(tasks: Map<string, BackgroundTask>, sessionID: string): BackgroundTask[] {
  return Array.from(tasks.values()).filter((task) => task.parentSessionID === sessionID)
}

export function getAllDescendantTasks(tasks: Map<string, BackgroundTask>, sessionID: string): BackgroundTask[] {
  return getTasksByParentSession(tasks, sessionID).flatMap((task) =>
    task.sessionID ? [task, ...getAllDescendantTasks(tasks, task.sessionID)] : [task],
  )
}

export function findBySession(tasks: Map<string, BackgroundTask>, sessionID: string): BackgroundTask | undefined {
  return Array.from(tasks.values()).find((task) => task.sessionID === sessionID)
}

export function getConcurrencyKeyFromInput(input: LaunchInput): string {
  if (input.model) {
    return `${input.model.providerID}/${input.model.modelID}`
  }

  return input.agent
}

export function getRunningTasks(tasks: Map<string, BackgroundTask>): BackgroundTask[] {
  return Array.from(tasks.values()).filter((task) => task.status === "running")
}

export function getNonRunningTasks(tasks: Map<string, BackgroundTask>): BackgroundTask[] {
  return Array.from(tasks.values()).filter((task) => task.status !== "running")
}

export function hasRunningTasks(tasks: Map<string, BackgroundTask>): boolean {
  return Array.from(tasks.values()).some((task) => task.status === "running")
}
