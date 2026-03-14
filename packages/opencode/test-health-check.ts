#!/usr/bin/env bun
/**
 * Manual test script for subagent-health-check hook
 *
 * This script simulates a session.created event and verifies
 * that the hook correctly injects the health check reminder.
 */

import { createSubagentHealthCheckHook } from "./src/hooks/subagent-health-check/hook.js"

console.log("🧪 Testing subagent-health-check hook...\n")

// Mock PluginInput
const mockCtx = {
  directory: "/test/project",
  client: {},
} as any

// Test 1: Hook creation
console.log("Test 1: Creating hook with default config...")
const hook = createSubagentHealthCheckHook(mockCtx, {
  enabled: true,
  timeout: 10000,
})

if (!hook) {
  console.error("❌ Failed: Hook is null")
  process.exit(1)
}
console.log("✅ Hook created successfully\n")

// Test 2: Session created event (main session)
console.log("Test 2: Triggering session.created for main session...")
const result = await hook["session.created"]({
  event: {
    type: "session.created",
    properties: {
      info: {
        id: "test-main-session-123",
        parentID: undefined,
      },
    },
  },
})

if (!result || !result.systemReminder) {
  console.error("❌ Failed: No system reminder returned")
  process.exit(1)
}

console.log("✅ System reminder injected\n")
console.log("📋 Reminder content:")
console.log("─".repeat(80))
console.log(result.systemReminder)
console.log("─".repeat(80))
console.log()

// Test 3: Verify reminder content
console.log("Test 3: Verifying reminder content...")
const checks = [
  { name: "Contains health check header", test: result.systemReminder.includes("[STARTUP HEALTH CHECK]") },
  { name: "Mentions manon-explorer", test: result.systemReminder.includes("manon-explorer") },
  { name: "Mentions librarian", test: result.systemReminder.includes("librarian") },
  { name: "Mentions sisyphus-junior", test: result.systemReminder.includes("sisyphus-junior") },
  { name: "Includes timeout", test: result.systemReminder.includes("10000ms") },
  { name: "Includes parallel instruction", test: result.systemReminder.includes("run_in_background=true") },
]

let allPassed = true
for (const check of checks) {
  if (check.test) {
    console.log(`  ✅ ${check.name}`)
  } else {
    console.log(`  ❌ ${check.name}`)
    allPassed = false
  }
}

if (!allPassed) {
  console.error("\n❌ Some content checks failed")
  process.exit(1)
}

console.log("\n✅ All content checks passed\n")

// Test 4: Subagent session (should not trigger)
console.log("Test 4: Testing subagent session (should not trigger)...")
const subagentResult = await hook["session.created"]({
  event: {
    type: "session.created",
    properties: {
      info: {
        id: "test-subagent-session-456",
        parentID: "test-main-session-123",
      },
    },
  },
})

if (subagentResult) {
  console.error("❌ Failed: Subagent session should not trigger health check")
  process.exit(1)
}
console.log("✅ Subagent session correctly ignored\n")

// Test 5: Duplicate check (should not trigger twice)
console.log("Test 5: Testing duplicate check prevention...")
const duplicateResult = await hook["session.created"]({
  event: {
    type: "session.created",
    properties: {
      info: {
        id: "test-main-session-123",
        parentID: undefined,
      },
    },
  },
})

if (duplicateResult) {
  console.error("❌ Failed: Duplicate check should not trigger")
  process.exit(1)
}
console.log("✅ Duplicate check correctly prevented\n")

console.log("🎉 All tests passed!")
console.log("\n✨ The subagent-health-check hook is working correctly!")
