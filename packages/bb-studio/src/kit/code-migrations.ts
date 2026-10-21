export const COMMENT_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS code_comments (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, parent_id TEXT, path TEXT NOT NULL,
  start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, line_text TEXT NOT NULL,
  author TEXT NOT NULL, body TEXT NOT NULL, sent_to TEXT, sent_at INTEGER, resolved_at INTEGER,
  created_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS code_comments_workspace ON code_comments(workspace_id, created_at);`,
  // The thread whose VS Code tab last showed the workspace: where its review goes.
  `ALTER TABLE code_workspaces ADD COLUMN review_thread_id TEXT;`,
];

export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS code_workspaces (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, project_id TEXT, folders TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS code_workspaces_updated ON code_workspaces(updated_at);`,
  `ALTER TABLE code_workspaces ADD COLUMN thread_id TEXT; CREATE INDEX IF NOT EXISTS code_workspaces_thread ON code_workspaces(thread_id);`,
  // Workspaces made so far were made by the user, so they stay trusted.
  `ALTER TABLE code_workspaces ADD COLUMN trusted INTEGER NOT NULL DEFAULT 1;`,
  // Whether agents may see what the user has open in this workspace.
  `ALTER TABLE code_workspaces ADD COLUMN share INTEGER NOT NULL DEFAULT 1;`,
  // When the user last opened the workspace's editor: Code's page opens the latest.
  `ALTER TABLE code_workspaces ADD COLUMN opened_at INTEGER;`,
  // Review comments (src/server/comments.ts).
  ...COMMENT_MIGRATIONS,
];
