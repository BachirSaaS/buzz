import { compactShortcutGuide, destinations, ownerLabel, shortcutGuide, type FocusRegion, type ShellState } from './shell-state.ts';

const rgb = (hex: string, background = false) => {
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(value => Number.parseInt(value, 16));
  return `\x1b[${background ? 48 : 38};2;${r};${g};${b}m`;
};
const reset = '\x1b[0m';
const colors = {
  surface: rgb('#0d100e', true), text: rgb('#dce1d8'), muted: rgb('#7d867c'),
  divider: rgb('#4a5149'), focus: rgb('#ffd34e'), selected: rgb('#dce1d8', true), selectedText: rgb('#10130f'),
  dialog: rgb('#9ca49b'),
};
type Style = 'text' | 'muted' | 'divider' | 'focus' | 'selected' | 'dialog';
const styleCode = (style: Style) => colors.surface + (style === 'selected' ? colors.selected + colors.selectedText : colors[style]);

function put(chars: string[], styles: Style[], start: number, text: string, style: Style) {
  for (let offset = 0; offset < text.length && start + offset < chars.length; offset++) {
    if (start + offset < 0) continue;
    chars[start + offset] = text[offset]!;
    styles[start + offset] = style;
  }
}
function line(chars: string[], styles: Style[]) {
  let output = '', prior: Style | undefined;
  for (let index = 0; index < chars.length; index++) {
    const style = styles[index]!;
    if (style !== prior) { output += styleCode(style); prior = style; }
    output += chars[index];
  }
  return output + reset;
}
function blank(width: number, style: Style = 'text') { return [Array(width).fill(' ') as string[], Array(width).fill(style) as Style[]] as const; }

export function listWidth(width: number) {
  if (width >= 90) return Math.min(35, Math.max(28, Math.floor((width - 1) * 0.32)));
  if (width >= 60) return Math.min(28, Math.max(24, Math.floor((width - 1) * 0.36)));
  return width;
}

/** Deterministic cell renderer. Pane documents intentionally contain zero text. */
export function renderFrame(state: ShellState, width: number, height: number) {
  width = Math.max(1, Math.floor(width)); height = Math.max(1, Math.floor(height));
  const rows: string[] = [];
  {
    const [chars, styles] = blank(width);
    put(chars, styles, 1, '⬢ BEEHIVE', 'focus');
    put(chars, styles, width - ownerLabel.length - 1, ownerLabel, state.headerIndex === destinations.length && state.focus === 'header' ? 'selected' : 'focus');
    rows.push(line(chars, styles));
  }
  {
    const [chars, styles] = blank(width);
    const total = destinations.reduce((sum, item) => sum + item.length, 0) + destinations.length - 1;
    let cursor = Math.max(0, Math.floor((width - total) / 2));
    destinations.forEach((item, index) => {
      const focused = state.focus === 'header' && state.headerIndex === index;
      const active = state.mode === 'section' && state.activeSection === index;
      const gated = index < 2;
      put(chars, styles, cursor, item, focused ? 'selected' : active ? 'focus' : gated ? 'muted' : 'text');
      cursor += item.length + 1;
    });
    rows.push(line(chars, styles));
  }
  {
    const [chars, styles] = blank(width, 'divider'); chars.fill('─'); rows.push(line(chars, styles));
  }
  const bodyHeight = Math.max(0, height - 5);
  const split = state.splitPane && width >= 60;
  const divider = split ? listWidth(width) : -1;
  for (let row = 0; row < bodyHeight; row++) {
    const [chars, styles] = blank(width);
    if (split && divider < width) { chars[divider] = '│'; styles[divider] = 'divider'; }
    outline(chars, styles, state.focus, split, divider, row, bodyHeight);
    rows.push(line(chars, styles));
  }
  if (height >= 2) {
    const [chars, styles] = blank(width, 'divider'); chars.fill('─'); rows.push(line(chars, styles));
    const [footer, footerStyles] = blank(width, 'muted');
    put(footer, footerStyles, 1, width >= 70 ? shortcutGuide : compactShortcutGuide, 'muted');
    rows.push(line(footer, footerStyles));
  }
  if (state.helpOpen) applyHelp(rows, width, height);
  return rows.slice(0, height).join('\n');
}

function outline(chars: string[], styles: Style[], focus: FocusRegion, split: boolean, divider: number, row: number, bodyHeight: number) {
  if (focus === 'header' || bodyHeight < 2) return;
  const left = focus === 'list' && split ? 0 : split ? divider + 1 : 0;
  const right = focus === 'list' && split ? divider - 1 : chars.length - 1;
  if (right < left) return;
  if (row === 0 || row === bodyHeight - 1) {
    for (let column = left; column <= right; column++) { chars[column] = '─'; styles[column] = 'focus'; }
  } else {
    chars[left] = '│'; styles[left] = 'focus'; chars[right] = '│'; styles[right] = 'focus';
  }
}

function applyHelp(rows: string[], width: number, height: number) {
  const boxWidth = Math.max(1, Math.min(62, width - 4));
  const content = ['HELP', '', '← →  move through the complete header', 'Enter  open the focused destination', 'Tab  move through available pane regions', 'Esc  return to the initiating header control', '?  close help', 'q  quit Beehive'];
  const boxHeight = Math.min(height - 4, content.length + 4);
  if (boxWidth < 4 || boxHeight < 4) return;
  const left = Math.floor((width - boxWidth) / 2), top = Math.floor((height - boxHeight) / 2);
  for (let y = 0; y < boxHeight; y++) {
    const [chars, styles] = blank(width);
    for (let x = left; x < left + boxWidth; x++) styles[x] = 'text';
    chars[left] = y === 0 ? '┌' : y === boxHeight - 1 ? '└' : '│';
    chars[left + boxWidth - 1] = y === 0 ? '┐' : y === boxHeight - 1 ? '┘' : '│';
    styles[left] = styles[left + boxWidth - 1] = 'dialog';
    if (y === 0 || y === boxHeight - 1) for (let x = left + 1; x < left + boxWidth - 1; x++) { chars[x] = '─'; styles[x] = 'dialog'; }
    const text = content[y - 2]; if (text) put(chars, styles, left + 2, text.slice(0, boxWidth - 4), y === 2 ? 'focus' : 'text');
    rows[top + y] = line(chars, styles);
  }
}
