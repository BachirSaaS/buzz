import { BoxRenderable, ScrollBoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from '@opentui/core';
import { brand, destinations, listWidth, ownerLabel, ShellState, type FocusRegion } from './shell-state.ts';
import { HarnessInventoryController, type HarnessInventorySnapshot } from './harness-inventory.ts';

export const palette = {
  surface: '#0d100e', text: '#dce1d8', muted: '#7d867c', divider: '#4a5149',
  focus: '#ffd34e', healthy: '#75d795', failure: '#ff8179', selected: '#dce1d8', selectedText: '#10130f', dialog: '#9ca49b', scrim: '#070907',
} as const;

const wideFooter = '←→ move  Enter open  Tab panes  Esc return  ? help  q quit';
const minimumFooter = 'Ctrl-Q quit';
const helpBody = 'Header: ←→ destination; Enter / ↓ opens\nList: ↑ header; → / Enter Details\nDetails: ↑ header; ← List\nTab / Shift-Tab  visible regions\nEsc  active header\n? / Enter / Esc  close help\nq  quit Beehive';
const helpTitleRows = 2;
const helpActionRows = 2;
const helpVerticalChrome = 4; // one-cell border and one-row inset at both edges

const wrappedRows = (content: string, width: number) => content.split('\n').reduce((rows, line) => {
  if (!line) return rows + 1;
  let remaining = line;
  let count = 0;
  while (remaining.length > width) {
    const breakAt = remaining.lastIndexOf(' ', width);
    const end = breakAt > 0 ? breakAt : width;
    remaining = remaining.slice(end).trimStart();
    count++;
  }
  return rows + count + 1;
}, 0);

/** Cell geometry shared by the help surface and its memory-renderer regressions. */
export function helpDialogGeometry(viewportWidth: number, viewportHeight: number, content = helpBody) {
  const width = Math.max(4, Math.min(62, viewportWidth - 4));
  const maxHeight = Math.max(4, viewportHeight - 4);
  const innerWidth = Math.max(1, width - 6); // border plus two-cell inset on both sides
  const maxBodyHeight = Math.max(0, maxHeight - helpTitleRows - helpActionRows - helpVerticalChrome);
  // ScrollBox's vertical bar is a sibling of its viewport in OpenTUI 0.5.11.
  // Decide overflow at the unreserved width, then wrap at the viewport width it
  // will actually receive once that sibling has claimed its one cell.
  const scrollbar = wrappedRows(content, innerWidth) > maxBodyHeight;
  const bodyWidth = Math.max(1, innerWidth - (scrollbar ? 1 : 0));
  const bodyRows = wrappedRows(content, bodyWidth);
  const naturalHeight = helpTitleRows + bodyRows + helpActionRows + helpVerticalChrome;
  const height = Math.min(naturalHeight, maxHeight);
  return { width, maxHeight, naturalHeight, height, bodyHeight: Math.max(0, height - helpTitleRows - helpActionRows - helpVerticalChrome), bodyWidth, scrollbar };
}

/** OpenTUI owns rendering, layout, input dispatch, pointer dispatch, and lifecycle. */
export class OpenTuiShell {
  readonly state = new ShellState();
  readonly done: Promise<void>;
  private finish!: () => void;
  private closed = false;
  private readonly root: BoxRenderable;
  private readonly brandText: TextRenderable;
  private readonly ownerText: TextRenderable;
  private readonly nav: BoxRenderable;
  private readonly navItems: TextRenderable[];
  private readonly headerRule: TextRenderable;
  private readonly body: BoxRenderable;
  private readonly listPane: BoxRenderable;
  private readonly detailPane: BoxRenderable;
  private readonly divider: TextRenderable;
  private readonly focusPerimeter: BoxRenderable;
  private readonly listTitle: TextRenderable;
  private readonly detailTitle: TextRenderable;
  private readonly detailText: TextRenderable;
  private readonly detailAction: TextRenderable;
  private readonly listRows: TextRenderable[] = [];
  private inventorySnapshot: HarnessInventorySnapshot;
  private unsubscribeInventory: () => void;
  private screenGeneration = 0;
  private readonly footerRule: TextRenderable;
  private readonly footer: TextRenderable;
  private helpScrim?: BoxRenderable;
  private help?: BoxRenderable;
  private helpBody?: BoxRenderable;
  private helpBodyScrollable = false;
  private helpTitle?: TextRenderable;
  private helpActions?: TextRenderable;

  constructor(readonly renderer: CliRenderer, private readonly inventory: HarnessInventoryController, private readonly helpContent = helpBody) {
    this.inventorySnapshot = inventory.snapshot();
    this.done = new Promise(resolve => { this.finish = resolve; });
    this.root = new BoxRenderable(renderer, { width: '100%', height: '100%', flexDirection: 'column', backgroundColor: palette.surface });
    renderer.root.add(this.root);

    const identity = new BoxRenderable(renderer, { width: '100%', height: 1, backgroundColor: palette.surface });
    this.root.add(identity);
    this.brandText = new TextRenderable(renderer, { position: 'absolute', left: 1, top: 0, height: 1, fg: palette.focus, content: brand });
    identity.add(this.brandText);
    this.ownerText = new TextRenderable(renderer, { position: 'absolute', top: 0, height: 1, fg: palette.focus, content: ownerLabel,
      onMouseDown: () => this.activate(destinations.length) });
    identity.add(this.ownerText);

    this.nav = new BoxRenderable(renderer, { width: '100%', height: 1, flexDirection: 'row', justifyContent: 'center', gap: 1, backgroundColor: palette.surface });
    this.root.add(this.nav);
    this.navItems = destinations.map((label, index) => {
      const item = new TextRenderable(renderer, { width: label.length, height: 1, content: label, fg: palette.text, onMouseDown: () => this.activate(index) });
      this.nav.add(item); return item;
    });
    this.headerRule = new TextRenderable(renderer, { height: 1, fg: palette.divider }); this.root.add(this.headerRule);

    this.body = new BoxRenderable(renderer, { flexGrow: 1, minHeight: 1, width: '100%', flexDirection: 'row', backgroundColor: palette.surface });
    this.root.add(this.body);
    this.listPane = this.pane('list'); this.detailPane = this.pane('detail');
    this.divider = new TextRenderable(renderer, { width: 1, height: '100%', fg: palette.divider, content: '│' });
    this.focusPerimeter = new BoxRenderable(renderer, { position: 'absolute', visible: false, border: true, borderColor: palette.focus, backgroundColor: 'transparent',
      onMouseDown: event => {
        if (this.state.focus === 'list') this.clickListSlot(Math.floor((event.y - 6) / 2));
        else if (this.state.focus === 'detail' && event.y === 15) this.activateSelectedRow();
      },
      onMouseScroll: event => {
        if (this.state.focus !== 'list') return;
        if (event.scroll?.direction === 'up') this.state.key('up');
        else if (event.scroll?.direction === 'down') this.state.key('down');
        this.paint();
      } });
    this.body.add(this.listPane); this.body.add(this.divider); this.body.add(this.detailPane); this.body.add(this.focusPerimeter);
    this.listTitle = new TextRenderable(renderer, { position: 'absolute', left: 2, top: 1, height: 1, fg: palette.muted, content: 'LIST' });
    this.detailTitle = new TextRenderable(renderer, { position: 'absolute', left: 2, top: 1, height: 1, fg: palette.muted, content: 'DETAILS' });
    this.detailText = new TextRenderable(renderer, { position: 'absolute', left: 2, top: 3, width: '90%', height: '80%', fg: palette.text, wrapMode: 'word', content: '' });
    this.detailAction = new TextRenderable(renderer, { position: 'absolute', left: 2, top: 12, height: 1, fg: palette.selectedText, bg: palette.selected, content: ' Refresh harnesses ', visible: false,
      onMouseDown: () => this.activateSelectedRow() });
    this.listPane.add(this.listTitle); this.detailPane.add(this.detailTitle); this.detailPane.add(this.detailText); this.detailPane.add(this.detailAction);
    for (let slot = 0; slot < 32; slot++) {
      const row = new TextRenderable(renderer, { position: 'absolute', left: 2, top: slot + 3, height: 1, fg: palette.text, content: '', visible: false,
        onMouseDown: () => this.clickListSlot(slot) });
      this.listPane.add(row); this.listRows.push(row);
    }

    this.footerRule = new TextRenderable(renderer, { height: 1, fg: palette.divider }); this.root.add(this.footerRule);
    this.footer = new TextRenderable(renderer, { height: 1, fg: palette.muted, content: wideFooter }); this.root.add(this.footer);

    renderer.keyInput.on('keypress', key => this.key(key));
    renderer.on('resize', () => this.resize());
    renderer.on('destroy', () => this.close(false));
    this.unsubscribeInventory = inventory.subscribe(snapshot => {
      this.inventorySnapshot = snapshot;
      this.state.setHarnessRows([...snapshot.harnesses.map(harness => ({ id: `harness:${harness.id}`, kind: 'harness' as const })), { id: 'command:refresh', kind: 'command' }], snapshot.generation > 0);
      this.paint();
    });
    this.resize();
  }

  private pane(region: Exclude<FocusRegion, 'header'>) {
    return new BoxRenderable(this.renderer, { height: '100%', backgroundColor: palette.surface,
      onMouseScroll: event => {
        if (region !== 'list' || this.state.activeSection !== 2 || !this.visible(region)) return;
        if (event.scroll?.direction === 'up') this.state.key('up');
        else if (event.scroll?.direction === 'down') this.state.key('down');
        this.paint();
      },
      onMouseDown: () => { if (!this.visible(region)) return; this.state.focus = region; this.paint(); } });
  }

  private visible(region: 'list' | 'detail') {
    if (!this.state.collection) return region === 'detail';
    return this.state.splitPane || region === 'detail';
  }

  private key(key: KeyEvent) {
    const wasHarnesses = this.state.mode === 'section' && this.state.activeSection === 2;
    const effect = this.state.key(key.name, { ctrl: key.ctrl, shift: key.shift });
    if (wasHarnesses && !(this.state.mode === 'section' && this.state.activeSection === 2)) { this.screenGeneration++; this.inventory.cancel(); }
    if (effect !== 'none') key.preventDefault();
    if (effect === 'quit') this.close();
    else if (effect === 'activate') this.activateSelectedRow();
    else if (effect === 'render') this.paint();
  }

  private activate(index: number) {
    if (this.state.belowMinimum || this.state.helpOpen) return;
    const wasHarnesses = this.state.mode === 'section' && this.state.activeSection === 2;
    this.state.activateHeader(index);
    if (wasHarnesses && !(this.state.mode === 'section' && this.state.activeSection === 2)) { this.screenGeneration++; this.inventory.cancel(); }
    this.paint();
  }

  private clickListSlot(slot: number) {
    if (this.closed || this.state.helpOpen || this.state.activeSection !== 2 || !this.visible('list')) return;
    const generation = this.screenGeneration;
    const row = this.state.harnessRows[this.state.listOffset + slot];
    if (!row || generation !== this.screenGeneration || !this.state.selectHarness(row.id)) return;
    this.state.focus = 'list';
    this.paint();
  }

  private activateSelectedRow() {
    const row = this.state.selectedHarnessRow;
    if (this.state.activeSection !== 2 || row?.id !== 'command:refresh') { this.paint(); return; }
    void this.inventory.refresh();
    this.paint();
  }

  private resize() {
    this.state.resize(this.renderer.width, this.renderer.height);
    this.paint();
  }

  private paint() {
    if (this.closed) return;
    const width = this.renderer.width;
    this.ownerText.left = Math.max(0, width - ownerLabel.length - 1);
    this.brandText.width = Math.max(0, this.ownerText.left - 1);
    const rule = '─'.repeat(Math.max(1, width));
    this.headerRule.content = rule; this.footerRule.content = rule;
    this.footer.content = this.state.belowMinimum ? minimumFooter : wideFooter;

    this.navItems.forEach((item, index) => {
      const focused = this.state.focus === 'header' && this.state.headerIndex === index;
      const active = this.state.mode === 'section' && this.state.activeSection === index;
      item.bg = focused ? palette.selected : palette.surface;
      item.fg = focused ? palette.selectedText : active ? palette.focus : index < 2 ? palette.muted : palette.text;
    });
    const ownerFocused = this.state.focus === 'header' && this.state.headerIndex === destinations.length;
    this.ownerText.bg = ownerFocused ? palette.selected : palette.surface;
    this.ownerText.fg = ownerFocused ? palette.selectedText : palette.focus;

    this.listPane.visible = this.visible('list'); this.detailPane.visible = this.visible('detail');
    if (this.state.splitPane) {
      const list = listWidth(width);
      this.listPane.width = list; this.detailPane.width = Math.max(1, width - list - 1); this.detailPane.flexGrow = 0;
      this.divider.visible = true; this.divider.width = 1; this.divider.content = '│'.repeat(Math.max(1, this.renderer.height - 5));
    } else {
      this.listPane.width = '100%'; this.detailPane.width = '100%'; this.detailPane.flexGrow = 1; this.divider.visible = false;
    }
    this.paintHarnesses();
    const focusedPane = this.state.focus === 'list' || this.state.focus === 'detail' ? this.state.focus : undefined;
    this.focusPerimeter.visible = Boolean(focusedPane);
    if (focusedPane) {
      this.focusPerimeter.left = focusedPane === 'list' || !this.state.splitPane ? 0 : listWidth(width) + 1;
      this.focusPerimeter.top = 0;
      this.focusPerimeter.width = focusedPane === 'list' || !this.state.splitPane ? (this.state.splitPane ? listWidth(width) : width) : Math.max(1, width - listWidth(width) - 1);
      this.focusPerimeter.height = Math.max(1, this.renderer.height - 5);
    }
    this.syncHelp();
  }

  private paintHarnesses() {
    const shown = this.state.mode === 'section' && this.state.activeSection === 2;
    this.listTitle.visible = shown; this.detailTitle.visible = shown; this.detailText.visible = shown; this.detailAction.visible = false;
    for (const row of this.listRows) row.visible = false;
    if (!shown) { this.detailText.content = ''; return; }
    this.listTitle.content = 'LOCAL RUNTIMES';
    const bodyHeight = Math.max(1, this.renderer.height - 5);
    const capacity = Math.max(1, Math.min(this.listRows.length, bodyHeight - 4));
    this.state.setListCapacity(capacity);
    for (let slot = 0; slot < capacity; slot++) {
      const descriptor = this.state.harnessRows[this.state.listOffset + slot];
      const renderable = this.listRows[slot]!;
      if (!descriptor) continue;
      const selected = descriptor.id === this.state.harnessSelection;
      const harness = descriptor.kind === 'harness' ? this.inventorySnapshot.harnesses.find(value => `harness:${value.id}` === descriptor.id) : undefined;
      const status = harness ? harness.state === 'available' ? '● READY' : harness.state === 'not-installed' ? 'UNAVAILABLE' : harness.state === 'cli-missing' ? 'CLI MISSING' : 'INCOMPATIBLE' : this.inventorySnapshot.phase === 'refreshing' ? 'REFRESHING…' : '';
      const icon = descriptor.kind === 'command' ? '↻' : harness?.state === 'available' ? '◆' : '◇';
      const label = descriptor.kind === 'command' ? 'Refresh harnesses' : harness?.label ?? descriptor.id;
      const width = Math.max(1, (this.state.splitPane ? listWidth(this.renderer.width) : this.renderer.width) - 4);
      const gap = Math.max(1, width - icon.length - label.length - status.length - 2);
      renderable.content = `${icon} ${label}${' '.repeat(gap)}${status}`;
      renderable.width = width;
      renderable.bg = selected ? palette.selected : palette.surface;
      renderable.fg = selected ? palette.selectedText : harness?.state === 'available' ? palette.healthy : palette.text;
      renderable.visible = true;
    }
    const selected = this.state.selectedHarnessRow;
    if (selected?.kind === 'harness') {
      const harness = this.inventorySnapshot.harnesses.find(value => `harness:${value.id}` === selected.id);
      if (harness) {
        const saved = this.inventorySnapshot.savedConfigurations[harness.id] ?? 0;
        const state = harness.state === 'available' ? '● READY' : harness.state === 'not-installed' ? 'UNAVAILABLE' : harness.state === 'cli-missing' ? 'CLI MISSING' : 'INCOMPATIBLE';
        const location = harness.executable ?? 'Not found';
        this.detailTitle.content = harness.label.toUpperCase();
        this.detailText.content = `State             ${state}\nVersion           ${harness.version ?? 'Version unavailable'}\nLocation          ${location}${harness.state === 'available' ? '' : `\n\nReason            ${harness.reason}\n\nInstall or repair this runtime, then refresh harnesses.`}${saved ? `\n\nSaved configurations  ${saved}` : ''}`;
      } else { this.detailTitle.content = 'RUNTIME UNAVAILABLE'; this.detailText.content = 'This harness is no longer in the current inventory.'; }
    } else {
      this.detailTitle.content = 'REFRESH HARNESSES';
      this.detailText.content = `Check this Host again for supported harnesses and installed versions.\n\n${this.inventorySnapshot.message}\n\n────────────────────────────────────────────────────────\nAVAILABLE ACTIONS`;
      this.detailAction.top = 10;
      this.detailAction.content = this.inventorySnapshot.phase === 'refreshing' ? ' Refresh in progress ' : ' Refresh harnesses ';
      this.detailAction.visible = this.state.focus === 'detail' && this.visible('detail');
    }
  }

  private syncHelp() {
    if (!this.state.helpOpen) {
      if (this.helpScrim) { this.help?.destroyRecursively(); this.helpScrim.destroyRecursively(); this.helpScrim = undefined; this.help = undefined; this.helpBody = undefined; this.helpBodyScrollable = false; this.helpTitle = undefined; this.helpActions = undefined; }
      return;
    }
    const geometry = helpDialogGeometry(this.renderer.width, this.renderer.height, this.helpContent);
    if (!this.help) {
      this.helpScrim = new BoxRenderable(this.renderer, { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', backgroundColor: palette.scrim });
      this.renderer.root.add(this.helpScrim);
      this.help = new BoxRenderable(this.renderer, { position: 'absolute', border: true, borderColor: palette.dialog, backgroundColor: palette.surface, flexDirection: 'column', paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 });
      this.renderer.root.add(this.help);
      this.helpTitle = new TextRenderable(this.renderer, { fg: palette.focus, height: helpTitleRows, content: 'HELP\n──────────────────────────────────────────────────────────' });
      this.helpActions = new TextRenderable(this.renderer, { fg: palette.muted, height: helpActionRows, content: '──────────────────────────────────────────────────────────\nEnter / Esc  close' });
      this.help.add(this.helpTitle); this.help.add(this.helpActions);
    }
    this.help.width = geometry.width; this.help.height = geometry.height;
    this.help.left = Math.floor((this.renderer.width - geometry.width) / 2);
    this.help.top = Math.floor((this.renderer.height - geometry.height) / 2);
    const rule = '─'.repeat(Math.max(1, geometry.width - 6));
    this.helpTitle!.content = `HELP\n${rule}`;
    this.helpActions!.content = `${rule}\nEnter / Esc  close`;
    if (!this.helpBody || this.helpBodyScrollable !== geometry.scrollbar) {
      this.helpBody?.destroyRecursively();
      this.helpBodyScrollable = geometry.scrollbar;
      this.helpBody = geometry.scrollbar
        ? new ScrollBoxRenderable(this.renderer, { flexGrow: 1, scrollY: true, backgroundColor: palette.surface })
        : new BoxRenderable(this.renderer, { flexGrow: 1, backgroundColor: palette.surface });
      // OpenTUI places the bar in the ScrollBox root rather than reducing a
      // child's percentage width.  Use the geometry's reserved viewport width
      // explicitly so the bar can only occupy the trailing blank column.
      this.helpBody.add(new TextRenderable(this.renderer, { fg: palette.text, width: geometry.bodyWidth, wrapMode: 'word', content: this.helpContent }));
      this.help.insertBefore(this.helpBody, this.helpActions);
      // A constrained help body is the only modal control that can consume
      // navigation keys, so give its ScrollBox OpenTUI focus when it appears.
      if (this.helpBodyScrollable) this.helpBody.focus();
    }
    this.helpBody!.height = geometry.bodyHeight;
  }

  close(destroy = true) {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeInventory();
    this.inventory.dispose();
    if (destroy) this.renderer.destroy();
    this.finish();
  }
}

export const footerGuides = { wide: wideFooter, minimum: minimumFooter } as const;
