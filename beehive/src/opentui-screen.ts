import { RGBA, BoxRenderable, InputRenderable, ScrollBoxRenderable, SelectRenderable, TextRenderable, TextareaRenderable, type CliRenderer, type KeyEvent } from '@opentui/core';
import type { ManagerResult } from './manager-controller.ts';
import { managerSections } from './manager-navigation.ts';
import { stripVTControlCharacters } from 'node:util';

export type ManagerRow = { id: string; label: string; detail: string; evidence?: string };
export type ManagerAction = { label: string; disabled?: string; run: () => void | Promise<void | ManagerResult> };
const fg = RGBA.defaultForeground(), bg = RGBA.defaultBackground();
const clean = (value: string) => stripVTControlCharacters(value).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');

/** Presentation only: never imports credentials, configuration, transport or host code.
 * Bun owns this renderer; the manager/service interpreter can remain Node. */
export class OpenTuiScreen {
  private readonly root: BoxRenderable;
  private readonly header: TextRenderable;
  private readonly list: SelectRenderable;
  private readonly listFrame: BoxRenderable;
  private readonly pane: BoxRenderable;
  private readonly detail: TextRenderable;
  private readonly scroll: ScrollBoxRenderable;
  private readonly actions: SelectRenderable;
  private readonly status: TextRenderable;
  private readonly footer: TextRenderable;
  private readonly small: TextRenderable;
  private rows: ManagerRow[] = [];
  private commands: ManagerAction[] = [];
  private selectedRow = -1;
  private focusIndex = 0;
  private scope = 0;
  private owner = 'signed out';
  private busy = false;
  private closed = false;
  private overlay?: BoxRenderable;
  private compactOverlay = false;
  private modal?: { cancel: () => void; key: (key: KeyEvent) => void; paste: (text: string) => void };
  private finish!: () => void;
  readonly done = new Promise<void>(resolve => { this.finish = resolve; });
  onScope: (index: number) => void = () => {};
  onSelect: (id: string) => void = () => {};

  /** Persistent ordinary-key legend, separate from status. Never function-key first.
   * The compact form keeps every affordance named at the 40-column narrow floor. */
  private static readonly hintsWide = 'Tab: Next · Arrows: Select · Enter: Open · ? Help · q Quit';
  private static readonly hintsNarrow = 'Tab Next · Enter Open · ? Help · q Quit';

  constructor(readonly renderer: CliRenderer) {
    this.root = new BoxRenderable(renderer, { width: '100%', height: '100%', flexDirection: 'column', backgroundColor: bg });
    renderer.root.add(this.root);
    this.header = new TextRenderable(renderer, { fg, height: 2, onMouseDown: event => {
      if (event.y !== 0) return;
      let start = this.renderer.width < 56 ? 0 : 8;
      for (let index = 0; index < managerSections.length; index++) {
        const width = managerSections[index]!.length + (this.scope === index ? 2 : 0);
        if (event.x >= start && event.x < start + width) { this.switchScope(index); return; }
        start += width + (this.renderer.width < 56 ? 1 : 3);
      }
    } });
    this.root.add(this.header);
    const body = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: 'row', minHeight: 1 });
    this.root.add(body);
    this.listFrame = new BoxRenderable(renderer, { width: 28, height: '100%', border: true, title: '[List]' }); body.add(this.listFrame);
    this.list = new SelectRenderable(renderer, { backgroundColor: bg, textColor: fg, focusedBackgroundColor: bg, focusedTextColor: fg, selectedBackgroundColor: fg, selectedTextColor: bg, width: '100%', height: '100%', showDescription: false, showScrollIndicator: true, showSelectionIndicator: true, onMouseScroll: event => { if (event.scroll?.direction === 'up') this.list.moveUp(); else if (event.scroll?.direction === 'down') this.list.moveDown(); }, onMouseDown: event => {
      this.focusIndex = 0; this.list.focus();
      const delta = event.y - this.list.y;
      // Pinned OpenTUI does not expose its scrolling offset. Never map a click
      // to an unrelated row; keyboard navigation remains available for long lists.
      if (this.rows.length <= this.list.height && delta >= 0) this.list.setSelectedIndex(Math.min(this.rows.length - 1, delta));
      else this.notice('Use arrows to select an item in this list. Mouse selection is unavailable.');
    } });
    this.listFrame.add(this.list);
    // One bordered detail pane owns both the report and its actionable rows.
    // Actions have a bounded viewport inside that pane, not a third frame.
    this.pane = new BoxRenderable(renderer, { flexGrow: 1, height: '100%', flexDirection: 'column', border: true, title: 'Details' });
    body.add(this.pane);
    this.scroll = new ScrollBoxRenderable(renderer, { flexGrow: 1, scrollY: true, onMouseDown: () => { this.focusIndex = 1; this.scroll.focus(); } });
    this.pane.add(this.scroll);
    this.detail = new TextRenderable(renderer, { fg, width: '100%', content: 'No items.', selectable: false });
    this.scroll.add(this.detail);
    this.actions = new SelectRenderable(renderer, { backgroundColor: bg, textColor: fg, focusedBackgroundColor: bg, focusedTextColor: fg, selectedBackgroundColor: fg, selectedTextColor: bg, width: '100%', height: '100%', showDescription: false, showSelectionIndicator: true, showScrollIndicator: true, options: [], onMouseScroll: event => { if (event.scroll?.direction === 'up') this.actions.moveUp(); else if (event.scroll?.direction === 'down') this.actions.moveDown(); }, onMouseDown: event => {
      this.focusIndex = 2; this.actions.focus();
      const delta = event.y - this.actions.y, visible = Math.max(1, Math.floor(this.actions.height));
      if (delta < 0 || delta >= visible) return;
      // The pinned SelectRenderable never exposes its window offset, but its
      // scroll is deterministic: one row per action, the selection kept centered
      // (offset = max(0, min(selected - floor(visible/2), count - visible))).
      // Map the click through that same window so every visible action runs
      // exactly itself even when the real Agents menu overflows the bounded
      // region; keyboard and wheel keep the remaining actions reachable.
      const offset = Math.max(0, Math.min(this.actions.getSelectedIndex() - Math.floor(visible / 2), this.commands.length - visible));
      const index = offset + delta;
      if (index >= this.commands.length) return;
      this.actions.setSelectedIndex(index); this.actions.selectCurrent();
    } });
    this.pane.add(this.actions);
    this.status = new TextRenderable(renderer, { fg, height: 2, onMouseDown: () => this.outcome() });
    this.root.add(this.status);
    this.footer = new TextRenderable(renderer, { fg, height: 1, content: OpenTuiScreen.hintsWide });
    this.root.add(this.footer);
    this.small = new TextRenderable(renderer, { fg, position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', bg, content: 'Resize to at least 40 × 16. Ctrl-Q quits. Existing operations can continue.', visible: false });
    renderer.root.add(this.small);
    this.list.on('selectionChanged', (index: number) => {
      // Pinned OpenTUI re-emits selectionChanged even for an unchanged index
      // (programmatic snapshot restores, clamped moves, re-clicks). Only a
      // genuine selection change resets Details scroll and re-routes
      // selection, so unchanged background snapshots preserve user scroll.
      if (index === this.selectedRow) { this.focusStyle(); return; }
      this.selectedRow = index;
      const row = this.rows[index]; this.detail.content = clean(row?.detail ?? 'No items.'); this.scroll.scrollTo(0);
      this.focusStyle(); if (row) this.onSelect(row.id);
    });
    this.actions.on('itemSelected', (index: number) => { void this.run(index); });
    this.list.on('itemSelected', () => { if (this.narrow) { this.drilled = true; this.resize(); this.focusIndex = 1; this.scroll.focus(); } });
    renderer.keyInput.on('keypress', key => this.key(key));
    renderer.keyInput.on('paste', event => {
      if (!this.modal) return;
      this.modal.paste(new TextDecoder().decode(event.bytes));
      // Ordinary editor paste is handled by its focused renderable.
    });
    renderer.on('resize', () => this.resize());
    renderer.on('destroy', () => this.close());
    for (const widget of [this.list, this.scroll, this.actions]) { widget.on('focused', () => this.focusStyle()); widget.on('blurred', () => this.focusStyle()); }
    this.list.focus(); this.heading(); this.resize();
  }

  private focusStyle() {
    this.listFrame.title = `${this.list.focused ? '[List]' : 'List'} · ${this.rows.length ? this.list.getSelectedIndex() + 1 : 0}/${this.rows.length}`;
    this.scroll.title = managerSections[this.scope] ?? 'Details';
    this.pane.title = this.actions.focused ? 'Details · [Actions]' : 'Details · Tab: Actions';
    for (const widget of [this.list, this.actions]) { widget.selectedBackgroundColor = widget.focused ? fg : bg; widget.selectedTextColor = widget.focused ? bg : fg; }
  }
  private narrow = false;
  private drilled = false;
  private pending = false;
  private lastNotice = '';
  onCancel: () => void = () => {};
  setPending(value: boolean) { this.pending = value; }
  private formWidth() { return this.scope === 0 ? Math.max(20, this.renderer.width - this.listFrame.width - 2) : Math.min(72, this.renderer.width - 4); }
  private formLeft() { return this.scope === 0 ? this.listFrame.width : Math.floor((this.renderer.width - this.formWidth()) / 2); }
  /** Keep actions reachable within the detail pane without consuming the report. */
  private actionHeight() { return Math.min(Math.max(7, Math.min(12, this.commands.length + 2)), Math.max(7, this.renderer.height - 10)) - 2; }
  private resize() {
    this.heading();
    if (this.overlay && this.modal) { this.overlay.width = this.formWidth(); this.overlay.left = this.formLeft(); this.overlay.height = this.compactOverlay ? Math.min(14, this.renderer.height - 4) : this.renderer.height - 4; }
    this.small.visible = this.renderer.width < 40 || this.renderer.height < 16;
    this.narrow = this.scope !== 0 && (this.renderer.width < 88 || this.renderer.height < 24);
    this.listFrame.visible = !this.narrow || !this.drilled;
    this.pane.visible = !this.narrow || this.drilled;
    this.actions.height = this.actionHeight();
    this.listFrame.width = this.narrow ? '100%' : Math.min(32, Math.max(14, Math.floor(this.renderer.width * .28)));
    this.scroll.title = managerSections[this.scope] ?? 'Details';
    this.footer.content = this.relayFooter + '\n' + (this.renderer.width >= 70 ? OpenTuiScreen.hintsWide : OpenTuiScreen.hintsNarrow); this.footer.height = 2;
  }
  private relayFooter = 'Relay: Not configured · disconnected';
  setRelay(url?: string, state = 'unknown', name?: string) { this.relayFooter = url ? `Relay: ${name ? `${clean(name)} · ` : ''}${clean(url)} · ${state}` : 'Relay: Not configured · disconnected'; this.resize(); }
  private heading() { this.header.content = `${this.renderer.width < 56 ? '' : 'BEEHIVE '}${managerSections.map((name, index) => this.scope === index ? `[${name}]` : name).join(this.renderer.width < 56 ? ' ' : ' | ')}\n${clean(this.owner)}`; }
  setOwner(publicSuffix?: string) { this.owner = publicSuffix ? `${publicSuffix} · signed in` : 'signed out'; this.heading(); }
  private switchScope(scope: number) {
    if (this.modal || this.busy || this.small.visible || this.closed) return;
    // A section change must present its own details from the top even when the
    // retained selection lands on the same list index.
    this.scope = scope; this.drilled = false; this.selectedRow = -1; this.resize(); this.heading(); this.onScope(scope);
  }
  private key(key: KeyEvent) {
    if (key.ctrl && (key.name === 'q' || key.name === 'c')) { key.preventDefault(); this.close(); return; }
    if (this.small.visible) { key.preventDefault(); return; }
    if (key.name === 'escape' && this.pending) { key.preventDefault(); this.onCancel(); return; }
    if (this.modal) { this.modal.key(key); return; }
    if (key.name === 'escape' && this.drilled) { key.preventDefault(); this.drilled = false; this.resize(); this.focusIndex = 0; this.list.focus(); }
    // Ordinary keys are the primary map. Every editable field is a modal handled
    // above, so these never intercept text in public, secret or multiline inputs.
    if (!key.ctrl && !key.meta) {
      if (key.name === '?') { key.preventDefault(); this.help(); return; }
      if (key.name === 'a') { key.preventDefault(); this.focusIndex = 2; this.actions.focus(); return; }
      if (key.name === 'i' && this.scope !== 0) { key.preventDefault(); this.inspect(); return; }
      if (key.name === 'o') { key.preventDefault(); this.outcome(); return; }
      if (key.name === 'q') { key.preventDefault(); this.close(); return; }
    }
    // Legacy compatibility aliases only; the advertised map above uses ordinary keys.
    if (key.name === 'f2') { key.preventDefault(); this.actions.focus(); return; }
    if (key.name === 'f3' && this.scope !== 0) { key.preventDefault(); this.inspect(); return; }
    if (key.name === 'f4') { key.preventDefault(); this.outcome(); return; }
    if (this.focusIndex === 0 && ['home','end','pageup','pagedown'].includes(key.name)) { key.preventDefault(); this.navigate(this.list, key.name); }
    if (key.name === 'left' || key.name === 'right') { key.preventDefault(); this.switchScope((this.scope + (key.name === 'left' ? managerSections.length - 1 : 1)) % managerSections.length); }
    if (key.name === 'tab') { key.preventDefault(); this.focusIndex = this.focusIndex === 0 ? 2 : 0; [this.list, this.scroll, this.actions][this.focusIndex]!.focus(); this.focusStyle(); }
    if (key.name === 'f1') { key.preventDefault(); this.help(); }
  }
  private async run(index: number, captured?: ManagerAction) {
    const action = captured ?? this.commands[index];
    if (!action || this.pending || this.busy || this.modal || this.small.visible || this.closed) return;
    if (action.disabled) { this.notice(action.disabled); return; }
    this.busy = true; const retire = this.temporaryNotice('Working…');
    try { await action.run(); }
    catch { this.notice('Action failed. The result is unknown. Inspect the operation before you try again.'); }
    finally { retire(); this.busy = false; }
  }
  show(rows: ManagerRow[], actions: ManagerAction[], selected?: string) {
    if (this.closed) return;
    const prior = selected ?? this.rows[this.list.getSelectedIndex()]?.id;
    this.rows = rows; this.commands = actions;
    this.detail.visible = true;
    const commandOptions = actions.map(a => ({ name: clean(a.label + (a.disabled ? ' — unavailable' : '')), description: '' }));
    if (JSON.stringify(this.actions.options) !== JSON.stringify(commandOptions)) this.actions.options = commandOptions;
    this.actions.height = this.actionHeight();
    const options = rows.map(row => ({ name: clean(row.label), description: '', value: row.id }));
    if (JSON.stringify(this.list.options) !== JSON.stringify(options)) this.list.options = options;
    const index = Math.max(0, rows.findIndex(row => row.id === prior));
    this.list.setSelectedIndex(index); this.detail.content = clean(rows[index]?.detail ?? 'No items.'); this.focusStyle();

  }
  private noticeToken: object = {};
  /** Retire only this notice, restoring the enclosing scope or idle status. */
  temporaryNotice(text: string) {
    const previous = this.lastNotice, previousToken = this.noticeToken;
    this.notice(text);
    const token = this.noticeToken;
    return () => {
      if (this.noticeToken !== token || this.closed) return;
      this.notice(previous); this.noticeToken = previousToken;
    };
  }
  notice(text: string) { this.noticeToken = {}; if (!this.closed) { this.lastNotice = clean(text); this.status.content = this.lastNotice; } }
  unavailable(feature: string) { this.notice(`${feature} is unavailable in this build. No request was sent. Local Host shows this computer. Agents shows host reports.`); }

  choose(title: string, names: string[]): Promise<string | undefined> {
    if (this.modal || !names.length) return Promise.resolve(undefined);
    return new Promise(resolve => {
      const box = new BoxRenderable(this.renderer, { position: 'absolute', top: 2, left: this.formLeft(), width: this.formWidth(), height: this.renderer.height - 4, border: true, title: title + ' · Esc cancel', backgroundColor: bg });
      const list = new SelectRenderable(this.renderer, { backgroundColor: bg, textColor: fg, focusedBackgroundColor: bg, focusedTextColor: fg, selectedBackgroundColor: fg, selectedTextColor: bg, width: '100%', height: '100%', showDescription: false, showSelectionIndicator: true, options: names.map(name => ({ name: clean(name), description: '' })) });
      this.overlay = box; this.compactOverlay = false; this.renderer.root.add(box); box.add(list); list.focus();
      const finish = (name?: string) => { this.modal = undefined; box.destroyRecursively(); this.actions.focus(); resolve(name); };
      list.on('itemSelected', (i: number) => finish(names[i]));
      this.modal = { cancel: () => finish(), paste: () => {}, key: key => { if (key.name === 'escape') { key.preventDefault(); finish(); } else if (['home','end','pageup','pagedown'].includes(key.name)) { key.preventDefault(); this.navigate(list, key.name); } } };
    });
  }
  private navigate(list: SelectRenderable, key: string) {
    const n = list.options.length, current = list.getSelectedIndex();
    list.setSelectedIndex(Math.max(0, Math.min(n - 1, key === 'home' ? 0 : key === 'end' ? n - 1 : current + (key === 'pageup' ? -1 : 1) * Math.max(1, list.height))));
  }
  inspect() { if (this.scope === 0) return; const row = this.rows[this.list.getSelectedIndex()]; this.read('Technical details', row?.evidence ?? 'No technical details for this item.'); }
  private outcome() { this.read('Status · latest message', this.lastNotice || 'No status message yet.'); }
  private help() { this.read('Help', 'Tab: switch list and detail actions. Arrows: select. Enter: open.\nLeft/Right: Host, Agents, Harnesses, Providers.\nEsc: cancel or back. q or Ctrl-C: quit. The host keeps running.\nHost Start and Stop control this computer’s service, not an agent.\nAgent execution still requires authenticated management authority.\nShortcuts do not run while you edit fields.'); }
  private read(title: string, content: string) {
    if (this.modal || this.closed) return;
    const box = new ScrollBoxRenderable(this.renderer, { position: 'absolute', top: 2, left: this.formLeft(), width: this.formWidth(), height: this.renderer.height - 4, border: true, title: title + ' · Esc close', backgroundColor: bg, scrollY: true });
    this.overlay = box; this.compactOverlay = false; this.renderer.root.add(box); box.add(new TextRenderable(this.renderer, { fg, content: clean(content), width: '100%', selectable: true })); box.focus();
    const cancel = () => { this.modal = undefined; box.destroyRecursively(); [this.list, this.scroll, this.actions][this.focusIndex]!.focus(); };
    this.modal = { cancel, paste: () => {}, key: key => { if (key.name === 'escape') { key.preventDefault(); cancel(); } } };
  }
  input(label: string, value = '', secret = false, multiline = false, validate?: (value: string) => string, back?: (value: string) => void): Promise<string | undefined> {
    if (this.closed || this.modal) return Promise.resolve(undefined);
    return new Promise(resolve => {
      const box = new BoxRenderable(this.renderer, { position: 'absolute', top: 2, left: this.formLeft(), width: this.formWidth(), height: multiline ? this.renderer.height - 4 : Math.min(this.renderer.height - 4, 14), border: true, backgroundColor: bg, flexDirection: 'column', padding: 1, title: secret ? 'Hidden key input' : multiline ? 'Private draft · Ctrl-S saves' : clean(label.split('\n')[0]!).slice(0, 45) });
      this.overlay = box; this.compactOverlay = false; this.renderer.root.add(box);
      this.compactOverlay = !multiline;
      const prompt = new ScrollBoxRenderable(this.renderer, { width: '100%', flexGrow: multiline ? 0 : 1, height: multiline ? 3 : undefined, scrollY: true });
      prompt.add(new TextRenderable(this.renderer, { fg, content: clean(label), width: '100%' })); box.add(prompt);
      let hidden = secret ? value : '';
      const entry = secret ? undefined : multiline
        ? new TextareaRenderable(this.renderer, { initialValue: value, flexGrow: 1, width: '100%' })
        : new InputRenderable(this.renderer, { value, maxLength: 8192, width: '100%', backgroundColor: fg, textColor: bg, focusedBackgroundColor: fg, focusedTextColor: bg });
      let secretDisplay: TextRenderable | undefined;
      if (entry) { const field = new BoxRenderable(this.renderer, { border: !multiline, height: multiline ? undefined : 3, flexShrink: 0, flexGrow: multiline ? 1 : 0, width: '100%' }); field.add(entry); box.add(field); entry.focus(); }
      else {
        this.list.blur(); this.actions.blur(); this.scroll.blur();
        const field = new BoxRenderable(this.renderer, { border: true, height: 3, flexShrink: 0, width: '100%' });
        secretDisplay = new TextRenderable(this.renderer, { fg, content: ' ', width: '100%' }); field.add(secretDisplay); box.add(field);
      }
      box.add(new TextRenderable(this.renderer, { fg, content: multiline ? 'Ctrl-S save · Esc cancel (unsaved text discarded)' : back ? 'Enter next · Shift-Tab back · Esc cancel' : 'Enter continue · Esc cancel · Ctrl-↑/↓ scroll', height: 2 }));
      const error = new TextRenderable(this.renderer, { fg, height: 2, flexShrink: 0 }); box.add(error);
      let settled = false;
      const finish = (answer?: string) => {
        if (settled) return; settled = true; hidden = '';
        if (entry instanceof InputRenderable) entry.value = '';
        else entry?.setText('');
        this.modal = undefined; box.destroyRecursively();
        if (!this.closed) [this.list, this.scroll, this.actions][this.focusIndex]!.focus();
        resolve(answer);
      };
      this.modal = {
        cancel: () => finish(),
        paste: text => { if (secret && hidden.length + text.length <= 4096) { hidden += text.replace(/[\r\n]/g, ''); if (secretDisplay) secretDisplay.content = hidden ? '•'.repeat(Math.min(hidden.length,64)) : ' '; } },
        key: key => {
          if (key.ctrl && ['up','down'].includes(key.name)) { key.preventDefault(); prompt.scrollBy(key.name === 'up' ? -3 : 3); return; }
          if (back && !secret && key.name === 'tab' && key.shift) { key.preventDefault(); back(entry instanceof InputRenderable ? entry.value : entry?.plainText ?? ''); finish('\0back'); return; }
          if (key.name === 'escape') { key.preventDefault(); finish(); return; }
          if ((!multiline && key.name === 'return') || (multiline && key.ctrl && key.name === 's')) {
            key.preventDefault(); const answer = secret ? hidden : entry instanceof InputRenderable ? entry.value : entry?.plainText ?? ''; const invalid = validate?.(answer); if (invalid) { error.content = secret ? 'Invalid key. Enter the key again.' : clean(invalid); if (secret) hidden = ''; return; } finish(answer); return;
          }
          if (!secret) return;
          key.preventDefault();
          if (key.name === 'backspace') hidden = hidden.slice(0, -1);
          else if (key.ctrl && key.name === 'u') hidden = '';
          else if (!key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence >= ' ' && hidden.length < 4096) hidden += key.sequence;
          if (secretDisplay) secretDisplay.content = hidden ? '•'.repeat(Math.min(hidden.length,64)) : ' ';
        },
      };
    });
  }
  async confirm(label: string) { return await this.input(`${label}\nType yes to confirm. Press Enter with no text to cancel.`) === 'yes'; }
  close() {
    if (this.closed) return; this.closed = true; this.modal?.cancel(); this.renderer.destroy(); this.finish();
  }
}
