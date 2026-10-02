/** Only renderer acquisition failures carry this code; asset errors stay generic. */
export class GraphicsUnavailableError extends Error {
  readonly code = 'graphics-unavailable';

  constructor(cause: unknown) {
    super('Could not initialize WebGL 2 graphics.', { cause });
    this.name = 'GraphicsUnavailableError';
  }
}

export function startupErrorMessageKey(error: unknown) {
  if (error instanceof GraphicsUnavailableError) return 'graphicsUnavailable';
  // The engine's existing context-loss callback supplies this exact sentinel.
  if (error === 'graphics-context-lost') return 'graphicsError';
  return 'loadErrorDetail';
}
