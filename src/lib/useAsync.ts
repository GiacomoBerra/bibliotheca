import { useCallback, useEffect, useState } from "react";

export interface AsyncState<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }

/** Esegue `fn` al montaggio e a ogni cambio di `deps`; ignora risposte superate da richieste più recenti. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    run().then(
      (data) => { if (live) setState({ data, error: null, loading: false }); },
      (e: unknown) => { if (live) setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : "Errore imprevisto.", loading: false })); },
    );
    return () => { live = false; };
  }, [run, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
