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
        </aside>
        <section class="studio" aria-label="Icon editor">
          <div class="toolbar">
            <button type="button" (click)="runAddRectangle()" [disabled]="!canEdit() || !hasIcon()">Add rectangle</button>
            <button type="button" (click)="runMoveRight()" [disabled]="!canEdit() || !selected()">Move right</button>
            <button type="button" (click)="runUndo()" [disabled]="!canEdit()">Undo</button>
            <button type="button" (click)="runRedo()" [disabled]="!canEdit()">Redo</button>
          </div>
          <div class="stage">
            @if (!hasIcon()) { <p class="empty">Create a project and add an icon to start drawing.</p> }
            <div #canvas class="canvas" (click)="onCanvasClick($event)" aria-label="Icon canvas"></div>
          </div>
        </section>
        <aside class="inspector" aria-label="Selection inspector">
          <h2>Selection</h2>
          <p>{{ selected() ? 'Rectangle selected' : 'Select a shape on the canvas' }}</p>
          <p class="hint">24 × 24 icon grid</p>
        </aside>
      </div>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    </main>`,
})
export class App implements OnInit, OnDestroy {
  @ViewChild('canvas') canvas?: ElementRef<HTMLElement>;
  private workspace!: BrowserWorkspace;
  private renderIconSvg!: typeof import('@iconforge/editor-core')['renderIconSvg'];
  readonly busy = signal(true);
  readonly status = signal('Loading project…');
  readonly error = signal('');
  readonly projectName = signal('No project');
  readonly icons = signal<{ id: string; name: string }[]>([]);
  readonly activeIconId = signal<string | null>(null);
  readonly selected = signal(false);
  readonly hasIcon = signal(false);
  readonly canEdit = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const [{ BrowserWorkspace }, { renderIconSvg }] = await Promise.all([
        import('./workspace.js'), import('@iconforge/editor-core'),
      ]);
      this.workspace = new BrowserWorkspace();
      this.renderIconSvg = renderIconSvg;
      await this.workspace.openLast();
      this.busy.set(false);
      this.refresh();
    }
    catch (error) { this.error.set(this.message(error)); this.status.set('Could not open project'); }
  }

  ngOnDestroy(): void { if (this.workspace) void this.workspace.close(); }

  private message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

  private refresh(): void {
    const project = this.workspace.project;
    const icon = this.workspace.icon;
    this.projectName.set(project?.name ?? 'No project');
    this.icons.set(project?.icons.map(item => ({ id: item.id, name: item.name })) ?? []);
    this.activeIconId.set(icon?.id ?? null);
    this.selected.set(this.workspace.selection.snapshot.nodeIds.length > 0);
    this.hasIcon.set(Boolean(icon));
    this.canEdit.set(Boolean(project) && this.workspace.writable && !this.busy());
    this.status.set(this.workspace.saveStatus);
    this.error.set(this.workspace.error);
    const host = this.canvas?.nativeElement;
    if (host) {
      host.replaceChildren();
      if (project && icon) {
        const svg = this.renderIconSvg(document, project, icon);
        svg.setAttribute('aria-label', `${icon.name} drawing`);
        for (const id of this.workspace.selection.snapshot.nodeIds) {
          svg.querySelector(`[data-node-id="${id}"]`)?.setAttribute('data-selected', 'true');
        }
        host.append(svg);
      }
    }
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
  runMoveRight(): void { void this.run(() => this.workspace.moveRight()); }
  runUndo(): void { void this.run(() => this.workspace.undo()); }
  runRedo(): void { void this.run(() => this.workspace.redo()); }
  runExport(): void { try { this.workspace.exportSvg(); } catch (error) { this.error.set(this.message(error)); } }

  chooseIcon(id: string): void { this.workspace.currentIconId = id; this.workspace.selection.clear(); this.refresh(); }

  onCanvasClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const nodeId = target.closest('[data-node-id]')?.getAttribute('data-node-id');
    if (nodeId) { this.workspace.select(nodeId); this.refresh(); }
  }
}
