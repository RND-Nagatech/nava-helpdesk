import type { MouseEvent } from "react";

export function navigateWithinHelpdesk(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("nava:navigate"));
}

export function handleHelpdeskNavigation(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigateWithinHelpdesk(event.currentTarget.pathname + event.currentTarget.search);
}
