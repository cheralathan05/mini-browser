import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { NexusBrowserHome } from "./components/nexus/NexusBrowserHome";
import { nexusClient } from "./lib/nexus/nexus-client";
import "./index.css";

function ElectronHomeStartPage() {
  const [user, setUser] = useState<{ name: string; email: string } | null>(() => {
    try {
      const saved = localStorage.getItem("nexus_user");
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });

  useEffect(() => {
    nexusClient.ensureSession().then((res) => {
      if (res?.user?.id) {
        setUser(res.user);
      }
    }).catch(() => {});
  }, []);

  const handleOpenUrl = (url: string) => {
    window.location.href = url;
  };

  const handleNavigate = (tab: any) => {
    window.location.href = `/?tab=${tab}`;
  };

  return (
    <div className="h-screen w-screen bg-neutral-950 text-neutral-100 flex flex-col overflow-y-auto">
      <NexusBrowserHome
        onNavigate={handleNavigate}
        onOpenUrl={handleOpenUrl}
        user={user}
        onOpenAiPanel={() => {}}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<ElectronHomeStartPage />);

