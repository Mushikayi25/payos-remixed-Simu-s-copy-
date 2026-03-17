'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Circle,
  Loader2,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  DollarSign,
  ArrowRightLeft,
  ThumbsUp,
  ThumbsDown,
  Star,
  MessageSquare,
  Bot,
  FileText,
  Clock,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface TimelineEvent {
  eventId: string;
  taskId: string;
  eventType: string;
  fromState?: string;
  toState?: string;
  actorType?: string;
  data: Record<string, unknown>;
  durationMs?: number;
  createdAt: string;
}

interface SessionTimelineProps {
  events: TimelineEvent[];
  compact?: boolean;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatTimeBetween(a: string, b: string): string | null {
  const diff = new Date(b).getTime() - new Date(a).getTime();
  if (diff <= 0) return null;
  return formatDuration(diff);
}

interface EventVisual {
  icon: React.ReactNode;
  colorClass: string;
  dotColor: string;
  label: string;
  description: string;
  expandable: boolean;
}

function getEventVisual(event: TimelineEvent): EventVisual {
  const data = event.data || {};
  const state = (data.state as string) || event.toState;
  const action = data.action as string;

  switch (event.eventType) {
    case 'status': {
      switch (state) {
        case 'submitted':
          return {
            icon: <Circle className="h-3.5 w-3.5" />,
            colorClass: 'text-blue-600 dark:text-blue-400',
            dotColor: 'text-blue-500',
            label: 'Task Submitted',
            description: (data.message as string) || 'Task created',
            expandable: false,
          };
        case 'working':
          return {
            icon: <Loader2 className="h-3.5 w-3.5" />,
            colorClass: 'text-amber-600 dark:text-amber-400',
            dotColor: 'text-amber-500',
            label: 'Processing Started',
            description: (data.message as string) || 'Agent began processing',
            expandable: false,
          };
        case 'input-required': {
          const reasonCode = data.reason_code as string;
          if (reasonCode === 'result_review') {
            return {
              icon: <Shield className="h-3.5 w-3.5" />,
              colorClass: 'text-orange-600 dark:text-orange-400',
              dotColor: 'text-orange-500',
              label: 'Acceptance Gate',
              description: 'Awaiting caller review',
              expandable: false,
            };
          }
          return {
            icon: <AlertTriangle className="h-3.5 w-3.5" />,
            colorClass: 'text-orange-600 dark:text-orange-400',
            dotColor: 'text-orange-500',
            label: 'Input Required',
            description: (data.message as string) || 'Waiting for input',
            expandable: false,
          };
        }
        case 'completed':
          return {
            icon: <CheckCircle2 className="h-3.5 w-3.5" />,
            colorClass: 'text-emerald-600 dark:text-emerald-400',
            dotColor: 'text-emerald-500',
            label: 'Task Completed',
            description: (data.message as string) || 'Task completed successfully',
            expandable: false,
          };
        case 'failed':
          return {
            icon: <XCircle className="h-3.5 w-3.5" />,
            colorClass: 'text-red-600 dark:text-red-400',
            dotColor: 'text-red-500',
            label: 'Task Failed',
            description: (data.message as string) || 'Task failed',
            expandable: false,
          };
        case 'canceled':
        case 'rejected':
          return {
            icon: <XCircle className="h-3.5 w-3.5" />,
            colorClass: 'text-red-600 dark:text-red-400',
            dotColor: 'text-red-500',
            label: state === 'rejected' ? 'Task Rejected' : 'Task Canceled',
            description: (data.message as string) || `Task ${state}`,
            expandable: false,
          };
        default:
          return {
            icon: <Circle className="h-3.5 w-3.5" />,
            colorClass: 'text-gray-500',
            dotColor: 'text-gray-400',
            label: `State: ${state}`,
            description: (data.message as string) || '',
            expandable: false,
          };
      }
    }

    case 'payment': {
      switch (action) {
        case 'mandate_created': {
          const amount = data.amount as number;
          const currency = (data.currency as string) || 'USDC';
          return {
            icon: <DollarSign className="h-3.5 w-3.5" />,
            colorClass: 'text-blue-600 dark:text-blue-400',
            dotColor: 'text-blue-500',
            label: 'Mandate Created',
            description: `${formatCurrency(amount, currency)} authorized`,
            expandable: true,
          };
        }
        case 'mandate_settled': {
          const amount = data.amount as number;
          const currency = (data.currency as string) || 'USDC';
          return {
            icon: <ArrowRightLeft className="h-3.5 w-3.5" />,
            colorClass: 'text-emerald-600 dark:text-emerald-400',
            dotColor: 'text-emerald-500',
            label: 'Settlement Executed',
            description: `${formatCurrency(amount, currency)} transferred`,
            expandable: true,
          };
        }
        case 'mandate_cancelled':
          return {
            icon: <XCircle className="h-3.5 w-3.5" />,
            colorClass: 'text-red-600 dark:text-red-400',
            dotColor: 'text-red-500',
            label: 'Mandate Cancelled',
            description: 'Funds returned to caller',
            expandable: true,
          };
        default:
          return {
            icon: <DollarSign className="h-3.5 w-3.5" />,
            colorClass: 'text-blue-600 dark:text-blue-400',
            dotColor: 'text-blue-500',
            label: 'Payment Event',
            description: action || 'Payment activity',
            expandable: true,
          };
      }
    }

    case 'acceptance': {
      if (action === 'accept') {
        const score = data.score as number | undefined;
        return {
          icon: <ThumbsUp className="h-3.5 w-3.5" />,
          colorClass: 'text-emerald-600 dark:text-emerald-400',
          dotColor: 'text-emerald-500',
          label: 'Accepted',
          description: score !== undefined
            ? `Score: ${score}/100${data.comment ? ` — ${data.comment}` : ''}`
            : (data.comment as string) || 'Result accepted by caller',
          expandable: true,
        };
      }
      const score = data.score as number | undefined;
      return {
        icon: <ThumbsDown className="h-3.5 w-3.5" />,
        colorClass: 'text-red-600 dark:text-red-400',
        dotColor: 'text-red-500',
        label: 'Rejected',
        description: score !== undefined
          ? `Score: ${score}/100${data.comment ? ` — ${data.comment}` : ''}`
          : (data.comment as string) || 'Result rejected by caller',
        expandable: true,
      };
    }

    case 'feedback': {
      const satisfaction = data.satisfaction as string;
      const score = data.score as number | undefined;
      return {
        icon: <Star className="h-3.5 w-3.5" />,
        colorClass: 'text-purple-600 dark:text-purple-400',
        dotColor: 'text-purple-500',
        label: 'Feedback Recorded',
        description: [satisfaction, score !== undefined ? `${score}/100` : null].filter(Boolean).join(' — ') || 'Feedback submitted',
        expandable: true,
      };
    }

    case 'message': {
      const role = data.role as string;
      const text = data.text as string || '';
      const truncated = text.length > 80 ? text.slice(0, 80) + '...' : text;
      if (role === 'agent') {
        return {
          icon: <Bot className="h-3.5 w-3.5" />,
          colorClass: 'text-gray-600 dark:text-gray-400',
          dotColor: 'text-gray-400',
          label: 'Agent Response',
          description: truncated || 'Agent message',
          expandable: false,
        };
      }
      return {
        icon: <MessageSquare className="h-3.5 w-3.5" />,
        colorClass: 'text-blue-600 dark:text-blue-400',
        dotColor: 'text-blue-500',
        label: 'Message Sent',
        description: truncated || 'User message',
        expandable: false,
      };
    }

    case 'artifact':
      return {
        icon: <FileText className="h-3.5 w-3.5" />,
        colorClass: 'text-purple-600 dark:text-purple-400',
        dotColor: 'text-purple-500',
        label: 'Artifact Created',
        description: (data.label as string) || 'Artifact generated',
        expandable: false,
      };

    case 'timeout':
      return {
        icon: <Clock className="h-3.5 w-3.5" />,
        colorClass: 'text-red-600 dark:text-red-400',
        dotColor: 'text-red-500',
        label: 'Review Timed Out',
        description: data.timeout_minutes ? `After ${data.timeout_minutes} minutes` : 'Review period expired',
        expandable: false,
      };

    case 'webhook':
      return {
        icon: <ArrowRightLeft className="h-3.5 w-3.5" />,
        colorClass: 'text-gray-600 dark:text-gray-400',
        dotColor: 'text-gray-400',
        label: 'Webhook Fired',
        description: (data.url as string) || 'Webhook notification sent',
        expandable: false,
      };

    default:
      return {
        icon: <Circle className="h-3.5 w-3.5" />,
        colorClass: 'text-gray-500',
        dotColor: 'text-gray-400',
        label: event.eventType,
        description: JSON.stringify(data).slice(0, 80),
        expandable: true,
      };
  }
}

function TimelineItem({ event, prevEvent, compact }: { event: TimelineEvent; prevEvent?: TimelineEvent; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const visual = getEventVisual(event);

  const timeBetween = prevEvent ? formatTimeBetween(prevEvent.createdAt, event.createdAt) : null;

  // In compact mode, truncate descriptions shorter
  const description = compact && visual.description.length > 60
    ? visual.description.slice(0, 60) + '...'
    : visual.description;

  return (
    <div className="relative">
      {/* Duration badge between events — hidden in compact mode */}
      {timeBetween && !compact && (
        <span className="absolute -left-[80px] -top-5 text-[10px] text-gray-400 dark:text-gray-500 font-mono whitespace-nowrap">
          {timeBetween}
        </span>
      )}

      {/* Dot */}
      <div className={`absolute ${compact ? '-left-[29px]' : '-left-[37px]'} flex items-center justify-center ${visual.dotColor}`}>
        <div className={`flex items-center justify-center ${compact ? '-ml-[3.5px]' : '-ml-[4.5px]'}`}>
          {compact
            ? <span className="[&>svg]:h-3 [&>svg]:w-3">{visual.icon}</span>
            : visual.icon
          }
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className={`text-sm font-medium ${visual.colorClass}`}>
            {visual.label}
          </h4>
          {!compact && (
            <Link
              href={`/dashboard/agents/a2a/tasks/${event.taskId}`}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-blue-500 transition-colors"
            >
              {event.taskId.slice(0, 8)}
            </Link>
          )}
          {visual.expandable && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {description}
        </p>
        <p className={`${compact ? 'text-[9px]' : 'text-[10px]'} text-gray-400 dark:text-gray-500 mt-0.5`}>
          {new Date(event.createdAt).toLocaleString()}
          {event.durationMs !== undefined && event.durationMs !== null && (
            <span className="ml-2 font-mono">({formatDuration(event.durationMs)})</span>
          )}
        </p>

        {/* Expanded data payload */}
        {expanded && (
          <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-800 overflow-x-auto">
            <pre className="text-[11px] font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
              {JSON.stringify(event.data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export function SessionTimeline({ events, compact }: SessionTimelineProps) {
  if (!events.length) return null;

  return (
    <div className={`relative ${compact ? 'pl-6 space-y-4' : 'pl-8 space-y-8'} before:absolute ${compact ? 'before:left-[9px]' : 'before:left-[11px]'} before:top-2 before:bottom-2 before:w-px before:bg-gray-200 dark:before:bg-gray-800`}>
      {events.map((event, index) => (
        <TimelineItem
          key={event.eventId}
          event={event}
          prevEvent={index > 0 ? events[index - 1] : undefined}
          compact={compact}
        />
      ))}
    </div>
  );
}
