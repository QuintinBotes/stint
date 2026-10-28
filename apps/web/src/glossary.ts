/**
 * The words Stint uses, each in one plain sentence for someone who has not met them. The Help dialog lists them all;
 * a screen explains a word where it first appears with <Explain word="...">. One source, so every screen says the same.
 */
export const GLOSSARY = {
  task: { word: 'Task', ask: 'What is a task?', plain: 'A piece of work you give the agents: a goal, and the tests that prove it is done.' },
  run: { word: 'Run', ask: 'What is a run?', plain: 'One attempt by one agent at a task. A task can take several runs, by different agents.' },
  agent: { word: 'Agent', ask: 'What is an agent?', plain: 'An AI coding tool that writes the change, such as Muse Code or Claude Code.' },
  packet: { word: 'Packet', ask: 'What is a packet?', plain: 'The note a run leaves for the next one: what was done, what is left, and what is unsure. A stopped run still leaves one, so nothing is lost.' },
  handoff: { word: 'Hand off', ask: 'What is a hand-off?', plain: 'Give the task to another agent, which starts from the last packet instead of from scratch.' },
  verify: { word: 'Verify', ask: 'What does verified mean?', plain: "Stint runs the task's own tests itself. Green means they passed; an agent's word is never taken for it." },
  review: { word: 'Review', ask: 'What is the review?', plain: 'A second model reads the change and lists any problems before you decide.' },
  finding: { word: 'Finding', ask: 'What is a finding?', plain: 'A problem the review found, with how serious it is.' },
  gate: { word: 'Approval', ask: 'What does approving do?', plain: 'Nothing reaches the main branch until you approve. Approving merges the change.' },
  decision: { word: 'Decision', ask: 'What is a decision?', plain: 'A choice made during a task, such as how a limit is counted. Later runs keep it unless you change it.' },
  memory: { word: 'Memory', ask: 'What is memory?', plain: 'What Stint remembers across tasks: decisions, findings, files and skills, and how they connect.' },
  skill: { word: 'Skill', ask: 'What is a skill?', plain: "Written know-how given to an agent at the start of a run, such as how this project's settings are read." },
  autopilot: { word: 'Autopilot', ask: 'What is autopilot?', plain: 'Plans, builds, tests and reviews on its own, handing off when a run fails. It always stops for your approval.' },
  branch: { word: 'Branch', ask: 'What is a branch?', plain: 'Each task works on its own copy of the code, so nothing touches the main branch until you approve.' },
  tokens: { word: 'Tokens', ask: 'What are tokens?', plain: 'The units AI models read, write and are billed in; a token is about four characters of text.' },
  sample: { word: 'Sample tasks', ask: 'What are sample tasks?', plain: 'A fixed set of practice tasks Stint runs several times, to check that agents pass every time and not just once.' },
  replay: { word: 'Replay', ask: 'What is the replay?', plain: 'A demo played back: a hand-written story, or a recording of a live run, and the strip at the top says which. Nothing runs and nothing is charged.' },
  limit: { word: 'Limit', ask: 'What is a limit?', plain: 'A cap you set on a task or a goal, on builds, hand-offs, spend or agent time. Stint stops and asks you before it would go past one.' },
  sharpen: { word: 'Sharpen', ask: 'What does sharpen do?', plain: 'Before work starts, Stint asks the few questions whose answers change what gets built or how it is proven, recommends an answer to each, and records yours as decisions.' },
  proof: { word: 'Proof', ask: 'What is a proof?', plain: 'What shows a criterion is met: a test that failed before the change and passes after, a check the agent never saw, another check, or you.' },
  goal: { word: 'Goal', ask: 'What is a goal?', plain: 'An outcome bigger than one task, with the criteria that prove it. Stint splits it into tasks and shows how each part went.' },
} as const;

export type Word = keyof typeof GLOSSARY;
