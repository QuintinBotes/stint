import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Dialog, NewTaskDialog, Palette, ReplayStrip, TopBar, usePaletteActions } from './components/Shell';
import { Notifier } from './components/Notifier';
import { Kbd } from './components/ui';
import { useHealth } from './hooks';
import { Board } from './routes/Board';
import { Factory } from './routes/Factory';
import { Skills } from './routes/Skills';
import { Placeholder, TaskView } from './routes/TaskView';

const KEYS: Array<[string, string]> = [
  ['n', 'New task'],
  ['j / k', 'Move along the timeline'],
  ['d', 'Diff'],
  ['t', 'Terminal'],
  ['h', 'Packet (handoff)'],
  ['m', 'Show or hide memory'],
  ['a', 'Approve and merge'],
  ['r', 'Request changes'],
  ['x', 'Reject'],
  ['⌘K', 'Commands'],
  ['?', 'This help'],
];

export function App() {
  const health = useHealth();
  const [palette, setPalette] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const [help, setHelp] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(true);
  const openNewTask = useCallback(() => setNewTask(true), []);
  const actions = usePaletteActions({ newTask: openNewTask });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
      if (e.key === 'n') setNewTask(true);
      else if (e.key === '?') setHelp(true);
      else if (e.key === 'm') setMemoryOpen((m) => !m);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <BrowserRouter>
      <div className="h-full flex flex-col">
        <TopBar health={health.data} unreachable={!health.data && !!health.error} onPalette={() => setPalette(true)} />
        <ReplayStrip health={health.data} />
        <Notifier />
        <Routes>
          <Route path="/" element={<Board onNewTask={openNewTask} />} />
          <Route path="/t/:id" element={<TaskView memoryOpen={memoryOpen} />} />
          <Route path="/factory" element={<Factory />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="*" element={<Placeholder title="Not found">There is nothing at this address. The board is at the top left.</Placeholder>} />
        </Routes>
        <Palette open={palette} onClose={() => setPalette(false)} actions={actions} health={health.data} />
        <NewTaskDialog open={newTask} onClose={() => setNewTask(false)} />
        <Dialog title="Keyboard" open={help} onClose={() => setHelp(false)}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            {KEYS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt>
                  <Kbd>{k}</Kbd>
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Dialog>
      </div>
    </BrowserRouter>
  );
}
