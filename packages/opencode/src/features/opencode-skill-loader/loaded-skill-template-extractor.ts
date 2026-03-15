import { readFileSync } from "node:fs"
import { parseFrontmatter } from "../../util/frontmatter"
import type { LoadedSkill } from "./types"

export function extractSkillTemplate(skill: LoadedSkill): string {
	if (skill.path) {
		const content = readFileSync(skill.path, "utf-8")
		const { body } = parseFrontmatter(content)
		return body.trim()
	}
	return skill.definition.template || ""
}
