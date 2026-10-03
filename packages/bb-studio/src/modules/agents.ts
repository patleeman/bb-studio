import type { BbPluginApi, PluginAgentConfiguration, PluginAgentConfigurationContext } from "@get-bb/plugin-sdk";

type Configure = (context: PluginAgentConfigurationContext) => PluginAgentConfiguration;
/** BB exposes one configure callback; modules retain independent selections. */
export class ModuleAgents {
  private readonly groups: { tools: string[]; skills: string[]; configure?: Configure }[] = [];
  constructor(private readonly host: BbPluginApi["agents"]) {}

  scope(skills: string[] = []): BbPluginApi["agents"] {
    const group: { tools: string[]; skills: string[]; configure?: Configure } = { tools: [], skills };
    this.groups.push(group);
    return { ...this.host,
      registerTool: ((tool: Parameters<BbPluginApi["agents"]["registerTool"]>[0]) => { group.tools.push(tool.name); this.host.registerTool(tool as never); }) as BbPluginApi["agents"]["registerTool"],
      configure: configure => {
        if (group.configure) throw new Error("Module agent configuration already registered");
        group.configure = configure;
      },
    };
  }

  register(): void {
    this.host.configure(context => {
      const selections = this.groups.map(group => group.configure ? group.configure(context) : { tools: group.tools, skills: group.skills });
      return {
        tools: selections.flatMap(selection => selection.tools),
        skills: [...new Set(selections.flatMap(selection => selection.skills))],
        instructions: selections.map(selection => selection.instructions).filter(Boolean).join("\n\n"),
      };
    });
  }
}
