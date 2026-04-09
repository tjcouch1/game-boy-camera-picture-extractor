import { useState, useEffect } from "react";
import { initOpenCV } from "gbcam-extract";

export type OpenCVStatus = "loading" | "ready" | "error";

export function useOpenCV() {
  const [status, setStatus] = useState<OpenCVStatus>("loading");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    initOpenCV((pct) => {
      if (!cancelled) setProgress(pct);
    })
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, progress, error };
}
