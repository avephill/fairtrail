import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Header } from './components/Header.js';
import { StatusBar } from './components/StatusBar.js';
import { SearchWizard } from './screens/SearchWizard.js';
import { QueryList } from './screens/QueryList.js';

interface AppProps {
  mode: 'search' | 'list' | 'view';
  viewId?: string;
}

export function App({ mode: initialMode, viewId: initialViewId }: AppProps) {
  const { exit } = useApp();
  const isTTY = process.stdin.isTTY ?? false;
  const [mode, setMode] = useState(initialMode);
  const [viewId, setViewId] = useState(initialViewId);

  useInput((_input, key) => {
    if (key.escape) {
      exit();
    }
  }, { isActive: isTTY });

  return (
    <Box flexDirection="column">
      <Header />
      <Box flexDirection="column" paddingX={1}>
        {mode === 'search' && <SearchWizard />}
        {mode === 'list' && (
          <QueryList
            onView={(id) => {
              setViewId(id);
              setMode('view');
            }}
          />
        )}
        {mode === 'view' && <Text>Chart view for {viewId} — coming in Phase 5</Text>}
      </Box>
      <StatusBar />
    </Box>
  );
}
