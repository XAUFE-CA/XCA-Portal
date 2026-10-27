import { defaultTranslator, type Translator } from "../../../i18n";
import type { CommandDefinition } from "./types";

export class CommandRegistry {
  constructor(private t: Translator = defaultTranslator) {}
  private commands = new Map<string, CommandDefinition>();
  private lookup = new Map<string, string>();
  register(command: CommandDefinition): void {
    const names = [command.name, ...(command.aliases ?? [])];
    if (new Set(names).size !== names.length)
      throw new Error(this.t("error.duplicateAlias", { name: command.name }));
    for (const name of names) {
      if (!/^[a-z][a-z0-9-]*$/.test(name) || this.lookup.has(name)) {
        throw new Error(this.t("error.invalidCommand", { name }));
      }
    }
    this.commands.set(command.name, command);
    for (const name of names) this.lookup.set(name, command.name);
  }
  resolve(name: string): CommandDefinition | undefined {
    return this.commands.get(this.lookup.get(name.toLowerCase()) ?? "");
  }
  list(): CommandDefinition[] {
    return [...this.commands.values()];
  }
  complete(prefix: string): string[] {
    return [...this.lookup.keys()].filter((name) => name.startsWith(prefix.toLowerCase())).sort();
  }
}
