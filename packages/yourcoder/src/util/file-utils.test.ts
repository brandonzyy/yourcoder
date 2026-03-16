import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { resolveSymlink, resolveSymlinkAsync, isSymbolicLink } from "./file-utils"

const testDir = join(tmpdir(), "file-utils-test-" + Date.now())

// Create a directory structure that mimics the real-world scenario:
//
//   testDir/
//   ├── repo/
//   │   ├── skills/
//   │   │   └── category/
//   │   │       └── my-skill/
//   │   │           └── SKILL.md
//   │   └── .yourcoder/
//   │       └── skills/
//   │           └── my-skill -> ../../skills/category/my-skill  (relative symlink)
//   └── config/
//       └── skills -> ../repo/.yourcoder/skills                  (absolute symlink)

const realSkillDir = join(testDir, "repo", "skills", "category", "my-skill")
const repoYcSkills = join(testDir, "repo", ".yourcoder", "skills")
const configSkills = join(testDir, "config", "skills")
let linked = false

function link(target: string, file: string) {
	try {
		symlinkSync(target, file)
		return true
	} catch (err) {
		if (
			err &&
			typeof err === "object" &&
			"code" in err &&
			err.code === "EPERM"
		)
			return false
		throw err
	}
}

beforeAll(() => {
	// Create real skill directory with a file
	mkdirSync(realSkillDir, { recursive: true })
	writeFileSync(join(realSkillDir, "SKILL.md"), "# My Skill")

	// Create .yourcoder/skills/ with a relative symlink to the real skill
	mkdirSync(repoYcSkills, { recursive: true })
	linked = link("../../skills/category/my-skill", join(repoYcSkills, "my-skill"))
	if (!linked) return

	// Create config/skills as an absolute symlink to .yourcoder/skills
	mkdirSync(join(testDir, "config"), { recursive: true })
	linked = link(repoYcSkills, configSkills)
})

afterAll(() => {
	rmSync(testDir, { recursive: true, force: true })
})

describe("resolveSymlink", () => {
	it("resolves a regular file path to itself", () => {
		const filePath = join(realSkillDir, "SKILL.md")
		expect(resolveSymlink(filePath)).toBe(filePath)
	})

	it("resolves a relative symlink to its real path", () => {
		if (!linked) return
		const symlinkPath = join(repoYcSkills, "my-skill")
		expect(resolveSymlink(symlinkPath)).toBe(realSkillDir)
	})

	it("resolves a chained symlink (symlink-to-dir-containing-symlinks) to the real path", () => {
		if (!linked) return
		// This is the real-world scenario:
		// config/skills/my-skill -> (follows config/skills) -> repo/.yourcoder/skills/my-skill -> repo/skills/category/my-skill
		const chainedPath = join(configSkills, "my-skill")
		expect(resolveSymlink(chainedPath)).toBe(realSkillDir)
	})

	it("returns the original path for non-existent paths", () => {
		const fakePath = join(testDir, "does-not-exist")
		expect(resolveSymlink(fakePath)).toBe(fakePath)
	})
})

describe("resolveSymlinkAsync", () => {
	it("resolves a regular file path to itself", async () => {
		const filePath = join(realSkillDir, "SKILL.md")
		expect(await resolveSymlinkAsync(filePath)).toBe(filePath)
	})

	it("resolves a relative symlink to its real path", async () => {
		if (!linked) return
		const symlinkPath = join(repoYcSkills, "my-skill")
		expect(await resolveSymlinkAsync(symlinkPath)).toBe(realSkillDir)
	})

	it("resolves a chained symlink (symlink-to-dir-containing-symlinks) to the real path", async () => {
		if (!linked) return
		const chainedPath = join(configSkills, "my-skill")
		expect(await resolveSymlinkAsync(chainedPath)).toBe(realSkillDir)
	})

	it("returns the original path for non-existent paths", async () => {
		const fakePath = join(testDir, "does-not-exist")
		expect(await resolveSymlinkAsync(fakePath)).toBe(fakePath)
	})
})

describe("isSymbolicLink", () => {
	it("returns true for a symlink", () => {
		if (!linked) return
		expect(isSymbolicLink(join(repoYcSkills, "my-skill"))).toBe(true)
	})

	it("returns false for a regular directory", () => {
		expect(isSymbolicLink(realSkillDir)).toBe(false)
	})

	it("returns false for a non-existent path", () => {
		expect(isSymbolicLink(join(testDir, "does-not-exist"))).toBe(false)
	})
})
