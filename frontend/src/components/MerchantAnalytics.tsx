import React, { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface AnalyticsSummary {
  totalPayments: number;
  totalVolume: number;
  refundRate: number;
  topTokens: Array<{ token: string; count: number }>;
}

interface TimeseriesPoint {
  date: string;
  count: number;
  volume?: number;
}

interface TokenBreakdown {
  token: string;
  count: number;
}

const ANALYTICS_BASE_URL =
  (typeof process !== 'undefined' &&
    process.env &&
    process.env.REACT_APP_ANALYTICS_URL) ||
  '/api/analytics';

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '16px',
    boxSizing: 'border-box',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    color: '#1a1a2e',
  },
  header: {
    fontSize: '1.5rem',
    fontWeight: 600,
    marginBottom: '16px',
  },
  cardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '24px',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    padding: '16px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    border: '1px solid #e5e7eb',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  cardLabel: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: 500,
  },
  cardValue: {
    fontSize: '1.75rem',
    fontWeight: 700,
    color: '#111827',
  },
  tokenList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '4px',
  },
  tokenPill: {
    backgroundColor: '#eef2ff',
    color: '#4338ca',
    borderRadius: '9999px',
    padding: '4px 10px',
    fontSize: '0.8125rem',
    fontWeight: 500,
  },
  chartSection: {
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    padding: '16px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    border: '1px solid #e5e7eb',
  },
  chartTitle: {
    fontSize: '1.125rem',
    fontWeight: 600,
    marginBottom: '16px',
  },
  chartWrapper: {
    width: '100%',
    height: '320px',
  },
  stateBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 16px',
    fontSize: '1rem',
    color: '#6b7280',
  },
  errorBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '48px 16px',
    color: '#b91c1c',
  },
  retryButton: {
    backgroundColor: '#4338ca',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
};

const formatVolume = (value: number): string => {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(2);
};

const formatRefundRate = (value: number): string => {
  if (!Number.isFinite(value)) return '—';
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(2)}%`;
};

const MerchantAnalytics: React.FC = () => {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [tokens, setTokens] = useState<TokenBreakdown[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;

    const fetchAnalytics = async () => {
      setLoading(true);
      setError(null);

      try {
        const [summaryRes, timeseriesRes, tokensRes] = await Promise.all([
          fetch(`${ANALYTICS_BASE_URL}/summary`),
          fetch(`${ANALYTICS_BASE_URL}/timeseries`),
          fetch(`${ANALYTICS_BASE_URL}/tokens`),
        ]);

        if (!summaryRes.ok || !timeseriesRes.ok || !tokensRes.ok) {
          throw new Error('Failed to fetch analytics data');
        }

        const summaryData = await summaryRes.json();
        const timeseriesData = await timeseriesRes.json();
        const tokensData = await tokensRes.json();

        if (cancelled) return;

        const normalizedSummary: AnalyticsSummary = {
          totalPayments:
            summaryData.totalPayments ?? summaryData.total_payments ?? 0,
          totalVolume: summaryData.totalVolume ?? summaryData.total_volume ?? 0,
          refundRate: summaryData.refundRate ?? summaryData.refund_rate ?? 0,
          topTokens:
            summaryData.topTokens ??
            summaryData.top_tokens ??
            (Array.isArray(tokensData) ? tokensData : []),
        };

        const normalizedTimeseries: TimeseriesPoint[] = Array.isArray(
          timeseriesData
        )
          ? timeseriesData
          : timeseriesData.points ?? timeseriesData.data ?? [];

        const normalizedTokens: TokenBreakdown[] = Array.isArray(tokensData)
          ? tokensData
          : tokensData.tokens ?? tokensData.data ?? [];

        setSummary(normalizedSummary);
        setTimeseries(normalizedTimeseries);
        setTokens(normalizedTokens);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : 'An unknown error occurred'
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchAnalytics();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>Merchant Analytics</div>
        <div style={styles.stateBox}>Loading analytics…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>Merchant Analytics</div>
        <div style={styles.errorBox}>
          <span>Unable to load analytics: {error}</span>
          <button
            type="button"
            style={styles.retryButton}
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const topTokens =
    summary && summary.topTokens.length > 0 ? summary.topTokens : tokens;

  return (
    <div style={styles.container}>
      <div style={styles.header}>Merchant Analytics</div>

      <div style={styles.cardsGrid}>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Total Payments</span>
          <span style={styles.cardValue}>
            {summary ? summary.totalPayments.toLocaleString() : '—'}
          </span>
        </div>

        <div style={styles.card}>
          <span style={styles.cardLabel}>Total Volume</span>
          <span style={styles.cardValue}>
            {summary ? formatVolume(summary.totalVolume) : '—'}
          </span>
        </div>

        <div style={styles.card}>
          <span style={styles.cardLabel}>Refund Rate</span>
          <span style={styles.cardValue}>
            {summary ? formatRefundRate(summary.refundRate) : '—'}
          </span>
        </div>

        <div style={styles.card}>
          <span style={styles.cardLabel}>Top Tokens</span>
          {topTokens.length > 0 ? (
            <div style={styles.tokenList}>
              {topTokens.slice(0, 5).map((t) => (
                <span key={t.token} style={styles.tokenPill}>
                  {t.token} · {t.count}
                </span>
              ))}
            </div>
          ) : (
            <span style={styles.cardValue}>—</span>
          )}
        </div>
      </div>

      <div style={styles.chartSection}>
        <div style={styles.chartTitle}>Payment Trends</div>
        {timeseries.length > 0 ? (
          <div style={styles.chartWrapper}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={timeseries}
                margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="count"
                  name="Payments"
                  stroke="#4338ca"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={styles.stateBox}>No trend data available.</div>
        )}
      </div>
    </div>
  );
};

export default MerchantAnalytics;