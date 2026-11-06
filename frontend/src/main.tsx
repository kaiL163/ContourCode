import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { BrowserRouter } from "react-router-dom";
import "./styles.scss";
import "./refinement.scss";
import "./light.scss";
import "./theme.scss";
import "./landing-redesign.scss";
import "./workspace-redesign.scss";
import "./readability-improvements.scss";
import "./dark-improvements.scss";
import "./live-layout.scss";
import "./verdict.scss";
import "./navigation.scss";
import "./task-bank.scss";
import "./integrity-redesign.scss";
import "./task-workbench.scss";
import "./form-controls.scss";
import "./code-history.scss";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
