import { useState, useEffect } from "react";
import CPUSimulator from "./CPUSimulator.tsx";
import MSU1Simulator from "./MSU1Simulator.tsx";
import "./app.css";

/* Hash routing rather than pathname routing, so the build works unchanged from
   a plain static host (GitHub Pages and the like) and from file:// — neither of
   which can rewrite unknown paths back to index.html. */

type RouteId = "cpu" | "msu1";

const ROUTES: {
  id: RouteId;
  hash: string;
  label: string;
  note: string;
  title: string;
}[] = [
  {
    id: "cpu",
    hash: "#/cpu",
    label: "CPU Simulator",
    note: "generic register machine",
    title: "CPU Simulator — ITE131 Unit II",
  },
  {
    id: "msu1",
    hash: "#/msu1",
    label: "MSU-1",
    note: "ITE131 teaching machine",
    title: "MSU-1 Simulator — ITE131 Computer Architecture",
  },
];

function readRoute(): RouteId {
  return window.location.hash.replace(/^#\/?/, "") === "msu1" ? "msu1" : "cpu";
}

export default function App() {
  const [route, setRoute] = useState<RouteId>(readRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const meta = ROUTES.find((r) => r.id === route);
    if (meta) document.title = meta.title;
  }, [route]);

  return (
    <div className={`app-shell is-${route}`}>
      <nav className="app-nav">
        <span className="app-brand">ITE131 simulators</span>
        <div className="app-tabs">
          {ROUTES.map((r) => (
            <a
              key={r.id}
              href={r.hash}
              className={`app-tab ${r.id === route ? "is-active" : ""}`}
              aria-current={r.id === route ? "page" : undefined}
            >
              <span className="app-tab-label">{r.label}</span>
              <span className="app-tab-note">{r.note}</span>
            </a>
          ))}
        </div>
      </nav>
      {route === "msu1" ? <MSU1Simulator /> : <CPUSimulator />}
    </div>
  );
}
