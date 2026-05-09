import { createRoot } from "react-dom/client";
import "../src/popup/globals.css";
import { PreviewApp } from "./PreviewApp";

createRoot(document.getElementById("root")!).render(<PreviewApp />);
