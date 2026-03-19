'use client';

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@sly/ui';
import { TrendingUp, TrendingDown, Minus, Zap, Bot, ShoppingCart, DollarSign, Activity, CheckCircle, ArrowRight, Globe } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import Link from 'next/link';

interface AllProtocolsOverviewProps {
    period: '24h' | '7d' | '30d' | '90d';
}

export function AllProtocolsOverview({ period }: AllProtocolsOverviewProps) {
    const api = useApiClient();

    // Fetch x402 stats from analytics summary (period-filtered)
    const { data: x402Summary } = useQuery({
        queryKey: ['x402', 'analytics-summary', period],
        queryFn: async () => {
            if (!api) return null;
            return api.x402Analytics.getSummary({ period });
        },
        enabled: !!api,
    });

    const x402Data = {
        volume: x402Summary?.totalRevenue || 0,
        transactions: x402Summary?.transactionCount || 0,
        successRate: (x402Summary?.transactionCount || 0) > 0 ? 100.0 : 0,
        trend: 0,
    };

    // Fetch AP2 stats from analytics endpoint (same as AP2 tab)
    const { data: ap2Analytics } = useQuery({
        queryKey: ['ap2', 'analytics', period],
        queryFn: async () => {
            if (!api) return null;
            return api.ap2.getAnalytics({ period });
        },
        enabled: !!api,
    });

    const ap2Data = (() => {
        const txCount = ap2Analytics?.summary?.transactionCount || 0;
        const pbs = ap2Analytics?.paymentsByStatus;
        const completed = pbs?.completed || 0;
        const total = completed + (pbs?.pending || 0) + (pbs?.failed || 0);
        return {
            volume: ap2Analytics?.summary?.totalRevenue || 0,
            transactions: txCount,
            successRate: total > 0 ? (completed / total) * 100 : 0,
            trend: 0,
        };
    })();

    // Fetch ACP stats from analytics endpoint (same as ACP tab)
    const { data: acpAnalytics } = useQuery({
        queryKey: ['acp', 'analytics', period],
        queryFn: async () => {
            if (!api) return null;
            return api.acp.getAnalytics({ period });
        },
        enabled: !!api,
    });

    // Fetch ACP checkouts for volume (totalRevenue only counts completed transfers)
    const { data: acpCheckouts } = useQuery({
        queryKey: ['acp', 'checkouts', period],
        queryFn: async () => {
            if (!api) return null;
            return api.acp.list({ limit: 100 });
        },
        enabled: !!api,
    });

    const acpData = (() => {
        const cbs = acpAnalytics?.checkoutsByStatus;
        const completed = cbs?.completed || 0;
        const total = completed + (cbs?.pending || 0) + (cbs?.cancelled || 0) + (cbs?.failed || 0);
        const volume = acpCheckouts?.data?.reduce((sum: number, c: any) => sum + (c.total_amount || 0), 0) || 0;
        return {
            volume,
            transactions: total,
            successRate: total > 0 ? (completed / total) * 100 : 0,
            trend: 0,
        };
    })();

    // Fetch MPP stats from analytics endpoint
    const { data: mppAnalytics } = useQuery({
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

    const mppData = {
        volume: mppAnalytics?.summary?.totalRevenue || 0,
        transactions: mppAnalytics?.summary?.transactionCount || 0,
        successRate: (() => {
            const pbs = mppAnalytics?.paymentsByStatus;
            if (!pbs) return 0;
            const total = (pbs.completed || 0) + (pbs.pending || 0) + (pbs.failed || 0);
            return total > 0 ? ((pbs.completed || 0) / total) * 100 : 0;
        })(),
        trend: 0,
    };

    // Fetch UCP stats from checkout stats endpoint (FX-normalized USD volume)
    const { data: ucpStats } = useQuery({
        queryKey: ['ucp', 'checkouts-stats'],
        queryFn: async () => {
            if (!api) return null;
            return api.ucp.checkouts.stats();
        },
        enabled: !!api,
    });

    const ucpData = {
        volume: ucpStats?.total_volume_usd || 0,
        transactions: ucpStats?.total_checkouts || 0,
        successRate: ucpStats?.total_checkouts
            ? ((ucpStats.completed_checkouts || 0) / ucpStats.total_checkouts) * 100
            : 0,
        trend: 0,
    };

    // Calculate totals with weighted average success rate
    const allProtocols = [x402Data, ap2Data, acpData, ucpData, mppData];
    const totalVolume = allProtocols.reduce((sum, p) => sum + (p?.volume || 0), 0);
    const totalTransactions = allProtocols.reduce((sum, p) => sum + (p?.transactions || 0), 0);
    const weightedSuccessSum = allProtocols.reduce((sum, p) => {
        const tx = p?.transactions || 0;
        const rate = p?.successRate || 0;
        return sum + rate * tx;
    }, 0);
    const totals = {
        volume: totalVolume,
        transactions: totalTransactions,
        successRate: totalTransactions > 0 ? weightedSuccessSum / totalTransactions : 0,
    };

    const protocols = [
        {
            id: 'ucp',
            name: 'UCP Checkouts',
            icon: Globe,
            color: 'text-purple-500',
            bgColor: 'bg-purple-500/10',
            data: ucpData || { volume: 0, transactions: 0, successRate: 0, trend: 0 },
            href: '?protocol=ucp',
        },
        {
            id: 'acp',
            name: 'ACP Checkouts',
            icon: ShoppingCart,
            color: 'text-green-500',
            bgColor: 'bg-green-500/10',
            data: acpData || { volume: 0, transactions: 0, successRate: 0, trend: 0 },
            href: '?protocol=acp',
        },
        {
            id: 'ap2',
            name: 'AP2 Mandates',
            icon: Bot,
            color: 'text-blue-500',
            bgColor: 'bg-blue-500/10',
            data: ap2Data || { volume: 0, transactions: 0, successRate: 0, trend: 0 },
            href: '?protocol=ap2',
        },
        {
            id: 'x402',
            name: 'x402 Micropayments',
            icon: Zap,
            color: 'text-yellow-500',
            bgColor: 'bg-yellow-500/10',
            data: x402Data || { volume: 0, transactions: 0, successRate: 0, trend: 0 },
            href: '?protocol=x402',
        },
        {
            id: 'mpp',
            name: 'MPP Payments',
            icon: DollarSign,
            color: 'text-orange-500',
            bgColor: 'bg-orange-500/10',
            data: mppData || { volume: 0, transactions: 0, successRate: 0, trend: 0 },
            href: '?protocol=mpp',
        },
    ];

    const TrendIndicator = ({ value }: { value: number }) => {
        if (value > 0) return <span className="text-green-500 text-xs flex items-center gap-0.5"><TrendingUp className="w-3 h-3" /> {value}%</span>;
        if (value < 0) return <span className="text-red-500 text-xs flex items-center gap-0.5"><TrendingDown className="w-3 h-3" /> {Math.abs(value)}%</span>;
        return <span className="text-muted-foreground text-xs flex items-center gap-0.5"><Minus className="w-3 h-3" /> 0%</span>;
    };

    return (
        <div className="space-y-6">
            {/* Aggregate Summary */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">Total Volume</p>
                                <p className="text-2xl font-bold">{formatCurrency(totals.volume, 'USD')}</p>
                                <p className="text-xs text-muted-foreground mt-1">All protocols combined</p>
                            </div>
                            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                                <DollarSign className="h-6 w-6 text-primary" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">Total Transactions</p>
                                <p className="text-2xl font-bold">{totals.transactions.toLocaleString()}</p>
                                <p className="text-xs text-muted-foreground mt-1">Across all protocols</p>
                            </div>
                            <div className="h-12 w-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                                <Activity className="h-6 w-6 text-blue-500" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">Success Rate</p>
                                <p className="text-2xl font-bold">{totals.successRate.toFixed(1)}%</p>
                                <p className="text-xs text-muted-foreground mt-1">Weighted average</p>
                            </div>
                            <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                                <CheckCircle className="h-6 w-6 text-green-500" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">Avg Transaction</p>
                                <p className="text-2xl font-bold">
                                    {totals.transactions > 0 
                                        ? formatCurrency(totals.volume / totals.transactions, 'USD')
                                        : '$0.00'
                                    }
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">Per transaction</p>
                            </div>
                            <div className="h-12 w-12 rounded-full bg-purple-500/10 flex items-center justify-center">
                                <TrendingUp className="h-6 w-6 text-purple-500" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Protocol Comparison */}
            <Card>
                <CardHeader>
                    <CardTitle>Protocol Performance</CardTitle>
                    <CardDescription>Compare volume, transactions, and trends across protocols</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b text-left">
                                    <th className="pb-3 font-medium">Protocol</th>
                                    <th className="pb-3 font-medium text-right">Volume</th>
                                    <th className="pb-3 font-medium text-right">Share</th>
                                    <th className="pb-3 font-medium text-right">Transactions</th>
                                    <th className="pb-3 font-medium text-right">Avg Size</th>
                                    <th className="pb-3 font-medium text-right">Success</th>
                                    <th className="pb-3 font-medium text-right">Trend</th>
                                    <th className="pb-3"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {protocols.map((protocol) => {
                                    const volume = protocol.data?.volume || 0;
                                    const transactions = protocol.data?.transactions || 0;
                                    const share = totals.volume > 0 ? (volume / totals.volume) * 100 : 0;
                                    const avgSize = transactions > 0 ? volume / transactions : 0;

                                    return (
                                        <tr key={protocol.id} className="border-b last:border-0 hover:bg-muted/50">
                                            <td className="py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className={`h-8 w-8 rounded-lg ${protocol.bgColor} flex items-center justify-center`}>
                                                        <protocol.icon className={`h-4 w-4 ${protocol.color}`} />
                                                    </div>
                                                    <span className="font-medium">{protocol.name}</span>
                                                </div>
                                            </td>
                                            <td className="py-4 text-right font-medium">
                                                {formatCurrency(volume, 'USD')}
                                            </td>
                                            <td className="py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                                                        <div 
                                                            className={`h-full ${protocol.bgColor.replace('/10', '')}`}
                                                            style={{ width: `${share}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-sm text-muted-foreground w-12">
                                                        {share.toFixed(1)}%
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="py-4 text-right">
                                                {transactions.toLocaleString()}
                                            </td>
                                            <td className="py-4 text-right text-muted-foreground">
                                                {formatCurrency(avgSize, 'USD')}
                                            </td>
                                            <td className="py-4 text-right">
                                                <span className="text-green-500">{(protocol.data?.successRate || 0).toFixed(1)}%</span>
                                            </td>
                                            <td className="py-4 text-right">
                                                <TrendIndicator value={protocol.data?.trend || 0} />
                                            </td>
                                            <td className="py-4 text-right">
                                                <Link 
                                                    href={protocol.href}
                                                    className="text-muted-foreground hover:text-foreground transition-colors"
                                                >
                                                    <ArrowRight className="h-4 w-4" />
                                                </Link>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Volume Distribution Visual */}
            <div className="grid gap-4 md:grid-cols-4">
                {protocols.map((protocol) => {
                    const volume = protocol.data?.volume || 0;
                    const transactions = protocol.data?.transactions || 0;
                    const share = totals.volume > 0 ? (volume / totals.volume) * 100 : 0;

                    return (
                        <Card key={protocol.id} className="hover:border-primary/50 transition-colors cursor-pointer group">
                            <Link href={protocol.href}>
                                <CardContent className="pt-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className={`h-10 w-10 rounded-lg ${protocol.bgColor} flex items-center justify-center`}>
                                                <protocol.icon className={`h-5 w-5 ${protocol.color}`} />
                                            </div>
                                            <div>
                                                <p className="font-medium">{protocol.name}</p>
                                                <p className="text-xs text-muted-foreground">{share.toFixed(1)}% of total</p>
                                            </div>
                                        </div>
                                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                                    </div>
                                    
                                    <div className="space-y-3">
                                        <div className="flex justify-between">
                                            <span className="text-sm text-muted-foreground">Volume</span>
                                            <span className="font-medium">{formatCurrency(volume, 'USD')}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-sm text-muted-foreground">Transactions</span>
                                            <span className="font-medium">{transactions.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-sm text-muted-foreground">Trend</span>
                                            <TrendIndicator value={protocol.data?.trend || 0} />
                                        </div>
                                    </div>
                                </CardContent>
                            </Link>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}

