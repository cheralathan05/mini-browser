// NEXUS AGENT - CANCELLATION MANAGER

export class CancellationManager {
  private static controllers: Map<string, AbortController> = new Map();
  private static cancelledRuns: Set<string> = new Set();

  public static register(runId: string, controller: AbortController) {
    this.controllers.set(runId, controller);
    this.cancelledRuns.delete(runId);
  }

  public static isCancelled(runId: string): boolean {
    return this.cancelledRuns.has(runId);
  }

  public static cancel(runId: string): boolean {
    this.cancelledRuns.add(runId);
    const controller = this.controllers.get(runId);
    if (controller) {
      controller.abort();
      this.controllers.delete(runId);
      return true;
    }
    return false;
  }

  public static cleanup(runId: string) {
    this.controllers.delete(runId);
    this.cancelledRuns.delete(runId);
  }
}
