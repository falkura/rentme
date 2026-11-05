import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "normalize.css/normalize.css";
import "./styles.css";
import { applyTheme } from "./theme";

applyTheme();

// iOS ignores user-scalable=no; block pinch-zoom gestures so the layout can't be zoomed out of shape
for (const ev of ["gesturestart", "gesturechange"])
  document.addEventListener(ev, e => e.preventDefault(), { passive: false });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
