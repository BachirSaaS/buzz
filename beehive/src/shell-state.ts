export const destinations = ['HOST', 'AGENTS', 'HARNESSES', 'PROVIDERS'] as const;
// The current prototype's signed-out owner control is a state label, not a sign-in action.
export const ownerLabel = 'SIGNED OUT';
export const brand = '⬢ BEEHIVE';

export type FocusRegion = 'header' | 'list' | 'detail';
export type ShellMode = 'section' | 'owner';
export type ShellEffect = 'render' | 'quit' | 'none';

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
    if (this.collection && !this.splitPane && this.focus === 'list' && (name === 'right' || name === 'return')) {
      this.narrowPane = 'detail'; this.focus = 'detail'; return 'render';
    }
    if (this.collection && !this.splitPane && this.focus === 'detail' && name === 'left') {
      this.narrowPane = 'list'; this.focus = 'list'; return 'render';
    }
    if (name === 'tab') {
      const regions: FocusRegion[] = this.collection
        ? this.splitPane ? ['header', 'list', 'detail'] : ['header', this.narrowPane]
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
