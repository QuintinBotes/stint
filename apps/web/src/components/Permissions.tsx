import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { type PendingPermission, type PermissionOptionData, api, daemonMessage } from '../api';
import { useHold } from './Scrubber';
import { Button, StateMark } from './ui';

/** The plain words for one permission choice, whatever name the agent gave it. */
export function optionLabel(option: PermissionOptionData): string {
  if (option.kind === 'allow_once') return 'Allow once';
  if (option.kind === 'allow_always') return 'Always for this run';
  if (option.kind === 'reject_once' || option.kind === 'reject_always') return 'Reject';
  return option.name || option.optionId;
}

function PermissionButtons({ p, onDecided }: { p: PendingPermission; onDecided?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const hold = useHold();
  const decide = (optionId: string) => {
    if (busy !== null) return;
    setBusy(optionId);
    api
      .decidePermission(p.task, p.run, p.requestId, optionId)
      .then(() => onDecided?.())
      .catch((e: unknown) => toast.error(`The answer to ${p.tool} was not sent: ${daemonMessage(e)}`))
      .finally(() => setBusy(null));
  };
  return (
    <div className="flex flex-wrap gap-2">
      {p.options.map((o) => (
        <Button key={o.optionId} className="h-8 px-2.5 text-small" aria-disabled={busy !== null} aria-busy={busy === o.optionId} onClick={() => decide(o.optionId)} data-testid={`permission-${o.kind}`} {...hold}>
          {busy === o.optionId ? 'Sending' : optionLabel(o)}
        </Button>
      ))}
    </div>
  );
}

/** A live run is waiting for a person: the tool, what it wants to do, and one button per choice (R-033). */
export function PermissionBanner({ permissions }: { permissions: PendingPermission[] }) {
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const waiting = permissions.filter((p) => !decided.has(p.requestId));
  if (waiting.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="permission-banner">
      {waiting.map((p) => (
        <section key={p.requestId} className="stint-notice stint-notice--attention flex-col items-start gap-2 mb-0" aria-label="Permission needed">
          <p className="inline-flex items-center gap-1.5 text-body font-medium text-amber">
            <StateMark shape="attention" />
            Permission needed
          </p>
          <p className="text-small text-ink-2" data-testid="permission-title">
            <span className="font-mono">{p.tool}</span>: {p.title}
          </p>
          <div>
            <PermissionButtons p={p} onDecided={() => setDecided((s) => new Set(s).add(p.requestId))} />
          </div>
        </section>
      ))}
    </div>
  );
}

/** Permission rows for the Factory queue, each linking to its task (R-033). */
export function PermissionRows({ permissions, onDecided }: { permissions: PendingPermission[]; onDecided?: () => void }) {
  if (permissions.length === 0) return null;
  return (
    <>
      {permissions.map((p) => (
        <li key={`${p.task}-${p.requestId}`} className="rounded-[5px] border border-amber bg-amber-wash p-3 text-small" data-testid="permission-row">
          <p className="text-ink-2 mb-2">
            <Link to={`/t/${p.task}`} className="font-medium text-ink hover:text-ink" data-testid="permission-task-link">
              {p.task}
            </Link>{' '}
            {p.run} is waiting for permission: <span className="font-mono">{p.tool}</span>, {p.title}
          </p>
          <PermissionButtons p={p} onDecided={onDecided} />
        </li>
      ))}
    </>
  );
}
