// The transcript renderer lives with the bench command so the CLI stays one package.
// This file keeps the bench/ path from the spec working for anything that imports it here.
export { renderTranscript } from '../packages/cli/src/bench/transcript';
