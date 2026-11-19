// Where the end-to-end tests run a hub of their own: a home of its own, so nothing of this computer's is touched.
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PORT = 8897;
export const SCRATCH = join(tmpdir(), 'agent-hub-e2e');
export const HOME = join(SCRATCH, 'home');
export const PROJECT = join(HOME, 'github', 'alpha');

// The token of this computer's own login, which works from a loopback address.
export function token() {
   return JSON.parse(readFileSync(join(SCRATCH, 'config', 'agent-hub', 'config.json'), 'utf8')).token;
}
