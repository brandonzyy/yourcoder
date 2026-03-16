export interface SubagentHealthCheckConfig {
  enabled?: boolean
  timeout?: number // milliseconds
}

export interface SubagentHealthStatus {
  name: string
  status: "ready" | "error" | "timeout"
  message?: string
  duration?: number
}

export interface HealthCheckResult {
  overall: "success" | "partial" | "failed"
  agents: SubagentHealthStatus[]
  totalDuration: number
}
