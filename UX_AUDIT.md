# UX audit, 29 October (R-071)

This is the record of an adversarial pass over Stint's web app, for anyone working on the UI or judging its quality. It looked for the moments a person could be confused, make a costly mistake, lose trust, or lose control of agent work, and records what was inspected, what was found, what changed and what was left. Everything here was observed on a running build unless a line says otherwise. Status lines marked "after the audit" were added when a later commit closed the item.

## Coverage

**How it was inspected.** Two daemons from the repository's own test harness, each on its own port: the hand-written replay (`apps/web/e2e/serve.ts`, the demo story after it finished) and a live daemon on a fresh fixture with scripted fake agents and a fake model server (`apps/web/e2e/flows/serve.ts`). No hosted or local model was called and nothing was charged. Playwright drove both, and screenshots were taken at 1440 by 900, 768 by 1024 and 390 by 844, before and after the changes, with a document-overflow check on each.

**Routes inspected.** Board (`/`), task view (`/t/:id`: the Changes and Tests tabs, the revision block and gate, rewind, memory), the Goals list and goal page (`/goals`, `/goals/:id`), Factory (`/factory`), Skills (`/skills`), the not-found page, the command palette, the status panel and the Run all question.

**States inspected.** Empty lanes; a task never run; a planned task waiting on an unmerged one; a task at the gate with green tests; a merged task with a pending contradiction; a goal with planned tasks; a goal with a dependency; an agent's permission question (flow test); a failed board read and a stale board (existing tests); a red verification and a pending contradiction at the gate (served by test routes); double presses on every new mutation.

**Not inspected by hand.** The Skills upload and editor, the spec builder's later steps, Intake with real GitHub data, the terminal with a live process, the memory graph at scale, and Windows High Contrast. Existing browser tests cover several of these; this pass did not change them.

## The product in one paragraph

A task (`task.json`) has one status the daemon enforces: planned, building, verifying, reviewing, in_review, awaiting_approval, approved, rejected, done, abandoned. A run is one agent's attempt and has its own ending (completed, capped, killed, failed, handed). Verification is the daemon's record: green or red, with a reason (tests, held-out scenarios, tampered tests, other checks). A review is a model's verdict and findings; a finding that would reverse a decision is a contradiction that waits in a queue for a person. Merge is the gate's outcome. These are separate records, and the Board groups statuses into four lanes: Needs you, Planned, In progress, Closed. Goals sit above tasks and roll their criteria up from each task's outcome. Controls that only navigate are links. The controls that start work are Run all, Start or Queue on autopilot, the autopilot switch, Hand to, Assign, Run the goal's tasks, Split into tasks, and Approve and merge.

## Findings

P0 is dangerous, data integrity or a severe loss of control; P1 blocks or materially confuses a core workflow; P2 is a meaningful usability or accessibility issue; P3 is polish.

| ID | P | Where | Evidence | Consequence | Fix | Verified by | Status |
|---|---|---|---|---|---|---|---|
| F1 | P1 | Board, `TaskCard` | A planned task with no run showed "Summary: The run wrote one file for its task." beside "No run yet" (live daemon, 1440 px). The card asked the summary route for every task, and the route asks a local model to summarise even a task whose only event is its creation. The text is the fake model's canned answer, so the wording is a fixture artifact; the request is a real product bug. | A model's guess reads as a run that never happened. | The card asks for a summary only once a run has started; a never-run task shows its goal. | `board.spec.ts`: no summary request for the planned task, one for the task that ran. | Fixed in the UI; the daemon side was fixed after the audit (R1). |
| F2 | P1 | Board header | The header counted "Needs you 0" and the empty lane explained the category, but nothing said in words whether anything needed you, or why a task did. | A returning user has to read every card to learn what to do. | A sentence under the title names each task and its reason ("T-0043 waits for your approval"), or says "Nothing needs you right now."; each empty lane says it is empty before it explains itself. | `board.spec.ts`, `attention-words.test.ts`. | Fixed. |
| F3 | P1 | Board, Run all planned; palette | One press put every planned task on autopilot. The button did not say how many, which would start now and which would wait, or what limits applied. Task defaults have no spend limit (`/api/limits`: `usd: null`). The palette command started it with no question at all. | Paid model calls on several tasks at once, uncapped, from one press. | The button says the count ("Run all 4 planned"). The first press asks: which tasks start now, which wait and on what, the most builds any may use, how many have no spend limit, and that nothing merges without you. Only Start starts; Start takes focus, and Cancel or Escape returns it to Run all. The palette opens the same question. | `board.spec.ts`: nothing is sent before Start, one request on a double press, the palette path. | Fixed. |
| F4 | P1 | Board, `TaskCard` | A run blocked on an agent's permission question stayed in In progress with a building label; only the task page said so. | The agent waits indefinitely while the board says nothing needs you. | A task with a pending permission question goes to Needs you with "asks permission" and the tool, and the header sentence names it. | `flows/permission.spec.ts`. | Fixed. |
| F5 | P1 | Task view, card | A task never showed its goal; the goal page linked down, but no page linked up. | A task's purpose and scope are invisible from the task. | "Part of G-0001, covers criterion 2" with a link, on the card and in the task header. | `flows/goal-links.spec.ts`. | Fixed. |
| F6 | P1 | Task view | A task that depends on an unmerged one gave no sign of it on its own page, and a planned task had no next action in the header. | A person cannot tell why it has not started, or how to start it. | The header lists "After T-0044 (not merged)"; a notice says it waits and that autopilot starts it only once T-0044 is merged; the header's one next action on a planned task is Start on autopilot (Queue on autopilot when it waits). | `flows/goal-links.spec.ts`. | Fixed. |
| F7 | P1 | Goal page | There was no way to run a goal's tasks from the goal; planned tasks read "In progress" in the task table (the rollup's label), and a goal with no task executing read "Running" with a filled dot. | The goal looks busy when nothing runs, and starting it needs the Board. | Run the goal's tasks (`api.runGoal`) in the header, with a pending guard, off in the replay, and a statement of what it starts and the goal's limits. Rows show each task's own status and what it waits for. A running goal reads "in progress" with a ring. `titles` is gone from the web `GoalView`. | `flows/goal-links.spec.ts`, `flows/goals.spec.ts`. | Fixed. |
| F8 | P1 | Gate | A review finding that would reverse a decision on this task was not mentioned at the gate; Approve looked ready, and the daemon refused with `decision_pending`. | The approval fails with a message the gate never prepared you for. | The gate lists each pending contradiction, and Approve holds with the reason; the header's Approve and the `a` key hold too; it opens when the queue settles. | `gate-reasons.spec.ts`. | Fixed. |
| F9 | P2 | Gate | A red verification read "The tests are red: 0 failed." when scenarios, tampered tests or another check were red. | The reason to act is hidden behind a contradiction. | The gate says what was red: failed tests out of the total, held-out scenarios that failed or could not run, tampered tests with their files, or the check by name. | `gate-reasons.spec.ts`, `attention-words.test.ts`. | Fixed. |
| F10 | P2 | Goals and How it went | A failing criterion was a red cross on the Goals page and an amber triangle in How it went, and "you check" had no mark in How it went. | The same state reads as two different things. | One shared map: proven is a green tick, failing a red cross, you check an amber triangle, and the rest are neutral with their shape. | `how-it-went.spec.ts` (unchanged, still passing), code review. | Fixed. |
| F11 | P2 | Gate sign-off | After a merge, Next pointed at any task waiting for approval, never at the goal's next task, and the sign-off did not link to the goal. | The goal's sequence is lost at the moment it matters. | The sign-off links to the goal; Next prefers the goal's next open task, else the oldest task waiting for approval. | `flows/goal-links.spec.ts`. | Fixed. |
| F12 | P2 | Top bar status button | "Ready, 4 agents, 1 model" (and "Replay, 2 agents, 1 model" where nothing can run). It reads as four agents running, and below 1280 px the counts vanished from the button's accessible name. | Ambiguous health; misleading in the replay. | "Connected, 4 agents and 1 model ready"; "Replay, agents are off"; below 1280 px the counts stay in the name as screen-reader text. Running work stays on the Board. | `shell.spec.ts`. | Fixed. |
| F13 | P2 | Card label | A card at the gate said "Needs you", the lane's name, while the task page said "Awaiting approval". | The label repeats the category instead of the reason. | The card says "awaiting approval". | `board.spec.ts`. | Fixed. |
| F14 | P2 | Palette | Goals were not under Go to. | Goals are not reachable by search. | Each goal, with `stint goal show G-xxxx`. | `flows/goal-links.spec.ts`. | Fixed. |
| F15 | P3 | Factory headline | On the fake daemon, "It has merged one task so far" sat above "Tasks merged 0". The headline counts tasks with status done; the figure counts merge events in the window; the seeded T-0040 is done with no merge event. | Two numbers disagree, on fixture data only. | None: a fixture artifact. A real merge writes both. | Inspection. | Open, low. |
| F16 | P3 | Replay board | "Decisions waiting 1 on T-0042" while T-0042 is merged. The recording ends with the contradiction unsettled. | A decision on a closed task looks actionable, and it is (Keep or Supersede still work). | None; the story is hand-written. | Inspection. | Open. |
| F17 | P3 | Revision block on a planned task | Approve, Request changes and Reject show disabled before anything is built. | Noise, but disabled and explained ("Nothing has been built yet."). | None. | Inspection. | Fixed after the audit, 30 October (R-016): before any run the gate says nothing has been built yet and offers none of the three. |
| F18 | P3 | Navigation names | "Factory" holds metrics, costs and the agent scoreboard; "Skills" holds SKILL.md know-how and its approval. Both are the product's own vocabulary (AGENTS.md, section 1). | Hard to predict for a first-time user. | Not renamed; see question 2. | Inspection. | Kept after the audit (D-083). |

Hypotheses from the earlier partial review, and the findings they became: 1 is F1 (a real bug plus fixture text); 2 is F2; 3 is F3; 4 is F4, F8 and F13 (the lanes stay as R-065 sets them, and their reasons are now explicit); 5 is partly fixture: every card's "wrote one file" line is the fake model's single answer, and with F1 a never-run card no longer shows one; 6 is F12; 7 is F18; 8 is F2 and F3 (the empty lanes and the Run all question carry the explanation, and the Board header leads with the state).

## What changed

Files, all under `apps/web/`:

- `src/routes/Board.tsx`: the attention sentence, empty-lane states, permission questions in Needs you, and the Run all question with the planned tasks' limits.
- `src/components/TaskCard.tsx`: no summary for a never-run task, the goal line (`GoalOf`, `criteriaWords`), and the permission blocker line.
- `src/routes/TaskView.tsx`: the goal and dependency line, the unmerged-dependency notice, Start or Queue on autopilot, pending contradictions passed to the gate, and a gate reload when the queue settles.
- `src/components/ApprovalGate.tsx`: `redReason`, contradictions in `gateState` and listed, the goal link and the goal's next task in the sign-off; the board's task list now comes from the task view.
- `src/routes/Goals.tsx`: Run the goal's tasks, task rows from `tasks`, the goal status label, and the shared criterion map.
- `src/components/HowItWent.tsx`: the shared `CRITERION` map.
- `src/components/StatusMenu.tsx`, `src/components/Shell.tsx`, `src/components/ui.tsx`, `src/hooks.ts` (`usePermissions`), `src/api.ts` (`titles` removed from `GoalView`) and `src/App.tsx` (the replay flag passed to Goals).
- Tests: `test/attention-words.test.ts`, `e2e/gate-reasons.spec.ts`, `e2e/flows/goal-links.spec.ts`, and changed assertions in `e2e/board.spec.ts`, `e2e/shell.spec.ts`, `e2e/flows/goals.spec.ts` and `e2e/flows/permission.spec.ts` where the behaviour changed.

## Remaining issues and decisions

- **R1, the summary route (daemon).** At the audit, `POST /api/tasks/:id/summary` still asked a local model about a task with no run. The UI no longer asked, but the CLI or another client could. Fixed after the audit (D-076): the route answers `source: 'none'` when no `run.started` event exists (`packages/daemon/src/routes/summary.ts`).
- **R2, `titles` in the daemon.** `GoalView.titles` stays in `packages/daemon/src/goals.ts` because `stint goal show` (`packages/cli/src/goal.ts`) and `packages/daemon/test/goals.test.ts` read it. Moving the CLI to `tasks` would let it go.
- **R3, stopping many tasks.** No one control takes every task off autopilot, although the daemon has it (`POST /api/autopilot {on:false}`). The palette offers it per task only.
- **R4, the goal's Run had no question.** Unlike the Board's Run all, it started on one press, since the goal page already shows the tasks, their order and the goal's spend and build meters, and its statement repeats the limits. Fixed after the audit (D-083): Run the goal's tasks asks first, as Run all does.
- **R5, the Factory and replay data points** (F15, F16) are fixture or recording artifacts and were left.

## Questions, and how they were settled

1. Should a task whose agent waits for permission count as Needs you on the Board (as implemented), or stay In progress with only the sentence above the lanes saying so? Kept as implemented (D-075).
2. Should "Factory" and "Skills" keep their names? A one-line description under each heading already exists; a rename is a product call. Kept (D-083).
3. Should a goal with no spend limit refuse "Run the goal's tasks" until one is set, or is saying "no spend limit" enough? Open.

## Tests and limitations

Run on the audit branch, on ports 6319 and 6320 only:

- `bash scripts/check.sh`: exit 0 (typecheck, `bun test` 640 pass and 0 fail, the identity guard, the web build).
- `bun run test:ui`: exit 0, 154 passed and 1 skipped (the skip is the existing Skills eval card, which needs live eval state).
- New tests: `test/attention-words.test.ts` (the attention sentence, the Run all limits sentence, the red reasons, the criteria words); `e2e/board.spec.ts` (the attention sentence, empty lanes, the Run all question with focus, Escape, a double press and the palette path, an axe pass on the header with the question open, and no summary for a never-run task); `e2e/gate-reasons.spec.ts` (a pending contradiction holds Approve, the header and the `a` key, then opens; a red scenario run says what was red); `e2e/flows/goal-links.spec.ts` (the goal and dependency on the card and task page, the palette goal, goal rows, Run the goal's tasks once on a double press, axe on the task and goal pages, the sign-off goal link and the next task after a merge); `e2e/flows/permission.spec.ts` (a permission question puts the task in Needs you).
- Two fixes were reverted once to prove their tests fail without them: the never-run summary (the test saw a summary request for the planned task) and the gate contradiction (the gate read "36 tests passed" with Approve open).
- Screenshots of every route at 1440 by 900, 768 by 1024 and 390 by 844, before and after, with a document-overflow check: no route scrolls sideways at any size, before or after.

Limitations:

- Single-key focus order and screen-reader output were checked through Playwright focus assertions and axe, not with a screen reader. Browser zoom and forced colours were not tested by hand.
- One 404 is logged once per new browser page, before and after these changes; its request was not pinned down.
- The Factory, Skills, Intake and the spec builder were not changed, and were only checked for overflow, console errors and their existing tests.
- Contrast for new text uses existing tokens whose ratios DESIGN.md measures; no new colour was added.
- The fake model answers every summary with the same sentence, so the quality of real card summaries was not judged.
