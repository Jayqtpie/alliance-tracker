"use client";

import { GitMerge, MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function MemberActions({ name, canMerge, onEdit, onMerge, onDelete }: {
  name: string;
  canMerge: boolean;
  onEdit: () => void;
  onMerge: () => void;
  onDelete: () => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => menu.current?.hidePopover();
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function run(action: () => void) {
    menu.current?.hidePopover();
    action();
  }

  return <div className="member-actions">
    <button ref={trigger} type="button" className="member-actions-trigger" popoverTarget={id} aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label={`Actions for ${name}`} title={`Actions for ${name}`} onKeyDown={(event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      focusLast.current = event.key === "ArrowUp";
      menu.current?.showPopover();
    }}><MoreHorizontal size={20} aria-hidden="true" /></button>
    <div ref={menu} id={id} popover="auto" role="menu" aria-label={`Actions for ${name}`} className="member-actions-menu" onToggle={(event) => {
      const panel = event.currentTarget;
      const isOpen = panel.matches(":popover-open");
      setOpen(isOpen);
      if (!isOpen || !trigger.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const bottomInset = window.innerWidth <= 760 ? 128 : 12;
      const below = anchor.bottom + 8;
      const top = below + height <= window.innerHeight - bottomInset ? below : anchor.top - height - 8;
      panel.style.left = `${Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12))}px`;
      panel.style.top = `${Math.max(12, top)}px`;
      const buttons = panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      buttons[focusLast.current ? buttons.length - 1 : 0]?.focus({ preventScroll: true });
      focusLast.current = false;
    }} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) menu.current?.hidePopover();
    }} onKeyDown={(event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
      <p className="member-actions-name">{name}</p>
      <button type="button" role="menuitem" onClick={() => run(onEdit)}><PencilLine size={16} aria-hidden="true" /><span>Edit member</span></button>
      <button type="button" role="menuitem" disabled={!canMerge} onClick={() => run(onMerge)}><GitMerge size={16} aria-hidden="true" /><span>Merge duplicate</span></button>
      <div className="member-actions-divider" role="separator" />
      <button type="button" role="menuitem" className="member-actions-delete" onClick={() => run(onDelete)}><Trash2 size={16} aria-hidden="true" /><span>Delete member</span></button>
    </div>
  </div>;
}
