import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from '@opentui/core';
import { palette } from './opentui-shell.ts';

export type DialogField = { label: string; value?: string; secret?: boolean; choices?: string[] };
export type DialogResult = Record<string, string>;

/** Public form state only. Secret keystrokes go straight to the controller. */
export class ProviderDialog {
  private scrim: BoxRenderable;
  private surface: BoxRenderable;
  private title: TextRenderable;
  private rows: TextRenderable[] = [];
  private labels: TextRenderable[] = [];
  private borders: TextRenderable[] = [];
  private actionBorder: TextRenderable;
  private help: TextRenderable;
  private actions: TextRenderable;
  private notice?: TextRenderable;
  private index = 0;
  private offset = 0;
  private secretLength = 0;
  private closed = false;
  readonly done: Promise<DialogResult | undefined>;
  private finish!: (value: DialogResult | undefined) => void;
  constructor(private renderer: CliRenderer, private heading: string, readonly fields: DialogField[], private secret: (action: 'append' | 'backspace' | 'clear', value?: string) => void, private submitLabel = 'Save', private message?: string) {
    this.done = new Promise(resolve => this.finish = resolve);
    this.scrim = new BoxRenderable(renderer, { position: 'absolute', width: '100%', height: '100%', backgroundColor: palette.scrim });
    this.surface = new BoxRenderable(renderer, { position: 'absolute', border: true, borderColor: palette.dialog, backgroundColor: palette.surface });
    renderer.root.add(this.scrim); renderer.root.add(this.surface);
    this.title = new TextRenderable(renderer, { position: 'absolute', top: 1, left: 2, height: 1, fg: palette.focus });
    this.surface.add(this.title);
    if (message) {
      this.notice = new TextRenderable(renderer, { position: 'absolute', top: 3, left: 2, fg: palette.text, wrapMode: 'word', content: message });
      this.surface.add(this.notice);
    }
    for (let i = 0; i < fields.length; i++) {
      const focus = () => { this.index = i; this.paint(); };
      const label = new TextRenderable(renderer, { position: 'absolute', left: 2, height: 1, fg: palette.muted, onMouseDown: focus });
      this.surface.add(label); this.labels.push(label);
      const border = new TextRenderable(renderer, { position: 'absolute', left: 2, height: 1, onMouseDown: focus });
      this.surface.add(border); this.borders.push(border);
      const row = new TextRenderable(renderer, { position: 'absolute', left: 4, height: 1, fg: palette.text, onMouseDown: focus });
      this.surface.add(row); this.rows.push(row);
    }
    this.actions = new TextRenderable(renderer, { position: 'absolute', left: 2, height: 1, fg: palette.text, onMouseDown: () => { this.index = this.fields.length; this.paint(); this.complete(); } });
    this.actionBorder = new TextRenderable(renderer, { position: 'absolute', left: 2, height: 1, onMouseDown: () => this.complete() });
    this.surface.add(this.actionBorder);
    this.actions.left = 4;
    this.help = new TextRenderable(renderer, { position: 'absolute', left: 2, height: 1, fg: palette.muted });
    this.surface.add(this.help); this.surface.add(this.actions); this.paint();
  }
  updateSecretLength(length: number) { this.secretLength = length; this.paint(); }
  paste(value: string) {
    const field = this.fields[this.index];
    if (!field || field.choices) return;
    const text = value.replace(/[\x00-\x1f\x7f]/g, '');
    if (field.secret) this.secret('append', text);
    else field.value = ((field.value ?? '') + text).slice(0, 4096);
    this.paint();
  }
  key(key: Pick<KeyEvent, 'name' | 'ctrl' | 'shift' | 'meta' | 'sequence'>) {
    if (key.name === 'escape') { this.cancel(); return; }
    if (key.name === 'tab' || key.name === 'down' || key.name === 'up') {
      const delta = key.name === 'up' || key.shift ? -1 : 1;
      this.index = (this.index + delta + this.fields.length + 1) % (this.fields.length + 1); this.paint(); return;
    }
    const field = this.fields[this.index];
    if (key.name === 'return') {
      if (!field) this.complete();
      else { this.index++; this.paint(); }
      return;
    }
    if (!field) return;
    if (field.choices) {
      if (key.name === 'left' || key.name === 'right') {
        const current = Math.max(0, field.choices.indexOf(field.value ?? ''));
        field.value = field.choices[(current + (key.name === 'left' ? -1 : 1) + field.choices.length) % field.choices.length];
      }
    } else if (key.ctrl && key.name === 'u') {
      if (field.secret) this.secret('clear'); else field.value = '';
    } else if (key.name === 'backspace') {
      if (field.secret) this.secret('backspace'); else field.value = [...(field.value ?? '')].slice(0, -1).join('');
    } else if (!key.ctrl && !key.meta && key.sequence && !/[\x00-\x1f\x7f]/.test(key.sequence)) this.paste(key.sequence);
    this.paint();
  }
  paint() {
    if (this.closed) return;
    const width = Math.min(68, this.renderer.width - 4), height = Math.min(this.renderer.height - 4, this.message ? 15 : 7 + this.fields.length * 3);
    this.surface.width = width; this.surface.height = height;
    this.surface.left = Math.floor((this.renderer.width - width) / 2); this.surface.top = Math.floor((this.renderer.height - height) / 2);
    this.title.content = this.heading; this.title.width = width - 6;
    if (this.notice) { this.notice.width = width - 6; this.notice.height = height - 7; }
    const capacity = Math.max(1, Math.floor((height - 7) / 3));
    const selected = Math.min(this.index, this.fields.length - 1);
    if (selected < this.offset) this.offset = selected;
    if (selected >= this.offset + capacity) this.offset = selected - capacity + 1;
    this.rows.forEach((row, i) => {
      const field = this.fields[i]!; row.visible = i >= this.offset && i < this.offset + capacity;
      const label = this.labels[i]!; label.visible = row.visible;
      label.top = 3 + (i - this.offset) * 3; label.width = width - 6; label.content = field.label;
      row.top = label.top + 1; row.width = width - 10;
      const value = field.secret ? '•'.repeat(Math.min(this.secretLength, width - 10)) : field.value ?? '';
      const focused = this.index === i;
      const prompt = field.secret ? (field.label.includes('blank keeps saved') ? 'Leave blank to keep saved' : 'Enter API key') : `Enter ${field.label.toLowerCase()}`;
      const suffix = field.choices ? '  ← →' : '';
      row.content = (value || prompt).slice(-(width - 10 - suffix.length)).padEnd(width - 10 - suffix.length) + suffix;
      row.fg = value ? palette.text : palette.muted;
      const border = this.borders[i]!; border.visible = row.visible; border.top = row.top; border.width = width - 6;
      border.content = '[' + ' '.repeat(width - 8) + ']'; border.fg = focused ? palette.focus : palette.muted;
    });
    this.actions.top = height - 4; this.actions.width = this.submitLabel.length;
    this.actions.content = this.submitLabel; this.actions.fg = palette.text;
    this.actionBorder.top = height - 4; this.actionBorder.width = this.submitLabel.length + 4;
    this.actionBorder.content = '[' + ' '.repeat(this.submitLabel.length + 2) + ']';
    this.actionBorder.fg = this.index === this.fields.length ? palette.focus : palette.muted;
    this.help.top = height - 3; this.help.width = width - 6;
    this.help.content = this.message ? 'Enter or Esc close' : 'Tab next · Esc cancel · Ctrl-U clear';
  }
  private complete() {
    const values = Object.fromEntries(this.fields.filter(field => !field.secret).map(field => [field.label, field.value ?? field.choices?.[0] ?? '']));
    this.destroy(); this.finish(values);
  }
  cancel() { if (this.closed) return; this.secret('clear'); this.destroy(); this.finish(undefined); }
  private destroy() { this.closed = true; this.surface.destroyRecursively(); this.scrim.destroyRecursively(); }
}
