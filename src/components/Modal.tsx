"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { CloseIcon } from "./icons";

/**
 * A modal on the native <dialog>: the browser traps focus, closes on
 * Escape, and returns focus to the control that opened it.
 */
export function Modal({
  open,
  onClose,
  title,
  dismissible = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** False while a wallet request is in flight: closing would hide its outcome. */
  dismissible?: boolean;
  children: ReactNode;
}) {
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
      className="modal"
      aria-label={title}
      onClose={onClose}
      onCancel={(event) => {
        if (!dismissible) event.preventDefault();
      }}
      onClick={(event) => {
        if (dismissible && event.target === ref.current) onClose(); // click on the backdrop
      }}
    >
      {open && (
        <div className="p-6 sm:p-8">
          <div className="mb-5 flex items-start justify-between gap-4">
            <h2 className="font-display text-[1.75rem] leading-[1.05] font-semibold tracking-[-0.03em]">{title}</h2>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mt-1 -mr-1 grid size-10 shrink-0 place-items-center rounded-full transition-colors hover:bg-tile"
              >
                <CloseIcon className="size-5" />
              </button>
            )}
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
