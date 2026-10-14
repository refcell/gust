/**
 * One run at a time: a trigger while a run is in flight schedules exactly one follow-up run after
 * it (`force` flags are OR-ed) instead of starting a parallel one. Each trigger's promise resolves
 * once the run that covers it has finished. Runner errors are swallowed (it reports its own).
 */
export function createCoalescer(run: (force: boolean) => Promise<void>): (force?: boolean) => Promise<void> {
  let running: Promise<void> | null = null;
  let pending: { force: boolean; promise: Promise<void> } | null = null;

  const trigger = (force = false): Promise<void> => {
    if (!running) {
      running = run(force)
        .catch(() => undefined)
        .finally(() => {
          running = null;
        });
      return running;
    }
    if (pending) {
      pending.force ||= force;
      return pending.promise;
    }
    const p: { force: boolean; promise: Promise<void> } = { force, promise: Promise.resolve() };
    p.promise = running.then(() => {
      if (pending === p) pending = null;
      return trigger(p.force);
    });
    pending = p;
    return p.promise;
  };
  return trigger;
}
