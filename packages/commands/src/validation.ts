import validate from './command.validator.mjs';
import type { ProjectCommand } from './project.js';

export function assertProjectCommand(input: unknown): ProjectCommand {
  if (!validate(input)) {
    throw new TypeError(`Invalid command: ${validate.errors?.map(error => `${error.instancePath} ${error.message}`).join('; ')}`);
  }
  return input as ProjectCommand;
}
