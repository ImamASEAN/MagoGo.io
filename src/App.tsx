import { useEffect, useState, type FormEvent } from "react";
import "./App.css";
import { supabase } from "./lib/supabase";
import { SensorChart24h } from "./SensorChart24h";

type DeviceRow = {
  id: number;
  hostname: string;
  created_at: string;
};

type SensorRow = {
  id: number;
  temperature_soil: number;
  humidity_soil: number;
  ph: number;
  weight: number;
  temperature_air: number;
  humidity_air: number;
  status: string | null;
  created_at: string;
  device_id: number | null;
};

type ActuatorRow = {
  id: number;
  exhaust_fan: number;
  mist_maker: number;
  heater: number;
  created_at: string;
  device_id: number | null;
};

type NutrientRow = {
  id: number;
  protein: number;
  carbohydrate: number;
  fat: number;
  category: string | null;
  current_weight: number;
  cycle_reset: boolean;
  created_at: string;
  device_id: number | null;
};

const nutrientCategories = [
  {
    value: "Fruit and Vegetable Waste (FVW)",
    label: "Limbah Sayur & Buah (FVW)",
    description: "Kaya serat dan kadar air alami",
  },
  {
    value: "Food Waste (FW)",
    label: "Sisa Makanan Olahan (FW)",
    description: "Kaya karbohidrat dan protein",
  },
  {
    value: "Household Organic Waste (HOW)",
    label: "Limbah Organik Campuran (HOW)",
    description: "Kombinasi sisa dapur rumah tangga",
  },
] as const;

type NutritionMessage = {
  type: "success" | "error";
  text: string;
} | null;

function App() {
  const [selectedCategory, setSelectedCategory] = useState<string>(
    nutrientCategories[0].value,
  );
  const [nutritionMessage, setNutritionMessage] = useState<NutritionMessage>(null);
  const [device, setDevice] = useState<DeviceRow | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [sensor, setSensor] = useState<SensorRow | null>(null);
  const [actuator, setActuator] = useState<ActuatorRow | null>(null);
  const [nutrientCount, setNutrientCount] = useState(0);
  const [latestCycleReset, setLatestCycleReset] = useState<NutrientRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Wi-Fi modal state
  const [isWifiModalOpen, setIsWifiModalOpen] = useState(false);
  const [deviceIpInput, setDeviceIpInput] = useState("");
  const [wifiTesting, setWifiTesting] = useState(false);
  const [wifiStatusMsg, setWifiStatusMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [activeSetupTab, setActiveSetupTab] = useState<"quick" | "portal" | "firmware">("quick");
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [wifiUpdating, setWifiUpdating] = useState(false);
  const [wifiUpdateResult, setWifiUpdateResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Determine if device is considered online (telemetry within last 15 minutes)
  const isDeviceOnline = (() => {
    if (!sensor?.created_at) return false;
    const readingTime = new Date(sensor.created_at).getTime();
    const now = new Date().getTime();
    return now - readingTime < 15 * 60 * 1000;
  })();

  // Human-readable "time ago" for last sensor reading
  const lastSeenAgo = (() => {
    if (!sensor?.created_at) return null;
    const diffMs = Date.now() - new Date(sensor.created_at).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "baru saja";
    if (mins < 60) return `${mins} menit lalu`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} jam lalu`;
    const days = Math.floor(hours / 24);
    return `${days} hari lalu`;
  })();

  // Format timestamp helper
  const formatTimestamp = (raw?: string | null) => {
    if (!raw) return "";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Load devices on initial mount
  useEffect(() => {
    let isMounted = true;

    const loadDevices = async () => {
      setIsLoading(true);
      setLoadError(null);

      const { data: deviceRows, error: deviceError } = await supabase
        .from("[SIBOB] device")
        .select("id, hostname, created_at")
        .order("id", { ascending: true });

      if (!isMounted) return;

      if (deviceError) {
        setLoadError(deviceError.message);
        setDevices([]);
        setDevice(null);
        setIsLoading(false);
        return;
      }

      setDevices(deviceRows ?? []);

      // Default to device 1 or latest device
      if (deviceRows && deviceRows.length && selectedDeviceId == null) {
        setSelectedDeviceId(deviceRows[0].id);
      }

      setIsLoading(false);
    };

    void loadDevices();

    return () => {
      isMounted = false;
    };
  }, []);

  // When selectedDeviceId changes, load associated sensor and actuator rows
  useEffect(() => {
    if (selectedDeviceId == null) return;
    let isMounted = true;

    const loadForDevice = async () => {
      setIsLoading(true);
      setLoadError(null);

      const cached = devices.find((d) => d.id === selectedDeviceId) ?? null;
      setDevice(cached);

      const [
        sensorResult,
        actuatorResult,
        nutrientCountResult,
        latestCycleResetResult,
      ] = await Promise.all([
        supabase
          .from("[SIBOB] sensor")
          .select(
            "id, temperature_soil, humidity_soil, ph, weight, temperature_air, humidity_air, status, created_at, device_id",
          )
          .eq("device_id", selectedDeviceId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("[SIBOB] actuator")
          .select("id, exhaust_fan, mist_maker, heater, created_at, device_id")
          .eq("device_id", selectedDeviceId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("[SIBOB] nutrient")
          .select("id", { count: "exact", head: true })
          .eq("device_id", selectedDeviceId),
        supabase
          .from("[SIBOB] nutrient")
          .select(
            "id, protein, carbohydrate, fat, category, current_weight, cycle_reset, created_at, device_id",
          )
          .eq("device_id", selectedDeviceId)
          .eq("cycle_reset", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!isMounted) return;

      setSensor(sensorResult.data ?? null);
      setActuator(actuatorResult.data ?? null);
      setNutrientCount(nutrientCountResult.count ?? 0);
      setLatestCycleReset(latestCycleResetResult.data ?? null);

      const combinedError = [
        sensorResult.error,
        actuatorResult.error,
        nutrientCountResult.error,
        latestCycleResetResult.error,
      ]
        .filter(Boolean)
        .map((entry) => entry?.message)
        .join(" ");

      setLoadError(combinedError || null);
      setIsLoading(false);
    };

    void loadForDevice();

    // Auto-poll latest sensor telemetry every 15 seconds
    const pollInterval = setInterval(() => void loadForDevice(), 15_000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [selectedDeviceId, devices]);

  // Submit nutrition / cycle entry
  const submitNutrition = async (cycleReset: boolean) => {
    const category =
      nutrientCategories.find((item) => item.value === selectedCategory) ??
      nutrientCategories[0];

    if (!device) {
      setNutritionMessage({
        type: "error",
        text: "Pilih unit device terlebih dahulu sebelum menyimpan data pakan.",
      });
      return;
    }

    const currentWeight = sensor?.weight ?? 0;
    const shouldResetCycle = cycleReset || nutrientCount === 0;

    const { error } = await supabase.from("[SIBOB] nutrient").insert({
      protein: 100,
      carbohydrate: 100,
      fat: 100,
      category: category.value,
      current_weight: currentWeight,
      cycle_reset: shouldResetCycle,
      device_id: device.id,
    });

    if (error) {
      setNutritionMessage({
        type: "error",
        text: `Gagal menyimpan: ${error.message}`,
      });
      return;
    }

    setNutritionMessage({
      type: "success",
      text: shouldResetCycle
        ? "Siklus baru dimulai! Berat awal biokonversi berhasil dicatat."
        : `Pemberian pakan (${category.label}) berhasil disimpan.`,
    });
  };

  const handleNutritionSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitNutrition(false);
  };

  const handleCycleReset = () => {
    if (window.confirm("Mulai siklus budidaya baru? Berat saat ini akan dijadikan titik awal.")) {
      void submitNutrition(true);
    }
  };

  // Target Biomass: 3 kg (3000 g)
  const targetBiomass = 3000;

  // Environmental Health Assessment (Human-Friendly)
  const tempAir = sensor?.temperature_air ?? 0;
  const humAir = sensor?.humidity_air ?? 0;
  const soilPh = sensor?.ph ?? 0;
  const rawWeight = sensor?.weight ?? 0;
  // If sensor weight is positive, use it; if negative due to untared offset, show 0 for progress
  const currentWeight = Math.max(0, rawWeight);
  const startWeight = latestCycleReset?.current_weight ? Math.max(0, latestCycleReset.current_weight) : 0;
  const gainedWeight = sensor && latestCycleReset ? rawWeight - latestCycleReset.current_weight : null;

  // Target Progress Calculation
  const targetPct = Math.min(100, Math.max(0, Math.round((currentWeight / targetBiomass) * 100)));

  // Simple environment evaluation
  const isTempOptimal = tempAir >= 27 && tempAir <= 33;
  const isHumOptimal = humAir >= 55 && humAir <= 85;
  const isPhOptimal = soilPh >= 6.0 && soilPh <= 8.0;
  const isSoilTempOptimal = sensor ? sensor.temperature_soil >= 26 && sensor.temperature_soil <= 34 : true;
  const isSoilHumOptimal = sensor ? sensor.humidity_soil >= 50 && sensor.humidity_soil <= 80 : true;
  const envStatusText = isTempOptimal && isHumOptimal
    ? "Kondisi Mikroklimat Ideal — Suhu dan kelembaban optimal untuk metabolisme larva BSF."
    : !isTempOptimal && tempAir > 33
    ? "Peringatan Suhu Tinggi — Suhu biopon di atas 33°C. Kipas ventilasi aktif untuk pendinginan."
    : !isHumOptimal && humAir < 55
    ? "Peringatan Kelembaban Rendah — Udara biopon kering (<55% RH). Mist maker diperlukan."
    : "Mikroklimat Dalam Pemantauan Stabil.";

  // Core 6 Sensor Cards — status seragam: "Normal" atau "Perlu Tindakan"
  const sensorCards = [
    {
      label: "Suhu Udara Biopon",
      value: sensor ? `${sensor.temperature_air.toFixed(1)} °C` : "—",
      status: isTempOptimal ? "Normal" : "Perlu Tindakan",
      note: sensor ? `Update: ${formatTimestamp(sensor.created_at)}` : "Menunggu sensor",
      accent: "var(--green)",
    },
    {
      label: "Kelembaban Udara",
      value: sensor ? `${sensor.humidity_air.toFixed(1)} %` : "—",
      status: isHumOptimal ? "Normal" : "Perlu Tindakan",
      note: sensor ? `Update: ${formatTimestamp(sensor.created_at)}` : "Menunggu sensor",
      accent: "var(--blue)",
    },
    {
      label: "Suhu Media Substrat",
      value: sensor ? `${sensor.temperature_soil.toFixed(1)} °C` : "—",
      status: isSoilTempOptimal ? "Normal" : "Perlu Tindakan",
      note: sensor ? `Update: ${formatTimestamp(sensor.created_at)}` : "Menunggu sensor",
      accent: "var(--amber)",
    },
    {
      label: "Kelembaban Media Substrat",
      value: sensor ? `${sensor.humidity_soil.toFixed(1)} %` : "—",
      status: isSoilHumOptimal ? "Normal" : "Perlu Tindakan",
      note: sensor ? `Update: ${formatTimestamp(sensor.created_at)}` : "Menunggu sensor",
      accent: "#06b6d4",
    },
    {
      label: "Derajat Keasaman (pH)",
      value: sensor ? (sensor.ph > 0 ? sensor.ph.toFixed(1) : "Netral") : "—",
      status: isPhOptimal ? "Normal" : "Perlu Tindakan",
      note: sensor ? `Update: ${formatTimestamp(sensor.created_at)}` : "Menunggu sensor",
      accent: "#a855f7",
    },
    {
      label: "Massa Maggot dan Frass",
      value: sensor ? `${sensor.weight.toFixed(1)} g` : "—",
      status: currentWeight >= targetBiomass ? `Target ${(targetBiomass/1000).toFixed(1)}kg Tercapai` : "Normal",
      note: sensor ? `Update: ${formatTimestamp(sensor.created_at)}` : "Menunggu sensor",
      accent: "var(--rose)",
    },
  ];

  return (
    <main className="dashboard-shell">
      {/* 1. TOP NAVBAR */}
      <header className="top-navbar">
        <div className="top-navbar__brand">
          <img src="/magogo-logo.png" alt="MagoGo" className="brand-logo-mark" />
          <div>
            <h1 className="brand-title">MagoGo Smart Chamber</h1>
            <p className="brand-subtitle">Sistem Pemantauan &amp; Biokonversi Larva BSF</p>
          </div>
        </div>

        <div className="top-navbar__actions">
          {/* Device Selector */}
          <div className="navbar-device-select-wrap">
            <select
              className="navbar-device-select"
              value={selectedDeviceId ?? ""}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : null;
                setSelectedDeviceId(v);
              }}
            >
              {devices.length === 0 ? (
                <option value="">Memuat device...</option>
              ) : (
                devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    Unit {d.hostname} (ID #{d.id})
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Status Badge */}
          <div className={`status-pill ${isDeviceOnline ? "status-pill--online" : "status-pill--offline"}`}>
            <span className="status-pill__dot" />
            <span className="status-pill__text">
              {device
                ? isDeviceOnline
                  ? `${device.hostname} Online`
                  : `${device.hostname} Offline${lastSeenAgo ? ` · ${lastSeenAgo}` : ""}`
                : "Menghubungkan..."}
            </span>
          </div>

          {/* Wi-Fi & Device Setup Button */}
          <button
            type="button"
            className="btn-wifi-action"
            onClick={() => setIsWifiModalOpen(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
              <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
              <line x1="12" y1="20" x2="12.01" y2="20"></line>
            </svg>
            Wi-Fi &amp; Pengaturan
          </button>
        </div>
      </header>

      {/* 2. UNIFIED DASHBOARD CONTAINER */}
      <div className="unified-dashboard-container">
        
        {/* HERO SECTION: STATUS BUDIDAYA & KONDISI HARI INI */}
        <section className="unified-hero-card">
          <div className="unified-hero-main">
            <div className="unified-hero-left">
              <div className="hero-status-tag">
                <span className="hero-dot" />
                <span>Ringkasan Chamber &middot; Unit {device?.hostname ?? "SiBob"}</span>
                {sensor?.created_at && (
                  <span className="hero-timestamp">Log: {formatTimestamp(sensor.created_at)}</span>
                )}
              </div>

              <h2 className="hero-heading">
                {currentWeight >= targetBiomass ? (
                  <span style={{ color: "#86efac" }}>🎉 Bobot Mencapai Target {targetBiomass.toLocaleString()} g (Siap Panen)</span>
                ) : (
                  <span>Fase Pertumbuhan Larva &middot; Menuju Target {targetBiomass.toLocaleString()} g</span>
                )}
              </h2>

              <p className="hero-desc">{envStatusText}</p>

              {/* Real Progress Bar */}
              <div className="hero-progress-section">
                <div className="hero-progress-bar">
                  <div
                    className="hero-progress-fill"
                    style={{ width: `${targetPct}%` }}
                  />
                </div>
                <div className="hero-progress-labels">
                  <span>Mulai: {startWeight > 0 ? `${startWeight.toFixed(0)} g` : "0 g"}</span>
                  <strong>Bobot Riil: {currentWeight.toFixed(1)} g ({targetPct}% dari target)</strong>
                  <span>Target: {targetBiomass.toLocaleString()} g</span>
                </div>
              </div>

            </div>

            <div className="unified-hero-right">
              <div className="hero-stat-card">
                <span className="hero-stat-label">Bobot Timbangan Saat Ini</span>
                <div className="hero-stat-val">
                  <strong>{currentWeight.toFixed(1)}</strong>
                  <span className="unit">gram</span>
                </div>
                <span className="hero-stat-sub">
                  {gainedWeight !== null && gainedWeight > 0
                    ? `+${gainedWeight.toFixed(1)} g dari awal siklus`
                    : "Sensor timbangan terkalibrasi"}
                </span>
              </div>

              <div className="hero-stat-card">
                <span className="hero-stat-label">Kendali Aktuator Fisik</span>
                <div className="actuator-pills">
                  <span className={`actuator-pill ${actuator?.exhaust_fan ? "actuator-pill--on" : ""}`}>
                    Kipas {actuator?.exhaust_fan ? "ON" : "OFF"}
                  </span>
                  <span className={`actuator-pill ${actuator?.mist_maker ? "actuator-pill--on" : ""}`}>
                    Mist {actuator?.mist_maker ? "ON" : "OFF"}
                  </span>
                  <span className={`actuator-pill ${actuator?.heater ? "actuator-pill--on" : ""}`}>
                    Heater {actuator?.heater ? "ON" : "OFF"}
                  </span>
                </div>
                <span className="hero-stat-sub">Otomatisasi ESP32 Bang-Bang Controller</span>
              </div>
            </div>
          </div>
        </section>

        {/* 3. CORE SENSOR TELEMETRY CARDS */}
        <section className="sensor-section">
          <div className="section-title-wrap">
            <div>
              <p className="panel-label">TELEMETRI PERANGKAT KERAS</p>
              <h3 style={{ margin: "2px 0 0", color: "var(--gray-900)", fontSize: "1.35rem", fontWeight: 800 }}>
                Nilai Sensor Real-Time
              </h3>
            </div>
            <span className="panel-chip" style={{ background: "rgba(22, 163, 74, 0.12)", color: "var(--green-700)", border: "1px solid rgba(22, 163, 74, 0.25)" }}>
              {isLoading ? "Sinkronisasi..." : isDeviceOnline ? "Streaming Aktif" : "Data Terakhir Tersimpan"}
            </span>
          </div>

          {loadError ? (
            <div className="summary-item summary-item--warn" style={{ marginBottom: "16px" }}>
              <strong>Perhatian Supabase</strong>
              <p>{loadError}</p>
            </div>
          ) : null}

          <div className="sensor-grid">
            {sensorCards.map((s) => (
              <article className="sensor-card" key={s.label}>
                <div className="sensor-card__head">
                  <span>{s.label}</span>
                  <span
                    className="sensor-accent"
                    style={{ backgroundColor: s.accent }}
                  />
                </div>
                <strong>{s.value}</strong>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: "8px" }}>
                  <span style={{ fontSize: "0.8rem", fontWeight: 700, color: s.accent }}>{s.status}</span>
                  <p style={{ margin: 0 }}>{s.note}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* 4. REAL INTERACTIVE SENSOR HISTORY CHART */}
        <section className="panel panel--chart" style={{ width: "100%", padding: "24px 28px" }}>
          <SensorChart24h deviceId={selectedDeviceId ?? 1} />
        </section>

        {/* 5. PRACTICAL FEEDING LOG & CYCLE MANAGEMENT */}
        <section className="panel panel--nutrition">
          <div className="panel-header">
            <div>
              <p className="panel-label">MANAJEMEN SIKLUS &amp; PAKAN</p>
              <h2>Pemberian Pakan Organik</h2>
            </div>
            <div className="cycle-badge-wrap">
              <span style={{ fontSize: "0.84rem", color: "var(--gray-600)" }}>
                Total Catatan: <strong>{nutrientCount} kali</strong>
              </span>
            </div>
          </div>

          <form className="nutrition-form" onSubmit={handleNutritionSubmit}>
            <div className="nutrition-grid">
              <label className="nutrition-field" htmlFor="category-input">
                <span>Kategori Pakan Limbah Hari Ini</span>
                <select
                  id="category-input"
                  value={selectedCategory}
                  onChange={(event) => setSelectedCategory(event.target.value)}
                >
                  {nutrientCategories.map((category) => (
                    <option key={category.value} value={category.value}>
                      {category.label} — {category.description}
                    </option>
                  ))}
                </select>
                <p className="nutrition-field__hint">
                  Mencatat jenis pakan organik yang diberikan untuk memantau efisiensi biokonversi larva.
                </p>
              </label>

              <div className="nutrition-submit-wrap">
                <button
                  type="submit"
                  className="nutrition-submit"
                  disabled={!device || isLoading}
                >
                  Simpan Pakan
                </button>
                <button
                  type="button"
                  className="nutrition-submit nutrition-submit--secondary"
                  disabled={!device || isLoading}
                  onClick={handleCycleReset}
                >
                  Mulai Siklus Baru
                </button>
              </div>
            </div>

            {nutritionMessage ? (
              <p className={`nutrition-message nutrition-message--${nutritionMessage.type}`}>
                {nutritionMessage.text}
              </p>
            ) : null}

            <div className="nutrition-cycle-panel">
              <div className="nutrition-cycle-panel__head">
                <span>Siklus Budidaya Saat Ini:</span>
                <strong>
                  {latestCycleReset
                    ? `Dimulai ${formatTimestamp(latestCycleReset.created_at)} (Bobot Awal: ${latestCycleReset.current_weight.toFixed(1)} g)`
                    : "Belum ada titik reset siklus. Klik 'Mulai Siklus Baru' saat memasukkan bibit larva baru."}
                </strong>
              </div>
            </div>
          </form>
        </section>

      </div>

      {/* 6. WI-FI & DEVICE CONFIGURATION MODAL */}
      {isWifiModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsWifiModalOpen(false)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header__title">
                <span className="modal-icon">📡</span>
                <div>
                  <h3>Pengaturan Jaringan Wi-Fi &amp; Device</h3>
                  <p>Hubungkan {device?.hostname ?? "SiBob"} ke Wi-Fi atau update firmware (.bin)</p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsWifiModalOpen(false)}
              >
                ✕
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="modal-tabs">
              <button
                type="button"
                className={`modal-tab ${activeSetupTab === "quick" ? "modal-tab--active" : ""}`}
                onClick={() => setActiveSetupTab("quick")}
              >
                ⚡ Ganti Wi-Fi Perangkat
              </button>
              <button
                type="button"
                className={`modal-tab ${activeSetupTab === "portal" ? "modal-tab--active" : ""}`}
                onClick={() => setActiveSetupTab("portal")}
              >
                📶 Panduan Hotspot Demo
              </button>
              <button
                type="button"
                className={`modal-tab ${activeSetupTab === "firmware" ? "modal-tab--active" : ""}`}
                onClick={() => setActiveSetupTab("firmware")}
              >
                🔄 OTA Firmware (.bin)
              </button>
            </div>

            <div className="modal-body">
              {activeSetupTab === "quick" && (
                <div className="setup-section">
                  <div className="info-banner">
                    <strong>Kirim SSID &amp; Password Langsung ke ESP32</strong>
                    <p>
                      Pastikan laptop/HP Anda berada dalam satu jaringan Wi-Fi yang sama dengan perangkat SiBob.
                    </p>
                  </div>

                  <div className="wifi-update-card">
                    <form
                      className="wifi-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!wifiSsid) return;
                        setWifiUpdating(true);
                        setWifiUpdateResult(null);

                        const targetHost = deviceIpInput.trim()
                          ? deviceIpInput.trim().replace(/^http:\/\//, "")
                          : `${device?.hostname ?? "sibob-1"}.local`;

                        try {
                          const res = await fetch(`http://${targetHost}/api/set-wifi`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              ssid: wifiSsid,
                              password: wifiPassword,
                            }),
                            signal: AbortSignal.timeout(4000),
                          });

                          if (res.ok) {
                            setWifiUpdateResult({
                              type: "success",
                              message: `Berhasil! ${device?.hostname ?? "SiBob"} menyimpan Wi-Fi baru dan sedang menyambung ulang ke "${wifiSsid}".`,
                            });
                          } else {
                            setWifiUpdateResult({
                              type: "error",
                              message: `Device merespons dengan kode ${res.status}.`,
                            });
                          }
                        } catch {
                          setWifiUpdateResult({
                            type: "error",
                            message: `Tidak dapat menjangkau http://${targetHost}/api/set-wifi. Pastikan perangkat aktif dan berada di jaringan lokal yang sama, atau gunakan IP langsung di bawah.`,
                          });
                        } finally {
                          setWifiUpdating(false);
                        }
                      }}
                    >
                      <div className="wifi-form-fields">
                        <label className="wifi-field">
                          <span>Nama Wi-Fi Baru (SSID)</span>
                          <input
                            type="text"
                            placeholder="Contoh: Hotspot-HP / Wi-Fi-Ruangan"
                            value={wifiSsid}
                            onChange={(e) => setWifiSsid(e.target.value)}
                            required
                          />
                        </label>
                        <label className="wifi-field">
                          <span>Password Wi-Fi</span>
                          <input
                            type="password"
                            placeholder="Masukkan password"
                            value={wifiPassword}
                            onChange={(e) => setWifiPassword(e.target.value)}
                          />
                        </label>
                      </div>

                      <div className="wifi-form-actions">
                        <button
                          type="submit"
                          className="btn-update-wifi"
                          disabled={wifiUpdating || !wifiSsid}
                        >
                          {wifiUpdating ? "Mengirim ke Perangkat..." : "Simpan & Hubungkan"}
                        </button>
                      </div>

                      {wifiUpdateResult && (
                        <div className={`status-msg status-msg--${wifiUpdateResult.type}`}>
                          {wifiUpdateResult.message}
                        </div>
                      )}
                    </form>
                  </div>

                  <div className="ip-override-form">
                    <label htmlFor="device-ip-input">
                      <span>Uji Sambungan via IP Langsung (jika .local tidak terdeteksi):</span>
                      <div className="ip-input-wrap">
                        <input
                          id="device-ip-input"
                          type="text"
                          placeholder="Contoh: 192.168.1.150"
                          value={deviceIpInput}
                          onChange={(e) => setDeviceIpInput(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn-test-ping"
                          disabled={!deviceIpInput || wifiTesting}
                          onClick={async () => {
                            setWifiTesting(true);
                            setWifiStatusMsg({ type: "info", text: "Menghubungi endpoint perangkat..." });
                            try {
                              const ip = deviceIpInput.trim().replace(/^http:\/\//, "");
                              const res = await fetch(`http://${ip}/`, { signal: AbortSignal.timeout(3500) });
                              if (res.ok) {
                                setWifiStatusMsg({ type: "success", text: `Tersambung! Perangkat merespons (HTTP ${res.status}).` });
                              } else {
                                setWifiStatusMsg({ type: "error", text: `Perangkat merespons error status: ${res.status}` });
                              }
                            } catch {
                              setWifiStatusMsg({
                                type: "error",
                                text: "Gagal menjangkau IP. Pastikan perangkat dan laptop dalam 1 Wi-Fi yang sama.",
                              });
                            } finally {
                              setWifiTesting(false);
                            }
                          }}
                        >
                          {wifiTesting ? "Menguji..." : "Tes Sambungan"}
                        </button>
                      </div>
                    </label>
                    {wifiStatusMsg && (
                      <p className={`status-msg status-msg--${wifiStatusMsg.type}`}>
                        {wifiStatusMsg.text}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {activeSetupTab === "portal" && (
                <div className="setup-section">
                  <div className="info-banner">
                    <strong>Panduan Cepat Hotspot HP (Sangat Direkomendasikan untuk Demo/Lomba)</strong>
                    <p>
                      Gunakan metode ini agar alat otomatis online di lokasi baru tanpa perlu colok kabel sama sekali:
                    </p>
                  </div>

                  <div className="hotspot-guide-card">
                    <h4>📱 4 Langkah Cepat Menghubungkan Alat:</h4>
                    <ol className="hotspot-steps">
                      <li>Nyalakan <strong>Personal Hotspot</strong> di HP Anda.</li>
                      <li>Atur nama hotspot menjadi: <code>Bengkel Inovasi Indonesia</code></li>
                      <li>Atur kata sandi hotspot menjadi: <code>EKSPEKTASI</code></li>
                      <li>Nyalakan alat SiBob. Dalam 10 detik, alat akan langsung tersambung dan streaming telemetri ke dashboard!</li>
                    </ol>
                  </div>
                </div>
              )}

              {activeSetupTab === "firmware" && (
                <div className="setup-section">
                  <div className="info-banner info-banner--accent">
                    <strong>Wireless OTA Firmware Update (ElegantOTA)</strong>
                    <p>
                      Kirim file binary (.bin) hasil build PlatformIO langsung ke chip ESP32 tanpa kabel USB.
                    </p>
                  </div>

                  <div className="workflow-steps">
                    <div className="workflow-step">
                      <span className="step-num">1</span>
                      <div>
                        <strong>Kompilasi Firmware</strong>
                        <p>Jalankan build di PlatformIO untuk menghasilkan file .bin terbaru.</p>
                      </div>
                    </div>
                    <div className="workflow-step">
                      <span className="step-num">2</span>
                      <div>
                        <strong>Buka Portal ElegantOTA</strong>
                        <div style={{ marginTop: "8px" }}>
                          <a
                            href={`http://${device?.hostname ?? "sibob-1"}.local/update`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-link-action"
                          >
                            Buka Portal OTA (http://{device?.hostname ?? "sibob-1"}.local/update) ↗
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <span className="modal-footer__status">
                Device Aktif: <strong>{device?.hostname ?? "SiBob"} (ID #{selectedDeviceId ?? 1})</strong>
              </span>
              <button
                type="button"
                className="btn-done"
                onClick={() => setIsWifiModalOpen(false)}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
