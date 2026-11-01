"use client";

import { GitMerge, MoreHorizontal, PencilLine, Trash2, UserCheck, UserMinus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useLanguage } from "./language-selector";
import { menuDebug } from "@/lib/menu-debug";

export function MemberActions({ name, canMerge, active, onEdit, onMerge, onToggleActive, onDelete }: {
  name: string;
  canMerge: boolean;
  active: boolean;
  onEdit: () => void;
  onMerge: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const [open, setOpen] = useState(false);

  // iOS Safari hid the menu between touching an item and the tap landing, so the
  // item never ran. The menu is a manual popover: it closes only on a completed
  // click outside it, Escape, focus leaving it, or its row scrolling off screen.
  useEffect(() => {
    if (!open) return;
    const follow = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor || anchor.bottom < 0 || anchor.top > window.innerHeight) hide("row off screen");
      else place();
    };
    const dismiss = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) hide("click outside");
    };
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    document.addEventListener("click", dismiss, true);
    return () => {
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
      document.removeEventListener("click", dismiss, true);
    };
  }, [open]);

  function hide(reason: string) {
    menuDebug(`hide(${reason}) open=${menu.current?.matches(":popover-open")}`);
    if (menu.current?.matches(":popover-open")) menu.current.hidePopover();
  }

  function place() {
    const panel = menu.current;
    if (!panel || !trigger.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const bottomInset = window.innerWidth <= 760 ? 128 : 12;
    const below = anchor.bottom + 8;
    const top = below + height <= window.innerHeight - bottomInset ? below : anchor.top - height - 8;
    panel.style.left = `${Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12))}px`;
    panel.style.top = `${Math.max(12, top)}px`;
  }

  function run(label: string, action: () => void) {
    menuDebug(`run ${label}`);
    action();
    hide(`ran ${label}`);
  }

  return <div className="member-actions">
    <button ref={trigger} type="button" className="member-actions-trigger" popoverTarget={id} aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label={t("Actions for {name}", { name })} title={t("Actions for {name}", { name })} onKeyDown={(event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      focusLast.current = event.key === "ArrowUp";
      menu.current?.showPopover();
    }}><MoreHorizontal size={20} aria-hidden="true" /></button>
    <div ref={menu} id={id} popover="manual" role="menu" aria-label={t("Actions for {name}", { name })} className="member-actions-menu" onToggle={(event) => {
      const panel = event.currentTarget;
      const isOpen = panel.matches(":popover-open");
      setOpen(isOpen);
      if (!isOpen) return;
      place();
      const buttons = panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      buttons[focusLast.current ? buttons.length - 1 : 0]?.focus({ preventScroll: true });
      focusLast.current = false;
    }} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) hide("focus left");
    }} onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        hide("Escape");
        trigger.current?.focus();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
      <p className="member-actions-name">{name}</p>
      <button type="button" role="menuitem" onClick={() => run("edit", onEdit)}><PencilLine size={16} aria-hidden="true" /><span>{t("Edit member")}</span></button>
      <button type="button" role="menuitem" disabled={!canMerge} onClick={() => run("merge", onMerge)}><GitMerge size={16} aria-hidden="true" /><span>{t("Merge duplicate")}</span></button>
      <button type="button" role="menuitem" onClick={() => run("toggle active", onToggleActive)}>{active ? <UserMinus size={16} aria-hidden="true" /> : <UserCheck size={16} aria-hidden="true" />}<span>{t(active ? "Move to previous records" : "Restore to roster")}</span></button>
      <div className="member-actions-divider" role="separator" />
      <button type="button" role="menuitem" className="member-actions-delete" onClick={() => run("delete", onDelete)}><Trash2 size={16} aria-hidden="true" /><span>{t("Delete member")}</span></button>
    </div>
  </div>;
}
