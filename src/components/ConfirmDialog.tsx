"use client";

import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Styles the confirm button as a destructive action. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation built on the native <dialog> element, which provides focus
 * trapping, Esc to close and the backdrop; this component only styles it.
 */
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> itself.
        if (e.target === e.currentTarget) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-zinc-950/60 backdrop:backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <div className="p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              danger ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300" : "bg-pitch-100 text-pitch-700 dark:bg-pitch-900/40 dark:text-pitch-100"
            }`}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
          </span>
          <div className="pt-0.5">
            <h2 id="confirm-title" className="text-base font-bold">
              {title}
            </h2>
            <p id="confirm-message" className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {message}
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-pitch-600 hover:bg-pitch-700"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
