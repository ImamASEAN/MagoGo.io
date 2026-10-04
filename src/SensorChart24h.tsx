import { useEffect, useState, useCallback, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { supabase } from "./lib/supabase";

type SensorPoint = {
  time: string;
  fullDate: string;
  timestamp: number;
  temperature_soil: number | null;
  humidity_soil: number | null;
  ph: number | null;
  weight: number | null;
  temperature_air: number | null;
  humidity_air: number | null;
};

type MetricKey =
  | "temperature_soil"
  | "humidity_soil"
  | "ph"
  | "weight"
  | "temperature_air"
  | "humidity_air";

export type TimeRange = "session" | "all" | "24h" | "100";

const METRICS: {
  key: MetricKey;
  label: string;
  color: string;
  unit: string;
}[] = [
  { key: "temperature_air", label: "Suhu Udara", color: "#22c55e", unit: "°C" },
  { key: "humidity_air", label: "Kelembaban Udara", color: "#3b82f6", unit: "%" },
  { key: "temperature_soil", label: "Suhu Media/Tanah", color: "#f59e0b", unit: "°C" },
  { key: "humidity_soil", label: "Kelembaban Media", color: "#06b6d4", unit: "%" },
  { key: "ph", label: "pH Media", color: "#a855f7", unit: "" },
  { key: "weight", label: "Berat Timbangan", color: "#ef4444", unit: "g" },
];

type Props = {
  deviceId: number;
};

export function SensorChart24h({ deviceId }: Props) {
  const [data, setData] = useState<SensorPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [activeMetrics, setActiveMetrics] = useState<MetricKey[]>([
    "temperature_air",
    "humidity_air",
    "weight",
  ]);
  const [lastFetch, setLastFetch] = useState<string>("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let rows: Record<string, unknown>[] = [];

      if (timeRange === "24h") {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: result, error: err } = await supabase
          .from("[SIBOB] sensor")
          .select("temperature_soil, humidity_soil, ph, weight, temperature_air, humidity_air, created_at")
          .eq("device_id", deviceId)
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(1000);

        if (err) throw err;
        rows = result ?? [];
      } else if (timeRange === "100") {
        const { data: result, error: err } = await supabase
          .from("[SIBOB] sensor")
          .select("temperature_soil, humidity_soil, ph, weight, temperature_air, humidity_air, created_at")
          .eq("device_id", deviceId)
          .order("created_at", { ascending: false })
          .limit(100);

        if (err) throw err;
        rows = (result ?? []).reverse();
      } else if (timeRange === "session") {
        // Find latest timestamp to identify latest recording date
        const { data: latestRow } = await supabase
          .from("[SIBOB] sensor")
          .select("created_at")
          .eq("device_id", deviceId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (latestRow && latestRow.length > 0) {
          const latestDate = new Date(latestRow[0].created_at as string);
          // Query session within 24 hours of that latest log
          const sessionStart = new Date(latestDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
          const { data: result, error: err } = await supabase
            .from("[SIBOB] sensor")
            .select("temperature_soil, humidity_soil, ph, weight, temperature_air, humidity_air, created_at")
            .eq("device_id", deviceId)
            .gte("created_at", sessionStart)
            .order("created_at", { ascending: true })
            .limit(1000);

          if (err) throw err;
          rows = result ?? [];
        }
      } else {
        // "all" - Full dataset up to 1000 points
        const { data: result, error: err } = await supabase
          .from("[SIBOB] sensor")
          .select("temperature_soil, humidity_soil, ph, weight, temperature_air, humidity_air, created_at")
          .eq("device_id", deviceId)
          .order("created_at", { ascending: false })
          .limit(1000);

        if (err) throw err;
        rows = (result ?? []).reverse();
      }

      const points: SensorPoint[] = rows.map((r) => {
        const d = new Date(r.created_at as string);
        return {
          time: d.toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          fullDate: d.toLocaleString("id-ID", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          }),
          timestamp: d.getTime(),
          temperature_soil: typeof r.temperature_soil === "number" ? r.temperature_soil : null,
          humidity_soil: typeof r.humidity_soil === "number" ? r.humidity_soil : null,
          ph: typeof r.ph === "number" ? r.ph : null,
          weight: typeof r.weight === "number" ? r.weight : null,
          temperature_air: typeof r.temperature_air === "number" ? r.temperature_air : null,
          humidity_air: typeof r.humidity_air === "number" ? r.humidity_air : null,
        };
      });

      setData(points);
      setLastFetch(
        new Date().toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [deviceId, timeRange]);

  // Initial fetch + auto-refresh every 30 seconds
  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const toggleMetric = (key: MetricKey) => {
    setActiveMetrics((prev) =>
      prev.includes(key) ? (prev.length > 1 ? prev.filter((k) => k !== key) : prev) : [...prev, key]
    );
  };

  const currentStats = useMemo(() => {
    if (data.length === 0) return null;
    const last = data[data.length - 1];
    return {
      lastTimestamp: last.fullDate,
    };
  }, [data]);

  // Custom tooltip
  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ color: string; name: string; value: number; dataKey: string; payload?: SensorPoint }>;
    label?: string;
  }) => {
    if (!active || !payload?.length) return null;
    const fullDate = payload[0]?.payload?.fullDate ?? label;
    return (
      <div className="chart-tooltip">
        <p className="chart-tooltip__time">{fullDate}</p>
        {payload.map((entry) => {
          const metric = METRICS.find((m) => m.key === entry.dataKey);
          return (
            <div key={entry.dataKey} className="chart-tooltip__row">
              <span
                className="chart-tooltip__dot"
                style={{ backgroundColor: entry.color }}
              />
              <span>{metric?.label ?? entry.name}:</span>
              <strong>
                {entry.value != null ? entry.value.toFixed(1) : "—"} {metric?.unit ?? ""}
              </strong>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="chart24h-panel">
      <div className="chart24h-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="panel-chip" style={{ padding: "3px 10px", fontSize: "0.72rem", height: "auto" }}>
              GRAFIK TREN RIIL
            </span>
            <span className="chart24h-badge">
              <span className="chart24h-pulse" /> Live Supabase
            </span>
          </div>
          <h2 style={{ color: "#fff", fontSize: "clamp(1.3rem, 2.2vw, 1.75rem)", margin: "8px 0 4px" }}>
            Riwayat Fluktuasi Sensor
          </h2>
          <p style={{ margin: 0, fontSize: "0.84rem", color: "#94a3b8" }}>
            Data asli dari chip sensor ESP32 yang tersimpan di cloud database
          </p>
        </div>

        <div className="chart24h-meta">
          {/* Time range selector buttons */}
          <div className="chart-range-selector">
            <button
              type="button"
              className={`range-btn ${timeRange === "all" ? "range-btn--active" : ""}`}
              onClick={() => setTimeRange("all")}
            >
              Semua Riwayat (1.000 Data)
            </button>
            <button
              type="button"
              className={`range-btn ${timeRange === "session" ? "range-btn--active" : ""}`}
              onClick={() => setTimeRange("session")}
            >
              Sesi Terakhir
            </button>
            <button
              type="button"
              className={`range-btn ${timeRange === "100" ? "range-btn--active" : ""}`}
              onClick={() => setTimeRange("100")}
            >
              100 Titik Terkini
            </button>
            <button
              type="button"
              className={`range-btn ${timeRange === "24h" ? "range-btn--active" : ""}`}
              onClick={() => setTimeRange("24h")}
            >
              24 Jam Terakhir
            </button>
          </div>
          {lastFetch && (
            <span className="chart24h-last">Sinkronisasi: {lastFetch}</span>
          )}
        </div>
      </div>

      {/* Metric toggle pills */}
      <div className="chart24h-toggles">
        <span style={{ fontSize: "0.78rem", color: "#64748b", alignSelf: "center", fontWeight: 700, textTransform: "uppercase" }}>
          Pilih Parameter:
        </span>
        {METRICS.map((m) => {
          const isActive = activeMetrics.includes(m.key);
          return (
            <button
              key={m.key}
              type="button"
              className={`chart24h-toggle ${isActive ? "chart24h-toggle--active" : ""}`}
              style={
                isActive
                  ? { borderColor: m.color, color: "#ffffff", background: `${m.color}28` }
                  : {}
              }
              onClick={() => toggleMetric(m.key)}
            >
              <span
                className="chart24h-toggle__dot"
                style={{ backgroundColor: m.color }}
              />
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Chart visualization */}
      <div className="chart24h-body">
        {loading && data.length === 0 ? (
          <div className="chart24h-loading">
            <div className="chart24h-pulse" style={{ margin: "0 auto 10px" }} />
            Mengunduh log sensor riil dari Supabase...
          </div>
        ) : error ? (
          <div className="chart24h-error">
            <strong>Gagal memuat:</strong> {error}
            <button type="button" onClick={() => void fetchData()}>
              Coba lagi
            </button>
          </div>
        ) : data.length === 0 ? (
          <div className="chart24h-empty">
            Belum ada rekaman sensor di Supabase untuk mode ini. Coba pilih <strong>&quot;Semua Riwayat&quot;</strong> atau nyalakan alat ESP32.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <LineChart
              data={data}
              margin={{ top: 12, right: 24, left: -10, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 6"
                stroke="rgba(255,255,255,0.07)"
              />
              <XAxis
                dataKey="time"
                stroke="#64748b"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                interval="preserveStartEnd"
                minTickGap={45}
              />
              <YAxis
                stroke="#64748b"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                width={50}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: "0.82rem", color: "#cbd5e1", paddingTop: "8px" }}
              />
              {METRICS.filter((m) => activeMetrics.includes(m.key)).map(
                (m) => (
                  <Line
                    key={m.key}
                    type="monotone"
                    dataKey={m.key}
                    name={`${m.label} (${m.unit})`}
                    stroke={m.color}
                    strokeWidth={2.4}
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 0 }}
                    connectNulls
                  />
                )
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Footer controls & quick metrics preview */}
      <div className="chart24h-footer">
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", fontSize: "0.82rem", color: "#94a3b8" }}>
          <span>Total data ditampilkan: <strong style={{ color: "#86efac" }}>{data.length} titik riil</strong></span>
          {currentStats?.lastTimestamp && (
            <span>Log terakhir: <strong style={{ color: "#e2e8f0" }}>{currentStats.lastTimestamp}</strong></span>
          )}
        </div>
        <button
          type="button"
          className="chart24h-refresh-btn"
          onClick={() => void fetchData()}
        >
          🔄 Refresh Data
        </button>
      </div>
    </div>
  );
}
