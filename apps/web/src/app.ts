import { Component, ElementRef, ViewChild, signal, type OnInit, type OnDestroy } from '@angular/core';
import type { BrowserWorkspace } from './workspace.js';

@Component({
  selector: 'iconforge-root',
  template: `
    <main class="shell">
      <header class="topbar">
        <strong class="brand">IconForge</strong>
        <span class="project-name">{{ projectName() }}</span>
        <span class="status" role="status">{{ status() }}</span>
        @if (readOnly()) {
          <button type="button" (click)="runTakeOver()" [disabled]="busy()">Take over editing</button>
        }
        @if (needsRecovery()) {
          <button type="button" (click)="runRecover()" [disabled]="busy() || readOnly()">Recover valid edits</button>
        }
        <button type="button" (click)="runCreate()" [disabled]="busy()">Create project</button>
        <button type="button" (click)="runExport()" [disabled]="!hasIcon()">Export SVG</button>
      </header>
      <div class="layout">
        <aside class="sidebar" aria-label="Project assets">
          <h2>Icons</h2>
          <button type="button" (click)="runAddIcon()" [disabled]="!canEdit()">Add icon</button>
          @for (icon of icons(); track icon.id) {
            <button type="button" class="asset" [class.active]="icon.id === activeIconId()"
              (click)="chooseIcon(icon.id)">{{ icon.name }}</button>
          }
          @if (hasIcon()) {
            <h2 class="layers-heading">Layers</h2>
            @for (layer of layers(); track layer.id) {
              <button type="button" class="layer" [class.active]="layer.selected"
                [attr.aria-label]="layer.label + ' layer'" [attr.aria-pressed]="layer.selected"
                (click)="chooseLayer(layer.id, $event)" (keydown)="onLayerKeydown(layer.id, $event)">{{ layer.label }}</button>
            }
          }
        </aside>
        <section class="studio" aria-label="Icon editor">
          <div class="toolbar">
            <button type="button" (click)="runAddRectangle()" [disabled]="!canEdit() || !hasIcon()">Add rectangle</button>
            <button type="button" (click)="runAddEllipse()" [disabled]="!canEdit() || !hasIcon()">Add ellipse</button>
            <button type="button" (click)="runAddLine()" [disabled]="!canEdit() || !hasIcon()">Add line</button>
            <button type="button" (click)="runMoveRight()" [disabled]="!canEdit() || !selected()">Move right</button>
            <button type="button" (click)="runUndo()" [disabled]="!canEdit()">Undo</button>
            <button type="button" (click)="runRedo()" [disabled]="!canEdit()">Redo</button>
            <button type="button" (click)="runGroup()" [disabled]="!canEdit() || !canGroup()">Group selection</button>
            <button type="button" (click)="runUngroup()" [disabled]="!canEdit() || !canUngroup()">Ungroup selection</button>
            <button type="button" (click)="toggleGrid()" [disabled]="!hasIcon()">{{ showGrid() ? 'Hide grid' : 'Show grid' }}</button>
          </div>
          <div class="stage">
            @if (!hasIcon()) { <p class="empty">Create a project and add an icon to start drawing.</p> }
            <div #canvas class="canvas" (click)="onCanvasClick($event)"
              (pointerdown)="onPointerDown($event)" (pointermove)="onPointerMove($event)"
              (pointerup)="onPointerUp($event)" (pointercancel)="onPointerCancel($event)"
              aria-label="Icon canvas"></div>
          </div>
        </section>
        <aside class="inspector" aria-label="Selection inspector">
          <h2>Selection</h2>
          <p>{{ selected() ? 'Shape selected' : 'Select a shape on the canvas' }}</p>
          <button type="button" (click)="runAppearance('filled')" [disabled]="!canEdit() || !canStyle()">Fill shape</button>
          <button type="button" (click)="runAppearance('outline')" [disabled]="!canEdit() || !canStyle()">Outline shape</button>
          <p class="hint">24 × 24 icon grid · drag snaps to whole units</p>
        </aside>
      </div>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    </main>`,
})
export class App implements OnInit, OnDestroy {
  @ViewChild('canvas') canvas?: ElementRef<HTMLElement>;
  private workspace!: BrowserWorkspace;
  private renderIconSvg!: typeof import('@iconforge/editor-core')['renderIconSvg'];
  private dragFrame: { pointerId: number; startX: number; startY: number; scaleX: number; scaleY: number } | null = null;
  readonly busy = signal(true);
  readonly status = signal('Loading project…');
  readonly error = signal('');
  readonly projectName = signal('No project');
  readonly icons = signal<{ id: string; name: string }[]>([]);
  readonly layers = signal<{ id: string; label: string; selected: boolean }[]>([]);
  readonly activeIconId = signal<string | null>(null);
  readonly selected = signal(false);
  readonly hasIcon = signal(false);
  readonly canEdit = signal(false);
  readonly canGroup = signal(false);
  readonly canUngroup = signal(false);
  readonly canStyle = signal(false);
  readonly readOnly = signal(false);
  readonly needsRecovery = signal(false);
  readonly showGrid = signal(true);
  private readonly onFocus = (): void => {
    if (!this.workspace) return;
    void this.workspace.refreshReadonly().then(() => this.refresh()).catch(error => this.error.set(this.message(error)));
  };

  async ngOnInit(): Promise<void> {
    try {
      const [{ BrowserWorkspace }, { renderIconSvg }] = await Promise.all([
        import('./workspace.js'), import('@iconforge/editor-core'),
      ]);
      this.workspace = new BrowserWorkspace();
      this.workspace.onChanged = () => this.refresh();
      this.renderIconSvg = renderIconSvg;
      await this.workspace.openLast();
      window.addEventListener('focus', this.onFocus);
      this.busy.set(false);
      this.refresh();
    }
    catch (error) { this.error.set(this.message(error)); this.status.set('Could not open project'); }
  }

  ngOnDestroy(): void {
    window.removeEventListener('focus', this.onFocus);
    if (this.workspace) void this.workspace.close();
  }

  private message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

  private refresh(): void {
    const project = this.workspace.project;
    const icon = this.workspace.icon;
    this.projectName.set(project?.name ?? 'No project');
    this.icons.set(project?.icons.map(item => ({ id: item.id, name: item.name })) ?? []);
    this.activeIconId.set(icon?.id ?? null);
    const selectedIds = this.workspace.selection.snapshot.nodeIds;
    this.selected.set(selectedIds.length > 0);
    this.layers.set(icon?.nodes.map(node => ({ id: node.id,
      label: node.name ?? (node.type === 'rect' ? 'Rectangle' : node.type[0]!.toUpperCase() + node.type.slice(1)),
      selected: selectedIds.includes(node.id) })) ?? []);
    this.canGroup.set(selectedIds.length > 1 && selectedIds.every(id => icon?.nodes.some(node => node.id === id)));
    this.canUngroup.set(selectedIds.length === 1 && Boolean(icon?.nodes.some(node => node.id === selectedIds[0] && node.type === 'group')));
    this.canStyle.set(this.workspace.styleableSelection);
    this.hasIcon.set(Boolean(icon));
    this.readOnly.set(Boolean(project) && !this.workspace.writable);
    this.needsRecovery.set(this.workspace.needsRecovery);
    this.canEdit.set(Boolean(project) && this.workspace.writable && !this.workspace.needsRecovery && !this.busy());
    this.status.set(this.workspace.saveStatus);
    this.error.set(this.workspace.error);
    const host = this.canvas?.nativeElement;
    if (host) {
      host.replaceChildren();
      if (project && icon) {
        const svg = this.renderIconSvg(document, project, icon,
          this.workspace.preview ? { preview: this.workspace.preview } : {});
        svg.setAttribute('aria-label', `${icon.name} drawing`);
        if (this.showGrid()) this.addGuides(svg, project.designSystem.safeArea, icon.viewBox);
        for (const id of this.workspace.selection.snapshot.nodeIds) {
          svg.querySelector(`[data-node-id="${id}"]`)?.setAttribute('data-selected', 'true');
        }
        host.append(svg);
      }
    }
  }

  private addGuides(svg: SVGSVGElement,
    safe: { top: number; right: number; bottom: number; left: number },
    viewBox: [number, number, number, number]): void {
    const guides = this.workspace.guides;
    if (!guides) return;
    const ns = 'http://www.w3.org/2000/svg';
    const group = document.createElementNS(ns, 'g');
    group.setAttribute('data-editor-grid', '');
    group.setAttribute('pointer-events', 'none');
    for (const x of guides.vertical) {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', String(x));
      line.setAttribute('y1', String(viewBox[1]));
      line.setAttribute('x2', String(x));
      line.setAttribute('y2', String(viewBox[1] + viewBox[3]));
      group.append(line);
    }
    for (const y of guides.horizontal) {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', String(viewBox[0]));
      line.setAttribute('y1', String(y));
      line.setAttribute('x2', String(viewBox[0] + viewBox[2]));
      line.setAttribute('y2', String(y));
      group.append(line);
    }
    const area = document.createElementNS(ns, 'rect');
    area.setAttribute('data-safe-area', '');
    area.setAttribute('x', String(viewBox[0] + safe.left));
    area.setAttribute('y', String(viewBox[1] + safe.top));
    area.setAttribute('width', String(viewBox[2] - safe.left - safe.right));
    area.setAttribute('height', String(viewBox[3] - safe.top - safe.bottom));
    group.append(area);
    svg.insertBefore(group, svg.querySelector('[data-node-id]'));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.canEdit.set(false);
    this.status.set('Saving…');
    try { await action(); }
    catch (error) {
      this.workspace.error = this.message(error);
      this.workspace.saveStatus = 'Save failed';
    }
    finally { this.busy.set(false); this.refresh(); }
  }

  runCreate(): void { void this.run(() => this.workspace.create()); }
  runAddIcon(): void { void this.run(() => this.workspace.addIcon()); }
  runAddRectangle(): void { void this.run(() => this.workspace.addRectangle()); }
  runAddEllipse(): void { void this.run(() => this.workspace.addEllipse()); }
  runAddLine(): void { void this.run(() => this.workspace.addLine()); }
  runTakeOver(): void { void this.run(() => this.workspace.takeOver()); }
  runRecover(): void { void this.run(() => this.workspace.recover()); }
  runGroup(): void { void this.run(() => this.workspace.groupSelected()); }
  runUngroup(): void { void this.run(() => this.workspace.ungroupSelected()); }
  runAppearance(mode: 'filled' | 'outline'): void { void this.run(() => this.workspace.setSelectedAppearance(mode)); }
  toggleGrid(): void { this.showGrid.update(value => !value); this.refresh(); }
  runMoveRight(): void { void this.run(() => this.workspace.moveRight()); }
  runUndo(): void { void this.run(() => this.workspace.undo()); }
  runRedo(): void { void this.run(() => this.workspace.redo()); }
  runExport(): void { try { this.workspace.exportSvg(); } catch (error) { this.error.set(this.message(error)); } }

  chooseIcon(id: string): void { this.workspace.currentIconId = id; this.workspace.selection.clear(); this.refresh(); }

  chooseLayer(id: string, event: MouseEvent): void {
    this.workspace.select(id, event.shiftKey);
    this.refresh();
  }

  onLayerKeydown(id: string, event: KeyboardEvent): void {
    if (!this.canEdit()) return;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const delta = move[event.key];
    if (!delta) return;
    event.preventDefault();
    this.workspace.select(id);
    this.refresh();
    void this.run(() => this.workspace.translateSelected(delta[0], delta[1]));
  }

  onCanvasClick(event: MouseEvent): void {
    if (event.shiftKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const nodeId = target.closest('[data-node-id]')?.getAttribute('data-node-id');
    if (nodeId) { this.workspace.select(nodeId); this.refresh(); }
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !this.canEdit()) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const nodeId = target.closest('[data-node-id]')?.getAttribute('data-node-id');
    if (nodeId && event.shiftKey) {
      event.preventDefault();
      this.workspace.select(nodeId, true);
      this.refresh();
      return;
    }
    const icon = this.workspace.icon;
    const svg = this.canvas?.nativeElement.querySelector('svg');
    if (!nodeId || !icon || !svg) return;
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    event.preventDefault();
    this.workspace.beginDrag(nodeId);
    this.dragFrame = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      scaleX: icon.viewBox[2] / bounds.width, scaleY: icon.viewBox[3] / bounds.height };
    this.canvas!.nativeElement.setPointerCapture(event.pointerId);
    this.refresh();
  }

  onPointerMove(event: PointerEvent): void {
    const frame = this.dragFrame;
    if (!frame || frame.pointerId !== event.pointerId) return;
    const dx = (event.clientX - frame.startX) * frame.scaleX;
    const dy = (event.clientY - frame.startY) * frame.scaleY;
    this.workspace.updateDrag(dx, dy, 6 * Math.max(frame.scaleX, frame.scaleY));
    this.refresh();
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.dragFrame || this.dragFrame.pointerId !== event.pointerId) return;
    this.dragFrame = null;
    if (this.canvas?.nativeElement.hasPointerCapture(event.pointerId)) {
      this.canvas.nativeElement.releasePointerCapture(event.pointerId);
    }
    void this.run(() => this.workspace.finishDrag());
  }

  onPointerCancel(event: PointerEvent): void {
    if (!this.dragFrame || this.dragFrame.pointerId !== event.pointerId) return;
    this.dragFrame = null;
    this.workspace.cancelDrag();
    this.refresh();
  }
}
