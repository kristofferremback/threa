export function extractWorkspaceIdFromGithubInstallState(state: string): string | null {
  const [workspaceId] = state.split(".")
  return workspaceId || null
}
