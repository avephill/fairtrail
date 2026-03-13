import React from 'react';
import { Box, Text } from 'ink';

interface AppProps {
  mode: 'search' | 'list' | 'view';
  viewId?: string;
}

export function App({ mode, viewId }: AppProps) {
  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        {'✈  F A I R T R A I L'}
      </Text>
      <Text dimColor>The price trail airlines don&apos;t show you</Text>
      <Box marginTop={1}>
        {mode === 'search' && <Text>Search wizard — coming in Phase 3</Text>}
        {mode === 'list' && <Text>Query list — coming in Phase 4</Text>}
        {mode === 'view' && <Text>Chart view for {viewId} — coming in Phase 5</Text>}
      </Box>
    </Box>
  );
}
