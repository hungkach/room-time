// Loads the <script id="rt-metrics"> block out of index.html and runs it in a fresh context.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const m = html.match(/<script id="rt-metrics">([\s\S]*?)<\/script>/);
if (!m) throw new Error('rt-metrics block not found in index.html');

export function loadRT() {
  const ctx = vm.createContext({});
  vm.runInContext(m[1], ctx, { filename: 'index.html#rt-metrics' });
  return ctx.RoomTime;
}
