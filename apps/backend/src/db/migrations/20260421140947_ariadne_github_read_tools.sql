-- Grant Ariadne read-only access to workspace GitHub integration via new tool set.
-- Scope: list/read repos, branches, commits, pull requests, file contents, code search,
-- workflow runs (CI), releases, and issues. All writes (creating PRs, merging, commenting,
-- pushing, etc.) remain unavailable.
UPDATE personas
SET enabled_tools = ARRAY[
  'send_message',
  'web_search',
  'read_url',
  'github_list_repos',
  'github_list_branches',
  'github_list_commits',
  'github_get_commit',
  'github_list_pull_requests',
  'github_get_pull_request',
  'github_list_pr_files',
  'github_get_file_contents',
  'github_search_code',
  'github_list_workflow_runs',
  'github_get_workflow_run',
  'github_list_releases',
  'github_get_release',
  'github_search_issues',
  'github_get_issue'
]
WHERE id = 'persona_system_ariadne';
