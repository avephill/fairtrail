#!/usr/bin/env node
import { program } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from './app.js';
import { launchTmuxView } from './lib/tmux-view.js';

program
  .name('fairtrail')
  .description('The price trail airlines don\'t show you')
  .option('--headless', 'Terminal UI mode (required for CLI interaction)')
  .option('--list', 'Show all tracked queries (web) or with --headless (terminal)')
  .option('--view <id>', 'View price chart (web) or with --headless (terminal)')
  .option('--tmux', 'Split grouped routes into tmux panes (requires --headless --view)')
  .parse();

const opts = program.opts<{ headless?: boolean; list?: boolean; view?: string; tmux?: boolean }>();

// --tmux requires --headless
if (opts.tmux && !opts.headless) {
  console.error('Error: --tmux requires --headless mode');
  console.error('Usage: fairtrail --headless --view <id> --tmux');
  process.exit(1);
}

// --tmux requires --view
if (opts.tmux && !opts.view) {
  console.error('Error: --tmux requires --view <id>');
  console.error('Usage: fairtrail --headless --view <id> --tmux');
  process.exit(1);
}

if (opts.headless) {
  // Terminal UI mode
  if (opts.view && opts.tmux) {
    launchTmuxView(opts.view).catch((err) => {
      console.error('tmux view failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
  } else {
    const mode = opts.list ? 'list' as const : opts.view ? 'view' as const : 'search' as const;
    const viewId = opts.view;
    render(<App mode={mode} viewId={viewId} />);
  }
} else if (opts.view) {
  // Open web view in browser
  const url = `http://localhost:3003/q/${opts.view}`;
  console.log(`Opening ${url} in browser...`);
  import('child_process').then(({ exec }) => exec(`open "${url}"`));
} else if (opts.list) {
  // Open admin dashboard in browser
  const url = 'http://localhost:3003/admin/queries';
  console.log(`Opening ${url} in browser...`);
  import('child_process').then(({ exec }) => exec(`open "${url}"`));
} else {
  // No flags — show help
  program.help();
}
