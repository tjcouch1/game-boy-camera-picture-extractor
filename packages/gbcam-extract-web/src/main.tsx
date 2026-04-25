import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import "./index.css";

// Register service worker with auto-update
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "./" })
      .then((registration) => {
        console.log("Service Worker registered:", registration);

        // Check for updates every minute
        setInterval(() => {
          registration.update();
        }, 60000);

        // Listen for updates
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (
                newWorker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                // New service worker is ready, notify user
                showUpdateNotification();
              }
            });
          }
        });
      })
      .catch((err) => {
        console.warn("Service Worker registration failed:", err);
      });
  });
}

function showUpdateNotification() {
  const notification = document.createElement("div");
  notification.className =
    "fixed bottom-4 right-4 bg-blue-600 text-white px-4 py-3 rounded shadow-lg z-50 flex items-center gap-3";
  notification.innerHTML = `
    <span>App updated! Refresh to get the latest version.</span>
    <button onclick="location.reload()" class="font-bold underline">Refresh</button>
  `;
  document.body.appendChild(notification);

  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 10000);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
