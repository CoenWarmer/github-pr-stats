/**
 * Sets up keyboard event handlers for cursor changes during zoom interactions
 */
export function setupKeyboardHandlers(svgElement: SVGSVGElement | null) {
  if (!svgElement) return () => {};

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.altKey && svgElement) {
      svgElement.style.cursor = 'zoom-in';
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (!e.altKey && svgElement) {
      svgElement.style.cursor = 'default';
    }
  };

  const handleBlur = () => {
    if (svgElement) {
      svgElement.style.cursor = 'default';
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', handleBlur);

  // Return cleanup function
  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('blur', handleBlur);
  };
}
