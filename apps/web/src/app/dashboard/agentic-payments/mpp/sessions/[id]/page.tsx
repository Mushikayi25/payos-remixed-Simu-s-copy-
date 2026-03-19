"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock, DollarSign, Zap, XCircle } from "lucide-react";
import { useApiConfig } from "@/lib/api-client";
import { formatCurrency } from "@/lib/utils";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Button,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@sly/ui";

/** Safe date formatter — returns fallback string for missing/invalid dates */
function safeFormatDate(value: string | null | undefined): string {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString();
}

export default function MppSessionDetailPage() {
    const params = useParams();
    const sessionId = params.id as string;
    const { authToken, apiKey } = useApiConfig();
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    const token = authToken || apiKey;
    const queryClient = useQueryClient();

    const { data, isLoading, error } = useQuery({
        queryKey: ["mpp-session", sessionId],
        queryFn: async () => {
            const res = await fetch(`${baseUrl}/v1/mpp/sessions/${sessionId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return null;
            return res.json();
        },
        enabled: !!token && !!sessionId,
    });

    const closeMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch(`${baseUrl}/v1/mpp/sessions/${sessionId}/close`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
            });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["mpp-session", sessionId] });
        },
    });

    if (isLoading) {
        return (
            <div className="p-8 max-w-[1600px] mx-auto">
                <div className="animate-pulse space-y-6">
                    <div className="h-8 w-48 bg-gray-200 dark:bg-gray-800 rounded" />
                    <div className="grid grid-cols-4 gap-4">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="h-28 bg-gray-200 dark:bg-gray-800 rounded-xl" />
                        ))}
                    </div>
                    <div className="h-48 bg-gray-200 dark:bg-gray-800 rounded-xl" />
                </div>
            </div>
        );
    }

    if (error || !data || data.error) {
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
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Session not found</h2>
                    <p className="text-gray-500 dark:text-gray-400">
                        The session with ID {sessionId} could not be found.
                    </p>
                </div>
            </div>
        );
    }

    const session = data;
    const vouchers: any[] = data.vouchers || [];

    // Session fields are camelCase from mapFromDb
    const budget = Number(session.maxBudget ?? session.depositAmount ?? 0) || 0;
    const spent = Number(session.spentAmount ?? 0) || 0;
    const remaining = budget - spent;
    const usagePercent = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;

    const isActive = session.status === "open" || session.status === "active";

    return (
        <div className="p-8 max-w-[1600px] mx-auto space-y-6">
            <Link
                href="/dashboard/agentic-payments/mpp"
                className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
                <ArrowLeft className="h-4 w-4" />
                Back to MPP
            </Link>

            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Session Detail</h1>
                    <p className="text-muted-foreground font-mono text-sm">{sessionId}</p>
                </div>
                {isActive && (
                    <Button
                        variant="destructive"
                        onClick={() => closeMutation.mutate()}
                        disabled={closeMutation.isPending}
                    >
                        <XCircle className="h-4 w-4 mr-2" />
                        {closeMutation.isPending ? "Closing..." : "Close Session"}
                    </Button>
                )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold capitalize">{session.status}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Budget</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatCurrency(budget)}</div>
                        <div className="mt-2 h-2 rounded-full bg-gray-200 dark:bg-gray-800">
                            <div
                                className={`h-full rounded-full ${usagePercent > 80 ? 'bg-red-500' : usagePercent > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                style={{ width: `${usagePercent}%` }}
                            />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Spent</CardTitle>
                        <Zap className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatCurrency(spent)}</div>
                        <p className="text-xs text-muted-foreground">{formatCurrency(remaining)} remaining</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Vouchers</CardTitle>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{session.voucherCount ?? 0}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Session Info */}
            <Card>
                <CardHeader>
                    <CardTitle>Session Info</CardTitle>
                </CardHeader>
                <CardContent>
                    <dl className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <dt className="text-muted-foreground">Service URL</dt>
                            <dd className="font-mono">{session.serviceUrl}</dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">Agent ID</dt>
                            <dd className="font-mono">{session.agentId}</dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">Wallet ID</dt>
                            <dd className="font-mono">{session.walletId}</dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">Opened At</dt>
                            <dd>{safeFormatDate(session.openedAt)}</dd>
                        </div>
                        {session.closedAt && (
                            <div>
                                <dt className="text-muted-foreground">Closed At</dt>
                                <dd>{safeFormatDate(session.closedAt)}</dd>
                            </div>
                        )}
                        <div className="col-span-2">
                            <dt className="text-muted-foreground">How it works</dt>
                            <dd className="text-sm">Agent deposits funds into this session and makes micropayments (vouchers) against the budget. Each voucher is recorded as a transfer.</dd>
                        </div>
                    </dl>
                </CardContent>
            </Card>

            {/* Voucher History */}
            <Card>
                <CardHeader>
                    <CardTitle>Voucher History</CardTitle>
                    <CardDescription>Individual payment vouchers in this session</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>#</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Date</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {vouchers.map((v: any, i: number) => (
                                <TableRow key={v.id || i}>
                                    <TableCell>
                                        {v.protocolMetadata?.voucher_index ?? v.protocol_metadata?.voucher_index ?? i + 1}
                                    </TableCell>
                                    <TableCell className="font-mono">
                                        {formatCurrency(typeof v.amount === "number" ? v.amount : parseFloat(v.amount))}
                                    </TableCell>
                                    <TableCell>
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                            {v.status}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {safeFormatDate(v.createdAt ?? v.created_at)}
                                    </TableCell>
                                </TableRow>
                            ))}
                            {vouchers.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                                        No vouchers yet
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
