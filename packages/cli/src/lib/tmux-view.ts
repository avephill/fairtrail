import { execSync, spawnSync, spawn } from 'child_process';
import { prisma } from '@/lib/prisma';

const SESSION_NAME = 'fairtrail-view';

function tmux(...args: string[]): string {
  const result = spawnSync('tmux', args, { encoding: 'utf-8' });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.stderr) {
    throw new Error(result.stderr.trim());
  }
  return result.stdout.trim();
}

function hasTmux(): boolean {
  try {
    execSync('tmux -V', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasGhostty(): boolean {
  try {
    execSync('which ghostty', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function buildViewCommand(queryId: string): string {
  const cwd = process.cwd();
  return `cd ${cwd} && doppler run -- node --import tsx/esm --import ./packages/cli/register.mjs packages/cli/src/index.tsx --view ${queryId}`;
}

export async function launchTmuxView(queryId: string): Promise<void> {
  if (!hasTmux()) {
    console.error('tmux is required for --tmux mode. Install with: brew install tmux');
    process.exit(1);
  }

  const query = await prisma.query.findUnique({ where: { id: queryId } });
  if (!query) {
    console.error(`Query "${queryId}" not found`);
    process.exit(1);
  }

  let queries = [query];
  if (query.groupId) {
    queries = await prisma.query.findMany({
      where: { groupId: query.groupId },
      orderBy: { createdAt: 'asc' },
    });
  }

  console.log(`Found ${queries.length} route(s) — creating isolated tmux session...`);
  for (const q of queries) {
    console.log(`  ${q.origin} → ${q.destination}  (${q.dateFrom.toISOString().slice(0, 10)})`);
  }

  // Always create a NEW isolated session — never touch the user's current tmux
  try { tmux('kill-session', '-t', SESSION_NAME); } catch { /* ok if not found */ }

  tmux('new-session', '-d', '-s', SESSION_NAME, '-x', '220', '-y', '55');

  // First pane already exists from new-session — send the first view command
  const firstCmd = buildViewCommand(queries[0]!.id);
  tmux('send-keys', '-t', `${SESSION_NAME}:0.0`, firstCmd, 'Enter');

  // Split for remaining queries
  for (let i = 1; i < queries.length; i++) {
    const cmd = buildViewCommand(queries[i]!.id);
    const splitDir = i % 2 === 1 ? '-h' : '-v';
    tmux('split-window', splitDir, '-t', `${SESSION_NAME}:0`);
    tmux('send-keys', '-t', `${SESSION_NAME}:0.${i}`, cmd, 'Enter');
  }

  tmux('select-layout', '-t', `${SESSION_NAME}:0`, 'tiled');
  tmux('select-pane', '-t', `${SESSION_NAME}:0.0`);

  // Open in a new Ghostty window (or attach in current terminal as fallback)
  if (hasGhostty()) {
    spawn('ghostty', ['-e', 'tmux', 'attach-session', '-t', SESSION_NAME], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    console.log(`Opened new Ghostty window with ${queries.length} panes`);
  } else {
    console.log(`Attaching to tmux session "${SESSION_NAME}"...`);
    spawnSync('tmux', ['attach-session', '-t', SESSION_NAME], { stdio: 'inherit' });
  }

  await prisma.$disconnect();
}
