import { Component, ElementRef, ViewChild, signal, type OnInit, type OnDestroy } from '@angular/core';
import type { BrowserWorkspace } from './workspace.js';
import { assertBrowserCapabilities } from './browser-capabilities.js';
import { iconConsistencyWarnings, type IconConsistencyWarning } from './consistency.js';
import { STARTER_ICONS, type StarterIconName } from './starter-library.js';
import type { IconGridPreset } from '@iconforge/commands';

@Component({
  selector: 'iconforge-root',
  template: `
    <main class="shell">
      <header class="topbar">
        <strong class="brand">IconForge</strong>
        <span class="project-name">{{ projectName() }}</span>
        <span class="status" role="status">{{ status() }}</span>
        @if (storageWarning()) { <span class="storage-warning" role="status">Browser storage may be cleared</span> }
        @if (fileReminder()) { <span class="file-reminder" role="status">Save a project file to back up recent changes</span> }
        @if (readOnly()) {
          <button type="button" (click)="runTakeOver()" [disabled]="busy() || previewOnly()">Take over editing</button>
        }
        @if (needsRecovery()) {
          <button type="button" (click)="runRecover()" [disabled]="busy() || readOnly() || previewOnly()">{{ checkpointRecovery() ? 'Recover as copy' : 'Recover valid edits' }}</button>
          <button type="button" (click)="runDownloadRecoveryData()" [disabled]="busy() || previewOnly()">Download recovery data</button>
        }
        <label class="grid-preset">Grid preset
          <select #gridPreset [disabled]="busy() || previewOnly()">
            <option value="16">16 × 16</option><option value="24" selected>24 × 24</option><option value="32">32 × 32</option>
          </select>
        </label>
        <button type="button" (click)="runCreate(gridPreset.value)" [disabled]="busy() || previewOnly()">Create project</button>
        <label class="open-file">Open project file
          <input type="file" accept=".iconproj,application/zip" (change)="runOpenProject($event)" [disabled]="busy() || previewOnly()">
        </label>
        <button type="button" (click)="runExport()" [disabled]="!hasIcon() || previewOnly()">Export SVG</button>
        <button type="button" (click)="runDownloadSprite()" [disabled]="!canExportSprite() || busy() || previewOnly()">Download sprite</button>
        <button type="button" (click)="runSaveProject()" [disabled]="!canEdit()">Save project</button>
        <button type="button" (click)="runDownloadProject()" [disabled]="!hasProject() || busy() || previewOnly()">Download project</button>
      </header>
      @if (previewOnly()) { <p class="mobile-preview" role="status">Mobile preview only</p> }
      <div class="layout">
        <aside class="sidebar" aria-label="Project assets">
          <h2>Icons</h2>
          <button type="button" (click)="runAddIcon()" [disabled]="!canEdit()">Add icon</button>
          <button type="button" (click)="toggleStarters()" [disabled]="!hasProject()">{{ showStarters() ? 'Hide starters' : 'Pick starter' }}</button>
          @if (showStarters()) {
            <div class="starter-list" aria-label="Starter icons">
              @for (starter of starters; track starter.name) {
                <button type="button" (click)="runAddStarter(starter.name)" [disabled]="!canEdit()">{{ starter.label }}</button>
              }
            </div>
          }
          <label class="import-file">Import SVG
            <input type="file" accept=".svg,image/svg+xml" (change)="runImportSvg($event)" [disabled]="!canEdit()">
          </label>
          @if (importMessages().length) {
            <div role="status">
              @for (message of importMessages(); track message) { <p>{{ message }}</p> }
            </div>
          }
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
            <button type="button" (click)="toggleOverview()" [disabled]="!hasProject()">{{ showOverview() ? 'Return to editor' : 'Set overview' }}</button>
            @if (!showOverview()) {
            <button type="button" (click)="runAddRectangle()" [disabled]="!canEdit() || !hasIcon()">Add rectangle</button>
            <button type="button" (click)="runAddRoundedRectangle()" [disabled]="!canEdit() || !hasIcon()">Add rounded rectangle</button>
            <button type="button" (click)="runAddEllipse()" [disabled]="!canEdit() || !hasIcon()">Add ellipse</button>
            <button type="button" (click)="runAddLine()" [disabled]="!canEdit() || !hasIcon()">Add line</button>
            <button type="button" (click)="runAddPolygon()" [disabled]="!canEdit() || !hasIcon()">Add polygon</button>
            <button type="button" (click)="runMoveRight()" [disabled]="!canEdit() || !selected()">Move right</button>
            <button type="button" (click)="runUndo()" [disabled]="!canEdit()">Undo</button>
            <button type="button" (click)="runRedo()" [disabled]="!canEdit()">Redo</button>
            <button type="button" (click)="runGroup()" [disabled]="!canEdit() || !canGroup()">Group selection</button>
            <button type="button" (click)="runUngroup()" [disabled]="!canEdit() || !canUngroup()">Ungroup selection</button>
            <button type="button" (click)="runDeleteSelection()" [disabled]="!canEdit() || !selected()">Delete selection</button>
            <button type="button" (click)="toggleGrid()" [disabled]="!hasIcon()">{{ showGrid() ? 'Hide grid' : 'Show grid' }}</button>
            }
          </div>
          <section class="set-overview" aria-label="Set overview" [hidden]="!showOverview()">
            <div class="overview-heading">
              <h2>Set overview</h2>
              <label>Find icons <input type="search" [value]="overviewQuery()" (input)="setOverviewQuery($event)"></label>
            </div>
            <p class="overview-count" role="status">{{ overviewSummary() }}</p>
            <div class="overview-grid">
              @for (item of overviewItems(); track item.id) {
                <button type="button" class="overview-card" [attr.aria-label]="'Open ' + item.name" (click)="chooseIcon(item.id)">
                  <img [src]="item.preview" [alt]="item.name + ' preview'" loading="lazy">
                  <span>{{ item.name }}</span>
                  @for (warning of item.warnings; track warning.code) {
                    <span class="overview-warning" [class.error]="warning.severity === 'error'">{{ warning.message }}</span>
                  }
                </button>
              }
            </div>
            <div class="overview-pages">
              <button type="button" (click)="changeOverviewPage(-1)" [disabled]="!overviewHasPrevious()">Previous icons</button>
              <button type="button" (click)="changeOverviewPage(1)" [disabled]="!overviewHasNext()">Next icons</button>
            </div>
          </section>
          <div class="stage" [hidden]="showOverview()">
            @if (!hasIcon()) { <p class="empty">Create a project and add an icon to start drawing.</p> }
            <div #canvas class="canvas" (click)="onCanvasClick($event)"
              (pointerdown)="onPointerDown($event)" (pointermove)="onPointerMove($event)"
              (pointerup)="onPointerUp($event)" (pointercancel)="onPointerCancel($event)"
              role="group" aria-label="Icon canvas"></div>
          </div>
        </section>
        <aside class="inspector" aria-label="Selection inspector">
          <h2>Project</h2>
          <div class="project-name-fields">
            <label>Project name <input #projectNameInput type="text" maxlength="120"
              [value]="projectName()" [disabled]="!canEdit()"></label>
            <button type="button" (click)="runRenameProject(projectNameInput.value)" [disabled]="!canEdit()">Apply project name</button>
          </div>
          <h2>Set style</h2>
          <div class="set-style-fields">
            <label>Visual language
              <select #setStyle [value]="setStyleValue()" [disabled]="!canEdit()">
                <option value="outline">Outline</option><option value="filled">Filled</option>
                <option value="duotone">Duotone</option><option value="custom">Custom</option>
              </select>
            </label>
            <label>Set stroke width <input #setWidth type="number" min="0.001" max="24" step="0.001"
              [value]="setStrokeWidth()" [disabled]="!canEdit()"></label>
            <label>Roundness <input #setRoundness type="number" min="0" max="12" step="0.001"
              [value]="setCornerRadius()" [disabled]="!canEdit()"></label>
            <button type="button" (click)="runUpdateSetStyle(setStyle.value, setWidth.value, setRoundness.value)"
              [disabled]="!canEdit()">Apply set style</button>
          </div>
          <p class="hint">Sets the design policy. Existing icons are not changed.</p>
          <h2>Icon</h2>
          <label class="icon-name-field">Icon name
            <input #iconName type="text" [value]="activeIconName()" [disabled]="!canEdit() || !hasIcon()">
          </label>
          <button type="button" (click)="runRenameIcon(iconName.value)" [disabled]="!canEdit() || !hasIcon()">Apply icon name</button>
          <p class="hint">Names become SVG filenames and sprite IDs.</p>
          <div class="icon-accessibility-fields">
            <label>Icon use
              <select #iconUse [value]="accessibilityKind()" (change)="setAccessibilityKind($event)"
                [disabled]="!canEdit() || !hasIcon()">
                <option value="decorative">Decorative</option><option value="informative">Informative</option>
              </select>
            </label>
            <label>Accessible name <input #accessibleName type="text" maxlength="120"
              [value]="accessibilityLabel()" [disabled]="!canEdit() || !hasIcon() || accessibilityKind() === 'decorative'"></label>
            <button type="button" (click)="runIconAccessibility(iconUse.value, accessibleName.value)"
              [disabled]="!canEdit() || !hasIcon()">Apply icon use</button>
          </div>
          <h2>Selection</h2>
          <p>{{ selected() ? 'Shape selected' : 'Select a shape on the canvas' }}</p>
          <div class="position-fields">
            <label>X position <input #positionX type="number" step="0.001" [value]="xPosition()" [disabled]="!canEdit() || !canPosition()"></label>
            <label>Y position <input #positionY type="number" step="0.001" [value]="yPosition()" [disabled]="!canEdit() || !canPosition()"></label>
            <button type="button" (click)="runPosition(positionX.value, positionY.value)"
              [disabled]="!canEdit() || !canPosition()">Apply position</button>
          </div>
          <button type="button" (click)="runAppearance('filled')" [disabled]="!canEdit() || !canStyle()">Fill shape</button>
          <button type="button" (click)="runAppearance('outline')" [disabled]="!canEdit() || !canStyle()">Outline shape</button>
          <div class="appearance-fields">
            <label>Fill color <input #fillColor type="color" [value]="currentFillColor()" [disabled]="!canEdit() || !canStyle()"></label>
            <button type="button" (click)="runFillColor(fillColor.value)" [disabled]="!canEdit() || !canStyle()">Apply fill color</button>
            <label>Stroke width <input #strokeWidth type="number" step="0.001" min="0.001"
              [value]="currentStrokeWidth()" [disabled]="!canEdit() || !canEditStroke()"></label>
          <button type="button" (click)="runStrokeWidth(strokeWidth.value)"
              [disabled]="!canEdit() || !canEditStroke()">Apply stroke width</button>
          </div>
          <button type="button" (click)="toggleSizePreview()" [disabled]="!hasIcon()">{{ showSizePreview() ? 'Hide size preview' : 'Preview sizes' }}</button>
          <section class="size-preview" aria-label="Icon size and theme preview" [hidden]="!showSizePreview()">
            <h3>Sizes and themes</h3>
            <label class="preview-context-picker">Preview in
              <select [value]="previewContext()" (change)="setPreviewContext($event)">
                <option value="Button">Button</option><option value="Navigation">Navigation</option>
                <option value="Toolbar">Toolbar</option>
              </select>
            </label>
            <div class="size-preview-grid">
              @for (sample of previewSamples(); track sample.theme + sample.size) {
                <div class="size-preview-tile" [class.dark]="sample.theme === 'Dark'">
                  <div class="preview-context" [class.as-button]="previewContext() === 'Button'"
                    [class.as-navigation]="previewContext() === 'Navigation'"
                    [class.as-toolbar]="previewContext() === 'Toolbar'">
                    <img [src]="sample.source" [alt]="sample.theme + ' ' + sample.size + ' px preview'"
                      [style.width.px]="sample.size" [style.height.px]="sample.size">
                    @if (previewContext() === 'Navigation') { <span>Home</span> }
                    @if (previewContext() === 'Toolbar') { <span aria-hidden="true">⋯</span> }
                  </div>
                  <span>{{ sample.theme }} · {{ sample.size }} px</span>
                </div>
              }
            </div>
          </section>
          <p class="hint">{{ gridHint() }} icon grid · drag snaps to whole units</p>
        </aside>
      </div>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    </main>`,
})
export class App implements OnInit, OnDestroy {
  @ViewChild('canvas') canvas?: ElementRef<HTMLElement>;
  private workspace!: BrowserWorkspace;
  private renderIconSvg!: typeof import('@iconforge/editor-core')['renderIconSvg'];
  private readonly phoneMedia = window.matchMedia('(max-width: 600px) and (pointer: coarse)');
  private readonly onPhoneMediaChange = (): void => {
    this.previewOnly.set(this.phoneMedia.matches);
    if (this.workspace) this.refresh();
  };
  private dragFrame: { pointerId: number; startX: number; startY: number; scaleX: number; scaleY: number;
    targets: { element: SVGElement; matrix: number[] }[] } | null = null;
  readonly busy = signal(true);
  readonly status = signal('Loading project…');
  readonly error = signal('');
  readonly projectName = signal('No project');
  readonly icons = signal<{ id: string; name: string }[]>([]);
  readonly importMessages = signal<string[]>([]);
  readonly layers = signal<{ id: string; label: string; selected: boolean }[]>([]);
  readonly activeIconId = signal<string | null>(null);
  readonly activeIconName = signal('');
  readonly accessibilityKind = signal<'decorative' | 'informative'>('decorative');
  readonly accessibilityLabel = signal('');
  readonly selected = signal(false);
  readonly hasIcon = signal(false);
  readonly hasProject = signal(false);
  readonly canExportSprite = signal(false);
  readonly storageWarning = signal(false);
  readonly fileReminder = signal(false);
  private fileReminderTimer: ReturnType<typeof setTimeout> | null = null;
  readonly canEdit = signal(false);
  readonly canGroup = signal(false);
  readonly canUngroup = signal(false);
  readonly canStyle = signal(false);
  readonly canPosition = signal(false);
  readonly xPosition = signal(0);
  readonly yPosition = signal(0);
  readonly currentFillColor = signal('#000000');
  readonly currentStrokeWidth = signal(1.75);
  readonly setStyleValue = signal('outline');
  readonly setStrokeWidth = signal(1.75);
  readonly setCornerRadius = signal(2);
  readonly gridHint = signal('24 × 24');
  readonly canEditStroke = signal(false);
  readonly previewOnly = signal(this.phoneMedia.matches);
  readonly readOnly = signal(false);
  readonly needsRecovery = signal(false);
  readonly checkpointRecovery = signal(false);
  readonly showGrid = signal(true);
  readonly showSizePreview = signal(false);
  readonly previewContext = signal<'Button' | 'Navigation' | 'Toolbar'>('Button');
  readonly previewSamples = signal<{ theme: 'Light' | 'Dark'; size: number; source: string }[]>([]);
  readonly showOverview = signal(false);
  readonly showStarters = signal(false);
  readonly starters = STARTER_ICONS;
  readonly overviewQuery = signal('');
  readonly overviewItems = signal<{ id: string; name: string; preview: string; warnings: IconConsistencyWarning[] }[]>([]);
  readonly overviewSummary = signal('');
  readonly overviewHasPrevious = signal(false);
  readonly overviewHasNext = signal(false);
  private overviewPage = 0;
  private readonly onFocus = (): void => {
    if (!this.workspace) return;
    void this.workspace.refreshReadonly().then(() => this.refresh()).catch(error => this.error.set(this.message(error)));
  };
  private readonly onSaveKeydown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's' || !this.hasProject()) return;
    event.preventDefault();
    if (this.canEdit()) this.runSaveProject();
  };

  async ngOnInit(): Promise<void> {
    try {
      await assertBrowserCapabilities();
      const [{ BrowserWorkspace }, { renderIconSvg }] = await Promise.all([
        import('./workspace.js'), import('@iconforge/editor-core'),
      ]);
      this.workspace = new BrowserWorkspace();
      this.workspace.onChanged = () => this.refresh();
      this.renderIconSvg = renderIconSvg;
      await this.workspace.openLast();
      window.addEventListener('focus', this.onFocus);
      window.addEventListener('keydown', this.onSaveKeydown);
      this.phoneMedia.addEventListener('change', this.onPhoneMediaChange);
      this.busy.set(false);
      this.refresh();
    }
    catch (error) { this.error.set(this.message(error)); this.status.set('Could not open project'); }
  }

  ngOnDestroy(): void {
    if (this.fileReminderTimer) clearTimeout(this.fileReminderTimer);
    window.removeEventListener('focus', this.onFocus);
    window.removeEventListener('keydown', this.onSaveKeydown);
    this.phoneMedia.removeEventListener('change', this.onPhoneMediaChange);
    if (this.workspace) void this.workspace.close();
  }

  private message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

  private refresh(): void {
    const project = this.workspace.project;
    const icon = this.workspace.icon;
    this.projectName.set(project?.name ?? 'No project');
    this.icons.set(project?.icons.map(item => ({ id: item.id, name: item.name })) ?? []);
    this.activeIconId.set(icon?.id ?? null);
    this.activeIconName.set(icon?.name ?? '');
    this.accessibilityKind.set(icon?.accessibility.kind ?? 'decorative');
    this.accessibilityLabel.set(icon?.accessibility.label ?? icon?.name ?? '');
    const selectedIds = this.workspace.selection.snapshot.nodeIds;
    this.selected.set(selectedIds.length > 0);
    const layerBases = icon?.nodes.map(node => ({ id: node.id,
      label: node.name ?? (node.type === 'rect' ? 'Rectangle' : node.type[0]!.toUpperCase() + node.type.slice(1)) })) ?? [];
    const totals = new Map<string, number>();
    for (const layer of layerBases) totals.set(layer.label, (totals.get(layer.label) ?? 0) + 1);
    const sequence = new Map<string, number>();
    this.layers.set(layerBases.map(layer => {
      const number = (sequence.get(layer.label) ?? 0) + 1;
      sequence.set(layer.label, number);
      return { id: layer.id, label: totals.get(layer.label)! > 1 ? `${layer.label} ${number}` : layer.label,
        selected: selectedIds.includes(layer.id) };
    }));
    this.canGroup.set(selectedIds.length > 1 && selectedIds.every(id => icon?.nodes.some(node => node.id === id)));
    this.canUngroup.set(this.workspace.canUngroupSelection);
    this.canStyle.set(this.workspace.styleableSelection);
    const position = this.workspace.position;
    this.canPosition.set(Boolean(position && !this.workspace.selectedNode?.locked));
    this.xPosition.set(position?.[0] ?? 0);
    this.yPosition.set(position?.[1] ?? 0);
    this.currentFillColor.set(this.workspace.fillColor);
    this.currentStrokeWidth.set(this.workspace.strokeWidth ?? project?.designSystem.stroke.width ?? 1.75);
    this.setStyleValue.set(project?.designSystem.style ?? 'outline');
    this.setStrokeWidth.set(project?.designSystem.stroke.width ?? 1.75);
    this.setCornerRadius.set(project?.designSystem.cornerRadius ?? 2);
    this.gridHint.set(icon ? `${icon.viewBox[2]} × ${icon.viewBox[3]}` : project
      ? `${project.designSystem.grid.width} × ${project.designSystem.grid.height}` : '24 × 24');
    this.canEditStroke.set(this.workspace.strokeWidth !== null && !this.workspace.selectedNode?.locked);
    this.hasIcon.set(Boolean(icon));
    this.hasProject.set(Boolean(project));
    this.canExportSprite.set(this.workspace.canExportSprite);
    this.storageWarning.set(Boolean(project && this.workspace.storageDurability
      && this.workspace.storageDurability !== 'persistent'));
    this.refreshFileReminder();
    this.readOnly.set(Boolean(project) && !this.workspace.writable);
    this.needsRecovery.set(this.workspace.needsRecovery);
    this.checkpointRecovery.set(this.workspace.checkpointRecovery);
    this.canEdit.set(Boolean(project) && this.workspace.writable && !this.workspace.needsRecovery
      && !this.busy() && !this.previewOnly());
    this.status.set(this.workspace.saveStatus);
    this.error.set(this.workspace.error);
    this.refreshOverview(project);
    this.refreshSizePreview(project, icon);
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

  private refreshFileReminder(): void {
    if (!this.workspace.hasUnsavedFileChanges) {
      if (this.fileReminderTimer) clearTimeout(this.fileReminderTimer);
      this.fileReminderTimer = null;
      this.fileReminder.set(false);
    } else if (!this.fileReminderTimer && !this.fileReminder()) {
      this.fileReminderTimer = setTimeout(() => {
        this.fileReminderTimer = null;
        if (this.workspace.hasUnsavedFileChanges) this.fileReminder.set(true);
      }, 30 * 60 * 1000);
    }
  }

  private refreshSizePreview(project: NonNullable<BrowserWorkspace['project']> | null,
    icon: NonNullable<BrowserWorkspace['icon']> | null): void {
    if (!project || !icon || !this.showSizePreview()) { this.previewSamples.set([]); return; }
    const samples: { theme: 'Light' | 'Dark'; size: number; source: string }[] = [];
    for (const theme of ['Light', 'Dark'] as const) {
      const svg = this.renderIconSvg(document, project, icon, { theme: theme.toLowerCase() as 'light' | 'dark' });
      svg.setAttribute('color', theme === 'Light' ? '#17233d' : '#ffffff');
      const source = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
      for (const size of [16, 20, 24, 32]) samples.push({ theme, size, source });
    }
    this.previewSamples.set(samples);
  }

  private refreshOverview(project: NonNullable<BrowserWorkspace['project']> | null): void {
    if (!project || !this.showOverview()) { this.overviewItems.set([]); return; }
    const query = this.overviewQuery().trim().toLowerCase();
    const filtered = project.icons.filter(icon => icon.name.toLowerCase().includes(query))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    const pageSize = 24;
    this.overviewPage = Math.min(this.overviewPage, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
    const start = this.overviewPage * pageSize;
    this.overviewItems.set(filtered.slice(start, start + pageSize).map(icon => {
      const svg = this.renderIconSvg(document, project, icon);
      const preview = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
      return { id: icon.id, name: icon.name, preview, warnings: iconConsistencyWarnings(project, icon) };
    }));
    this.overviewSummary.set(filtered.length
      ? `Showing ${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length} icons`
      : 'No matching icons');
    this.overviewHasPrevious.set(this.overviewPage > 0);
    this.overviewHasNext.set(start + pageSize < filtered.length);
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

  private async run(action: () => Promise<void>, failureStatus = 'Save failed'): Promise<void> {
    if (this.busy() || this.previewOnly()) return;
    this.busy.set(true);
    this.canEdit.set(false);
    this.status.set('Saving…');
    try { await action(); }
    catch (error) {
      this.workspace.error = this.message(error);
      this.workspace.saveStatus = failureStatus;
    }
    finally { this.busy.set(false); this.refresh(); }
  }

  private resetOverview(): void {
    this.showOverview.set(false);
    this.showStarters.set(false);
    this.showSizePreview.set(false);
    this.overviewQuery.set('');
    this.overviewPage = 0;
  }

  runCreate(value = '24'): void {
    const size = Number(value);
    if (size !== 16 && size !== 24 && size !== 32) { this.error.set('Unknown icon grid preset'); return; }
    void this.run(async () => { await this.workspace.create(size as IconGridPreset); this.resetOverview(); });
  }
  runOpenProject(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.files?.length) return;
    const file = input.files[0]!;
    input.value = '';
    if (file.size > 64 * 1024 * 1024) { this.error.set('project-archive.size-limit'); return; }
    void this.run(async () => {
      await this.workspace.openProjectFile(new Uint8Array(await file.arrayBuffer()));
      this.resetOverview();
    }, 'Open failed');
  }
  runAddIcon(): void { void this.run(() => this.workspace.addIcon()); }
  runRenameProject(name: string): void { void this.run(() => this.workspace.renameProject(name)); }
  runAddStarter(name: StarterIconName): void { void this.run(() => this.workspace.addStarterIcon(name)); }
  toggleStarters(): void { this.showStarters.update(value => !value); }
  runRenameIcon(name: string): void { void this.run(() => this.workspace.renameIcon(name)); }
  setAccessibilityKind(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLSelectElement && (input.value === 'decorative' || input.value === 'informative')) {
      this.accessibilityKind.set(input.value);
    }
  }
  runIconAccessibility(kind: string, label: string): void {
    void this.run(() => this.workspace.setIconAccessibility(kind as 'decorative' | 'informative', label));
  }
  runUpdateSetStyle(style: string, width: string, roundness: string): void {
    if (!width.trim() || !roundness.trim()) { this.error.set('Enter stroke width and roundness'); return; }
    void this.run(() => this.workspace.updateSetStyle(
      style as 'outline' | 'filled' | 'duotone' | 'custom', Number(width), Number(roundness)));
  }
  runImportSvg(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.files?.length) return;
    const file = input.files[0]!;
    input.value = '';
    this.importMessages.set([]);
    if (file.size > 2 * 1024 * 1024) { this.error.set('import.source-limit'); return; }
    void this.run(async () => {
      const diagnostics = await this.workspace.importSvg(new Uint8Array(await file.arrayBuffer()), file.name);
      this.importMessages.set(diagnostics.map(diagnostic => diagnostic.message));
    }, 'Import failed');
  }
  runAddRectangle(): void { void this.run(() => this.workspace.addRectangle()); }
  runAddRoundedRectangle(): void { void this.run(() => this.workspace.addRectangle(true)); }
  runAddEllipse(): void { void this.run(() => this.workspace.addEllipse()); }
  runAddLine(): void { void this.run(() => this.workspace.addLine()); }
  runAddPolygon(): void { void this.run(() => this.workspace.addPolygon()); }
  runTakeOver(): void { void this.run(() => this.workspace.takeOver()); }
  runRecover(): void { void this.run(() => this.workspace.recover()); }
  runGroup(): void { void this.run(() => this.workspace.groupSelected()); }
  runUngroup(): void { void this.run(() => this.workspace.ungroupSelected()); }
  runDeleteSelection(): void { void this.run(() => this.workspace.removeSelected()); }
  runAppearance(mode: 'filled' | 'outline'): void { void this.run(() => this.workspace.setSelectedAppearance(mode)); }
  runPosition(x: string, y: string): void {
    if (!x.trim() || !y.trim()) { this.error.set('Enter both position values'); return; }
    void this.run(() => this.workspace.setPosition(Number(x), Number(y)));
  }
  runFillColor(color: string): void { void this.run(() => this.workspace.setFillColor(color)); }
  runStrokeWidth(width: string): void {
    if (!width.trim()) { this.error.set('Enter a stroke width'); return; }
    void this.run(() => this.workspace.setStrokeWidth(Number(width)));
  }
  toggleGrid(): void { this.showGrid.update(value => !value); this.refresh(); }
  runMoveRight(): void { void this.run(() => this.workspace.moveRight()); }
  runUndo(): void { void this.run(() => this.workspace.undo()); }
  runRedo(): void { void this.run(() => this.workspace.redo()); }
  runExport(): void { try { this.workspace.exportSvg(); } catch (error) { this.error.set(this.message(error)); } }
  runDownloadProject(): void {
    void this.workspace.downloadProject().catch(error => this.error.set(this.message(error)));
  }
  runSaveProject(): void {
    void this.run(async () => {
      try { await this.workspace.saveProject(); }
      catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        throw error;
      }
    }, 'File save failed');
  }
  runDownloadSprite(): void {
    void this.workspace.downloadSprite().catch(error => this.error.set(this.message(error)));
  }
  runDownloadRecoveryData(): void {
    void this.workspace.downloadRecoveryData().catch(error => this.error.set(this.message(error)));
  }

  toggleOverview(): void { this.showOverview.update(value => !value); this.refresh(); }

  toggleSizePreview(): void { this.showSizePreview.update(value => !value); this.refresh(); }

  setPreviewContext(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLSelectElement && ['Button', 'Navigation', 'Toolbar'].includes(input.value)) {
      this.previewContext.set(input.value as 'Button' | 'Navigation' | 'Toolbar');
    }
  }

  setOverviewQuery(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.overviewQuery.set(input.value);
    this.overviewPage = 0;
    this.refresh();
  }

  changeOverviewPage(delta: number): void {
    this.overviewPage = Math.max(0, this.overviewPage + delta);
    this.refresh();
  }

  chooseIcon(id: string): void {
    this.workspace.currentIconId = id;
    this.workspace.selection.clear();
    this.showOverview.set(false);
    this.refresh();
  }

  chooseLayer(id: string, event: MouseEvent): void {
    this.workspace.select(id, event.shiftKey);
    this.refresh();
  }

  onLayerKeydown(id: string, event: KeyboardEvent): void {
    if (!this.canEdit()) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (!this.workspace.selection.snapshot.nodeIds.includes(id)) this.workspace.select(id);
      void this.run(() => this.workspace.removeSelected());
      return;
    }
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
    this.canvas!.nativeElement.setPointerCapture(event.pointerId);
    this.refresh();
    const targets = this.workspace.selection.snapshot.nodeIds.flatMap(id => {
      const element = this.canvas?.nativeElement.querySelector(`[data-node-id="${id}"]`);
      if (!(element instanceof SVGElement)) return [];
      const transform = element.getAttribute('transform');
      const matrix = transform ? transform.slice(7, -1).split(/\s+/).map(Number) : [1, 0, 0, 1, 0, 0];
      return [{ element, matrix }];
    });
    this.dragFrame = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      scaleX: icon.viewBox[2] / bounds.width, scaleY: icon.viewBox[3] / bounds.height, targets };
    performance.clearMeasures('iconforge.transform-feedback');
  }

  onPointerMove(event: PointerEvent): void {
    const frame = this.dragFrame;
    if (!frame || frame.pointerId !== event.pointerId) return;
    const start = performance.now();
    const dx = (event.clientX - frame.startX) * frame.scaleX;
    const dy = (event.clientY - frame.startY) * frame.scaleY;
    this.workspace.updateDrag(dx, dy, 6 * Math.max(frame.scaleX, frame.scaleY));
    const preview = this.workspace.preview;
    if (preview) for (const { element, matrix } of frame.targets) {
      element.setAttribute('transform', `matrix(${matrix[0]} ${matrix[1]} ${matrix[2]} ${matrix[3]} ${
        Math.round((matrix[4]! + preview.matrix[4]) * 1000) / 1000} ${
        Math.round((matrix[5]! + preview.matrix[5]) * 1000) / 1000})`);
    }
    performance.measure('iconforge.transform-feedback', { start, end: performance.now() });
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
