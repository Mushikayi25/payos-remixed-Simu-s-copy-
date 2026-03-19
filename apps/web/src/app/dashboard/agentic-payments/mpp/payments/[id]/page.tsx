"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
    ArrowLeft,
    ArrowRight,
    DollarSign,
    Globe,
    Wallet,
    User,
    Clock,
    CheckCircle,
    XCircle,
    AlertTriangle,
    FileText,
    ExternalLink,
    Zap,
} from "lucide-react";
import { useApiClient, useApiConfig } from "@/lib/api-client";
import { formatDate, formatCurrency } from "@/lib/utils";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@sly/ui";

const statusConfig: Record<string, { color: string; icon: typeof CheckCircle }> = {
    completed: { color: "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400", icon: CheckCircle },
    pending: { color: "bg-yellow-100 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-400", icon: Clock },
    failed: { color: "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400", icon: XCircle },
};

export default function MppPaymentDetailPage() {
    const params = useParams();
    const transferId = params.id as string;
    const api = useApiClient();
    const { isConfigured } = useApiConfig();

    const { data: transfer, isLoading, error } = useQuery({
        queryKey: ["transfer", transferId],
        queryFn: () => api!.transfers.get(transferId),
        enabled: !!api && isConfigured,
    });

    // Handle potential nested response
    const transferData = transfer as any;
    const t = transferData?.data || transferData;

    if (isLoading) {
        return (
            <div className="p-8 max-w-[1600px] mx-auto">
                <div className="animate-pulse space-y-6">
                    <div className="h-8 w-48 bg-gray-200 dark:bg-gray-800 rounded" />
                    <div className="grid grid-cols-3 gap-4">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="h-32 bg-gray-200 dark:bg-gray-800 rounded-xl" />
                        ))}
                    </div>
                    <div className="h-64 bg-gray-200 dark:bg-gray-800 rounded-xl" />
                </div>
            </div>
        );
    }

    if (error || !t) {
        return (
            <div className="p-8 max-w-[1600px] mx-auto">
                <Link
                    href="/dashboard/agentic-payments/mpp"
                    className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-6"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to MPP
                </Link>
                <div className="text-center py-12">
                    <XCircle className="h-16 w-16 text-red-400 mx-auto mb-4" />
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Payment not found</h2>
                    <p className="text-gray-500 dark:text-gray-400">
                        The transfer with ID {transferId} could not be found.
                    </p>
                </div>
            </div>
        );
    }

    const meta = t.protocolMetadata || (t as any).protocol_metadata || {};
    const statusCfg = statusConfig[t.status] || statusConfig.pending;
    const StatusIcon = statusCfg.icon;

    let serviceHostname = "";
    try {
        serviceHostname = new URL(meta.service_url).hostname;
    } catch {
        serviceHostname = meta.service_url || "Unknown";
    }

    return (
        <div className="p-8 max-w-[1600px] mx-auto space-y-6">
            {/* Back */}
            <Link
                href="/dashboard/agentic-payments/mpp"
                className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
                <ArrowLeft className="h-4 w-4" />
                Back to MPP
            </Link>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                            MPP Payment
                        </h1>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${statusCfg.color}`}>
                            <StatusIcon className="h-3 w-3" />
                            {t.status}
                        </span>
                    </div>
                    <p className="text-gray-500 dark:text-gray-400 font-mono text-sm">{t.id}</p>
                </div>
                <Link
                    href={`/dashboard/transfers/${t.id}`}
                    className="inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                    View in Transfers
                    <ExternalLink className="h-3.5 w-3.5" />
                </Link>
            </div>

            {/* Payment Flow */}
            <div className="bg-white dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Payment Flow</h3>
                <div className="flex items-center justify-between">
                    {/* From (Agent) */}
                    <div className="flex-1">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-950 flex items-center justify-center">
                                <User className="h-6 w-6 text-orange-600" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500 dark:text-gray-400">From (Agent)</p>
                                <p className="font-medium text-gray-900 dark:text-white">
                                    {t.from?.accountName?.trim() || t.initiatedBy?.name?.trim() || t.description?.replace(/^MPP payment(?: to )?:?\s*/, '').trim() || "Unknown Agent"}
                                </p>
                                {t.initiatedBy?.id && (
                                    <Link
                                        href={`/dashboard/agents/${t.initiatedBy.id}`}
                                        className="text-xs text-blue-600 hover:underline font-mono"
                                    >
                                        {t.initiatedBy.id.slice(0, 8)}...
                                    </Link>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Arrow + Amount */}
                    <div className="flex-shrink-0 px-8">
                        <div className="flex items-center gap-2">
                            <div className="h-px w-12 bg-gray-300 dark:bg-gray-700" />
                            <ArrowRight className="h-6 w-6 text-orange-500" />
                            <div className="h-px w-12 bg-gray-300 dark:bg-gray-700" />
                        </div>
                        <p className="text-center text-lg font-bold text-gray-900 dark:text-white mt-1">
                            {formatCurrency(t.amount || 0)}
                        </p>
                        <p className="text-center text-xs text-gray-500 dark:text-gray-400">{t.currency || "USDC"}</p>
                    </div>

                    {/* To (Service) */}
                    <div className="flex-1 text-right">
                        <div className="flex items-center gap-3 justify-end">
                            <div>
                                <p className="text-sm text-gray-500 dark:text-gray-400">To (Service)</p>
                                <p className="font-medium text-gray-900 dark:text-white">
                                    {t.to?.accountName || serviceHostname}
                                </p>
                                {meta.service_url && (
                                    <p className="text-xs text-gray-500 font-mono truncate max-w-[200px] ml-auto">
                                        {meta.service_url}
                                    </p>
                                )}
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center">
                                <Globe className="h-6 w-6 text-emerald-600" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* MPP Details + Settlement */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Payment Details */}
                <div className="bg-white dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        <DollarSign className="h-5 w-5" />
                        Payment Details
                    </h3>
                    <dl className="space-y-3">
                        <div className="flex justify-between">
                            <dt className="text-gray-500 dark:text-gray-400">Amount</dt>
                            <dd className="font-mono text-sm text-gray-900 dark:text-white">
                                {formatCurrency(t.amount || 0)} {t.currency || "USDC"}
                            </dd>
                        </div>
                        {meta.payment_method && (
                            <div className="flex justify-between">
                                <dt className="text-gray-500 dark:text-gray-400">Payment Method</dt>
                                <dd className="text-sm text-gray-900 dark:text-white capitalize">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                                        {meta.payment_method}{meta.protocol_intent ? `/${meta.protocol_intent}` : ''}
                                    </span>
                                </dd>
                            </div>
                        )}
                        {meta.intent && (
                            <div className="flex justify-between">
                                <dt className="text-gray-500 dark:text-gray-400">Description</dt>
                                <dd className="text-sm text-gray-900 dark:text-white">{meta.intent}</dd>
                            </div>
                        )}
                        {meta.service_url && (
                            <div className="flex justify-between">
                                <dt className="text-gray-500 dark:text-gray-400">Service URL</dt>
                                <dd className="font-mono text-xs text-gray-900 dark:text-white truncate max-w-[240px]">
                                    {meta.service_url}
                                </dd>
                            </div>
                        )}
                        {meta.session_id && (
                            <div className="flex justify-between">
                                <dt className="text-gray-500 dark:text-gray-400">Session</dt>
                                <dd className="font-mono text-xs text-gray-900 dark:text-white">
                                    <Link
                                        href={`/dashboard/agentic-payments/mpp/sessions/${meta.session_id}`}
                                        className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                                    >
                                        {meta.session_id.slice(0, 8)}...
                                        <ExternalLink className="h-3 w-3" />
                                    </Link>
                                </dd>
                            </div>
                        )}
                        {meta.voucher_index !== undefined && (
                            <div className="flex justify-between">
                                <dt className="text-gray-500 dark:text-gray-400">Voucher #</dt>
                                <dd className="text-sm text-gray-900 dark:text-white">{meta.voucher_index}</dd>
                            </div>
                        )}
                        {t.description && (
                            <div className="flex justify-between">
                                <dt className="text-gray-500 dark:text-gray-400">Description</dt>
                                <dd className="text-sm text-gray-900 dark:text-white">{t.description}</dd>
                            </div>
                        )}
                    </dl>
                </div>

                {/* Settlement Info */}
                <div className="bg-white dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        <Wallet className="h-5 w-5" />
                        Settlement
                    </h3>
                    <dl className="space-y-3">
                        {meta.receipt_id && (
                            <div className="flex justify-between">
                                <dt className="text-gray-500 dark:text-gray-400">Receipt ID</dt>
                                <dd className="font-mono text-xs text-gray-900 dark:text-white">{meta.receipt_id}</dd>
                            </div>
                        )}
                        {meta.settlement_network && (
                            <div className="flex justify-between">
                                <dt className="text-gray-500 dark:text-gray-400">Network</dt>
                                <dd className="font-mono text-sm text-gray-900 dark:text-white">{meta.settlement_network}</dd>
                            </div>
                        )}
                        {(meta.settlement_tx_hash || (t as any).txHash) && (
                            <div className="flex justify-between items-center">
                                <dt className="text-gray-500 dark:text-gray-400">Tx Hash</dt>
                                <dd className="font-mono text-xs text-gray-900 dark:text-white">
                                    {(() => {
                                        const hash = meta.settlement_tx_hash || (t as any).txHash;
                                        return (
                                            <a
                                                href={`https://sepolia.basescan.org/tx/${hash}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                                            >
                                                {hash.slice(0, 10)}...{hash.slice(-8)}
                                                <ExternalLink className="h-3 w-3" />
                                            </a>
                                        );
                                    })()}
                                </dd>
                            </div>
                        )}
                        {meta.verified_at && (
                            <div className="flex justify-between">
                                <dt className="text-gray-500 dark:text-gray-400">Verified At</dt>
                                <dd className="text-sm text-gray-900 dark:text-white">
                                    {new Date(meta.verified_at).toLocaleString()}
                                </dd>
                            </div>
                        )}
                        {t.createdAt && (
                            <div className="flex justify-between">
                                <dt className="text-gray-500 dark:text-gray-400">Created</dt>
                                <dd className="text-sm text-gray-900 dark:text-white">
                                    {new Date(t.createdAt).toLocaleString()}
                                </dd>
                            </div>
                        )}
                        {t.completedAt && (
                            <div className="flex justify-between">
                                <dt className="text-gray-500 dark:text-gray-400">Completed</dt>
                                <dd className="text-sm text-gray-900 dark:text-white">
                                    {new Date(t.completedAt).toLocaleString()}
                                </dd>
                            </div>
                        )}
                    </dl>
                </div>
            </div>

            {/* Initiator Details */}
            <div className="bg-white dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Initiated By
                </h3>
                <dl className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <dt className="text-gray-500 dark:text-gray-400 text-sm">Actor Type</dt>
                        <dd className="font-medium text-gray-900 dark:text-white capitalize mt-1">
                            {t.initiatedBy?.type || "agent"}
                        </dd>
                    </div>
                    {t.initiatedBy?.name && (
                        <div>
                            <dt className="text-gray-500 dark:text-gray-400 text-sm">Agent Name</dt>
                            <dd className="font-medium text-gray-900 dark:text-white mt-1">{t.initiatedBy.name}</dd>
                        </div>
                    )}
                    {t.initiatedBy?.id && (
                        <div>
                            <dt className="text-gray-500 dark:text-gray-400 text-sm">Agent ID</dt>
                            <dd className="mt-1">
                                <Link
                                    href={`/dashboard/agents/${t.initiatedBy.id}`}
                                    className="font-mono text-sm text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                    {t.initiatedBy.id}
                                </Link>
                            </dd>
                        </div>
                    )}
                    {(t.initiatedBy as any)?.erc8004AgentId && (
                        <div>
                            <dt className="text-gray-500 dark:text-gray-400 text-sm">On-Chain ID</dt>
                            <dd className="mt-1">
                                <a
                                    href={`https://sepolia.basescan.org/nft/0x13b52042ef3e0e84d7ad49fdc1b71848b187a89c/${(t.initiatedBy as any).erc8004AgentId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                                >
                                    ERC-8004 #{(t.initiatedBy as any).erc8004AgentId}
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            </dd>
                        </div>
                    )}
                    {(t.initiatedBy as any)?.walletAddress && (
                        <div>
                            <dt className="text-gray-500 dark:text-gray-400 text-sm">Agent Wallet</dt>
                            <dd className="mt-1">
                                <a
                                    href={`https://sepolia.basescan.org/address/${(t.initiatedBy as any).walletAddress}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                                >
                                    {(t.initiatedBy as any).walletAddress.slice(0, 6)}...{(t.initiatedBy as any).walletAddress.slice(-4)}
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            </dd>
                        </div>
                    )}
                </dl>
            </div>

            {/* Receipt Data (if present) */}
            {meta.receipt_data && Object.keys(meta.receipt_data).length > 0 && (
                <div className="bg-white dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        Receipt Data
                    </h3>
                    <pre className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-sm text-gray-800 dark:text-gray-200 overflow-x-auto font-mono">
                        {JSON.stringify(meta.receipt_data, null, 2)}
                    </pre>
                </div>
            )}

            {/* Failure Info */}
            {t.failureReason && (
                <div className="bg-red-50 dark:bg-gray-900 rounded-2xl border border-red-200 dark:border-red-500/30 p-6">
                    <h3 className="text-lg font-semibold text-red-900 dark:text-red-300 mb-2 flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                        Failure Details
                    </h3>
                    <p className="text-red-800 dark:text-red-200">{t.failureReason}</p>
                    {t.failedAt && (
                        <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                            Failed at {new Date(t.failedAt).toLocaleString()}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
