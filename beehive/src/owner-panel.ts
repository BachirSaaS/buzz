import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from '@opentui/core';
import { palette } from './opentui-shell.ts';
import { ProviderDialog } from './provider-dialog.ts';
import type { OwnerClient, OwnerSnapshot } from './owner-protocol.ts';
import { destinations, type ShellState } from './shell-state.ts';

/** Full-width owner screen and access gate. Only public session facts enter Bun. */
export class OwnerPanel {
  private snapshot: OwnerSnapshot;
  private unsubscribe: () => void;
  private box: BoxRenderable;
  private title: TextRenderable;
  private facts: TextRenderable;
  private labels: TextRenderable;
  private heading: TextRenderable;
  private actions: TextRenderable[] = [];
  private message: TextRenderable;
  private note: TextRenderable;
  private dialog?: ProviderDialog;
  private index = 0;
  private actionTop = 0;
  private relay = '';
  private requestedSection?: number;
  private prior?: { mode: ShellState['mode']; activeSection: number; headerIndex: number; focus: ShellState['focus'] };
  private shown = false;
  private generation = 0;
  private wasOwner = false;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private renderer: CliRenderer, pane: BoxRenderable, private state: ShellState, private client: OwnerClient, private repaint: () => void) {
    this.snapshot = client.snapshot();
    this.box = new BoxRenderable(renderer, { width: '100%', height: '100%', backgroundColor: palette.surface }); pane.add(this.box);
    const text = (fg: string) => { const t = new TextRenderable(renderer, { position: 'absolute', left: 2, fg, wrapMode: 'word' }); this.box.add(t); return t; };
    this.title = text(palette.muted); this.facts = text(palette.text); this.labels = text(palette.muted); this.heading = text(palette.focus);
    for (let i = 0; i < 4; i++) {
      const action = text(palette.text); action.onMouseDown = () => { if (!this.shown || this.dialog || this.state.helpOpen) return; this.index = i; this.state.focus = 'detail'; this.repaint(); void this.run(); }; this.actions.push(action);
    }
    this.message = text(palette.text); this.note = text(palette.muted);
    this.unsubscribe = client.subscribe(snapshot => { if (this.snapshot.signedIn && !snapshot.signedIn && !snapshot.relay) this.relay = ''; this.snapshot = snapshot; this.state.signedIn = snapshot.signedIn; this.dialog?.updateSecretLength(snapshot.secretLength); this.repaint(); });
  }
  get modal() { return !!this.dialog; }
  private commands() {
    if (!this.state.ownerActive) return this.snapshot.signedIn ? [] : ['Sign in'];
    if (this.snapshot.signedIn) return ['Sign out'];
    if (!this.snapshot.relay && !this.relay) return ['Choose a relay', 'Use Buzz Desktop identity', 'Provide owner nsec'];
    return ['Use Buzz Desktop identity', 'Provide owner nsec', ...(this.snapshot.relay ? [] : ['Change relay'])];
  }
  private disabled(command: string) { return command === 'Use Buzz Desktop identity' && (this.snapshot.desktop !== 'available' || !(this.snapshot.relay || this.relay)) || command === 'Provide owner nsec' && !(this.snapshot.relay || this.relay); }
  private selectionNote(command: string) {
    if (command === 'Use Buzz Desktop identity') return !(this.snapshot.relay || this.relay) ? 'Choose a relay first. No sign-in or connection happens yet.' : this.snapshot.desktopReason;
    if (command === 'Provide owner nsec') return !(this.snapshot.relay || this.relay) ? 'Choose a relay first.' : 'Your nsec stays in memory until sign-out or quit.';
    if (command === 'Sign out') return 'Signs out of Beehive. Host and agents keep running.';
    if (command.includes('relay')) return 'First sign-in binds this Host to the owner and relay.';
    return 'Host and Agents require owner sign-in. Harnesses and Providers do not.';
  }
  private openOwner() {
    this.prior = { mode: this.state.mode, activeSection: this.state.activeSection, headerIndex: this.state.headerIndex, focus: this.state.focus };
    this.requestedSection = this.state.activeSection;
    this.state.mode = 'owner'; this.state.headerIndex = destinations.length; this.state.focus = 'detail'; this.index = 0; this.repaint();
  }
  private focusOwner() {
    this.generation++; this.requestedSection = undefined; this.prior = undefined; this.index = 0;
    this.state.mode = 'owner'; this.state.headerIndex = destinations.length; this.state.focus = 'header'; this.repaint();
  }
  private back() {
    if (this.snapshot.signedIn) { this.focusOwner(); return; }
    this.generation++; this.client.cancel(); this.requestedSection = undefined;
    if (this.prior) { Object.assign(this.state, this.prior); this.prior = undefined; }
    else { this.state.mode = 'section'; this.state.headerIndex = this.state.activeSection; this.state.focus = 'header'; }
    this.repaint();
  }
  key(key: KeyEvent) {
    if (!this.shown) return false;
    if (this.dialog) { this.dialog.key(key); return true; }
    if (key.name === 'escape' && this.snapshot.phase === 'busy') { this.generation++; this.client.cancel(); return true; }
    if (key.name === 'escape' && this.state.ownerActive) { this.back(); return true; }
    if (key.name === 'a' && this.commands().length) { this.state.focus = 'detail'; this.repaint(); return true; }
    if (this.state.focus !== 'detail') return false;
    if (key.name === 'up') { if (this.index > 0) this.index--; else { this.state.focus = 'header'; this.state.headerIndex = this.state.ownerActive ? destinations.length : this.state.activeSection; } this.repaint(); return true; }
    if (key.name === 'down') { this.index = Math.min(this.commands().length - 1, this.index + 1); this.repaint(); return true; }
    if (key.name === 'left') { if (this.state.ownerActive) this.back(); else { this.state.focus = 'header'; this.repaint(); } return true; }
    if (key.name === 'return') { void this.run(); return true; }
    return false;
  }
  paste(value: string) { if (!this.dialog) return false; this.dialog.paste(value); return true; }
  pointer(y: number) {
    if (!this.shown || this.dialog || this.state.helpOpen) return;
    const index = y - 3 - this.actionTop;
    if (index < 0 || index >= this.commands().length) return;
    this.index = index; this.state.focus = 'detail'; this.repaint(); void this.run();
  }
  private async run() {
    if (this.dialog || !this.shown || this.snapshot.phase === 'busy') return;
    const command = this.commands()[this.index]; if (!command || this.disabled(command)) return;
    const generation = this.generation;
    if (command === 'Sign in') { this.openOwner(); return; }
    if (command === 'Sign out') { this.requestedSection = undefined; this.prior = undefined; this.index = 0; await this.client.request({ action: 'signout' }); this.repaint(); return; }
    if (command.includes('relay')) {
      const dialog = new ProviderDialog(this.renderer, 'CHOOSE A RELAY', [{ label: 'Relay URL', value: this.relay || 'wss://' }], () => {}, 'Use relay');
      this.dialog = dialog; const result = await dialog.done; if (this.dialog === dialog) this.dialog = undefined;
      if (result && generation === this.generation) { this.relay = result['Relay URL']!.trim(); this.index = 0; }
      this.repaint(); return;
    }
    if (command === 'Provide owner nsec') {
      this.client.secret('clear');
      const dialog = new ProviderDialog(this.renderer, 'PROVIDE OWNER NSEC', [{ label: 'Owner nsec', secret: true }], (action, value) => this.client.secret(action, value), 'Sign in');
      this.dialog = dialog; const result = await dialog.done; if (this.dialog === dialog) this.dialog = undefined;
      if (!result || generation !== this.generation) { this.repaint(); return; }
    }
    const ok = await this.client.request({ action: command === 'Use Buzz Desktop identity' ? 'signin-desktop' : 'signin-nsec', relay: this.relay });
    if (ok && generation === this.generation && this.snapshot.signedIn) {
      const target = this.requestedSection ?? 0;
      this.requestedSection = undefined; this.prior = undefined; this.index = 0;
      this.state.activateHeader(target);
    }
    this.repaint();
  }
  private probe() {
    if (this.shown && this.state.ownerActive && !this.snapshot.signedIn && !this.dialog && !this.state.helpOpen && this.snapshot.phase !== 'busy') void this.client.request({ action: 'probe' });
  }
  paint() {
    const owner = this.state.ownerActive;
    const shown = !this.state.belowMinimum && (owner || this.state.protectedSection && !(this.state.activeSection === 0 && this.snapshot.signedIn));
    const left = (this.wasOwner && !owner) || (this.shown && !shown);
    this.wasOwner = owner; this.shown = shown; this.box.visible = shown;
    if (left) {
      this.generation++; this.dialog?.cancel(); this.dialog = undefined;
      if (this.snapshot.phase === 'busy') this.client.cancel();
      this.requestedSection = undefined; this.prior = undefined; this.index = 0;
    }
    const detecting = shown && owner && !this.snapshot.signedIn;
    if (!detecting && this.timer) { clearInterval(this.timer); this.timer = undefined; }
    if (detecting && !this.timer) { this.timer = setInterval(() => this.probe(), 3000); this.probe(); }
    if (!shown) return;
    const width = this.renderer.width - 4, height = this.renderer.height - 5;
    const wrap = (value: string) => { const rows: string[] = []; for (const line of value.split('\n')) { let rest = line; while (rest.length > width) { const at = rest.lastIndexOf(' ', width); const end = at > 0 ? at : width; rows.push(rest.slice(0, end)); rest = rest.slice(end).trimStart(); } rows.push(rest); } return rows; };
    const truncate = (value: string) => { const limit = width - (owner && this.requestedSection !== undefined ? 19 : 8); return value.length > limit ? value.slice(0, Math.ceil((limit - 1) / 2)) + '…' + value.slice(-Math.floor((limit - 1) / 2)) : value; };
    const commands = this.commands(); this.index = Math.max(0, Math.min(this.index, commands.length - 1));
    this.title.top = 1; this.title.width = width; this.title.height = 1;
    this.title.content = owner ? this.snapshot.signedIn ? 'SIGNED IN' : this.requestedSection === undefined ? 'OWNER SIGN-IN' : 'SIGN-IN REQUIRED' : destinations[this.state.activeSection]!;
    const contextual = owner && this.requestedSection !== undefined;
    const labelWidth = contextual ? 19 : 8;
    this.facts.top = 2; this.facts.left = owner ? 2 + labelWidth : 2; this.facts.width = owner ? width - labelWidth : width;
    this.labels.top = 2; this.labels.width = labelWidth; this.labels.height = contextual ? 3 : 2; this.labels.visible = owner; this.labels.content = (contextual ? 'Requested section\n' : '') + 'Relay\nOwner';
    this.facts.content = owner ? `${contextual ? (this.requestedSection === 0 ? 'Host' : 'Agents') + '\n' : ''}${truncate(this.snapshot.relay || this.relay || 'Not configured')}\n${truncate(this.snapshot.owner || this.snapshot.boundOwner || 'Not configured')}` : this.snapshot.signedIn ? 'Owner access granted.\nThis section is not implemented in this slice.' : `Sign in to view and manage ${this.state.activeSection === 0 ? 'Host' : 'Agents'}.`;
    this.facts.height = contextual ? 3 : owner || this.snapshot.signedIn ? 2 : 1;
    this.heading.top = contextual ? 5 : 4; this.heading.width = width; this.heading.height = 1; this.heading.visible = commands.length > 0;
    this.heading.content = 'AVAILABLE ACTIONS ' + '─'.repeat(Math.max(1, width - 18));
    this.actionTop = contextual ? 6 : 5;
    this.actions.forEach((action, i) => { action.visible = i < commands.length; action.top = this.actionTop + i; action.width = width; action.height = 1;
      action.content = `${this.state.focus === 'detail' && i === this.index ? '›' : ' '} ${commands[i] ?? ''}`;
      action.fg = this.disabled(commands[i] ?? '') ? palette.muted : this.state.focus === 'detail' && i === this.index ? palette.focus : palette.text;
    });
    const messageTop = this.actionTop + commands.length;
    this.message.top = messageTop; this.message.width = width; this.message.height = Math.max(1, height - messageTop - 3);
    this.message.content = owner ? this.snapshot.message : '';
    this.message.fg = this.snapshot.phase === 'error' ? palette.failure : palette.text;
    this.note.top = height - 3; this.note.height = 2; this.note.width = width;
    this.note.content = wrap(this.selectionNote(commands[this.index] ?? '')).join('\n');
    this.dialog?.paint();
  }
  dispose() { if (this.timer) clearInterval(this.timer); this.generation++; this.dialog?.cancel(); this.unsubscribe(); this.client.dispose(); }
}
