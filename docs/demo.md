# The demo

One task, four agents, one model family, three survivals. The beat sheet is in `AGENTS.md` section 2; this page is the runbook. Rehearsal timings are filled in from the three rehearsals (R-022).

## Before the show

1. `scripts/bootstrap.sh --check-only` lists every adapter and host as available or not, with the reason.
2. `ollama list` shows `muse-glimmer:30b-mlx`; run one review the day before so the model is warm.
3. `stint demo seed` on a fresh copy of the fixture: T-0040 done with its review, T-0042 and T-0043 planned.
4. The terminal pane is open on T-0042; the browser is on the board, dark theme, 1080p.

## The beats

| Time | Beat | What to do | What the screen shows |
|---|---|---|---|
| 0:00 | The folder is the task | open the board, then `.stint/tasks/T-0042` in the file browser | three tasks, plain JSON and markdown |
| 0:12 | Speak the task | press `n`, speak the task | `task.json` from speech; Muse Wonder's plan streams in; memory shows T-0040 as similar |
| 0:40 | Muse Code builds | assign Muse Code | the worktree, the live diff, the cost meter, D3 in `decisions.md` |
| 1:05 | Kill it | `pkill -9 -f "muse exec"` in the terminal pane | the segment goes amber; the packet appears: size and tokens, in-flight step unknown |
| 1:20 | A different agent finishes | hand to the Stint agent | it checks the unknown step first; the daemon verifies |
| 1:45 | Review offline | turn Wi-Fi off; review with Glimmer | $0.00; a finding that contradicts D3 goes to the queue |
| 2:05 | Approve and merge | press `a` | one merge commit with `Stint-Task: T-0042` |
| 2:15 | It learned | approve the proposed skill; start T-0043 | `skill.applied`; the review finds nothing on limits |
| 2:35 | Close | open the task total and the memory scrubber | under one dollar for the task |

## What can go wrong

| Problem | What you see | What to do |
|---|---|---|
| The Meta API rate-limits the planner | the planner chip says it fell back to another host | nothing: the chain handles it, and that is worth saying on stage |
| Muse Code is slow to start | the segment stays "running" with no events | keep talking through the plan; the run arrives |
| Glimmer is cold | the review takes longer than 20 s | run one review before the show |
| The live run misbehaves | anything unexpected | switch to `stint demo --from <beat>`: the replay of the rehearsal, labelled as a replay on screen |
| Wi-Fi does not come back | hosted legs show unavailable | the rest of the demo needs no network |
