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

  describe("launch() returns immediately with pending status", () => {
    test("should return task with pending status immediately", async () => {
      // given
      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionID: "parent-session",
        parentMessageID: "parent-message",
      }

      // when
      const task = await manager.launch(input)

      // then
      expect(task.status).toBe("pending")
      expect(task.id).toMatch(/^bg_/)
      expect(task.description).toBe("Test task")
      expect(task.agent).toBe("test-agent")
      expect(task.queuedAt).toBeInstanceOf(Date)
      expect(task.startedAt).toBeUndefined()
      expect(task.sessionID).toBeUndefined()
    })

    test("should return immediately even with concurrency limit", async () => {
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
      const startTime = Date.now()
      const task1 = await manager.launch(input)
      const task2 = await manager.launch(input)
      const endTime = Date.now()

      // then
      expect(endTime - startTime).toBeLessThan(100) // Should be instant
      expect(task1.status).toBe("pending")
      expect(task2.status).toBe("pending")
    })

    test("should queue multiple tasks without blocking", async () => {
      // given
      const config = { defaultConcurrency: 2 }
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
      const tasks = await Promise.all([
        manager.launch(input),
        manager.launch(input),
        manager.launch(input),
        manager.launch(input),
        manager.launch(input),
      ])

      // then
      expect(tasks).toHaveLength(5)
      tasks.forEach((task) => {
        expect(task.status).toBe("pending")
        expect(task.queuedAt).toBeInstanceOf(Date)
      })
    })
  })

  describe("task transitions pending→running when slot available", () => {
    test("does not override parent session permission when creating child session", async () => {
      // given
      const createCalls: any[] = []
      const parentPermission = [
        { permission: "question", action: "allow" as const, pattern: "*" },
        { permission: "plan_enter", action: "deny" as const, pattern: "*" },
      ]

      const customClient = {
        session: {
          create: async (args?: any) => {
            createCalls.push(args)
            return { data: { id: `ses_${crypto.randomUUID()}` } }
          },
          get: async () => ({ data: { directory: "/test/dir", permission: parentPermission } }),
          prompt: async () => ({}),
          promptAsync: async () => ({}),
          messages: async () => ({ data: [] }),
          todo: async () => ({ data: [] }),
          status: async () => ({ data: {} }),
          abort: async () => ({}),
        },
      }
      manager.shutdown()
      manager = new BackgroundManager({ client: customClient, directory: tmpdir() } as unknown as PluginInput, {
        defaultConcurrency: 5,
      })

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionID: "parent-session",
        parentMessageID: "parent-message",
      }

      // when
      await manager.launch(input)
      await new Promise((resolve) => setTimeout(resolve, 50))

      // then
      expect(createCalls).toHaveLength(1)
      expect(createCalls[0]?.body?.permission).toBeUndefined()
    })

    test("should transition first task to running immediately", async () => {
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

      // Give processKey time to run
      await new Promise((resolve) => setTimeout(resolve, 50))

      // then
      const updatedTask = manager.getTask(task.id)
      expect(updatedTask?.status).toBe("running")
      expect(updatedTask?.startedAt).toBeInstanceOf(Date)
      expect(updatedTask?.sessionID).toBeDefined()
      expect(updatedTask?.sessionID).toBeTruthy()
    })

    test("should set startedAt when transitioning to running", async () => {
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
      const queuedAt = task.queuedAt

      // Wait for transition
      await new Promise((resolve) => setTimeout(resolve, 50))

      // then
      const updatedTask = manager.getTask(task.id)
      expect(updatedTask?.startedAt).toBeInstanceOf(Date)
      if (updatedTask?.startedAt && queuedAt) {
        expect(updatedTask.startedAt.getTime()).toBeGreaterThanOrEqual(queuedAt.getTime())
      }
    })
  })

  describe("pending task can be cancelled", () => {
    test("should cancel pending task successfully", async () => {
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

      const task1 = await manager.launch(input)
      const task2 = await manager.launch(input)

      // Wait for first task to start
      await new Promise((resolve) => setTimeout(resolve, 50))

      // when
      const cancelled = manager.cancelPendingTask(task2.id)

      // then
      expect(cancelled).toBe(true)
      const updatedTask2 = manager.getTask(task2.id)
      expect(updatedTask2?.status).toBe("cancelled")
      expect(updatedTask2?.completedAt).toBeInstanceOf(Date)
    })

    test("should not cancel running task", async () => {
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

      const task = await manager.launch(input)

      // Wait for task to start
      await new Promise((resolve) => setTimeout(resolve, 50))

      // when
      const cancelled = manager.cancelPendingTask(task.id)

      // then
      expect(cancelled).toBe(false)
      const updatedTask = manager.getTask(task.id)
      expect(updatedTask?.status).toBe("running")
    })

    test("should remove cancelled task from queue", async () => {
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

      const task1 = await manager.launch(input)
      const task2 = await manager.launch(input)
      const task3 = await manager.launch(input)

      // Wait for first task to start
      await new Promise((resolve) => setTimeout(resolve, 100))

      // when - cancel middle task
      const cancelledTask2 = manager.getTask(task2.id)
      expect(cancelledTask2?.status).toBe("pending")

      manager.cancelPendingTask(task2.id)

      const afterCancel = manager.getTask(task2.id)
      expect(afterCancel?.status).toBe("cancelled")

      // then - verify task3 is still pending (task1 still running)
      const task3BeforeRelease = manager.getTask(task3.id)
      expect(task3BeforeRelease?.status).toBe("pending")
    })
  })
})
