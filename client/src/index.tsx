import "./index.css";
import React from "react";
import { render } from "react-dom";
import { App } from "./App";

render(<App />, document.getElementById("root"));

// Register the service worker.
//
// Required for the app to be installable at all, and it is what will
// receive push once that lands. Failure is not fatal: without it the app
// behaves exactly as it did before, just not installable.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err.message);
    });
  });
}
