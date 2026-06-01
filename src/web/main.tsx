import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./tokens.css"; // kn.work design tokens (--kn-*), vendored — see tokens.css header
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
