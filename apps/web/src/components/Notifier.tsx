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
  if (e.type === 'verification.ran' && p.status === 'red') return { text: `${e.task}: the tests are red (${Number(p.failed)} failed).`, tone: 'bad' };
  if (e.type === 'permission.requested') return { text: `${e.task}: ${agentOf(e.adapter ?? null, null, null).name} ${e.run} asks permission: ${String(p.title ?? p.tool)}.`, tone: 'warn' };
  if (e.type === 'skill.proposed') return { text: `A skill was proposed from recurring review findings: ${String(p.id)}.`, tone: 'info' };
  if ((e.type === 'verification.tampered' || e.type === 'acceptance.tampered') && !p.allowedBy) return { text: `${e.task}: an agent changed the locked tests.`, tone: 'bad' };
  return null;
}

/** A person has to act: the gate is waiting, an agent asks permission, or autopilot stopped for them. */
export function needsYou(e: StintEvent): boolean {
  if (e.type === 'approval.requested' || e.type === 'permission.requested') return true;
  return e.type === 'autopilot.stopped' && !!e.payload.needsYou;
}

const SOUND_KEY = 'stint.sound';

/** The needs-you sound is on unless it was turned off in the palette. */
export function soundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSound(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* private window: the choice lasts for this tab only */
  }
}

let audio: AudioContext | null = null;

/** A short two-note sound made in code, so nothing needs an audio file. */
export function playNeedsYouSound(): void {
  if (!soundOn()) return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audio ??= new Ctor();
    void audio.resume().catch(() => undefined);
    const at = audio.currentTime;
    for (const [start, freq] of [
      [0, 880],
      [0.12, 660],
    ] as const) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.08, at + start);
      gain.gain.exponentialRampToValueAtTime(0.001, at + start + 0.1);
      osc.connect(gain).connect(audio.destination);
      osc.start(at + start);
      osc.stop(at + start + 0.11);
    }
  } catch {
    /* a browser that will not play sound says so by silence */
  }
}

/**
 * Asks for desktop notification permission. Called only from the palette action, so
 * the ask itself is the user gesture the browser wants.
 */
export function enableDesktopNotifications(): Promise<NotificationPermission | 'unsupported'> {
  try {
    if (typeof Notification === 'undefined') return Promise.resolve('unsupported');
    if (Notification.permission === 'granted' || Notification.permission === 'denied') return Promise.resolve(Notification.permission);
    return Notification.requestPermission();
  } catch {
    return Promise.resolve('unsupported');
  }
}

/** An OS notification for a finished run or a person being needed, while the window is not the one being looked at. */
function notifyOutside(e: StintEvent, text: string, open: () => void): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (e.type !== 'run.finished' && !needsYou(e)) return;
    if (typeof document !== 'undefined' && document.hasFocus()) return;
    const sent = new Notification('Stint', { body: text });
    sent.onclick = () => {
      try {
        window.focus();
      } catch {
        /* the browser may keep its own focus rules */
      }
      open();
    };
  } catch {
    /* a browser that will not notify says so by silence */
  }
}

export function Notifier() {
  const navigate = useNavigate();
  useEffect(() => {
    const since = Date.now();
    return subscribe('/api/stream', (e) => {
      if (Date.parse(e.ts) < since - 1000) return;
      const n = notice(e);
      const open = e.type === 'skill.proposed' ? '/skills' : e.task ? `/t/${e.task}` : '/';
      const finished = e.type === 'run.finished' ? `${e.task}: ${agentOf(e.adapter ?? null, null, null).name} ${e.run} finished.` : null;
      const text = n?.text ?? finished;
      if (text) notifyOutside(e, text, () => navigate(open));
      if (!n) return;
      if (needsYou(e)) playNeedsYouSound();
      const opts = { action: { label: 'Open', onClick: () => navigate(open) } };
      if (n.tone === 'bad') toast.error(n.text, opts);
      else if (n.tone === 'warn') toast.warning(n.text, opts);
      else toast(n.text, opts);
    });
  }, [navigate]);
  return (
    <Toaster
      position="bottom-right"
      theme="dark"
      visibleToasts={3}
      closeButton
      toastOptions={{ style: { background: 'var(--panel)', color: 'var(--ink)', border: '1px solid var(--rule-strong)', borderRadius: 5, boxShadow: 'none', fontFamily: 'var(--sans)', fontSize: 13, lineHeight: '18px' } }}
    />
  );
}
