import { useEffect, useState } from "react";

export function useServiceWorker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let interval: ReturnType<typeof setInterval> | undefined;

    navigator.serviceWorker
      .register("/sw.js", { scope: "./" })
      .then((reg) => {
        console.log("Service Worker registered:", reg);

        interval = setInterval(() => reg.update(), 60000);

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              setUpdateAvailable(true);
            }
          });
        });
      })
      .catch((err) => {
        console.warn("Service Worker registration failed:", err);
      });

    return () => {
      if (interval) clearInterval(interval);
    };
  }, []);

  const reload = () => location.reload();

  return { updateAvailable, reload };
}
