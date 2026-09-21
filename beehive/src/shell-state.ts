export const destinations = ['HOST', 'AGENTS', 'HARNESSES', 'PROVIDERS'] as const;
// The current prototype's signed-out owner control is a state label, not a sign-in action.
export const ownerLabel = 'SIGNED OUT';
export const brand = '⬢ BEEHIVE';

export type FocusRegion = 'header' | 'list' | 'detail';
export type ShellMode = 'section' | 'owner';
export type ShellEffect = 'render' | 'activate' | 'quit' | 'none';
export type HarnessListRow = Readonly<{ id: string; kind: 'harness' | 'command' }>;

/** Framework-independent state for the never-signed-in shell tracer. */
export class ShellState {
  headerIndex = 0;
  activeSection = 0;
  focus: FocusRegion = 'header';
  mode: ShellMode = 'section';
  helpOpen = false;
  width = 120;
  height = 40;
  narrowPane: 'list' | 'detail' = 'list';
  harnessRows: readonly HarnessListRow[] = [{ id: 'command:refresh', kind: 'command' }];
  harnessSelection = 'command:refresh';
  listOffset = 0;
  listCapacity = 1;

  get belowMinimum() { return this.width < 50 || this.height < 20; }
  get protectedSection() { return this.activeSection < 2; }
  get collection() { return this.mode === 'section' && !this.protectedSection; }
  get splitPane() { return this.collection && this.width >= 60; }
  get ownerActive() { return this.mode === 'owner'; }

  resize(width: number, height: number) {
    const wasSplit = this.splitPane;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    if (wasSplit && !this.splitPane && this.collection) this.narrowPane = this.focus === 'detail' ? 'detail' : 'list';
    if (this.belowMinimum) this.helpOpen = false;
  }

  setHarnessRows(rows: readonly HarnessListRow[], preserveSelection = false) {
    const previous = this.harnessSelection;
    const previousHarnesses = this.harnessRows.filter(row => row.kind === 'harness');
    const previousHarnessIndex = previousHarnesses.findIndex(row => row.id === previous);
    this.harnessRows = rows.length ? rows : [{ id: 'command:refresh', kind: 'command' }];
    if (!preserveSelection && previous === 'command:refresh' && this.harnessRows[0]?.kind === 'harness') this.harnessSelection = this.harnessRows[0].id;
    else if (this.harnessRows.some(row => row.id === previous)) this.harnessSelection = previous;
    else {
      const harnesses = this.harnessRows.filter(row => row.kind === 'harness');
      this.harnessSelection = harnesses[previousHarnessIndex]?.id
        ?? harnesses[Math.min(previousHarnessIndex - 1, harnesses.length - 1)]?.id
        ?? this.harnessRows.find(row => row.kind === 'command')?.id
        ?? this.harnessRows[0]!.id;
    }
    this.revealHarnessSelection();
  }

  setListCapacity(capacity: number) { this.listCapacity = Math.max(1, capacity); this.revealHarnessSelection(); }
  private revealHarnessSelection() {
    const index = Math.max(0, this.harnessRows.findIndex(row => row.id === this.harnessSelection));
    if (index < this.listOffset) this.listOffset = index;
    if (index >= this.listOffset + this.listCapacity) this.listOffset = index - this.listCapacity + 1;
    this.listOffset = Math.max(0, Math.min(this.listOffset, Math.max(0, this.harnessRows.length - this.listCapacity)));
  }
  selectHarness(id: string) {
    if (!this.harnessRows.some(row => row.id === id)) return false;
    this.harnessSelection = id; this.revealHarnessSelection(); return true;
  }
  private moveHarness(delta: number) {
    const index = Math.max(0, this.harnessRows.findIndex(row => row.id === this.harnessSelection));
    const next = Math.max(0, Math.min(this.harnessRows.length - 1, index + delta));
    if (next === index) return false;
    this.harnessSelection = this.harnessRows[next]!.id; this.revealHarnessSelection(); return true;
  }
  get selectedHarnessRow() { return this.harnessRows.find(row => row.id === this.harnessSelection); }

  key(name: string, options: { ctrl?: boolean; shift?: boolean } = {}): ShellEffect {
    if (options.ctrl && name === 'q') return 'quit';
    if (this.belowMinimum) return 'none';
    if (options.ctrl && name === 'c') return 'quit';
    if (this.helpOpen) {
      if (name === 'escape' || name === 'return' || name === '?') { this.helpOpen = false; return 'render'; }
      return 'none';
    }
    if (!options.ctrl && !options.shift && name === 'q') return 'quit';
    if (!options.ctrl && name === '?') { this.helpOpen = true; return 'render'; }
    if (name === 'escape') {
      if (this.collection && !this.splitPane && this.narrowPane === 'detail') {
        this.narrowPane = 'list'; this.focus = 'list'; return 'render';
      }
      if (this.focus !== 'header') {
        this.focus = 'header';
        this.headerIndex = this.mode === 'owner' ? destinations.length : this.activeSection;
        return 'render';
      }
      return 'none';
    }
    if (this.focus === 'header') {
      if (name === 'left' || name === 'right') {
        const delta = name === 'left' ? -1 : 1;
        const next = Math.max(0, Math.min(destinations.length, this.headerIndex + delta));
        if (next !== this.headerIndex) { this.headerIndex = next; return 'render'; }
        return 'none';
      }
      if (name === 'return' || name === 'down') { this.activateHeader(); return 'render'; }
    }
    // Collection panes follow their visible geometry.  Header focus and the
    // active destination remain separate: only header activation changes the
    // destination, while these transitions only move the focus perimeter.
    if (this.collection && this.focus === 'list') {
      if (this.activeSection === 2 && name === 'down') return this.moveHarness(1) ? 'render' : 'none';
      if (name === 'up') {
        if (this.activeSection === 2 && this.moveHarness(-1)) return 'render';
        this.focus = 'header'; this.headerIndex = this.activeSection; return 'render';
      }
      if (name === 'right' || name === 'return') {
        this.focus = 'detail';
        if (!this.splitPane) this.narrowPane = 'detail';
        return 'render';
      }
    }
    if (this.collection && this.focus === 'detail') {
      if (name === 'return' && this.activeSection === 2 && this.selectedHarnessRow?.kind === 'command') return 'activate';
      if (name === 'up') {
        this.focus = 'header'; this.headerIndex = this.activeSection; return 'render';
      }
      if (name === 'left') {
        this.focus = 'list';
        if (!this.splitPane) this.narrowPane = 'list';
        return 'render';
      }
    }
    if (name === 'tab') {
      const harnessAction = this.activeSection === 2 && this.selectedHarnessRow?.kind === 'command';
      const regions: FocusRegion[] = this.collection
        ? this.splitPane ? harnessAction ? ['header', 'list', 'detail'] : ['header', 'list'] : this.narrowPane === 'list' ? ['header', 'list'] : harnessAction ? ['header', 'detail'] : ['header']
        : ['header', 'detail'];
      const current = Math.max(0, regions.indexOf(this.focus));
      this.focus = regions[(current + (options.shift ? regions.length - 1 : 1)) % regions.length]!;
      return 'render';
    }
    return 'none';
  }

  activateHeader(index = this.headerIndex) {
    this.headerIndex = Math.max(0, Math.min(destinations.length, index));
    if (this.headerIndex === destinations.length) {
      this.mode = 'owner';
      this.focus = 'detail';
      return;
    }
    this.mode = 'section';
    this.activeSection = this.headerIndex;
    this.narrowPane = 'list';
    this.focus = this.collection ? 'list' : 'detail';
  }
}

export function listWidth(width: number) {
  if (width >= 90) return Math.min(35, Math.max(28, Math.floor((width - 1) * 0.32)));
  if (width >= 60) return Math.min(28, Math.max(24, Math.floor((width - 1) * 0.36)));
  return width;
}
