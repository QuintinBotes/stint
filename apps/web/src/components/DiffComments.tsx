import { useState } from 'react';
import type { LineComment } from '../api';
import { Button } from './ui';

/** What an annotation under a diff line carries: a stored comment, or the editor for a new one. */
export type CommentAnnotation = { kind: 'comment'; comment: LineComment } | { kind: 'editor' };

export function CommentNote({ comment }: { comment: LineComment }) {
  return (
    <div data-testid="diff-comment" data-line={comment.line} className="border-t border-rule bg-panel px-3 py-2 text-small">
      <p className="font-mono text-small text-ink-3">
        {comment.file}:{comment.line}
        {comment.handedTo ? <span>{` handed to ${comment.handedTo}`}</span> : null}
      </p>
      <p className="mt-1 whitespace-pre-wrap">{comment.text}</p>
    </div>
  );
}

/** The inline field a line click or Enter opens; saving hands the text to the daemon. */
export function CommentEditor({
  file,
  line,
  busy,
  error,
  onSave,
  onCancel,
}: {
  file: string;
  line: number;
  busy: boolean;
  error: string | null;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const save = () => {
    const trimmed = text.trim();
    if (trimmed) onSave(trimmed);
  };
  return (
    <form
      data-testid="diff-comment-form"
      className="border-t border-rule bg-panel px-3 py-2 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="text-small" htmlFor={`comment-${line}`}>
        Comment on {file}:{line}
      </label>
      <textarea
        id={`comment-${line}`}
        data-testid="diff-comment-input"
        aria-label={`Comment on ${file} line ${line}`}
        // the field the click asked for, ready to type in
        autoFocus
        rows={3}
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        className="w-full rounded-[5px] border border-rule bg-ground px-2 py-1 text-body outline-none focus-visible:border-ink"
      />
      {error ? (
        <p role="alert" className="text-red text-small">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button tone="primary" className="h-7 px-2.5 text-small" disabled={busy || !text.trim()} onClick={save} data-testid="diff-comment-save">
          Save comment
        </Button>
        <Button className="h-7 px-2.5 text-small" disabled={busy} onClick={onCancel} data-testid="diff-comment-cancel">
          Cancel
        </Button>
      </div>
    </form>
  );
}
