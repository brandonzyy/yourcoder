import z from "zod"
import { Tool } from "./tool"

interface QueryPlan {
  mainQuery: string
  subQueries: string[]
  mustTerms: string[]
  shouldTerms: string[]
  excludeTerms: string[]
  preferredSources: string[]
  searchMode: "broad" | "precise" | "recent"
  reasoning: string
}

const CURRENT_YEAR = new Date().getFullYear()

export const QueryPlannerTool = Tool.define("query_planner", {
  description: "Query planning - decomposes user questions into executable search plans with main/sub queries, term filters, and source preferences. Pure code logic.",
  parameters: z.object({
    question: z.string().describe("User's original question"),
    goal: z.string().describe("Search goal from main agent"),
    constraints: z.string().optional().describe("Constraints (e.g., 'official docs only', 'recent 2026')"),
  }),
  async execute(params) {
    const plan = planQuery(params.question, params.goal, params.constraints)

    const output = [
      "# Query Plan\n",
      `**Main Query**: ${plan.mainQuery}`,
      "",
      "**Sub Queries**:",
      ...plan.subQueries.map((q, i) => `${i + 1}. ${q}`),
      "",
      `**Must Terms**: ${plan.mustTerms.join(", ") || "None"}`,
      `**Should Terms**: ${plan.shouldTerms.join(", ") || "None"}`,
      `**Exclude Terms**: ${plan.excludeTerms.join(", ") || "None"}`,
      "",
      `**Preferred Sources**: ${plan.preferredSources.join(", ") || "Any"}`,
      `**Search Mode**: ${plan.searchMode}`,
      "",
      `**Reasoning**: ${plan.reasoning}`,
    ].join("\n")

    return {
      title: `Query plan for: ${params.question.slice(0, 50)}`,
      output,
      metadata: { plan },
    }
  },
})

function planQuery(question: string, goal: string, constraints?: string): QueryPlan {
  const lower = question.toLowerCase()
  const plan: QueryPlan = {
    mainQuery: "",
    subQueries: [],
    mustTerms: [],
    shouldTerms: [],
    excludeTerms: [],
    preferredSources: [],
    searchMode: "broad",
    reasoning: "",
  }

  // Extract key terms
  const terms = extractTerms(question)
  
  // Detect intent
  const intent = detectIntent(lower, goal)
  
  // Build main query
  plan.mainQuery = buildMainQuery(terms, intent)
  
  // Generate sub queries
  plan.subQueries = generateSubQueries(terms, intent)
  
  // Extract filters
  const filters = extractFilters(lower, constraints)
  plan.mustTerms = filters.must
  plan.shouldTerms = filters.should
  plan.excludeTerms = filters.exclude
  
  // Determine preferred sources
  plan.preferredSources = determinePreferredSources(intent, lower)
  
  // Set search mode
  plan.searchMode = determineSearchMode(intent, lower)
  
  // Generate reasoning
  plan.reasoning = generateReasoning(intent, plan)

  return plan
}

function extractTerms(question: string): string[] {
  const stopWords = new Set(["what", "how", "why", "when", "where", "is", "are", "the", "a", "an", "in", "on", "at", "to", "for", "of", "with"])
  return question
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
}

function detectIntent(lower: string, goal: string): string {
  if (lower.includes("latest") || lower.includes("new") || lower.includes("recent") || lower.includes(CURRENT_YEAR.toString())) {
    return "version"
  }
  if (lower.includes("how to") || lower.includes("tutorial") || lower.includes("guide")) {
    return "tutorial"
  }
  if (lower.includes("vs") || lower.includes("compare") || lower.includes("difference")) {
    return "comparison"
  }
  if (lower.includes("error") || lower.includes("fix") || lower.includes("problem")) {
    return "troubleshooting"
  }
  if (lower.includes("docs") || lower.includes("documentation") || lower.includes("api")) {
    return "docs"
  }
  if (lower.includes("example") || lower.includes("code")) {
    return "implementation"
  }
  return "general"
}

function buildMainQuery(terms: string[], intent: string): string {
  let query = terms.join(" ")
  
  if (intent === "version") {
    query += ` ${CURRENT_YEAR}`
  }
  if (intent === "tutorial") {
    query += " tutorial guide"
  }
  if (intent === "docs") {
    query += " documentation"
  }
  
  return query
}

function generateSubQueries(terms: string[], intent: string): string[] {
  const main = terms.join(" ")
  const queries: string[] = []
  
  // Broad query
  queries.push(main)
  
  // Specific query with intent
  if (intent === "version") {
    queries.push(`${main} ${CURRENT_YEAR} release`)
    queries.push(`${main} latest version`)
  } else if (intent === "tutorial") {
    queries.push(`${main} getting started`)
    queries.push(`${main} quickstart`)
  } else if (intent === "docs") {
    queries.push(`${main} official documentation`)
    queries.push(`${main} API reference`)
  } else if (intent === "implementation") {
    queries.push(`${main} code example`)
    queries.push(`${main} github`)
  }
  
  // Site-specific query
  if (terms.length > 0) {
    queries.push(`site:github.com ${main}`)
  }
  
  return queries.slice(0, 3)
}

function extractFilters(lower: string, constraints?: string): { must: string[], should: string[], exclude: string[] } {
  const must: string[] = []
  const should: string[] = []
  const exclude: string[] = []
  
  // Extract year constraints
  const yearMatch = lower.match(/\b(20\d{2})\b/)
  if (yearMatch) {
    must.push(yearMatch[1])
  }
  
  // Extract "only" constraints
  if (lower.includes("official only") || constraints?.includes("official")) {
    should.push("official", "documentation")
  }
  
  // Extract exclusions
  if (lower.includes("not") || lower.includes("exclude")) {
    const notMatch = lower.match(/not\s+(\w+)/i)
    if (notMatch) exclude.push(notMatch[1])
  }
  
  return { must, should, exclude }
}

function determinePreferredSources(intent: string, lower: string): string[] {
  const sources: string[] = []
  
  if (intent === "docs") {
    sources.push("docs.", "developer.", "api.")
  }
  if (intent === "implementation") {
    sources.push("github.com", "stackoverflow.com")
  }
  if (intent === "tutorial") {
    sources.push("dev.to", "medium.com", "freecodecamp.org")
  }
  if (lower.includes("official")) {
    sources.push("docs.", "github.com")
  }
  
  return sources
}

function determineSearchMode(intent: string, lower: string): "broad" | "precise" | "recent" {
  if (intent === "version" || lower.includes("latest") || lower.includes(CURRENT_YEAR.toString())) {
    return "recent"
  }
  if (intent === "docs" || intent === "implementation") {
    return "precise"
  }
  return "broad"
}

function generateReasoning(intent: string, plan: QueryPlan): string {
  const parts: string[] = []
  
  parts.push(`Detected intent: ${intent}`)
  
  if (plan.searchMode === "recent") {
    parts.push(`Using recent mode with year ${CURRENT_YEAR}`)
  }
  
  if (plan.preferredSources.length > 0) {
    parts.push(`Prioritizing: ${plan.preferredSources.slice(0, 2).join(", ")}`)
  }
  
  if (plan.subQueries.length > 1) {
    parts.push(`Generated ${plan.subQueries.length} query variations for coverage`)
  }
  
  return parts.join(". ") + "."
}
