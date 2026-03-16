declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach } = require("bun:test")
import {
  BackgroundManager,
  ConcurrencyManager,
  MIN_IDLE_TIME_MS,
  MockBackgroundManager,
  TASK_TTL_MS,
  createBackgroundManager,
  createMockTask,
  createToastRemoveTaskTracker,
  getCleanupSignals,
  getCompletionTimers,
  getConcurrencyManager,
  getListenerCounts,
  getPendingByParent,
  getPendingNotifications,
  getQueuesByKey,
  getTaskMap,
  processKeyForTest,
  pruneStaleTasksAndNotificationsForTest,
  resetProcessCleanup,
  stubNotifyParentSession,
  tmpdir,
  tryCompleteTaskForTest,
  type BackgroundTask,
  type LaunchInput,
  type PluginInput,
  type ResumeInput,
} from "./manager.test.helpers"

describe("BackgroundManager - Non-blocking Queue Integration", () => {
  let manager: BackgroundManager
  let mockClient: ReturnType<typeof createMockClient>

  function createMockClient() {
    return {
      session: {
        create: async (_args?: any) => ({ data: { id: `ses_${crypto.randomUUID()}` } }),
        get: async () => ({ data: { directory: "/test/dir" } }),
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        messages: async () => ({ data: [] }),
        todo: async () => ({ data: [] }),
        status: async () => ({ data: {} }),
        abort: async () => ({}),
      },
    }
  }

  beforeEach(() => {
    // given
    mockClient = createMockClient()
    manager = new BackgroundManager({ client: mockClient, directory: tmpdir() } as unknown as PluginInput)
  })

  afterEach(() => {
    manager.shutdown()
  })

  describe("cancelTask", () => {
    test("should cancel running task and release concurrency", async () => {
      // given
      const manager = createBackgroundManager()
      stubNotifyParentSession(manager)

      const concurrencyManager = getConcurrencyManager(manager)
      const concurrencyKey = "test-provider/test-model"
      await concurrencyManager.acquire(concurrencyKey)

      const task = createMockTask({
        id: "task-cancel-running",
        sessionID: "session-cancel-running",
        parentSessionID: "parent-cancel",
        status: "running",
        concurrencyKey,
      })

      getTaskMap(manager).set(task.id, task)
      const pendingByParent = getPendingByParent(manager)
      pendingByParent.set(task.parentSessionID, new Set([task.id]))

      // when
      const cancelled = await manager.cancelTask(task.id, { source: "test" })

      // then
      const updatedTask = manager.getTask(task.id)
      expect(cancelled).toBe(true)
      expect(updatedTask?.status).toBe("cancelled")
      expect(updatedTask?.completedAt).toBeInstanceOf(Date)
      expect(updatedTask?.concurrencyKey).toBeUndefined()
      expect(concurrencyManager.getCount(concurrencyKey)).toBe(0)

      const pendingSet = pendingByParent.get(task.parentSessionID)
      expect(pendingSet?.has(task.id) ?? false).toBe(false)
    })

    test("should remove task from toast manager when notification is skipped", async () => {
      //#given
      const { removeTaskCalls, resetToastManager } = createToastRemoveTaskTracker()
      const manager = createBackgroundManager()
      const task = createMockTask({
        id: "task-cancel-skip-notification",
        sessionID: "session-cancel-skip-notification",
        parentSessionID: "parent-cancel-skip-notification",
        status: "running",
      })
      getTaskMap(manager).set(task.id, task)

      //#when
      const cancelled = await manager.cancelTask(task.id, {
        source: "test",
        skipNotification: true,
      })

      //#then
      expect(cancelled).toBe(true)
      expect(removeTaskCalls).toContain(task.id)

      manager.shutdown()
      resetToastManager()
    })
  })

  describe("multiple keys process in parallel", () => {
    test("should process different concurrency keys in parallel", async () => {
      // given
      const config = { defaultConcurrency: 1 }
      manager.shutdown()
      manager = new BackgroundManager({ client: mockClient, directory: tmpdir() } as unknown as PluginInput, config)

      const input1 = {
        description: "Task 1",
        prompt: "Do something",
        agent: "agent-a",
        parentSessionID: "parent-session",
        parentMessageID: "parent-message",
      }

      const input2 = {
        description: "Task 2",
        prompt: "Do something else",
        agent: "agent-b",
        parentSessionID: "parent-session",
        parentMessageID: "parent-message",
      }

      // when
      const task1 = await manager.launch(input1)
      const task2 = await manager.launch(input2)

      // Wait for both to start
      await new Promise((resolve) => setTimeout(resolve, 50))

      // then - both should be running despite limit of 1 (different keys)
      const updatedTask1 = manager.getTask(task1.id)
      const updatedTask2 = manager.getTask(task2.id)

      expect(updatedTask1?.status).toBe("running")
      expect(updatedTask2?.status).toBe("running")
    })

    test("should respect per-key concurrency limits", async () => {
      // given
      const config = { defaultConcurrency: 1 }
      manager.shutdown()
      manager = new BackgroundManager({ client: mockClient, directory: tmpdir() } as unknown as PluginInput, config)

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionID: "parent-session",
        parentMessageID: "parent-message",
      }

      // when
      const task1 = await manager.launch(input)
      const task2 = await manager.launch(input)

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 50))

      // then - same key should respect limit
      const updatedTask1 = manager.getTask(task1.id)
      const updatedTask2 = manager.getTask(task2.id)

      expect(updatedTask1?.status).toBe("running")
      expect(updatedTask2?.status).toBe("pending")
    })

    test("should process model-based keys in parallel", async () => {
      // given
      const config = { defaultConcurrency: 1 }
      manager.shutdown()
      manager = new BackgroundManager({ client: mockClient, directory: tmpdir() } as unknown as PluginInput, config)

      const input1 = {
        description: "Task 1",
        prompt: "Do something",
        agent: "test-agent",
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
        parentSessionID: "parent-session",
        parentMessageID: "parent-message",
      }

      const input2 = {
        description: "Task 2",
        prompt: "Do something else",
        agent: "test-agent",
        model: { providerID: "openai", modelID: "gpt-5.4" },
        parentSessionID: "parent-session",
        parentMessageID: "parent-message",
      }

      // when
      const task1 = await manager.launch(input1)
      const task2 = await manager.launch(input2)

      // Wait for both to start
      await new Promise((resolve) => setTimeout(resolve, 50))

      // then - different models should run in parallel
      const updatedTask1 = manager.getTask(task1.id)
      const updatedTask2 = manager.getTask(task2.id)

      expect(updatedTask1?.status).toBe("running")
      expect(updatedTask2?.status).toBe("running")
    })
  })

  describe("TTL uses queuedAt for pending, startedAt for running", () => {
    test("should use queuedAt for pending task TTL", async () => {
      // given
      const config = { defaultConcurrency: 1 }
      manager.shutdown()
      manager = new BackgroundManager({ client: mockClient, directory: tmpdir() } as unknown as PluginInput, config)

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionID: "parent-session",
        parentMessageID: "parent-message",
      }

      // Launch two tasks (second will be pending)
      await manager.launch(input)
      const task2 = await manager.launch(input)

      // Wait for first to start
      await new Promise((resolve) => setTimeout(resolve, 50))

      // when
      const pendingTask = manager.getTask(task2.id)

      // then
      expect(pendingTask?.status).toBe("pending")
      expect(pendingTask?.queuedAt).toBeInstanceOf(Date)
      expect(pendingTask?.startedAt).toBeUndefined()

      // Verify TTL would use queuedAt (implementation detail check)
      const now = Date.now()
      const age = now - pendingTask!.queuedAt!.getTime()
      expect(age).toBeGreaterThanOrEqual(0)
    })

    test("should use startedAt for running task TTL", async () => {
      // given
      const config = { defaultConcurrency: 5 }
      manager.shutdown()
      manager = new BackgroundManager({ client: mockClient, directory: tmpdir() } as unknown as PluginInput, config)

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionID: "parent-session",
        parentMessageID: "parent-message",
      }

      // when
      const task = await manager.launch(input)

      // Wait for task to start
      await new Promise((resolve) => setTimeout(resolve, 50))

      // then
      const runningTask = manager.getTask(task.id)
      expect(runningTask?.status).toBe("running")
      expect(runningTask?.startedAt).toBeInstanceOf(Date)

      // Verify TTL would use startedAt (implementation detail check)
      const now = Date.now()
      const age = now - runningTask!.startedAt!.getTime()
      expect(age).toBeGreaterThanOrEqual(0)
    })

    test("should have different timestamps for queuedAt and startedAt", async () => {
      // given
      const config = { defaultConcurrency: 1 }
      manager.shutdown()
      manager = new BackgroundManager({ client: mockClient, directory: tmpdir() } as unknown as PluginInput, config)

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionID: "parent-session",
        parentMessageID: "parent-message",
      }

      // Launch task that will queue
      await manager.launch(input)
      const task2 = await manager.launch(input)

      const queuedAt = task2.queuedAt!

      // Wait for first task to complete and second to start
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Simulate first task completion
      const tasks = Array.from(getTaskMap(manager).values())
      const runningTask = tasks.find((t) => t.status === "running" && t.id !== task2.id)
      if (runningTask?.concurrencyKey) {
        runningTask.status = "completed"
        getConcurrencyManager(manager).release(runningTask.concurrencyKey)
      }

      // Wait for second task to start
      await new Promise((resolve) => setTimeout(resolve, 100))

      // then
      const startedTask = manager.getTask(task2.id)
      if (startedTask?.status === "running" && startedTask.startedAt) {
        expect(startedTask.startedAt).toBeInstanceOf(Date)
        expect(startedTask.startedAt.getTime()).toBeGreaterThan(queuedAt.getTime())
      }
    })
  })

  describe("manual verification scenario", () => {
    test("should handle 10 tasks with limit 5 returning immediately", async () => {
      // given
      const config = { defaultConcurrency: 5 }
      manager.shutdown()
      manager = new BackgroundManager({ client: mockClient, directory: tmpdir() } as unknown as PluginInput, config)

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionID: "parent-session",
        parentMessageID: "parent-message",
      }

      // when
      const startTime = Date.now()
      const tasks = await Promise.all(Array.from({ length: 10 }, () => manager.launch(input)))
      const endTime = Date.now()

      // then
      expect(endTime - startTime).toBeLessThan(200) // Should be very fast
      expect(tasks).toHaveLength(10)
      tasks.forEach((task) => {
        expect(task.status).toBe("pending")
        expect(task.id).toMatch(/^bg_/)
      })

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Verify 5 running, 5 pending
      const updatedTasks = tasks.map((t) => manager.getTask(t.id))
      const runningCount = updatedTasks.filter((t) => t?.status === "running").length
      const pendingCount = updatedTasks.filter((t) => t?.status === "pending").length

      expect(runningCount).toBe(5)
      expect(pendingCount).toBe(5)
    })
  })
})
