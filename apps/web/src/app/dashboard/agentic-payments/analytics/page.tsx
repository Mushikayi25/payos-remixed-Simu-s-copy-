'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger, TabsContent, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@sly/ui';
import { Zap, Bot, ShoppingCart, BarChart3, Globe, DollarSign } from 'lucide-react';
import { X402Analytics } from '@/components/agentic-payments/x402-analytics';
import { Ap2Analytics } from '@/components/ap2/ap2-analytics';
import { AcpAnalytics } from '@/components/acp/acp-analytics';
import { UcpAnalytics } from '@/components/ucp/ucp-analytics';
import { MppAnalytics } from '@/components/agentic-payments/mpp-analytics';
import { AllProtocolsOverview } from '@/components/agentic-payments/all-protocols-overview';

type Protocol = 'all' | 'x402' | 'ap2' | 'acp' | 'ucp' | 'mpp';
type Period = '24h' | '7d' | '30d' | '90d';

export default function AgenticAnalyticsPage() {
    const searchParams = useSearchParams();
    const initialProtocol = (searchParams.get('protocol') as Protocol) || 'all';

    const [protocol, setProtocol] = useState<Protocol>(initialProtocol);
    const [period, setPeriod] = useState<Period>('30d');

    return (
        <div className="space-y-6 p-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Agentic Payments Analytics</h1>
                    <p className="text-muted-foreground text-sm">
                        Performance overview across all payment protocols
                    </p>
                </div>
                <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="24h">Last 24 Hours</SelectItem>
                        <SelectItem value="7d">Last 7 Days</SelectItem>
                        <SelectItem value="30d">Last 30 Days</SelectItem>
                        <SelectItem value="90d">Last 90 Days</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <Tabs value={protocol} onValueChange={(v) => setProtocol(v as Protocol)}>
                <TabsList>
                    <TabsTrigger value="all">
                        <BarChart3 className="w-4 h-4 mr-1" /> Overview
                    </TabsTrigger>
                    <TabsTrigger value="ucp">
                        <Globe className="w-4 h-4 mr-1" /> UCP
                    </TabsTrigger>
                    <TabsTrigger value="acp">
                        <ShoppingCart className="w-4 h-4 mr-1" /> ACP
                    </TabsTrigger>
                    <TabsTrigger value="ap2">
                        <Bot className="w-4 h-4 mr-1" /> AP2
                    </TabsTrigger>
                    <TabsTrigger value="x402">
                        <Zap className="w-4 h-4 mr-1" /> x402
                    </TabsTrigger>
                    <TabsTrigger value="mpp">
                        <DollarSign className="w-4 h-4 mr-1" /> MPP
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="all" className="pt-6">
                    <AllProtocolsOverview period={period} />
                </TabsContent>
                <TabsContent value="ucp" className="pt-4">
                    <UcpAnalytics period={period} />
                </TabsContent>
                <TabsContent value="acp" className="pt-4">
                    <AcpAnalytics period={period as any} />
                </TabsContent>
                <TabsContent value="ap2" className="pt-4">
                    <Ap2Analytics period={period} />
                </TabsContent>
                <TabsContent value="x402" className="pt-4">
                    <X402Analytics period={period} />
                </TabsContent>
                <TabsContent value="mpp" className="pt-4">
                    <MppAnalytics period={period} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
