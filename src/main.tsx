import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initI18n } from "./i18n";
import "./styles/tokens.css";
import "./styles/app.css";

// Fire-and-forget; <App/> is already idempotent against the language
// swap that happens when the persisted locale loads.
initI18n();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
