import type { CommandDefinition } from "../core/types";
import { fileCommands } from "./files/navigation";
import { lessCommand } from "./files/pager";
import { searchCommands } from "./files/search";
import { textCommands } from "./files/text";
import { authCommands } from "./session/auth";
import { sessionCommands } from "./session/commands";
import { xcaCommand } from "./site";
import { systemCommands } from "./system";

export const terminalCommands: CommandDefinition[] = [
  ...sessionCommands,
  ...fileCommands,
  ...textCommands,
  ...searchCommands,
  ...systemCommands,
  lessCommand,
  ...authCommands,
  xcaCommand,
];
