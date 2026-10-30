import { type VisualCheck, visualChecks, visualRef } from '@stint-dev/core';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { StatusChip } from './ui';

/**
 * What Stint saw (R-068): each visual proof of a verification, with the screenshot it judged (the copy SAM 3.1
 * marked when it did not hold), the verdict as a label with its shape, and Muse Spark's own sentence on what it saw.
 * `at` is the verification's time, so a re-run of the same run reads the log again.
 */
export function VisualChecks({ taskId, run, at }: { taskId: string; run: string; at: string }) {
  const [checks, setChecks] = useState<VisualCheck[]>([]);
  useEffect(() => {
    let live = true;
    api
      .events(taskId)
      .then((events) => live && setChecks(visualChecks(events, run)))
      .catch(() => live && setChecks([]));
    return () => {
      live = false;
    };
  }, [taskId, run, at]);

  if (checks.length === 0) return null;
  return (
    <section aria-label="What Stint saw" data-testid="visual-checks" className="flex flex-col gap-3">
      <h3 className="text-body font-semibold">What Stint saw</h3>
      <p className="text-small text-ink-2 -mt-2">Once the tests passed, Stint opened each page in a browser and Muse Spark judged the screenshot. Where it did not hold, SAM 3.1 marked what Muse Spark named.</p>
      {checks.map((c) => {
        const page = visualRef(c.ref);
        const head = (
          <p className="text-small">
            <span className="tabular text-ink-2">Criterion {c.criterion}</span> on <span className="font-mono">{page?.path ?? c.ref}</span>
            {page ? `: ${page.want}` : ''}
          </p>
        );
        if ('notChecked' in c) {
          return (
            <article key={c.criterion} data-testid={`visual-check-${c.criterion}`} className="border-t border-rule pt-3 flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-3">
                {head}
                <StatusChip label="not checked" tone="neutral" shape="waiting" />
              </div>
              <p className="text-small text-ink-2">Stint did not look: {c.notChecked}</p>
            </article>
          );
        }
        const image = c.marked && !c.holds ? c.marked : c.screenshot;
        return (
          <article key={c.criterion} data-testid={`visual-check-${c.criterion}`} className="border-t border-rule pt-3 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              {head}
              <StatusChip label={c.holds ? 'looks right' : 'looks wrong'} tone={c.holds ? 'good' : 'bad'} />
            </div>
            <figure className="flex flex-col gap-1.5 m-0">
              <img src={api.visualFile(taskId, run, image)} alt={c.seen} width={1280} height={800} loading="lazy" className="w-full h-auto rounded-[5px] border border-rule bg-panel" data-testid="visual-screenshot" />
              <figcaption className="text-small text-ink-2">
                <span className="text-ink">Muse Spark saw:</span> {c.seen}
              </figcaption>
            </figure>
            {!c.holds && c.problem ? (
              <p className="text-small text-red" data-testid="visual-problem">
                {c.problem}
              </p>
            ) : null}
            <p className="text-small text-ink-3 tabular">
              {c.marked && !c.holds ? `SAM 3.1 marked the ${c.element ?? 'element'}. ` : !c.holds && c.element ? `SAM 3.1 could not find the ${c.element} to mark. ` : ''}
              {c.mark ? 'Judged and marked.' : 'Judged.'}{' '}
              {c.clip ? (
                <a href={api.visualFile(taskId, run, c.clip)} className="underline underline-offset-4 hover:text-ink">
                  The page loading, as a short clip
                </a>
              ) : null}
            </p>
          </article>
        );
      })}
    </section>
  );
}
