import React, { useState, useEffect } from "react";
import { Lock, Mail, User, ArrowRight, Loader2, X } from "lucide-react";
import { nexusClient } from "../../lib/nexus/nexus-client";

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

  useEffect(() => {
    if (!isOpen) return;
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
      setError(err.message || "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
    >
      <div className="relative bg-neutral-900 border border-neutral-800 rounded-2xl max-w-md w-full p-6 shadow-2xl text-neutral-100 animate-in fade-in zoom-in-95">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-500 flex items-center justify-center font-black text-white text-lg mx-auto shadow-lg shadow-indigo-500/20 mb-3">
            NX
          </div>
          <h2 className="text-lg font-bold text-white">
            {isRegister ? "Create NEXUS Account" : "Sign in to NEXUS BROWSER"}
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            Browse. Think. Automate with persistent workspaces.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <div>
              <label className="text-xs text-neutral-400">Full Name</label>
              <div className="relative mt-1">
                <User className="w-4 h-4 text-neutral-500 absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your Name"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-neutral-400">Email Address</label>
            <div className="relative mt-1">
              <Mail className="w-4 h-4 text-neutral-500 absolute left-3 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-neutral-400">Password</label>
            <div className="relative mt-1">
              <Lock className="w-4 h-4 text-neutral-500 absolute left-3 top-3" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-lg shadow-indigo-600/30 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            <span>{isRegister ? "Create Account" : "Sign In"}</span>
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-neutral-800 text-center text-xs text-neutral-400">
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
