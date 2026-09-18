import { renderFrame } from './shell-frame.ts';
import { destinations, ownerLabel, ShellState } from './shell-state.ts';

export type TerminalIO = {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
};

/** Owns only terminal presentation and input. It never opens product state or services. */
export class ShellApp {
  readonly state = new ShellState();
  private closed = false;
  private buffer = '';
  private priorRaw = false;
  private resolveDone!: () => void;
  readonly done = new Promise<void>(resolve => { this.resolveDone = resolve; });

  private readonly io: TerminalIO;
  constructor(io: TerminalIO) { this.io = io; }

  start() {
    this.priorRaw = Boolean(this.io.stdin.isRaw);
    if (this.io.stdin.isTTY) this.io.stdin.setRawMode(true);
    this.io.stdin.setEncoding('utf8');
    this.io.stdin.resume();
    this.io.stdin.on('data', this.onData);
    this.io.stdout.on('resize', this.onResize);
    this.io.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h');
    this.render();
    return this.done;
  }

  private onResize = () => this.render();
  private onData = (chunk: string) => {
    this.buffer += chunk;
    while (this.buffer.length) {
      const mouse = this.buffer.match(/^\x1b\[<([0-9]+);([0-9]+);([0-9]+)([Mm])/);
      if (mouse) {
        this.buffer = this.buffer.slice(mouse[0].length);
        if (mouse[4] === 'M' && Number(mouse[1]) === 0) this.pointer(Number(mouse[2]) - 1, Number(mouse[3]) - 1);
        continue;
      }
      const keys: [string, string, { ctrl?: boolean; shift?: boolean }?][] = [
        ['\x1b[A', 'up'], ['\x1b[B', 'down'], ['\x1b[C', 'right'], ['\x1b[D', 'left'], ['\x1b[Z', 'tab', { shift: true }],
        ['\r', 'return'], ['\n', 'return'], ['\t', 'tab'], ['\x1b', 'escape'], ['\x11', 'q', { ctrl: true }], ['\x03', 'c', { ctrl: true }],
      ];
      const found = keys.find(([sequence]) => this.buffer.startsWith(sequence));
      if (found) { this.buffer = this.buffer.slice(found[0].length); this.dispatch(found[1], found[2]); continue; }
      if (this.buffer.startsWith('\x1b[') && this.buffer.length < 6) return;
      const character = this.buffer[0]!; this.buffer = this.buffer.slice(1);
      if (character === 'q' || character === '?') this.dispatch(character);
    }
  };

  private dispatch(name: string, options: { ctrl?: boolean; shift?: boolean } = {}) {
    const effect = this.state.key(name, { ...options, belowMinimum: this.width < 50 || this.height < 20 });
    if (effect === 'quit') this.close(); else if (effect === 'render') this.render();
  }

  private pointer(x: number, y: number) {
    if (this.width < 50 || this.height < 20 || this.state.helpOpen) return;
    if (y === 0 && x >= this.width - ownerLabel.length - 1) { this.state.openHeader(destinations.length); this.render(); return; }
    if (y !== 1) return;
    const total = destinations.reduce((sum, item) => sum + item.length, 0) + destinations.length - 1;
    let cursor = Math.max(0, Math.floor((this.width - total) / 2));
    for (let index = 0; index < destinations.length; index++) {
      const end = cursor + destinations[index]!.length;
      if (x >= cursor && x < end) { this.state.openHeader(index); this.render(); return; }
      cursor = end + 1;
    }
  }

  private get width() { return this.io.stdout.columns || 80; }
  private get height() { return this.io.stdout.rows || 24; }
  render() {
    if (this.closed) return;
    this.io.stdout.write(`\x1b[H${renderFrame(this.state, this.width, this.height)}`);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.io.stdin.off('data', this.onData);
    this.io.stdout.off('resize', this.onResize);
    if (this.io.stdin.isTTY) this.io.stdin.setRawMode(this.priorRaw);
    this.io.stdin.pause();
    this.io.stdin.unref();
    this.io.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l');
    this.resolveDone();
  }
}
