export function isNonInteractive(): boolean {
  if (process.env.CI === "true" || process.env.CI === "1") {
    return true
  }

  if (process.env.YC_RUN === "true" || process.env.YC_NON_INTERACTIVE === "true") {
    return true
  }

  if (process.env.GITHUB_ACTIONS === "true") {
    return true
  }

  if (process.stdout.isTTY !== true) {
    return true
  }

  return false
}
