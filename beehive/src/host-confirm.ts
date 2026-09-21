import { BoxRenderable, TextRenderable, t, fg, type CliRenderer, type KeyEvent } from '@opentui/core';
import { palette } from './opentui-shell.ts';

/** Two explicit choices; Escape is always the non-mutating path. */
export class HostConfirm {
  private scrim: BoxRenderable;
  private surface: BoxRenderable;
  private title: TextRenderable;
  private body: TextRenderable;
  private buttons: TextRenderable[];
  private help: TextRenderable;
  private selected = 0;
  private closed = false;
  readonly done: Promise<boolean>;
  private finish!: (confirmed: boolean) => void;
  constructor(private renderer: CliRenderer, private reset: boolean) {
    this.done = new Promise(resolve => this.finish = resolve);
    this.scrim = new BoxRenderable(renderer, { position: 'absolute', width: '100%', height: '100%', backgroundColor: palette.scrim });
    this.surface = new BoxRenderable(renderer, { position: 'absolute', border: true, borderColor: palette.dialog, backgroundColor: palette.surface });
    renderer.root.add(this.scrim); renderer.root.add(this.surface);
    const text = (fg: string) => { const t = new TextRenderable(renderer, { position: 'absolute', left: 2, fg, wrapMode: 'word' }); this.surface.add(t); return t; };
    this.title = text(palette.failure); this.body = text(palette.text);
    this.buttons = [text(palette.failure), text(palette.text)];
    this.buttons.forEach((button, index) => { button.onMouseDown = () => this.complete(index === 0); });
    this.help = text(palette.muted); this.paint();
  }
  key(key: Pick<KeyEvent, 'name' | 'shift'>) {
    if (key.name === 'escape') this.cancel();
    else if (key.name === 'return') this.complete(this.selected === 0);
    else if (['tab', 'up', 'down', 'left', 'right'].includes(key.name)) { this.selected = 1 - this.selected; this.paint(); }
  }
  paint() {
    if (this.closed) return;
    const width = Math.min(68, this.renderer.width - 4), inner = width - 6;
    const message = this.reset ? 'Deletes Host identity, configuration, owner and relay binding, all local agent registrations, and their Host/agent keys. Harnesses, Providers and relay history remain.' : 'This stops the Host and every agent it is running.';
    const lines: string[] = []; let rest = message;
    while (rest.length > inner) { const at = rest.lastIndexOf(' ', inner); lines.push(rest.slice(0, at)); rest = rest.slice(at + 1); } lines.push(rest);
    const height = Math.min(this.renderer.height - 4, lines.length + 10);
    this.surface.width = width; this.surface.height = height; this.surface.left = Math.floor((this.renderer.width - width) / 2); this.surface.top = Math.floor((this.renderer.height - height) / 2);
    this.title.top = 1; this.title.height = 1; this.title.width = inner; this.title.content = this.reset ? 'RESET HOST?' : 'STOP HOST?';
    this.body.top = 3; this.body.width = inner; this.body.height = lines.length; this.body.content = lines.join('\n');
    this.buttons.forEach((button, i) => { button.top = height - 5 + i; button.width = inner; button.height = 1; button.content = t`${fg(palette.focus)(this.selected === i ? '›' : ' ')} ${i === 0 ? this.reset ? 'Reset Host' : 'Stop Host' : this.reset ? 'Keep Host' : 'Keep running'}`; });
    this.help.top = height - 2; this.help.width = inner; this.help.height = 1; this.help.content = '↑↓ choose · Enter confirm · Esc cancel';
  }
  private complete(value: boolean) { if (this.closed) return; this.closed = true; this.surface.destroyRecursively(); this.scrim.destroyRecursively(); this.finish(value); }
  cancel() { this.complete(false); }
}
