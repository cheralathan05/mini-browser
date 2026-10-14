import ReactDOM from "react-dom/client";
import { HomePage } from "@/pages/HomePage";
import "./home.css";
import "./home-agent-tasks.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<HomePage pageMode="agent" />);
