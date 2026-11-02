import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { loadSet, onTarget, tally, toViewport } from '../visual-set';

test('the published set has five seeded defects that each name an element, and five clean pages that name none', () => {
  const set = loadSet(join(import.meta.dir, '..', '..', 'bench', 'visual-set'));
  expect(set.ref).toBe('/admin :: a 429 banner saying try again in 60 s');
  expect(set.pages.filter((p) => p.kind === 'defect' && p.targets.length > 0)).toHaveLength(5);
  expect(set.pages.filter((p) => p.kind === 'clean' && p.targets.length === 0)).toHaveLength(5);
});

test("SAM's box is scaled from its own frame to the 1280 by 800 screenshot", () => {
  expect(toViewport({ x1: 16, y1: 44, x2: 466, y2: 73, w: 640, h: 400 })).toEqual({ x1: 32, y1: 88, x2: 932, y2: 146 });
});

test('a box is on target when at least half of it lies on one seeded element', () => {
  const banner = { x1: 32, y1: 88, x2: 932, y2: 146 };
  expect(onTarget({ x1: 50, y1: 100, x2: 400, y2: 130 }, [banner])).toEqual({ share: 1, onTarget: true });
  // the whole main column: the banner is a small part of it
  expect(onTarget({ x1: 32, y1: 88, x2: 932, y2: 374 }, [banner]).onTarget).toBe(false);
  expect(onTarget({ x1: 32, y1: 239, x2: 932, y2: 374 }, [banner])).toEqual({ share: 0, onTarget: false });
  // the share is per element, the best of them
  expect(onTarget({ x1: 24, y1: 70, x2: 502, y2: 168 }, [banner, { x1: 24, y1: 70, x2: 502, y2: 168 }]).share).toBe(1);
});

test('the table counts a fail on a defect as caught, a fail on a clean page as wrong, and leaves a page not checked out of both', () => {
  expect(
    tally([
      { kind: 'defect', holds: false, boxed: true, onTarget: true },
      { kind: 'defect', holds: false, boxed: true, onTarget: false },
      { kind: 'defect', holds: false, boxed: false, onTarget: null },
      { kind: 'defect', holds: true, boxed: false, onTarget: null },
      { kind: 'defect', holds: null, boxed: false, onTarget: null },
      { kind: 'clean', holds: false, boxed: true, onTarget: null },
      { kind: 'clean', holds: true, boxed: false, onTarget: null },
    ]),
  ).toEqual({ defectsCaught: 3, defects: 4, cleanWronglyFailed: 1, clean: 2, defectsBoxed: 2, boxesOnTarget: 1, notChecked: 1 });
});
