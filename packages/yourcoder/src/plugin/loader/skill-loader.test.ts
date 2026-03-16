import { afterEach, describe, expect, it } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadPluginSkillsAsCommands } from "./skill-loader"

const dirs: string[] = []

function dir() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-skill-"))
  dirs.push(value)
  return value
}

afterEach(() => {
  for (const value of dirs.splice(0)) {
    fs.rmSync(value, { recursive: true, force: true })
  }
})

describe("loadPluginSkillsAsCommands", () => {
  it("loads plugin skills and resolves @path references", () => {
    const root = dir()
    const skills = path.join(root, "skills")
    const skill = path.join(skills, "diagnose")
    fs.mkdirSync(path.join(skill, "scripts"), { recursive: true })
    fs.writeFileSync(path.join(skill, "scripts", "fix.sh"), "echo fix")
    fs.writeFileSync(
      path.join(skill, "SKILL.md"),
      [
        "---",
        "name: Diagnose",
        "description: Debug the issue",
        "model: claude-sonnet",
        "---",
        "",
        "Inspect @scripts/fix.sh before acting.",
      ].join("\n"),
    )

    expect(
      loadPluginSkillsAsCommands([
        {
          name: "demo",
          version: "1.0.0",
          scope: "user",
          installPath: root,
          pluginKey: "demo@local",
          skillsDir: skills,
        },
      ]),
    ).toEqual({
      "demo:Diagnose": {
        name: "demo:Diagnose",
        description: "(plugin: demo - Skill) Debug the issue",
        template: `<skill-instruction>\nBase directory for this skill: ${skill}/\nFile references (@path) in this skill are relative to this directory.\n\nInspect ${skill.replaceAll("\\", "/")}/scripts/fix.sh before acting.\n</skill-instruction>\n\n<user-request>\n$ARGUMENTS\n</user-request>`,
        model: undefined,
      },
    })
  })
})
