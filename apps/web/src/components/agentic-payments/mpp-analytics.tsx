'use client';

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    StatCard,
} from '@sly/ui';
import { TableSkeleton } from '@/components/ui/skeletons';
import {
    DollarSign,
    Activity,
    CheckCircle2,
    XCircle,
    Clock,
    AlertCircle,
    TrendingUp,
    Zap,
} from 'lucide-react';

type Period = '24h' | '7d' | '30d' | '90d' | '1y';

const periodLabels: Record<Period, string> = {
    '24h': 'Last 24 Hours',
    '7d': 'Last 7 Days',
    '30d': 'Last 30 Days',
    '90d': 'Last 90 Days',
    '1y': 'Last Year',
};

export function MppAnalytics({ period }: { period: Period }) {
    const api = useApiClient();

    const { data: analytics, isLoading } = useQuery({
        queryKey: ['mpp', 'analytics', period],
        queryFn: async () => {
            if (!api) return null;
            try {
                return await api.mpp.getAnalytics({ period });
            } catch {
                return null;
            }
        },
        enabled: !!api,
    });

    const summary = analytics?.summary;
    const sessionsByStatus = analytics?.sessionsByStatus;
    const paymentsByStatus = analytics?.paymentsByStatus;

    if (isLoading) {
        return (
            <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <TableSkeleton rows={1} columns={1} />
                    <TableSkeleton rows={1} columns={1} />
                    <TableSkeleton rows={1} columns={1} />
                    <TableSkeleton rows={1} columns={1} />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    title="Total Revenue"
                    value={`$${summary?.totalRevenue?.toFixed(2) || '0.00'}`}
                    description="Completed payments"
                    icon={<DollarSign className="h-5 w-5" />}
                />
                <StatCard
                    title="Total Payments"
                    value={summary?.transactionCount?.toString() || '0'}
                    description={periodLabels[period]}
                    icon={<Activity className="h-5 w-5" />}
                />
                <StatCard
                    title="Active Sessions"
                    value={summary?.activeSessions?.toString() || '0'}
                    description={`${summary?.totalSessions || 0} total`}
                    icon={<Zap className="h-5 w-5" />}
                />
                <StatCard
                    title="Budget Utilization"
                    value={`${summary?.budgetUtilization?.toFixed(1) || '0'}%`}
                    description="Spent / deposited"
                    icon={<TrendingUp className="h-5 w-5" />}
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Sessions by Status */}
                <Card>
                    <CardHeader>
                        <CardTitle>Sessions by Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 rounded-lg border bg-card text-card-foreground shadow-sm flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Clock className="h-5 w-5 text-blue-500" />
                                    <span className="text-sm font-medium">Open</span>
                                </div>
                                <span className="text-2xl font-bold">{sessionsByStatus?.open || 0}</span>
                            </div>
                            <div className="p-4 rounded-lg border bg-card text-card-foreground shadow-sm flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                                    <span className="text-sm font-medium">Active</span>
                                </div>
                                <span className="text-2xl font-bold">{sessionsByStatus?.active || 0}</span>
                            </div>
                            <div className="p-4 rounded-lg border bg-card text-card-foreground shadow-sm flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <XCircle className="h-5 w-5 text-gray-500" />
                                    <span className="text-sm font-medium">Closed</span>
                                </div>
                                <span className="text-2xl font-bold">{sessionsByStatus?.closed || 0}</span>
                            </div>
                            <div className="p-4 rounded-lg border bg-card text-card-foreground shadow-sm flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <AlertCircle className="h-5 w-5 text-red-500" />
                                    <span className="text-sm font-medium">Exhausted</span>
                                </div>
                                <span className="text-2xl font-bold">{sessionsByStatus?.exhausted || 0}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Payments by Status */}
                <Card>
                    <CardHeader>
                        <CardTitle>Payments by Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 border rounded-lg">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                                        <CheckCircle2 className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <div className="font-medium">Completed</div>
                                        <div className="text-xs text-muted-foreground">Settled payments</div>
                                    </div>
                                </div>
                                <span className="text-2xl font-bold">{paymentsByStatus?.completed || 0}</span>
                            </div>
                            <div className="flex items-center justify-between p-4 border rounded-lg">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-600">
                                        <Clock className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <div className="font-medium">Pending</div>
                                        <div className="text-xs text-muted-foreground">In progress</div>
                                    </div>
                                </div>
                                <span className="text-2xl font-bold">{paymentsByStatus?.pending || 0}</span>
                            </div>
                            <div className="flex items-center justify-between p-4 border rounded-lg">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                                        <XCircle className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <div className="font-medium">Failed</div>
                                        <div className="text-xs text-muted-foreground">Payment errors</div>
                                    </div>
                                </div>
                                <span className="text-2xl font-bold">{paymentsByStatus?.failed || 0}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Budget Overview */}
            <Card>
                <CardHeader>
                    <CardTitle>Budget Overview</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="flex items-center justify-between p-4 border rounded-lg">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                                    <DollarSign className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="font-medium">Total Deposited</div>
                                    <div className="text-xs text-muted-foreground">Across all sessions</div>
                                </div>
                            </div>
                            <span className="text-2xl font-bold">${summary?.totalDeposited?.toFixed(2) || '0.00'}</span>
                        </div>
                        <div className="flex items-center justify-between p-4 border rounded-lg">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                                    <CheckCircle2 className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="font-medium">Total Spent</div>
                                    <div className="text-xs text-muted-foreground">Voucher payments</div>
                                </div>
                            </div>
                            <span className="text-2xl font-bold">${summary?.totalSpent?.toFixed(2) || '0.00'}</span>
                        </div>
                        <div className="flex items-center justify-between p-4 border rounded-lg">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-600">
                                    <TrendingUp className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="font-medium">Utilization</div>
                                    <div className="text-xs text-muted-foreground">Budget usage rate</div>
                                </div>
                            </div>
                            <span className="text-2xl font-bold">{summary?.budgetUtilization?.toFixed(1) || '0'}%</span>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
