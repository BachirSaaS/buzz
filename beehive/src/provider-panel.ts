import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from '@opentui/core';
import { palette } from './opentui-shell.ts';
import { ProviderDialog, type DialogField } from './provider-dialog.ts';
import type { ProviderClient, ProviderRow, ProviderSnapshot } from './provider-protocol.ts';
import type { ShellState } from './shell-state.ts';
import { listWidth } from './shell-state.ts';

const types = ['openai', 'anthropic', 'openai-compat', 'openrouter', 'databricks_v2'];
const labels: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', 'openai-compat': 'OpenAI-compatible', openrouter: 'OpenRouter', databricks_v2: 'Databricks v2' };

/** Supported types remain visible before any accounts are configured. */
export function providerInventory(snapshot: ProviderSnapshot): ProviderRow[] {
  return types.flatMap(type => {
    const accounts = snapshot.rows.filter(row => row.type === type);
    return accounts.length ? accounts : [{ id: `type:${type}`, name: labels[type]!, type: type as ProviderRow['type'], endpoint: '', state: 'NOT SET', detail: 'Not configured. Select Configure to get started.' }];
  });
}
/** Providers presentation. All durable changes and secret state live in Node. */
export class ProviderPanel {
  private snapshot: ProviderSnapshot;
  private unsubscribe: () => void;
  private selected = 'type:openai';
  private actionIndex = 0;
  private actionStart = 0;
  private offset = 0;
  private detailOffset = 0;
  private resultPageSize = 1;
  private list: BoxRenderable;
  private detail: BoxRenderable;
  private listTitle: TextRenderable;
  private detailTitle: TextRenderable;
  private details: TextRenderable;
  private rows: TextRenderable[] = [];
  private actions: TextRenderable[] = [];
  private status: TextRenderable;
  private result: TextRenderable;
  private actionTitle: TextRenderable;
  private dialog?: ProviderDialog;
  private active = false;
  private generation = 0;
  constructor(private renderer: CliRenderer, listPane: BoxRenderable, detailPane: BoxRenderable, private state: ShellState, private client: ProviderClient, private repaint: () => void) {
    this.snapshot = client.snapshot();
    this.list = new BoxRenderable(renderer, { width: '100%', height: '100%', backgroundColor: palette.surface });
    this.detail = new BoxRenderable(renderer, { width: '100%', height: '100%', backgroundColor: palette.surface });
    listPane.add(this.list); detailPane.add(this.detail);
    this.listTitle = new TextRenderable(renderer, { left: 2, top: 1, position: 'absolute', height: 1, fg: palette.muted, content: 'MODEL ACCOUNTS' }); this.list.add(this.listTitle);
    this.detailTitle = new TextRenderable(renderer, { left: 2, top: 1, position: 'absolute', height: 1, fg: palette.muted }); this.detail.add(this.detailTitle);
    this.details = new TextRenderable(renderer, { left: 2, top: 3, position: 'absolute', fg: palette.text, wrapMode: 'word' }); this.detail.add(this.details);
    this.actionTitle = new TextRenderable(renderer, { left: 2, position: 'absolute', height: 1, fg: palette.focus, content: 'AVAILABLE ACTIONS ───' }); this.detail.add(this.actionTitle);
    this.status = new TextRenderable(renderer, { left: 2, position: 'absolute', fg: palette.muted, wrapMode: 'word' }); this.detail.add(this.status);
    this.result = new TextRenderable(renderer, { left: 2, position: 'absolute', fg: palette.text }); this.detail.add(this.result);
    for (let i = 0; i < 40; i++) {
      const row = new TextRenderable(renderer, { left: 2, position: 'absolute', height: 1, fg: palette.text, onMouseDown: () => this.select(i + this.offset) }); this.list.add(row); this.rows.push(row);
    }
    for (let i = 0; i < 7; i++) {
      const action = new TextRenderable(renderer, { left: 2, position: 'absolute', height: 1, fg: palette.text, onMouseDown: () => { if (!this.active || this.dialog) return; this.actionIndex = i; this.state.focus = 'detail'; this.repaint(); void this.run(); } }); this.detail.add(action); this.actions.push(action);
    }
    this.unsubscribe = client.subscribe(snapshot => { if (this.snapshot.message !== snapshot.message) this.detailOffset = 0; this.snapshot = snapshot; this.dialog?.updateSecretLength(snapshot.secretLength); this.paint(); });
  }
  private items() { return [...providerInventory(this.snapshot).map(row => row.id), 'reload']; }
  private row() { return providerInventory(this.snapshot).find(row => row.id === this.selected); }
  private commands() {
    if (this.selected === 'reload') return ['Reload providers'];
    if (this.selected.startsWith('type:')) return ['Configure'];
    return ['Edit configuration', 'Refresh models', ...(this.row()?.type === 'databricks_v2' ? ['Sign in to Databricks'] : [])];
  }
  private select(index: number) {
    if (!this.active || this.dialog) return;
    const id = this.items()[index]; if (!id) return;
    this.selected = id; this.actionIndex = 0; this.detailOffset = 0; this.state.focus = 'list'; this.repaint();
  }
  setActive(active: boolean) {
    if (this.active && !active) { this.generation++; this.dialog?.cancel(); this.dialog = undefined; this.client.cancel(); }
    const entered = active && !this.active;
    this.active = active; this.list.visible = active; this.detail.visible = active;
    if (entered) void this.client.request({ action: 'reload' });
    this.paint();
  }
  paste(value: string) { if (this.dialog) { this.dialog.paste(value); return true; } return false; }
  key(key: KeyEvent): boolean {
    if (!this.active) return false;
    if (this.dialog) { this.dialog.key(key); return true; }
    if (this.snapshot.phase === 'busy' && key.name === 'escape') { this.client.cancel(); return true; }
    if (key.name === 'a') { this.state.focus = 'detail'; this.repaint(); return true; }
    if (key.name === 'tab') { this.state.focus = this.state.focus === 'list' ? 'detail' : this.state.focus === 'detail' ? 'list' : 'list'; this.repaint(); return true; }
    if (this.state.focus === 'list' && ['up', 'down'].includes(key.name)) {
      const index = this.items().indexOf(this.selected), next = index + (key.name === 'up' ? -1 : 1);
      if (next < 0) { this.state.focus = 'header'; this.state.headerIndex = 3; this.repaint(); }
      else this.select(Math.min(this.items().length - 1, next));
      return true;
    }
    if (this.state.focus === 'detail') {
      if (['up', 'down'].includes(key.name)) { this.actionIndex = Math.max(0, Math.min(this.commands().length - 1, this.actionIndex + (key.name === 'up' ? -1 : 1))); this.paint(); return true; }
      if (['pageup', 'pagedown'].includes(key.name)) { this.detailOffset = Math.max(0, this.detailOffset + (key.name === 'pageup' ? -this.resultPageSize : this.resultPageSize)); this.paint(); return true; }
      if (key.name === 'return') { void this.run(); return true; }
    }
    return false;
  }
  private async form(title: string, fields: DialogField[], submit = 'Save', message?: string) {
    this.client.secret('clear');
    const dialog = new ProviderDialog(this.renderer, title, fields, (action, value) => this.client.secret(action, value), submit, message);
    this.dialog = dialog;
    const result = await dialog.done;
    if (this.dialog === dialog) this.dialog = undefined;
    this.repaint(); return result;
  }
  private async edit(row: ProviderRow | undefined, type: ProviderRow['type']) {
    const generation = this.generation, revision = this.snapshot.revision;
    const fields: DialogField[] = [{ label: 'Name', value: row?.name ?? labels[type]! }];
    if (type === 'databricks_v2') fields.push({ label: 'Workspace (DATABRICKS_HOST)', value: row?.endpoint ?? this.snapshot.databricksHost ?? '' });
    else {
      if (type === 'openai-compat') fields.push({ label: 'Endpoint', value: row?.endpoint ?? 'https://' }, { label: 'Wire', value: row?.wire ?? 'auto', choices: ['auto', 'chat', 'responses'] });
      fields.push({ label: 'API key', secret: true, savedSecret: !!row });
    }
    const result = await this.form(row ? 'EDIT PROVIDER' : 'CONFIGURE PROVIDER', fields);
    if (!result || generation !== this.generation) return;
    await this.client.request({ action: 'save', provider: row?.id ?? `type:${type}`, revision, values: { type, name: result.Name!, endpoint: result['Workspace (DATABRICKS_HOST)'] ?? result.Endpoint ?? '', wire: result.Wire ?? 'auto' } });
  }
  pointer(y: number) {
    if (!this.active || this.dialog) return;
    if (this.state.focus === 'list') this.select(y - 6 + this.offset);
    else {
      const index = y - 3 - this.actionStart;
      if (index >= 0 && index < this.commands().length) { this.actionIndex = index; this.repaint(); void this.run(); }
    }
  }
  scroll(direction: string) {
    if (!this.active || this.dialog) return;
    if (this.state.focus === 'list') this.select(Math.max(0, Math.min(this.items().length - 1, this.items().indexOf(this.selected) + (direction === 'up' ? -1 : 1))));
    else { this.detailOffset = Math.max(0, this.detailOffset + (direction === 'up' ? -1 : 1)); this.paint(); }
  }
  private async run() {
    if (this.snapshot.phase === 'busy' || this.dialog || !this.active) return;
    const command = this.commands()[this.actionIndex], row = this.row();
    if (command === 'Reload providers') await this.client.request({ action: 'reload' });
    else if (row) {
      if (row.id.startsWith('type:')) { await this.edit(undefined, row.type); return; }
      if (command === 'Edit configuration') await this.edit(row, row.type);
      else await this.client.request({ action: command === 'Refresh models' ? 'models' : 'login', provider: row.id, revision: this.snapshot.revision });
    }
  }
  paint() {
    if (!this.active) return;
    const height = this.renderer.height - 5, leftWidth = listWidth(this.renderer.width) - 4, width = this.renderer.width - listWidth(this.renderer.width) - 5;
    const items = this.items(); if (!items.includes(this.selected)) {
      const type = this.selected.startsWith('type:') ? this.selected.slice(5) : undefined;
      this.selected = (type && this.snapshot.rows.find(row => row.type === type)?.id) || items[0]!;
    }
    const selectedIndex = items.indexOf(this.selected), capacity = Math.min(this.rows.length, Math.max(1, height - 4));
    if (selectedIndex < this.offset) this.offset = selectedIndex;
    if (selectedIndex >= this.offset + capacity) this.offset = selectedIndex - capacity + 1;
    this.rows.forEach((renderable, slot) => {
      const id = items[this.offset + slot], row = providerInventory(this.snapshot).find(row => row.id === id);
      renderable.visible = slot < capacity && !!id; renderable.top = slot + 3; renderable.width = leftWidth;
      if (row) {
        const status = row.state;
        const available = Math.max(1, leftWidth - status.length - 3);
        const name = row.name.length > available ? row.name.slice(0, Math.max(1, available - 1)) + '…' : row.name;
        renderable.content = `◇ ${name.padEnd(available)} ${status}`;
      } else renderable.content = '↻ Reload providers'.slice(0, leftWidth);
      renderable.bg = id === this.selected ? palette.selected : palette.surface; renderable.fg = id === this.selected ? palette.selectedText : palette.text;
    });
    const row = this.row();
    this.detailTitle.content = row ? row.name.toUpperCase() : 'RELOAD PROVIDERS'; this.detailTitle.width = width;
    const commands = this.commands();
    const compact = this.renderer.height < 28;
    const ownsResult = this.snapshot.resultTarget === this.selected;
    const modelCount = row?.modelCount === undefined ? '' : `${row.modelCount} ${row.modelCount === 1 ? 'model' : 'models'}`;
    const info = row ? [`State       ${row.state}${modelCount ? ` · ${modelCount}` : ''}`, `Type        ${row.type}`, ...(row.endpoint ? [`Connects to ${row.endpoint}`] : []), '', row.detail] : ['Reload saved providers and check their model catalogs. No owner sign-in is required.'];
    const wrap = (lines: string[]) => lines.flatMap(line => {
      const result: string[] = [];
      while (line.length > width) {
        const space = line.lastIndexOf(' ', width);
        const end = space > 0 ? space : width;
        result.push(line.slice(0, end)); line = line.slice(end).trimStart();
      }
      result.push(line); return result;
    });
    const fullDetails = wrap(info);
    // Reserve every action and a result viewport before allocating detail rows.
    this.detailTitle.top = 1;
    const detailTop = compact ? 2 : 3;
    const detailCapacity = compact ? 2 : Math.max(1, height - commands.length - 10);
    const compactSummary = row ? [
      `${row.state}${modelCount ? ` · ${modelCount}` : ''}`,
      row.state === 'Connected' ? 'Execution not tested' : row.state === 'Failed' ? 'Catalog unavailable' : row.state === 'Checking…' ? 'Checking model access' : row.id.startsWith('type:') ? 'Select Configure to get started' : 'Model access not checked',
    ] : ['Reload saved accounts', 'Check model access'];
    const summary = compact ? compactSummary : fullDetails.slice(0, detailCapacity);
    this.details.top = detailTop; this.details.width = width; this.details.height = summary.length; this.details.content = summary.join('\n');
    this.actionTitle.top = detailTop + summary.length + (compact ? 0 : 1); this.actionTitle.width = width;
    this.actionTitle.content = 'AVAILABLE ACTIONS ' + '─'.repeat(Math.max(1, width - 18));
    this.actionStart = Number(this.actionTitle.top) + 1;
    this.actions.forEach((action, index) => {
      const focused = this.state.focus === 'detail' && this.actionIndex === index;
      action.visible = index < commands.length; action.top = this.actionStart + index; action.width = width;
      action.content = `${focused ? '›' : ' '} ${commands[index] ?? ''}`;
      action.fg = focused ? palette.focus : palette.text; action.bg = palette.surface;
    });
    const resultTop = this.actionStart + commands.length;
    const resultCapacity = Math.max(1, height - 2 - resultTop);
    this.resultPageSize = resultCapacity;
    const recovery = row?.state === 'Failed' ? row.type === 'databricks_v2'
      ? 'Check workspace and network. Sign in to Databricks, then Refresh models.'
      : 'Check API key, endpoint, network and model access. Then Refresh models.' : undefined;
    const output = [
      ...(recovery ? [recovery] : []),
      ...(ownsResult && this.snapshot.message ? [`${this.snapshot.phase === 'error' ? 'FAILED' : this.snapshot.phase === 'busy' ? 'WORKING' : 'RESULT'}: ${this.snapshot.message}`] : []),
      ...(compact ? row ? [`Type ${row.type}`, ...(row.endpoint ? [`Connects to ${row.endpoint}`] : [])] : [] : fullDetails.length > detailCapacity ? ['DETAILS', ...info] : []),
    ];
    const wrapped = wrap(output);
    this.detailOffset = Math.min(this.detailOffset, Math.max(0, wrapped.length - resultCapacity));
    this.result.top = resultTop; this.result.width = width; this.result.height = resultCapacity;
    this.result.content = wrapped.slice(this.detailOffset, this.detailOffset + resultCapacity).join('\n');
    this.result.fg = row?.state === 'Failed' || ownsResult && this.snapshot.phase === 'error' ? palette.failure : palette.text;
    this.details.fg = row?.state === 'Failed' ? palette.failure : palette.text;
    this.status.top = height - 2; this.status.width = width; this.status.height = 1;
    this.status.content = ownsResult && this.snapshot.phase === 'busy' ? 'Working… Esc stops waiting' : '↑↓ actions · PgUp/PgDn output';
    this.status.fg = palette.muted;
    this.dialog?.paint();
  }
  dispose() { this.generation++; this.dialog?.cancel(); this.unsubscribe(); this.client.dispose(); }
}
