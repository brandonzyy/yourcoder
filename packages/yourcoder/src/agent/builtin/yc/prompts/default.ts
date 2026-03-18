/**
 * Shared utilities used by the Yc prompt system.
 */

export function buildTaskManagementSection(useTaskSystem: boolean): string {
  const tool = useTaskSystem ? "TaskCreate/TaskUpdate" : "todowrite";
  return `Multi-step (2+) → ${tool} atomic steps FIRST. Mark in_progress (one at a time) → completed immediately. Never batch.`;
}
