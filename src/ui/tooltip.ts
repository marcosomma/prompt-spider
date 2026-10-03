export interface Tooltip {
  /** Shows the tooltip near a viewport point, kept inside the viewport. */
  show(clientX: number, clientY: number, html: string): void;
  hide(): void;
}

export function createTooltip(element: HTMLElement): Tooltip {
  return {
    show(clientX, clientY, html) {
      element.innerHTML = html;
      element.hidden = false;
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const left = clientX + 16 + width > window.innerWidth ? clientX - width - 12 : clientX + 16;
      const top = clientY + 16 + height > window.innerHeight ? clientY - height - 12 : clientY + 16;
      element.style.left = `${Math.max(4, left)}px`;
      element.style.top = `${Math.max(4, top)}px`;
    },
    hide() {
      element.hidden = true;
    },
  };
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
