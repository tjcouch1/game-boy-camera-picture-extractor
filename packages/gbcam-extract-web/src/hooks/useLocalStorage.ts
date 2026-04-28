import { useCallback, useEffect, useRef, useState } from "react";

type SetValue<T> = (value: T | ((prev: T) => T)) => void;

/**
 * Generic typed localStorage hook with JSON serialization, error tolerance,
 * and cross-tab sync via the storage event.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, SetValue<T>] {
  const readValue = useCallback((): T => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initialValue;
      return JSON.parse(raw) as T;
    } catch {
      return initialValue;
    }
  }, [key, initialValue]);

  const [value, setValueState] = useState<T>(readValue);
  const valueRef = useRef(value);
  valueRef.current = value;

  const setValue: SetValue<T> = useCallback(
    (next) => {
      const resolved =
        typeof next === "function"
          ? (next as (prev: T) => T)(valueRef.current)
          : next;
      try {
        localStorage.setItem(key, JSON.stringify(resolved));
      } catch (e) {
        console.error(`useLocalStorage: failed to write key "${key}"`, e);
      }
      setValueState(resolved);
    },
    [key],
  );

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== key || e.newValue === null) return;
      try {
        setValueState(JSON.parse(e.newValue) as T);
      } catch {
        // Ignore parse errors from other-tab writes.
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [key]);

  return [value, setValue];
}
