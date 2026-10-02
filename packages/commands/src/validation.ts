import validate from './command.validator.mjs';
import type { CommandEnvelopeV1 } from './project.js';

export function assertCommandEnvelope(input: unknown): CommandEnvelopeV1 {
  if (!validate(input)) {
    throw new TypeError(`Invalid command: ${validate.errors?.map(error => `${error.instancePath} ${error.message}`).join('; ')}`);
  }
  return input as CommandEnvelopeV1;
}
