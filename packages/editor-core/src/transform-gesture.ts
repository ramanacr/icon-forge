import { ProjectDispatcher } from '@iconforge/application';
import type { ProjectCommand } from '@iconforge/commands';
import { quantizeMatrix, type MatrixV1, type UUID } from '@iconforge/project-model';

type TransformCommand = Extract<ProjectCommand, { type: 'selection.transform' }>;
export type TransformGestureRequest = Pick<TransformCommand,
  'commandVersion' | 'commandId' | 'projectId' | 'issuedAt' | 'actor'> & {
  iconId: UUID;
  nodeIds: UUID[];
};
export interface TransformPreview {
  iconId: UUID;
  nodeIds: UUID[];
  matrix: MatrixV1;
  revision: number;
}

const IDENTITY: MatrixV1 = [1, 0, 0, 1, 0, 0];

/** Ephemeral drag state. Only commit dispatches a journaled command. */
export class TransformGesture {
  private matrix: MatrixV1 = [...IDENTITY];
  private active = true;
  private readonly command: TransformCommand;

  constructor(private readonly dispatcher: ProjectDispatcher, request: TransformGestureRequest) {
    const input = structuredClone(request);
    this.command = { commandVersion: input.commandVersion, commandId: input.commandId,
      projectId: input.projectId, issuedAt: input.issuedAt, actor: input.actor,
      type: 'selection.transform', expectedRevision: dispatcher.revision,
      payload: { iconId: input.iconId, nodeIds: input.nodeIds, matrix: [...IDENTITY] } };
    dispatcher.dispatch({ ...this.command, dryRun: true });
  }

  get preview(): TransformPreview {
    return { iconId: this.command.payload.iconId, nodeIds: [...this.command.payload.nodeIds],
      matrix: [...this.matrix], revision: this.command.expectedRevision! };
  }

  update(matrix: MatrixV1): TransformPreview {
    if (!this.active) throw new TypeError('gesture.finished');
    if (matrix.length !== 6 || matrix.some(value => !Number.isFinite(value))) throw new TypeError('gesture.matrix.invalid');
    const normalized = quantizeMatrix(matrix);
    if (matrix.some((value, index) => value !== normalized[index])) throw new TypeError('gesture.matrix.invalid');
    this.matrix = [...matrix];
    return this.preview;
  }

  cancel(): void {
    if (!this.active) throw new TypeError('gesture.finished');
    this.active = false;
  }

  commit(): ReturnType<ProjectDispatcher['dispatch']> | null {
    if (!this.active) throw new TypeError('gesture.finished');
    this.active = false;
    if (this.matrix.every((value, index) => value === IDENTITY[index])) return null;
    return this.dispatcher.dispatch({ ...this.command,
      payload: { ...this.command.payload, matrix: [...this.matrix] } });
  }
}
