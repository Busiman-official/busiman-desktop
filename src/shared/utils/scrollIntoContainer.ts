/** Keep `element` visible inside a scrollable `container` (keyboard list nav). */
export function scrollElementIntoContainer(
  container: HTMLElement,
  element: HTMLElement,
  padding = 8
): void {
  const cRect = container.getBoundingClientRect();
  const eRect = element.getBoundingClientRect();

  if (eRect.top < cRect.top + padding) {
    container.scrollTop -= cRect.top + padding - eRect.top;
  } else if (eRect.bottom > cRect.bottom - padding) {
    container.scrollTop += eRect.bottom - (cRect.bottom - padding);
  }
}
