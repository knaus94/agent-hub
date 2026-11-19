// Starts a hub for the end-to-end tests in a scratch home, with two projects and Zed settings whose agents are the
// stand-in of fake-agent.mjs. Run by Playwright, which stops it when the tests end.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME, PORT, PROJECT, SCRATCH } from './scratch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const agent = { type: 'custom', command: process.execPath, args: [join(here, 'fake-agent.mjs')] };

rmSync(SCRATCH, { recursive: true, force: true });
for (const dir of ['config/zed', 'data', 'state', 'run', 'home/github/alpha/.git', 'home/github/alpha/docs', 'home/github/beta/.git'])
   mkdirSync(join(SCRATCH, dir), { recursive: true });
writeFileSync(join(SCRATCH, 'config/zed/settings.json'), JSON.stringify({ agent_servers: { 'Claude (e2e)': agent, 'Codex (e2e)': agent } }));
writeFileSync(join(PROJECT, 'docs/brief.md'), '# Бриф\n\n## Цель\n\nПроверить чтение файлов.\n');

const hub = spawn(join(here, '../../dist/agent-hub'), ['serve'], {
   stdio: 'inherit',
   env: {
      PATH: '/usr/bin:/bin',
      HOME,
      XDG_CONFIG_HOME: join(SCRATCH, 'config'),
      XDG_DATA_HOME: join(SCRATCH, 'data'),
      XDG_STATE_HOME: join(SCRATCH, 'state'),
      XDG_RUNTIME_DIR: join(SCRATCH, 'run'),
      XDG_CACHE_HOME: join(HOME, '.cache'),
      AGENT_HUB_PORT: String(PORT),
   },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => hub.kill('SIGTERM'));
hub.on('exit', (code) => process.exit(code ?? 0));
