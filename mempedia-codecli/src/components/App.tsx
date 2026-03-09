import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { Agent, TraceEvent } from '../agent/index.js';

interface AppProps {
  apiKey: string;
  projectRoot: string;
  baseURL?: string;
  model?: string;
}

interface HistoryItem {
  type: 'user' | 'agent' | 'info' | 'trace';
  content: string;
  traceType?: 'thought' | 'action' | 'observation' | 'error';
}

export const App: React.FC<AppProps> = ({ apiKey, projectRoot, baseURL, model }) => {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<string>('Ready');
  const [history, setHistory] = useState<Array<HistoryItem>>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [agent] = useState(() => new Agent({ apiKey, baseURL, model }, projectRoot));

  useEffect(() => {
    agent.start().catch((err: any) => {
      setHistory((prev: HistoryItem[]) => [...prev, { type: 'info', content: `Error starting agent: ${err.message}` }]);
    });
    return () => {
      agent.stop();
    };
  }, [agent]);

  const handleSubmit = async (query: string) => {
    if (!query.trim()) return;
    
    setIsProcessing(true);
    setHistory((prev: HistoryItem[]) => [...prev, { type: 'user', content: query }]);
    setInput('');
    setStatus('Initializing...');

    try {
      const response = await agent.run(query, (event: TraceEvent) => {
        setHistory((prev: HistoryItem[]) => [...prev, { 
          type: 'trace', 
          content: event.content, 
          traceType: event.type 
        }]);
        setStatus(event.type === 'thought' ? 'Thinking...' : event.type === 'action' ? 'Acting...' : 'Observing...');
      });
      setHistory((prev: HistoryItem[]) => [...prev, { type: 'agent', content: response }]);
      setStatus('Ready');
    } catch (error: any) {
      setHistory((prev: HistoryItem[]) => [...prev, { type: 'info', content: `Error: ${error.message}` }]);
      setStatus('Error');
    } finally {
      setIsProcessing(false);
    }
  };

  const getTraceColor = (type?: string) => {
    switch (type) {
      case 'thought': return 'gray';
      case 'action': return 'yellow';
      case 'observation': return 'dim';
      case 'error': return 'red';
      default: return 'white';
    }
  };

  const getTracePrefix = (type?: string) => {
    switch (type) {
      case 'thought': return '🤔 ';
      case 'action': return '⚡ ';
      case 'observation': return '👁️ ';
      case 'error': return '❌ ';
      default: return '';
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green" bold>Mempedia CodeCLI (ReAct Agent)</Text>
      <Box flexDirection="column" marginY={1}>
        {history.map((item, index) => (
          <Box key={index} flexDirection="column" marginY={0} marginLeft={item.type === 'trace' ? 2 : 0}>
            {item.type === 'trace' ? (
              <Text color={getTraceColor(item.traceType)}>
                {getTracePrefix(item.traceType)} {item.content}
              </Text>
            ) : (
              <Text color={item.type === 'user' ? 'blue' : item.type === 'agent' ? 'green' : 'yellow'}>
                {item.type === 'user' ? '> ' : item.type === 'agent' ? '🤖 ' : 'ℹ️ '}
                {item.content}
              </Text>
            )}
          </Box>
        ))}
      </Box>

      {isProcessing ? (
        <Text color="cyan">⚙️ {status}</Text>
      ) : (
        <Box>
          <Text color="blue">{'> '}</Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Type your instruction..."
          />
        </Box>
      )}
    </Box>
  );
};
