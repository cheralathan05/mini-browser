import React, { useState, useEffect, useCallback, createContext, useContext } from "react";
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from "lucide-react";

// --- Toast Types ---
type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextType {
  addToast: (type: ToastType, message: string, duration?: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback for components that render outside provider
    return {
      addToast: () => {},
      success: () => {},
      error: () => {},
      info: () => {},
      warning: () => {},
    };
  }
  return ctx;
}

// --- Single Toast Item ---
const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const duration = toast.duration ?? 4000;
    const exitTimer = setTimeout(() => setIsExiting(true), duration - 300);
    const removeTimer = setTimeout(() => onDismiss(toast.id), duration);
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [toast.id, toast.duration, onDismiss]);

  const iconMap: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
    error: <XCircle className="w-4 h-4 text-rose-400" />,
    info: <Info className="w-4 h-4 text-blue-400" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-400" />,
  };

  const borderMap: Record<ToastType, string> = {
    success: "border-emerald-500/30",
    error: "border-rose-500/30",
    info: "border-blue-500/30",
    warning: "border-amber-500/30",
  };

  return (
    <div
      className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-neutral-900/95 backdrop-blur-xl border ${borderMap[toast.type]} shadow-2xl shadow-black/40 text-xs text-neutral-200 transition-all duration-300 ${
        isExiting ? "opacity-0 translate-x-4" : "opacity-100 translate-x-0"
      }`}
    >
      {iconMap[toast.type]}
      <span className="flex-1 font-medium">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="p-0.5 rounded text-neutral-500 hover:text-neutral-200 transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};

// --- Provider ---
export const NexusToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string, duration?: number) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-4), { id, type, message, duration }]);
  }, []);

  const ctx: ToastContextType = {
    addToast,
    success: (msg) => addToast("success", msg),
    error: (msg) => addToast("error", msg),
    info: (msg) => addToast("info", msg),
    warning: (msg) => addToast("warning", msg),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {/* Toast Container */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-auto">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};
