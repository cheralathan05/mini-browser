import React, { useState, useEffect, useMemo } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Shield,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Filter,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  AlertTriangle,
  Info,
  Lock,
  ArrowRight,
  Sliders,
  Check,
  X,
  Copy,
  Terminal,
  Zap,
  FileText,
  AlertCircle,
} from "lucide-react";
import { ApprovalsApi, ApprovalRequest, ApprovalPolicy, ApprovalStats, ApprovalRiskLevel } from "../../lib/nexus/approvals.api";
import { nexusWs } from "../../lib/nexus/nexus-ws";
import { useToast } from "./NexusToast";

interface NexusApprovalsViewProps {
  workspaceId?: string;
  onOpenInBrowser?: (url: string, title?: string) => void;
}

type TabType = "pending" | "approved" | "rejected" | "expired" | "all";
type SortOption = "created_desc" | "created_asc" | "deadline_asc";

export const NexusApprovalsView: React.FC<NexusApprovalsViewProps> = ({ workspaceId, onOpenInBrowser }) => {
  const toast = useToast();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [stats, setStats] = useState<ApprovalStats>({
    pending: 0,
    approved: 0,
    rejected: 0,
    expired: 0,
    cancelled: 0,
    total: 0,
  });
  const [policies, setPolicies] = useState<ApprovalPolicy[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<TabType>("pending");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("created_desc");

  // Selected approval for detailed slide-over
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRequest | null>(null);
  const [actionNotes, setActionNotes] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Policy modal
  const [showPolicyModal, setShowPolicyModal] = useState<boolean>(false);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [apprRes, statsRes, polRes] = await Promise.all([
        ApprovalsApi.getApprovals({
          status: activeTab === "all" ? undefined : activeTab,
          risk: riskFilter === "all" ? undefined : riskFilter,
          search: searchQuery,
          sort: sortBy,
          workspaceId,
        }),
        ApprovalsApi.getStats(workspaceId),
        ApprovalsApi.getPolicies(workspaceId),
      ]);

      setApprovals(apprRes.approvals || []);
      setStats(statsRes.stats || { pending: 0, approved: 0, rejected: 0, expired: 0, cancelled: 0, total: 0 });
      setPolicies(polRes.policies || []);
    } catch (err: any) {
      console.error("Failed to load approvals data:", err);
      toast.error(err.message || "Failed to load approval center");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Subscribe to live approval events
    const unsubReq = nexusWs.subscribe("approval.required", () => {
      loadData();
      toast.info("New action requires human authorization");
    });

    const unsubRes = nexusWs.subscribe("approval.resolved", () => {
      loadData();
    });

    return () => {
      unsubReq();
      unsubRes();
    };
  }, [activeTab, riskFilter, sortBy, workspaceId]);

  const handleApprove = async (id: string, notes?: string) => {
    try {
      setIsSubmitting(true);
      const res = await ApprovalsApi.approve(id, notes || actionNotes);
      toast.success("Action approved. Execution resuming.");
      if (selectedApproval?.id === id) {
        setSelectedApproval(res.approval);
      }
      setActionNotes("");
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Approval failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async (id: string, reason?: string) => {
    try {
      setIsSubmitting(true);
      const res = await ApprovalsApi.reject(id, reason || actionNotes);
      toast.info("Action rejected. Execution halted.");
      if (selectedApproval?.id === id) {
        setSelectedApproval(res.approval);
      }
      setActionNotes("");
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Rejection failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async (id: string, reason?: string) => {
    try {
      setIsSubmitting(true);
      const res = await ApprovalsApi.cancel(id, reason || actionNotes);
      toast.info("Approval request cancelled.");
      if (selectedApproval?.id === id) {
        setSelectedApproval(res.approval);
      }
      setActionNotes("");
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Cancellation failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTogglePolicy = async (policy: ApprovalPolicy) => {
    try {
      const updated = await ApprovalsApi.updatePolicy(policy.id, {
        enabled: !policy.enabled,
      });
      setPolicies((prev) => prev.map((p) => (p.id === policy.id ? updated.policy : p)));
      toast.success(`Policy "${policy.name}" ${updated.policy.enabled ? "enabled" : "disabled"}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to update policy");
    }
  };

  const getRiskBadge = (risk: string) => {
    switch (risk?.toLowerCase()) {
      case "critical":
        return {
          bg: "bg-rose-500/10 text-rose-400 border-rose-500/20",
          dot: "bg-rose-400",
          label: "Critical Risk",
        };
      case "high":
        return {
          bg: "bg-orange-500/10 text-orange-400 border-orange-500/20",
          dot: "bg-orange-400",
          label: "High Risk",
        };
      case "moderate":
        return {
          bg: "bg-amber-500/10 text-amber-400 border-amber-500/20",
          dot: "bg-amber-400",
          label: "Moderate",
        };
      default:
        return {
          bg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
          dot: "bg-emerald-400",
          label: "Low Risk",
        };
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case "approved":
        return { bg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: CheckCircle2, label: "Approved" };
      case "rejected":
        return { bg: "bg-rose-500/10 text-rose-400 border-rose-500/20", icon: XCircle, label: "Rejected" };
      case "expired":
        return { bg: "bg-neutral-800 text-neutral-400 border-neutral-700", icon: Clock, label: "Expired" };
      case "cancelled":
        return { bg: "bg-neutral-800 text-neutral-400 border-neutral-700", icon: X, label: "Cancelled" };
      default:
        return { bg: "bg-amber-500/15 text-amber-300 border-amber-500/30", icon: Clock, label: "Pending Review" };
    }
  };

  const formatCountdown = (expiresAt?: string) => {
    if (!expiresAt) return null;
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${mins}m remaining`;
  };

  const activePolicyCount = useMemo(() => {
    return policies.filter((p) => p.enabled).length;
  }, [policies]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#050507] text-neutral-100 overflow-hidden select-none font-sans">
      {/* 1. HEADER BAR */}
      <div className="px-8 py-5 border-b border-neutral-800/80 bg-[#08080d]/80 shrink-0 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-base font-semibold text-white tracking-wide">Human-in-the-Loop Approval Center</h1>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-medium">
                  {stats.pending} Pending
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5 max-w-xl">
                Review, authorize, or reject sensitive autonomous operations before execution. All decisions are cryptographically bound and logged.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowPolicyModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-700 transition"
            >
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>Policies ({activePolicyCount} Active)</span>
            </button>
            <button
              onClick={loadData}
              className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-700 transition"
              title="Refresh Approvals"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-cyan-400" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* 2. METRICS OVERVIEW */}
      <div className="px-8 py-4 border-b border-neutral-800/50 bg-[#06060a] shrink-0">
        <div className="max-w-7xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div
            onClick={() => setActiveTab("pending")}
            className={`p-3.5 rounded-xl border transition cursor-pointer ${
              activeTab === "pending"
                ? "bg-amber-500/10 border-amber-500/40 shadow-sm shadow-amber-500/10"
                : "bg-neutral-900/40 border-neutral-800/60 hover:border-neutral-700"
            }`}
          >
            <div className="flex items-center justify-between text-[11px] text-neutral-400 font-medium">
              <span>Pending Decisions</span>
              <Clock className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-xl font-bold text-amber-300 mt-1">{stats.pending}</div>
          </div>

          <div
            onClick={() => setActiveTab("approved")}
            className={`p-3.5 rounded-xl border transition cursor-pointer ${
              activeTab === "approved"
                ? "bg-emerald-500/10 border-emerald-500/40 shadow-sm shadow-emerald-500/10"
                : "bg-neutral-900/40 border-neutral-800/60 hover:border-neutral-700"
            }`}
          >
            <div className="flex items-center justify-between text-[11px] text-neutral-400 font-medium">
              <span>Approved Actions</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-bold text-emerald-400 mt-1">{stats.approved}</div>
          </div>

          <div
            onClick={() => setActiveTab("rejected")}
            className={`p-3.5 rounded-xl border transition cursor-pointer ${
              activeTab === "rejected"
                ? "bg-rose-500/10 border-rose-500/40 shadow-sm shadow-rose-500/10"
                : "bg-neutral-900/40 border-neutral-800/60 hover:border-neutral-700"
            }`}
          >
            <div className="flex items-center justify-between text-[11px] text-neutral-400 font-medium">
              <span>Rejected Requests</span>
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <div className="text-xl font-bold text-rose-400 mt-1">{stats.rejected}</div>
          </div>

          <div
            onClick={() => setActiveTab("expired")}
            className={`p-3.5 rounded-xl border transition cursor-pointer ${
              activeTab === "expired"
                ? "bg-neutral-800/60 border-neutral-600 shadow-sm"
                : "bg-neutral-900/40 border-neutral-800/60 hover:border-neutral-700"
            }`}
          >
            <div className="flex items-center justify-between text-[11px] text-neutral-400 font-medium">
              <span>Expired / Cancelled</span>
              <AlertCircle className="w-3.5 h-3.5 text-neutral-400" />
            </div>
            <div className="text-xl font-bold text-neutral-300 mt-1">{stats.expired + stats.cancelled}</div>
          </div>
        </div>
      </div>

      {/* 3. TABS AND SEARCH FILTERS */}
      <div className="px-8 py-3.5 border-b border-neutral-800/60 bg-[#08080c] shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-neutral-950 border border-neutral-800">
            {(["pending", "approved", "rejected", "expired", "all"] as TabType[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition ${
                  activeTab === tab
                    ? "bg-neutral-800 text-white font-semibold shadow-sm"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Search & Selectors */}
          <div className="flex items-center gap-2.5 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by action, target, actor..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadData()}
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-amber-500/50 transition"
              />
            </div>

            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 focus:outline-none focus:border-amber-500/50 transition cursor-pointer"
            >
              <option value="all">All Risks</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="moderate">Moderate</option>
              <option value="low">Low</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 focus:outline-none focus:border-amber-500/50 transition cursor-pointer"
            >
              <option value="created_desc">Newest</option>
              <option value="created_asc">Oldest</option>
              <option value="deadline_asc">Urgent</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4. MAIN CONTENT AREA */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-7xl mx-auto">
          {isLoading && approvals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-neutral-500">
              <RefreshCw className="w-6 h-6 animate-spin text-amber-400 mb-3" />
              <p className="text-xs">Loading approval requests...</p>
            </div>
          ) : approvals.length === 0 ? (
            <div className="p-12 rounded-2xl bg-neutral-900/20 border border-dashed border-neutral-800 text-center max-w-lg mx-auto">
              <ShieldCheck className="w-10 h-10 text-emerald-400/60 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-white">No Approvals In This View</h3>
              <p className="text-xs text-neutral-400 mt-1 max-w-sm mx-auto">
                {activeTab === "pending"
                  ? "All autonomous tasks are currently running smoothly without pending authorization barriers."
                  : `No records found matching status "${activeTab}" with current filters.`}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5">
              {approvals.map((req) => {
                const riskInfo = getRiskBadge(req.riskLevel);
                const statusInfo = getStatusBadge(req.status);
                const isPending = req.status === "pending";
                const countdown = formatCountdown(req.expiresAt);

                return (
                  <div
                    key={req.id}
                    onClick={() => setSelectedApproval(req)}
                    className="group p-4 rounded-xl bg-[#09090e] border border-neutral-800/80 hover:border-neutral-700 transition cursor-pointer hover:shadow-lg hover:shadow-black/50"
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      {/* Left: Action summary & badges */}
                      <div className="flex items-start gap-3.5 flex-1 min-w-0">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border ${
                          isPending ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-neutral-800/60 border-neutral-700 text-neutral-400"
                        }`}>
                          <statusInfo.icon className="w-4 h-4" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-white group-hover:text-amber-300 transition truncate">
                              {req.actionTitle || req.action}
                            </span>
                            <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium border ${riskInfo.bg}`}>
                              {riskInfo.label}
                            </span>
                            <span className={`text-[10px] px-2 py-0.5 rounded font-medium border ${statusInfo.bg}`}>
                              {statusInfo.label}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400 mt-1.5">
                            <span className="flex items-center gap-1 font-mono text-neutral-300">
                              <Terminal className="w-3 h-3 text-violet-400" />
                              {req.requestingActor || "system"}
                            </span>
                            <span>•</span>
                            <span className="text-neutral-300 truncate max-w-xs font-mono">
                              Target: {req.target}
                            </span>
                            {countdown && isPending && (
                              <>
                                <span>•</span>
                                <span className="text-amber-400/90 font-mono flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {countdown}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Quick action controls */}
                      <div className="flex items-center gap-2 shrink-0 self-end md:self-center" onClick={(e) => e.stopPropagation()}>
                        {isPending ? (
                          <>
                            <button
                              onClick={() => handleApprove(req.id)}
                              disabled={isSubmitting}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition disabled:opacity-50"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Authorize</span>
                            </button>
                            <button
                              onClick={() => handleReject(req.id)}
                              disabled={isSubmitting}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-neutral-900 border border-neutral-800 text-rose-400 hover:border-rose-500/30 hover:bg-rose-500/10 transition disabled:opacity-50"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Reject</span>
                            </button>
                          </>
                        ) : (
                          <div className="text-[11px] text-neutral-500 font-mono">
                            Resolved: {req.resolvedAt ? new Date(req.resolvedAt).toLocaleDateString() : "Historical"}
                          </div>
                        )}

                        <button
                          onClick={() => setSelectedApproval(req)}
                          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
                          title="Inspect Details"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 5. SLIDE-OVER DETAIL DRAWER */}
      {selectedApproval && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-xl h-full bg-[#0a0a0f] border-l border-neutral-800 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-5 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/60">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-semibold text-white">Approval Request Details</h3>
              </div>
              <button
                onClick={() => setSelectedApproval(null)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Action Banner */}
              <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase font-mono tracking-wider font-semibold text-neutral-400">
                    Operation
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium border ${getRiskBadge(selectedApproval.riskLevel).bg}`}>
                    {getRiskBadge(selectedApproval.riskLevel).label}
                  </span>
                </div>
                <h2 className="text-base font-bold text-white">
                  {selectedApproval.actionTitle || selectedApproval.action}
                </h2>
                <div className="text-xs text-neutral-400 flex items-center gap-2">
                  <span className="font-mono text-neutral-300">Actor: {selectedApproval.requestingActor || "system"}</span>
                  <span>•</span>
                  <span>Target: {selectedApproval.target}</span>
                </div>
              </div>

              {/* Security Policy Information */}
              <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800/80 space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5 text-neutral-300 font-medium">
                  <Lock className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Security Policy Verification</span>
                </div>
                <p className="text-neutral-400 text-[11px] leading-relaxed">
                  {selectedApproval.policy?.description ||
                    "This operation mutates external systems or accesses sensitive information. Security policy strictly requires human sign-off."}
                </p>
                {selectedApproval.payloadDigest && (
                  <div className="mt-2 pt-2 border-t border-neutral-900 flex items-center justify-between text-[10px] font-mono text-neutral-500">
                    <span>Digest: {selectedApproval.payloadDigest.substring(0, 16)}...</span>
                    <span className="text-emerald-400 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Integrity Verified
                    </span>
                  </div>
                )}
              </div>

              {/* Proposed Payload */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-neutral-300 mb-2">
                  <span>Exact Proposed Payload</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(selectedApproval.details || {}, null, 2));
                      toast.success("Payload copied to clipboard");
                    }}
                    className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-white transition"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy JSON</span>
                  </button>
                </div>
                <pre className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800 text-[11px] font-mono text-neutral-300 overflow-x-auto max-h-60 leading-relaxed selection:bg-neutral-800">
                  {JSON.stringify(selectedApproval.details || {}, null, 2)}
                </pre>
              </div>

              {/* Decision History */}
              {selectedApproval.decisions && selectedApproval.decisions.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-neutral-300 mb-2">Decision History</h4>
                  <div className="space-y-2">
                    {selectedApproval.decisions.map((d) => (
                      <div key={d.id} className="p-3 rounded-lg bg-neutral-900/40 border border-neutral-800 text-xs">
                        <div className="flex items-center justify-between">
                          <span className={`capitalize font-semibold ${d.decision === "approved" ? "text-emerald-400" : "text-rose-400"}`}>
                            {d.decision}
                          </span>
                          <span className="text-[10px] font-mono text-neutral-500">
                            {new Date(d.decidedAt).toLocaleString()}
                          </span>
                        </div>
                        {d.reason && <p className="text-neutral-400 text-[11px] mt-1">{d.reason}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Form for Pending Approvals */}
              {selectedApproval.status === "pending" && (
                <div className="space-y-3 pt-2">
                  <label className="block text-xs font-medium text-neutral-300">
                    Decision Notes or Rejection Reason (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={actionNotes}
                    onChange={(e) => setActionNotes(e.target.value)}
                    placeholder="Enter any authorization constraints or reason for rejection..."
                    className="w-full p-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-amber-500/50 transition resize-none"
                  />
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            {selectedApproval.status === "pending" ? (
              <div className="p-5 border-t border-neutral-800 bg-neutral-950/80 flex items-center gap-3">
                <button
                  onClick={() => handleApprove(selectedApproval.id)}
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-neutral-950 transition flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>Authorize & Resume</span>
                </button>
                <button
                  onClick={() => handleReject(selectedApproval.id)}
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                  <span>Reject & Halt</span>
                </button>
              </div>
            ) : (
              <div className="p-4 border-t border-neutral-800 bg-neutral-950/80 text-center">
                <span className="text-xs text-neutral-400 font-mono">
                  This request has already been finalized ({selectedApproval.status}).
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. POLICY SETTINGS MODAL */}
      {showPolicyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-[#0b0b12] border border-neutral-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh]">
            <div className="p-5 border-b border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Sliders className="w-5 h-5 text-cyan-400" />
                <div>
                  <h3 className="text-sm font-semibold text-white">Central Security & Approval Policies</h3>
                  <p className="text-[11px] text-neutral-400">Server-side enforced gates for autonomous operations</p>
                </div>
              </div>
              <button
                onClick={() => setShowPolicyModal(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {policies.map((p) => (
                <div
                  key={p.id}
                  className="p-4 rounded-xl bg-neutral-900/40 border border-neutral-800/80 flex items-start justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">{p.name}</span>
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
                        {p.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-400 leading-relaxed max-w-md">{p.description}</p>
                    <div className="flex items-center gap-3 pt-1 text-[11px] text-neutral-500 font-mono">
                      <span>Threshold: {p.riskThreshold}</span>
                      <span>•</span>
                      <span>Expires: {p.autoExpireHours}h</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleTogglePolicy(p)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                      p.enabled
                        ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                        : "bg-neutral-800 border-neutral-700 text-neutral-500"
                    }`}
                  >
                    {p.enabled ? "Enforcing" : "Disabled"}
                  </button>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-neutral-800 bg-neutral-950/60 flex items-center justify-between text-xs text-neutral-400">
              <span>Policies are strictly enforced by the execution engine and fail closed.</span>
              <button
                onClick={() => setShowPolicyModal(false)}
                className="px-4 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white font-medium transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
