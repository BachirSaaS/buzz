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
  private actions: TextRenderable;
  private index = 0;
  private offset = 0;
  private secretLength = 0;
  private closed = false;
  readonly done: Promise<DialogResult | undefined>;
  private finish!: (value: DialogResult | undefined) => void;
  constructor(private renderer: CliRenderer, private heading: string, readonly fields: DialogField[], private secret: (action: 'append' | 'backspace' | 'clear', value?: string) => void, private submitLabel = 'Save') {
    this.done = new Promise(resolve => this.finish = resolve);
    this.scrim = new BoxRenderable(renderer, { position: 'absolute', width: '100%', height: '100%', backgroundColor: palette.scrim });
    this.surface = new BoxRenderable(renderer, { position: 'absolute', border: true, borderColor: palette.dialog, backgroundColor: palette.surface });
    renderer.root.add(this.scrim); renderer.root.add(this.surface);
    this.title = new TextRenderable(renderer, { position: 'absolute', top: 1, left: 2, height: 1, fg: palette.focus });
    this.surface.add(this.title);
    for (let i = 0; i < fields.length; i++) {
      const row = new TextRenderable(renderer, { position: 'absolute', left: 2, height: 2, fg: palette.text, onMouseDown: () => { this.index = i; this.paint(); } });
      this.surface.add(row); this.rows.push(row);
    }
    this.actions = new TextRenderable(renderer, { position: 'absolute', left: 2, height: 2, fg: palette.text, onMouseDown: () => this.complete() });
    this.surface.add(this.actions); this.paint();
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
    const width = Math.min(68, this.renderer.width - 4), height = Math.min(this.renderer.height - 4, 7 + this.fields.length * 3);
    this.surface.width = width; this.surface.height = height;
    this.surface.left = Math.floor((this.renderer.width - width) / 2); this.surface.top = Math.floor((this.renderer.height - height) / 2);
    this.title.content = this.heading; this.title.width = width - 6;
    const capacity = Math.max(1, Math.floor((height - 7) / 3));
    const selected = Math.min(this.index, this.fields.length - 1);
    if (selected < this.offset) this.offset = selected;
    if (selected >= this.offset + capacity) this.offset = selected - capacity + 1;
    this.rows.forEach((row, i) => {
      const field = this.fields[i]!; row.visible = i >= this.offset && i < this.offset + capacity;
      row.top = 3 + (i - this.offset) * 3; row.width = width - 6;
      const value = field.secret ? '•'.repeat(Math.min(this.secretLength, width - 10)) : field.value ?? '';
      row.content = `${field.label}${field.choices ? '  ← →' : ''}\n${value.slice(-(width - 6)) || ' '}`;
      row.bg = this.index === i ? palette.selected : palette.surface;
      row.fg = this.index === i ? palette.selectedText : palette.text;
    });
    this.actions.top = height - 4; this.actions.width = width - 6;
    this.actions.content = ` ${this.submitLabel} \nTab next · Esc cancel · Ctrl-U clear`;
    this.actions.bg = this.index === this.fields.length ? palette.selected : palette.surface;
    this.actions.fg = this.index === this.fields.length ? palette.selectedText : palette.text;
  }
  private complete() {
    const values = Object.fromEntries(this.fields.filter(field => !field.secret).map(field => [field.label, field.value ?? field.choices?.[0] ?? '']));
    this.destroy(); this.finish(values);
  }
  cancel() { if (this.closed) return; this.secret('clear'); this.destroy(); this.finish(undefined); }
  private destroy() { this.closed = true; this.surface.destroyRecursively(); this.scrim.destroyRecursively(); }
}
