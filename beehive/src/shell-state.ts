export const destinations = ['HOST', 'AGENTS', 'HARNESSES', 'PROVIDERS'] as const;
export const ownerLabel = 'SIGNED OUT';
export const shortcutGuide = '←→ header  Enter open  Tab panes  Esc return  ? help  q quit';
export const compactShortcutGuide = '←→ nav ↵ open Tab panes Esc back ? help q quit';

export type FocusRegion = 'header' | 'list' | 'detail';
export type ShellMode = 'section' | 'owner';
export type ShellEffect = 'render' | 'quit' | 'none';

/** Pure navigation owner for the never-signed-in tracer bullet. */
export class ShellState {
  headerIndex = 0;
  activeSection = 0;
  focus: FocusRegion = 'header';
  mode: ShellMode = 'section';
  helpOpen = false;

  get protectedSection() { return this.activeSection < 2; }
  get splitPane() { return this.mode === 'section' && !this.protectedSection; }
  get activeOwner() { return this.mode === 'owner'; }

  key(name: string, options: { ctrl?: boolean; shift?: boolean; belowMinimum?: boolean } = {}): ShellEffect {
    if (options.ctrl && (name === 'q' || name === 'c')) return 'quit';
    if (options.belowMinimum) return 'none';
    if (this.helpOpen) {
      if (name === 'escape' || name === 'return' || name === '?') { this.helpOpen = false; return 'render'; }
      return 'none';
    }
    if (!options.ctrl && name === 'q') return 'quit';
    if (!options.ctrl && name === '?') { this.helpOpen = true; return 'render'; }
    if (name === 'escape') {
      if (this.focus !== 'header') { this.focus = 'header'; this.headerIndex = this.mode === 'owner' ? destinations.length : this.activeSection; return 'render'; }
      return 'none';
    }
    if (this.focus === 'header') {
      if (name === 'left') { const next = Math.max(0, this.headerIndex - 1); if (next !== this.headerIndex) { this.headerIndex = next; return 'render'; } return 'none'; }
      if (name === 'right') { const next = Math.min(destinations.length, this.headerIndex + 1); if (next !== this.headerIndex) { this.headerIndex = next; return 'render'; } return 'none'; }
      if (name === 'return' || name === 'down') { this.openHeader(); return 'render'; }
    }
    if (name === 'tab') {
      const regions: FocusRegion[] = this.splitPane ? ['header', 'list', 'detail'] : ['header', 'detail'];
      const current = regions.indexOf(this.focus);
      const delta = options.shift ? regions.length - 1 : 1;
      this.focus = regions[(current + delta) % regions.length]!;
      return 'render';
    }
    return 'none';
  }

  openHeader(index = this.headerIndex) {
    this.headerIndex = Math.max(0, Math.min(destinations.length, index));
    if (this.headerIndex === destinations.length) {
      this.mode = 'owner';
      this.focus = 'detail';
      return;
    }
    this.mode = 'section';
    this.activeSection = this.headerIndex;
    // Host and Agents remain gated: activation exposes only an empty safe pane.
    this.focus = this.splitPane ? 'list' : 'detail';
  }
}
