import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { initAuth } from "./lib/auth";
import "./styles/index.css";

initAuth();

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
