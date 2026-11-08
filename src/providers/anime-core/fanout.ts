/**
 * Fan-out con budget di risposta.
 *
 * I provider girano in parallelo e ognuno scrive il suo risultato appena
 * finisce: allo scadere del budget si consegna quello che c'è. Ma **una lista
 * vuota non è una risposta**: su una serie fredda nessun provider ha finito
 * entro il budget, e consegnare zero stream manda il client su un episodio
 * vuoto. In quel caso si aspetta il primo provider che produce qualcosa.
 */

export interface FanoutResult<T> {
  /** Risultati dei provider, nell'ordine di arrivo originale. */
  items: T[];
  /** true quando la lista è stata tagliata dal budget (non va in cache). */
  truncated: boolean;
  /** Provider che avevano già finito quando il budget è scaduto. */
  readyAtBudget: number;
}

export interface FanoutOptions {
  /** Oltre questo tempo si consegna quello che c'è (0 = nessun budget). */
  budgetMs: number;
  /** Chiamata quando il budget scade, per il log. */
  onBudget?: (ready: number) => void;
  /** Chiamata quando si è dovuto aspettare il primo provider non vuoto. */
  onEmptyBudget?: (ready: number) => void;
}

export async function collectWithinBudget<T>(
  tasks: Promise<T[]>[],
  options: FanoutOptions
): Promise<FanoutResult<T>> {
  const collected: (T[] | undefined)[] = new Array(tasks.length);
  let resolveFirstStream: (() => void) | undefined;
  const firstStream = new Promise<void>((resolve) => { resolveFirstStream = resolve; });

  const settled = tasks.map((task, index) =>
    task.then((items) => {
      collected[index] = items;
      if (items.length) resolveFirstStream?.();
    })
  );
  const allDone = Promise.all(settled);

  const gather = (): T[] => {
    const out: T[] = [];
    for (const group of collected) {
      if (!group) continue;
      for (const item of group) out.push(item);
    }
    return out;
  };

  if (!(options.budgetMs > 0)) {
    await allDone;
    return { items: gather(), truncated: false, readyAtBudget: tasks.length };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const budgetReached = new Promise<'budget'>((resolve) => {
    timer = setTimeout(() => resolve('budget'), options.budgetMs);
  });
  const outcome = await Promise.race([allDone.then(() => 'done' as const), budgetReached]);
  if (timer) clearTimeout(timer);

  if (outcome === 'done') {
    return { items: gather(), truncated: false, readyAtBudget: tasks.length };
  }

  const readyAtBudget = collected.filter(Boolean).length;
  options.onBudget?.(readyAtBudget);
  const anyStream = collected.some((group) => group && group.length > 0);
  if (!anyStream) {
    options.onEmptyBudget?.(readyAtBudget);
    await Promise.race([firstStream, allDone]);
  }
  return { items: gather(), truncated: true, readyAtBudget };
}
