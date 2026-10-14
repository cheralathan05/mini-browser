import React, { useState, useEffect } from "react";
import { ShieldAlert, Check, X, AlertTriangle, ArrowRight } from "lucide-react";
import { nexusClient } from "../../lib/nexus/nexus-client";
import { nexusWs } from "../../lib/nexus/nexus-ws";
import { useToast } from "./NexusToast";

export const NexusApprovalsBanner: React.FC = () => {
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const toast = useToast();

  const loadApprovals = async () => {
    try {
      const res = await nexusClient.getApprovals("pending");
      setPendingApprovals(res.approvals || []);
    } catch (e) {
      console.error("Failed to load approvals:", e);
    }
  };

  useEffect(() => {
    loadApprovals();

    const unsubRequired = nexusWs.subscribe("approval.required", () => loadApprovals());
    const unsubResolved = nexusWs.subscribe("approval.resolved", () => loadApprovals());

    return () => {
      unsubRequired();
      unsubResolved();
    };
  }, []);

  const handleApprove = async (id: string) => {
    try {
      await nexusClient.approve(id);
      toast.success("Action approved");
      await loadApprovals();
    } catch (err: any) {
      toast.error(err.message || "Approval failed");
    }
  };

  const handleReject = async (id: string) => {
    try {
      await nexusClient.reject(id);
      toast.info("Action rejected");
      await loadApprovals();
    } catch (err: any) {
      toast.error(err.message || "Rejection failed");
    }
  };

  if (pendingApprovals.length === 0) {
    return null;
  }

  const current = pendingApprovals[0];
  const metadata = typeof current.metadata === "string" 
    ? JSON.parse(current.metadata || "{}") 
    : (current.metadata || {});

  const reason = current.reason || metadata.reason || "Autonomous agent requested execution of a consequential command.";
  const risk = current.risk || metadata.risk || (current.action?.toLowerCase().includes("delete") || current.action?.toLowerCase().includes("submit") ? "High" : "Medium");
  const destination = current.target || metadata.destination || current.url || "System Target";

  return (
    <div className="fixed bottom-6 right-6 max-w-md w-full bg-[#0d0d12]/95 backdrop-blur-xl border border-amber-500/40 shadow-2xl shadow-black/80 rounded-2xl p-5 text-neutral-100 z-50 animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="flex items-start gap-3.5">
        <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase font-mono tracking-wider font-semibold text-amber-400">
              Approval Required
            </span>
            {pendingApprovals.length > 1 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400 font-mono">
                1 of {pendingApprovals.length}
              </span>
            )}
          </div>

          <h3 className="text-sm font-medium text-white mt-1">
            NEXUS wants to: <span className="text-amber-300 font-semibold">{current.action}</span>
          </h3>

          <div className="mt-3 p-3 rounded-xl bg-neutral-950/80 border border-neutral-800/80 text-xs space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-[11px] text-neutral-500 w-16 shrink-0">Reason</span>
              <span className="text-neutral-300 text-[11px] leading-relaxed">{reason}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-neutral-500 w-16 shrink-0">Risk</span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium ${
                risk.toLowerCase() === "high" 
                  ? "bg-rose-500/15 text-rose-400 border border-rose-500/20" 
                  : "bg-amber-500/15 text-amber-400 border border-amber-500/20"
              }`}>
                {risk} Risk
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-[11px] text-neutral-500 w-16 shrink-0">Destination</span>
              <span className="text-neutral-200 text-[11px] font-mono truncate">{destination}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 mt-4">
            <button
              onClick={() => handleReject(current.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-white text-xs font-medium transition"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reject</span>
            </button>
            <button
              onClick={() => handleApprove(current.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-semibold transition shadow-lg shadow-amber-500/20"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Approve</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
