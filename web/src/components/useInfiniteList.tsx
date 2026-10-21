import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from '@shared/types';

/** Cursor-paginated list; `key` resets it. */
export function useInfiniteList<T>(fetchPage: (cursor: string | null) => Promise<Page<T>>, key: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const st = useRef({ cursor: null as string | null, done: false, busy: false, gen: 0 });

  const loadMore = useCallback(async () => {
    const s = st.current;
    if (s.busy || s.done) return;
    s.busy = true;
    const gen = s.gen;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchRef.current(s.cursor);
      if (gen !== s.gen) return;
      s.cursor = page.nextCursor;
      s.done = !page.nextCursor;
      setItems((prev) => [...prev, ...page.items]);
      setHasMore(!s.done);
    } catch (e) {
      if (gen === s.gen) setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      if (gen === s.gen) {
        s.busy = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const s = st.current;
    s.gen++;
    s.cursor = null;
    s.done = false;
    s.busy = false;
    setItems([]);
    setHasMore(true);
    setError(null);
    void loadMore();
  }, [key, loadMore]);

  return { items, setItems, loading, hasMore, error, loadMore };
}

/** Calls onVisible whenever the sentinel scrolls (or stays) into view. */
export function InfiniteSentinel({
  onVisible,
  disabled,
  watch,
}: {
  onVisible: () => void;
  disabled: boolean;
  watch: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current();
      },
      { rootMargin: '500px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [disabled, watch]);

  return <div ref={ref} className="sentinel" aria-hidden="true" />;
}
