import { useState, useCallback, useRef, useEffect } from "react";

interface UseRangeSelectionOptions<T> {
  data: T[];
  getRowId: (row: T) => string;
}

export interface UseRangeSelectionReturn {
  selectedIds: Set<string>;
  isSelected: (id: string) => boolean;
  toggleRow: (id: string, shiftKey: boolean) => void;
  toggleAll: () => void;
  clearSelection: () => void;
  selectedCount: number;
  allSelected: boolean;
}

export function useRangeSelection<T>({
  data,
  getRowId,
}: UseRangeSelectionOptions<T>): UseRangeSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedIdRef = useRef<string | null>(null);

  // Reset lastClickedId if it's no longer in the data
  useEffect(() => {
    if (lastClickedIdRef.current) {
      const exists = data.some(
        (row) => getRowId(row) === lastClickedIdRef.current
      );
      if (!exists) {
        lastClickedIdRef.current = null;
      }
    }
  }, [data, getRowId]);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  const toggleRow = useCallback(
    (id: string, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);

        if (shiftKey && lastClickedIdRef.current) {
          // Range select: find indices of last clicked and current
          const ids = data.map(getRowId);
          const lastIdx = ids.indexOf(lastClickedIdRef.current);
          const currentIdx = ids.indexOf(id);

          if (lastIdx !== -1 && currentIdx !== -1) {
            const start = Math.min(lastIdx, currentIdx);
            const end = Math.max(lastIdx, currentIdx);
            for (let i = start; i <= end; i++) {
              next.add(ids[i]);
            }
          } else {
            // Fallback: just toggle
            if (next.has(id)) next.delete(id);
            else next.add(id);
          }
        } else {
          // Normal toggle
          if (next.has(id)) next.delete(id);
          else next.add(id);
        }

        lastClickedIdRef.current = id;
        return next;
      });
    },
    [data, getRowId]
  );

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === data.length && data.length > 0) {
        return new Set();
      }
      return new Set(data.map(getRowId));
    });
  }, [data, getRowId]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastClickedIdRef.current = null;
  }, []);

  return {
    selectedIds,
    isSelected,
    toggleRow,
    toggleAll,
    clearSelection,
    selectedCount: selectedIds.size,
    allSelected: data.length > 0 && selectedIds.size === data.length,
  };
}
