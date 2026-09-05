'use client';

import { useState, useSyncExternalStore } from 'react';

import type { BoardController } from '../board/controller.ts';
import type { Tool } from '../board/input/gesture.ts';

/**
 * Tools, undo/redo, copy-link, and the declared limit.
 *
 * Reads the controller through `useSyncExternalStore`, whose snapshot identity changes only
 * when the tool, the selection or the undo depth does — so a 300-sample drag re-renders this
 * component zero times, not three hundred.
 */

interface ToolbarProps {
  readonly controller: BoardController;
}

const TOOLS: readonly { readonly tool: Tool; readonly label: string; readonly key: string }[] = [
  { tool: 'select', label: 'Select', key: 'V' },
  { tool: 'rect', label: 'Rectangle', key: 'R' },
];

const button =
  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-40';

export const Toolbar = ({ controller }: ToolbarProps) => {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [copied, setCopied] = useState(false);

  const copyLink = (): void => {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => {
          setCopied(false);
        }, 1_500);
      })
      .catch(() => {
        // Clipboard access can be refused; the URL bar still has the link. Nothing to raise.
      });
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 p-3">
      <div
        role="toolbar"
        aria-label="Board tools"
        className="pointer-events-auto flex w-fit items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur"
      >
        {TOOLS.map(({ tool, label, key }) => (
          <button
            key={tool}
            type="button"
            data-testid={`tool-${tool}`}
            aria-pressed={snapshot.tool === tool}
            title={`${label} (${key})`}
            onClick={() => { controller.setTool(tool); }}
            className={`${button} ${snapshot.tool === tool ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
          >
            {label}
          </button>
        ))}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-200" />
        <button
          type="button"
          data-testid="undo"
          title="Undo (Ctrl+Z)"
          disabled={!snapshot.canUndo}
          onClick={controller.undo}
          className={`${button} text-slate-700 hover:bg-slate-100`}
        >
          Undo
        </button>
        <button
          type="button"
          data-testid="redo"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!snapshot.canRedo}
          onClick={controller.redo}
          className={`${button} text-slate-700 hover:bg-slate-100`}
        >
          Redo
        </button>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-200" />
        <button
          type="button"
          data-testid="copy-link"
          onClick={copyLink}
          className={`${button} text-slate-700 hover:bg-slate-100`}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <span className="px-2 text-xs text-slate-500" aria-live="polite">
          {snapshot.selection.length === 0 ? 'Nothing selected' : `${snapshot.selection.length} selected`}
        </span>
      </div>

      <p
        role="status"
        data-testid="ephemeral-banner"
        className="pointer-events-auto w-fit rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900"
      >
        <strong>Boards are ephemeral until persistence lands.</strong> Refresh and this board is gone; nobody else
        can see it yet.
      </p>
    </div>
  );
};
