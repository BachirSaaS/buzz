import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from '@opentui/core';
import { brand, destinations, listWidth, ownerLabel, ShellState, type FocusRegion } from './shell-state.ts';

export const palette = {
  surface: '#0d100e', text: '#dce1d8', muted: '#7d867c', divider: '#4a5149',
  focus: '#ffd34e', selected: '#dce1d8', selectedText: '#10130f', dialog: '#9ca49b', scrim: '#070907',
} as const;

const wideFooter = '←→ focus  Enter open  Tab panes  Esc return  ? help  q quit';
const compactFooter = '←→ nav ↵ open Tab panes Esc back ? help q quit';
const minimumFooter = 'Ctrl-Q quit';

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
  private readonly footerRule: TextRenderable;
  private readonly footer: TextRenderable;
  private help?: BoxRenderable;

  constructor(readonly renderer: CliRenderer) {
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
    this.body.add(this.listPane); this.body.add(this.detailPane);

    this.footerRule = new TextRenderable(renderer, { height: 1, fg: palette.divider }); this.root.add(this.footerRule);
    this.footer = new TextRenderable(renderer, { height: 1, fg: palette.muted, content: wideFooter }); this.root.add(this.footer);

    renderer.keyInput.on('keypress', key => this.key(key));
    renderer.on('resize', () => this.resize());
    renderer.on('destroy', () => this.close(false));
    this.resize();
  }

  private pane(region: Exclude<FocusRegion, 'header'>) {
    return new BoxRenderable(this.renderer, { height: '100%', border: true, borderColor: palette.divider, backgroundColor: palette.surface,
      onMouseDown: () => { if (!this.visible(region)) return; this.state.focus = region; this.paint(); } });
  }

  private visible(region: 'list' | 'detail') {
    if (!this.state.collection) return region === 'detail';
    return this.state.splitPane || this.state.narrowPane === region;
  }

  private key(key: KeyEvent) {
    const effect = this.state.key(key.name, { ctrl: key.ctrl, shift: key.shift });
    if (effect !== 'none') key.preventDefault();
    if (effect === 'quit') this.close();
    else if (effect === 'render') this.paint();
  }

  private activate(index: number) {
    if (this.state.belowMinimum || this.state.helpOpen) return;
    this.state.activateHeader(index); this.paint();
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
    this.footer.content = this.state.belowMinimum ? minimumFooter : width >= 70 ? wideFooter : compactFooter;

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
      this.listPane.width = listWidth(width); this.detailPane.width = Math.max(1, width - listWidth(width)); this.detailPane.flexGrow = 0;
    } else {
      this.listPane.width = '100%'; this.detailPane.width = '100%'; this.detailPane.flexGrow = 1;
    }
    this.listPane.borderColor = this.state.focus === 'list' ? palette.focus : palette.divider;
    this.detailPane.borderColor = this.state.focus === 'detail' ? palette.focus : palette.divider;
    this.syncHelp();
  }

  private syncHelp() {
    if (!this.state.helpOpen) {
      if (this.help) { this.help.destroyRecursively(); this.help = undefined; }
      return;
    }
    const width = Math.max(4, Math.min(62, this.renderer.width - 4));
    const height = Math.max(4, Math.min(14, this.renderer.height - 4));
    if (!this.help) {
      this.help = new BoxRenderable(this.renderer, { position: 'absolute', border: true, borderColor: palette.dialog, backgroundColor: palette.scrim, flexDirection: 'column', paddingLeft: 2, paddingRight: 2, paddingTop: 1 });
      this.renderer.root.add(this.help);
      this.help.add(new TextRenderable(this.renderer, { fg: palette.focus, height: 2, content: 'HELP\n──────────────────────────────────────────────────────────' }));
      this.help.add(new TextRenderable(this.renderer, { fg: palette.text, content: '← →  focus a destination\nEnter  activate the focused destination\nTab / Shift-Tab  move between visible regions\nEsc  return to the active header control\n? / Enter / Esc  close help\nq  quit Beehive' }));
    }
    this.help.width = width; this.help.height = height;
    this.help.left = Math.floor((this.renderer.width - width) / 2);
    this.help.top = Math.floor((this.renderer.height - height) / 2);
  }

  close(destroy = true) {
    if (this.closed) return;
    this.closed = true;
    if (destroy) this.renderer.destroy();
    this.finish();
  }
}

export const footerGuides = { wide: wideFooter, compact: compactFooter, minimum: minimumFooter } as const;
