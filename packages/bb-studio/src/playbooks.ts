import type Database from "better-sqlite3";
import { fillTemplate } from "@bb-studio/kit/contract";

export interface Playbook {
  id: string;
  name: string;
  description: string;
  pages: { title: string; markdown: string }[];
  tasks: { title: string; description: string; assignee?: string; handoffPrompt?: string }[];
}

export const BUILTIN_PLAYBOOKS: Playbook[] = [
  { id: "launch-review", name: "Launch review", description: "Plan, review, and approve a launch.", pages: [
    { title: "{{name}} launch brief", markdown: "# {{name}} launch brief\n\n## Goal\n\n## Audience\n\n## Risks\n\n## Decision\n" },
  ], tasks: [
    { title: "Review {{name}} launch brief", description: "Check the goal, audience, risks, and decision.", handoffPrompt: "Review this launch brief and report gaps." },
    { title: "Approve {{name}} launch", description: "Record the final launch decision." },
  ] },
  { id: "bug-triage", name: "Bug triage", description: "Capture evidence and move a fix through review.", pages: [
    { title: "{{name}} incident notes", markdown: "# {{name}} incident notes\n\n## Symptoms\n\n## Reproduction\n\n## Root cause\n\n## Resolution\n" },
  ], tasks: [
    { title: "Reproduce {{name}}", description: "Record steps and expected behavior." },
    { title: "Fix and verify {{name}}", description: "Implement a fix and verify the reproduction.", handoffPrompt: "Investigate and fix the issue described in the incident notes." },
  ] },
  { id: "weekly-review", name: "Weekly review", description: "Collect wins, blockers, and next actions.", pages: [
    { title: "{{name}} weekly review", markdown: "# {{name}} weekly review\n\n## Wins\n\n## Blockers\n\n## Next week\n" },
  ], tasks: [{ title: "Review {{name}} priorities", description: "Choose the next actions from the weekly review." }] },
];

export class PlaybookStore {
  constructor(private readonly db: Database.Database) {}

  list(): Playbook[] {
    const saved = this.db.prepare("SELECT data FROM studio_playbooks ORDER BY name").all() as { data: string }[];
    return [...BUILTIN_PLAYBOOKS, ...saved.map((row) => JSON.parse(row.data) as Playbook)];
  }

  get(id: string): Playbook | null { return this.list().find((playbook) => playbook.id === id) ?? null; }

  save(playbook: Playbook): void {
    if (BUILTIN_PLAYBOOKS.some((item) => item.id === playbook.id)) throw new Error("Built-in playbooks cannot be changed.");
    this.db.prepare("INSERT INTO studio_playbooks (id, name, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data")
      .run(playbook.id, playbook.name, JSON.stringify(playbook));
  }

  remove(id: string): void {
    if (BUILTIN_PLAYBOOKS.some((item) => item.id === id)) throw new Error("Built-in playbooks cannot be removed.");
    this.db.prepare("DELETE FROM studio_playbooks WHERE id = ?").run(id);
  }
}

export function renderPlaybook(playbook: Playbook, variables: Record<string, string>): Playbook {
  return {
    ...playbook,
    name: fillTemplate(playbook.name, variables),
    pages: playbook.pages.map((page) => ({ title: fillTemplate(page.title, variables), markdown: fillTemplate(page.markdown, variables) })),
    tasks: playbook.tasks.map((task) => ({ ...task, title: fillTemplate(task.title, variables), description: fillTemplate(task.description, variables),
      handoffPrompt: task.handoffPrompt && fillTemplate(task.handoffPrompt, variables) })),
  };
}
