/** One cancellable frame for each change. A static cabin never runs a render
 * loop, and hidden displays retain only an invalidation until shown again. */
export class CabinDisplayFrames {
  private frame: number | null = null;
  private visible = true;
  private dirty = false;
  private disposed = false;
  constructor(
    private readonly draw: () => void,
    private readonly request = (callback: FrameRequestCallback) =>
      requestAnimationFrame(callback),
    private readonly cancel = (frame: number) => cancelAnimationFrame(frame),
  ) {}
  invalidate() {
    if (this.disposed) return;
    this.dirty = true;
    if (!this.visible || this.frame !== null) return;
    this.frame = this.request(() => {
      this.frame = null;
      if (!this.disposed && this.visible && this.dirty) {
        this.dirty = false;
        this.draw();
      }
    });
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    if (!visible && this.frame !== null) {
      this.cancel(this.frame);
      this.frame = null;
    } else if (visible && this.dirty) this.invalidate();
  }
  dispose() {
    this.disposed = true;
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
    this.dirty = false;
  }
}
