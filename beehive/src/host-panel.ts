import { BoxRenderable, TextRenderable, t, fg, type CliRenderer, type KeyEvent } from '@opentui/core';
import { palette } from './opentui-shell.ts';
import type { OwnerClient, OwnerSnapshot } from './owner-protocol.ts';
import type { ShellState } from './shell-state.ts';
import { HostConfirm } from './host-confirm.ts';

/** Single local object. The same Node owner authority gates every Host request. */
export class HostPanel {
  private snapshot: OwnerSnapshot;
  private unsubscribe: () => void;
  private box: BoxRenderable;
  private labels: TextRenderable;
  private facts: TextRenderable;
  private heading: TextRenderable;
  private actions: TextRenderable[];
  private message: TextRenderable;
  private index = 0;
  private shown = false;
  private generation = 0;
  private confirmation?: HostConfirm;
  private timer?: ReturnType<typeof setInterval>;
  private actionTop = 8;
  constructor(private renderer: CliRenderer, pane: BoxRenderable, private state: ShellState, private client: OwnerClient, private repaint: () => void) {
    this.snapshot = client.snapshot();
    this.box = new BoxRenderable(renderer, { width: '100%', height: '100%', backgroundColor: palette.surface }); pane.add(this.box);
    const text = (fg: string) => { const t = new TextRenderable(renderer, { position: 'absolute', left: 2, fg, wrapMode: 'word' }); this.box.add(t); return t; };
    this.labels = text(palette.muted); this.facts = text(palette.text); this.heading = text(palette.focus); this.message = text(palette.text);
    this.actions = Array.from({ length: 3 }, (_, i) => { const action = text(palette.text); action.onMouseDown = () => { if (!this.shown || this.confirmation || this.state.helpOpen) return; this.index = i; this.state.focus = 'detail'; this.repaint(); void this.run(); }; return action; });
    this.unsubscribe = client.subscribe(snapshot => { this.snapshot = snapshot; this.repaint(); });
  }
  get modal() { return !!this.confirmation; }
  private commands() {
    const host = this.snapshot.host;
    return [...(host?.state === 'running' ? ['Stop Host'] : host?.state === 'stopped' ? [...(host.resetPending ? [] : ['Start Host']), 'Reset Host'] : []), 'Refresh status'];
  }
  private refresh() { if (this.shown && !this.confirmation && this.snapshot.hostPhase !== 'busy' && this.snapshot.hostPhase !== 'error') void this.client.request({ action: 'host-status' }); }
  key(key: KeyEvent) {
    if (!this.shown) return false;
    if (this.confirmation) { this.confirmation.key(key); return true; }
    if (key.name === 'escape' && this.snapshot.hostPhase === 'busy') { this.client.cancel(); return true; }
    if (key.name === 'a') { this.state.focus = 'detail'; this.repaint(); return true; }
    if (this.state.focus !== 'detail') return false;
    if (key.name === 'up') { if (this.index) this.index--; else this.state.focus = 'header'; this.repaint(); return true; }
    if (key.name === 'down') { this.index = Math.min(this.index + 1, this.commands().length - 1); this.repaint(); return true; }
    if (key.name === 'left') { this.state.focus = 'header'; this.repaint(); return true; }
    if (key.name === 'return') { void this.run(); return true; }
    return false;
  }
  pointer(y: number) { const index = y - 3 - this.actionTop; if (!this.shown || this.confirmation || this.state.helpOpen || index < 0 || index >= this.commands().length) return; this.index = index; this.state.focus = 'detail'; this.repaint(); void this.run(); }
  private async run() {
    if (!this.shown || this.confirmation || this.snapshot.hostPhase === 'busy') return;
    const command = this.commands()[this.index], host = this.snapshot.host, generation = this.generation;
    if (command === 'Refresh status') { await this.client.request({ action: 'host-status' }); return; }
    if (!host) return;
    if (command === 'Stop Host' || command === 'Reset Host') {
      const dialog = new HostConfirm(this.renderer, command === 'Reset Host'); this.confirmation = dialog;
      const confirmed = await dialog.done; if (this.confirmation === dialog) this.confirmation = undefined;
      if (!confirmed || generation !== this.generation || !this.shown) { this.repaint(); return; }
    }
    await this.client.request({ action: command === 'Start Host' ? 'host-start' : command === 'Stop Host' ? 'host-stop' : 'host-reset', revision: host.revision, instance: host.instance, confirmed: command !== 'Start Host' });
    this.repaint();
  }
  paint() {
    const shown = !this.state.belowMinimum && !this.state.ownerActive && this.state.activeSection === 0 && this.snapshot.signedIn;
    const entered = shown && !this.shown;
    if (!shown && this.shown) { this.generation++; this.confirmation?.cancel(); this.confirmation = undefined; if (this.timer) clearInterval(this.timer); this.timer = undefined; }
    this.shown = shown; this.box.visible = shown;
    if (!shown) return;
    if (entered) { this.refresh(); this.timer = setInterval(() => this.refresh(), 3000); }
    const width = this.renderer.width - 4, height = this.renderer.height - 5, labelWidth = 16;
    const truncate = (value: string) => { const max = width - labelWidth; return value.length <= max ? value : value.slice(0, Math.ceil((max - 1) / 2)) + '…' + value.slice(-Math.floor((max - 1) / 2)); };
    const host = this.snapshot.host;
    this.labels.top = 1; this.labels.width = labelWidth; this.labels.height = 5; this.labels.content = 'State\nHost name\nOwner\nRelay\nAgents running';
    this.facts.top = 1; this.facts.left = 2 + labelWidth; this.facts.width = width - labelWidth; this.facts.height = 5;
    this.facts.content = host ? [host.resetPending ? 'RESET INCOMPLETE' : host.state.toUpperCase(), host.name, host.owner, host.relay, host.agents === undefined ? 'Unknown' : String(host.agents)].map(truncate).join('\n') : `${this.snapshot.hostPhase === 'error' ? 'UNKNOWN' : 'Checking…'}\n—\n—\n—\nUnknown`;
    this.heading.top = 7; this.heading.height = 1; this.heading.width = width; this.heading.content = 'AVAILABLE ACTIONS ' + '─'.repeat(Math.max(1, width - 18));
    const commands = this.commands(); this.index = Math.max(0, Math.min(this.index, commands.length - 1));
    this.actions.forEach((action, i) => { action.top = this.actionTop + i; action.width = width; action.height = 1; action.visible = i < commands.length; action.content = t`${fg(palette.focus)(this.state.focus === 'detail' && this.index === i ? '›' : ' ')} ${commands[i] ?? ''}`; action.fg = commands[i] === 'Reset Host' ? palette.failure : this.state.focus === 'detail' && this.index === i ? palette.focus : palette.text; });
    this.message.top = this.actionTop + commands.length; this.message.width = width; this.message.height = Math.max(1, height - Number(this.message.top) - 1);
    this.message.content = this.snapshot.hostMessage || 'Host runs independently of the manager.'; this.message.fg = this.snapshot.hostPhase === 'error' ? palette.failure : palette.muted;
    this.confirmation?.paint();
  }
  dispose() { if (this.timer) clearInterval(this.timer); this.confirmation?.cancel(); this.unsubscribe(); }
}
