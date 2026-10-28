import React, { useState, useEffect } from "react";
import { Lock, Mail, User, ArrowRight, Loader2, X, ShieldCheck, Database, KeyRound } from "lucide-react";
import { nexusClient } from "../../lib/nexus/nexus-client";
import { getApiBase } from "../../lib/nexus/nexus-config";

interface AuthModalProps {
  isOpen: boolean;
  onSuccess: (user: { id: string; email: string; name: string }) => void;
  onClose?: () => void;
}

export const NexusAuthModal: React.FC<AuthModalProps> = ({ isOpen, onSuccess, onClose }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    if (!isOpen) return;

    // Check backend & DB health
    fetch(`${getApiBase()}/api/health`)
      .then((res) => {
        if (res.ok) setBackendStatus("online");
        else setBackendStatus("offline");
      })
      .catch(() => setBackendStatus("offline"));

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (isRegister) {
        const res = await nexusClient.register(email, password, name);
        onSuccess(res.user);
      } else {
        const res = await nexusClient.login(email, password);
        onSuccess(res.user);
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed. Please verify credentials or check PostgreSQL connection.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAdminLogin = async () => {
    setEmail("cheralathan@nexus.ai");
    setPassword("nexus123");
    setIsLoading(true);
    setError(null);

    try {
      const res = await nexusClient.login("cheralathan@nexus.ai", "nexus123");
      onSuccess(res.user);
    } catch (err: any) {
      // If user doesn't exist yet, register default admin
      try {
        const regRes = await nexusClient.register("cheralathan@nexus.ai", "nexus123", "Cheralathan");
        onSuccess(regRes.user);
      } catch (regErr: any) {
        setError(regErr.message || err.message || "Quick admin sign in failed.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
      className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
    >
      <div className="relative bg-[#0d0d1a] border border-indigo-500/30 rounded-2xl max-w-md w-full p-6 shadow-[0_0_50px_rgba(99,102,241,0.25)] text-neutral-100 animate-in fade-in zoom-in-95 duration-200">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.08] transition"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Brand & Title */}
        <div className="text-center mb-5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-purple-600 flex items-center justify-center font-black text-white text-lg mx-auto shadow-lg shadow-indigo-500/30 mb-3 ring-1 ring-white/20">
            NX
          </div>
          <h2 className="text-lg font-bold text-white tracking-wide">
            {isRegister ? "Create NEXUS Account" : "Sign in to NEXUS BROWSER"}
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            Browse. Think. Automate with persistent workspaces.
          </p>

          {/* Real Backend / DB status indicator */}
          <div className="mt-2.5 inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-[10px] text-neutral-300">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                backendStatus === "online"
                  ? "bg-emerald-400 shadow-[0_0_6px_#10b981]"
                  : backendStatus === "checking"
                  ? "bg-amber-400 animate-pulse"
                  : "bg-rose-400 shadow-[0_0_6px_#f43f5e]"
              }`}
            />
            <Database className="w-3 h-3 text-indigo-400" />
            <span>
              {backendStatus === "online"
                ? "PostgreSQL & Express Monolith Online"
                : backendStatus === "checking"
                ? "Checking Monolith Services..."
                : "Monolith Offline (Port 8001 / DB 5433)"}
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        {/* 1-Click Quick Admin Sign-in Button */}
        {!isRegister && (
          <button
            type="button"
            onClick={handleQuickAdminLogin}
            disabled={isLoading}
            className="w-full mb-4 flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-gradient-to-r from-violet-600/25 to-indigo-600/25 hover:from-violet-600/40 hover:to-indigo-600/40 border border-violet-500/35 hover:border-violet-400 text-violet-200 text-xs font-semibold transition-all group shadow-sm disabled:opacity-50"
          >
            <KeyRound className="w-3.5 h-3.5 text-cyan-300 group-hover:rotate-12 transition-transform" />
            <span>Instant Admin Sign-In (Cheralathan)</span>
          </button>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {isRegister && (
            <div>
              <label className="text-[11px] font-medium text-neutral-400">Full Name</label>
              <div className="relative mt-1">
                <User className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Cheralathan"
                  className="w-full bg-[#121224] border border-white/[0.08] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-[11px] font-medium text-neutral-400">Email Address</label>
            <div className="relative mt-1">
              <Mail className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="cheralathan@nexus.ai"
                className="w-full bg-[#121224] border border-white/[0.08] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-neutral-400">Password</label>
            <div className="relative mt-1">
              <Lock className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#121224] border border-white/[0.08] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold transition shadow-lg shadow-indigo-600/30 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            <span>{isRegister ? "Create Account" : "Sign In with Credentials"}</span>
          </button>
        </form>

        <div className="mt-5 pt-3.5 border-t border-white/[0.08] text-center text-xs text-neutral-400">
          {isRegister ? (
            <p>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => setIsRegister(false)}
                className="text-indigo-400 hover:underline font-semibold"
              >
                Sign in
              </button>
            </p>
          ) : (
            <p>
              Don't have an account?{" "}
              <button
                type="button"
                onClick={() => setIsRegister(true)}
                className="text-indigo-400 hover:underline font-semibold"
              >
                Create one
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
