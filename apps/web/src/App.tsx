import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Dialog, NewGoalDialog, NewTaskDialog, Palette, ReplayStrip, TopBar, usePaletteActions } from './components/Shell';
import { Notifier } from './components/Notifier';
import { Kbd } from './components/ui';
import { GLOSSARY } from './glossary';
import { singleKey } from './shortcuts';
import { useHealth } from './hooks';
import { Board } from './routes/Board';

// the Goals, Factory and Skills load when first opened, so the board and the task view start sooner
const Goals = lazy(() => import('./routes/Goals').then((m) => ({ default: m.Goals })));
const Factory = lazy(() => import('./routes/Factory').then((m) => ({ default: m.Factory })));
const Skills = lazy(() => import('./routes/Skills').then((m) => ({ default: m.Skills })));
import { Placeholder, TaskView } from './routes/TaskView';

const KEYS: Array<[string, string]> = [
  ['⌘K', 'Search or run a command'],
  ['n', 'New task'],
  ['j / k', 'Next or previous event in the runs'],
  ['d', 'Show the changes (Diff)'],
  ['[ / ]', 'Previous or next changed file'],
  ['v', 'Mark the file as viewed'],
  ['t', 'Terminal'],
  ['h', 'Packet'],
  ['m', 'Show or hide memory'],
  ['a', 'Approve: press once to get ready, again to merge'],
  ['r', 'Request changes'],
  ['x', 'Reject'],
  ['⌘.', 'Stop the run that is going'],
  ['?', 'This help'],
];

export function App() {
  const health = useHealth();
  const [palette, setPalette] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const [newGoal, setNewGoal] = useState(false);
  const [help, setHelp] = useState(false);
  const openNewTask = useCallback(() => setNewTask(true), []);
  const openNewGoal = useCallback(() => setNewGoal(true), []);
  const actions = usePaletteActions({ newTask: openNewTask, newGoal: openNewGoal });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (!singleKey(e)) return;
      if (e.key === 'n') setNewTask(true);
      else if (e.key === '?') setHelp(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <BrowserRouter>
      <div className="h-full flex flex-col">
        <a
          href="#main"
          onClick={(e) => {
            e.preventDefault();
            const main = document.querySelector<HTMLElement>('main');
            if (!main) return;
            main.tabIndex = -1;
            main.focus();
          }}
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-[5px] focus:bg-ink focus:text-on-ink focus:font-semibold"
        >
          Skip to content
        </a>
        <TopBar health={health.data} unreachable={!health.data && !!health.error} onPalette={() => setPalette(true)} onHelp={() => setHelp(true)} />
        <ReplayStrip health={health.data} />
        <Notifier />
        <Routes>
          <Route path="/" element={<Board onNewTask={openNewTask} />} />
          <Route path="/t/:id" element={<TaskView />} />
          {['/goals', '/goals/:id'].map((path) => (
            <Route
              key={path}
              path={path}
              element={
                <Suspense fallback={<p className="p-6 text-ink-2">Opening Goals.</p>}>
                  <Goals onNewGoal={openNewGoal} />
                </Suspense>
              }
            />
          ))}
          <Route
            path="/factory"
            element={
              <Suspense fallback={<p className="p-6 text-ink-2">Opening the Factory.</p>}>
                <Factory />
              </Suspense>
            }
          />
          <Route
            path="/skills"
            element={
              <Suspense fallback={<p className="p-6 text-ink-2">Opening Skills.</p>}>
                <Skills />
              </Suspense>
            }
          />
          <Route path="*" element={<Placeholder title="Not found">There is nothing at this address. The board is at the top left.</Placeholder>} />
        </Routes>
        <Palette open={palette} onClose={() => setPalette(false)} actions={actions} health={health.data} />
        <NewTaskDialog open={newTask} onClose={() => setNewTask(false)} />
        <NewGoalDialog open={newGoal} onClose={() => setNewGoal(false)} />
        <Dialog title="Help" open={help} onClose={() => setHelp(false)} width="max-w-[640px]">
          <p className="text-ink-2 mb-5">Stint gives coding work to AI agents, checks it with your tests, and waits for you to approve before anything is merged.</p>
          <h3 className="font-semibold mb-2">Words used here</h3>
          <dl className="flex flex-col gap-2.5 mb-6" data-testid="glossary">
            {Object.values(GLOSSARY).map((g) => (
              <div key={g.word}>
                <dt className="font-medium">{g.word}</dt>
                <dd className="text-ink-2">{g.plain}</dd>
              </div>
            ))}
          </dl>
          <h3 className="font-semibold mb-2">Keys</h3>
          <p className="text-small text-ink-2 mb-2">Single keys work when you are not typing in a field. You can turn them off from the command search.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            {KEYS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt>
                  <Kbd>{k}</Kbd>
                  <span className="sr-only">{k}</span>
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
