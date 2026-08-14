import { useState } from "react";
import "./App.css";

function App() {
  const [ready] = useState(true);
  return (
    <main className="app">
      <h1>Auto-DM</h1>
      <p className="muted">
        Scaffold running. Engine, data layer, and DM pipeline land in later phases.
      </p>
    </main>
  );
}

export default App;
