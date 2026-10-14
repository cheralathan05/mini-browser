// NEXUS AGENT - PAUSE MANAGER

export class PauseManager {
  private static pausedRuns: Set<string> = new Set();
  private static resumeResolvers: Map<string, () => void> = new Map();

  public static pause(runId: string) {
    this.pausedRuns.add(runId);
  }

  public static resume(runId: string) {
    this.pausedRuns.delete(runId);
    const resolver = this.resumeResolvers.get(runId);
    if (resolver) {
      resolver();
      this.resumeResolvers.delete(runId);
    }
  }

  public static isPaused(runId: string): boolean {
    return this.pausedRuns.has(runId);
  }

  public static async waitForResume(runId: string, signal?: AbortSignal): Promise<void> {
    if (!this.isPaused(runId)) return;

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.resumeResolvers.delete(runId);
      };

      if (signal) {
        signal.addEventListener("abort", () => {
          cleanup();
          reject(new Error("Run was cancelled while paused."));
        });
      }

      this.resumeResolvers.set(runId, () => {
        cleanup();
        resolve();
      });
    });
  }

  public static cleanup(runId: string) {
    this.pausedRuns.delete(runId);
    this.resumeResolvers.delete(runId);
  }
}
