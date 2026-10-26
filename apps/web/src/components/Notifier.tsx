import type { StintEvent } from '@stint-dev/core';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Toaster, toast } from 'sonner';
import { agentOf } from '../agents';
import { subscribe } from '../api';

/** What deserves a toast: a person is needed, or an agent stopped in a way worth seeing. Nothing else. */
export function notice(e: StintEvent): { text: string; tone: 'warn' | 'bad' | 'info' } | null {
  const p = e.payload;
  if (e.type === 'approval.requested') return { text: `${e.task} needs your approval: the tests are green.`, tone: 'warn' };
  if (e.type === 'autopilot.stopped' && p.needsYou) return { text: `${e.task}: ${String(p.reason)}`, tone: 'warn' };
  if (e.type === 'run.finished' && (p.endedBy === 'killed' || p.endedBy === 'failed')) return { text: `${e.task}: ${agentOf(e.adapter ?? null, null, null).name} ${e.run} ${p.endedBy}. Its packet is ready for the next agent.`, tone: 'bad' };
  if (e.type === 'verification.ran' && p.status === 'red') return { text: `${e.task}: the daemon's tests are red (${Number(p.failed)} failed).`, tone: 'bad' };
  if (e.type === 'skill.proposed') return { text: `A skill was proposed from recurring review findings: ${String(p.id)}.`, tone: 'info' };
  if (e.type === 'acceptance.tampered') return { text: `${e.task}: an agent changed the locked acceptance tests.`, tone: 'bad' };
  return null;
}

export function Notifier() {
  const navigate = useNavigate();
  useEffect(() => {
    const since = Date.now();
    return subscribe('/api/stream', (e) => {
      if (Date.parse(e.ts) < since - 1000) return;
      const n = notice(e);
      if (!n) return;
      const open = e.type === 'skill.proposed' ? '/skills' : e.task ? `/t/${e.task}` : '/';
      const opts = { action: { label: 'Open', onClick: () => navigate(open) } };
      if (n.tone === 'bad') toast.error(n.text, opts);
      else if (n.tone === 'warn') toast.warning(n.text, opts);
      else toast(n.text, opts);
    });
  }, [navigate]);
  return <Toaster position="bottom-right" theme="dark" visibleToasts={3} richColors closeButton />;
}
