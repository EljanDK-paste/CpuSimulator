import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CPUSimulator from "./CPUSimulator.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CPUSimulator />
  </StrictMode>,
);
