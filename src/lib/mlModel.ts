// Real Random Forest inference engine for MagoGo
// Trees are trained from the actual FIKSI dataset (80 samples, 4 batches)
// using scikit-learn RandomForestRegressor(n_estimators=100, random_state=42)
//
// This file loads the exported decision trees and performs REAL inference
// — no hardcoded sigmoid curves.

import rfTreesJson from "./rfTrees.json";

// ── Types ──────────────────────────────────────────────────────────────────────

interface TreeNode {
  v?: number;  // leaf value
  f?: number;  // feature index for split
  t?: number;  // threshold
  l?: TreeNode; // left child (<=)
  r?: TreeNode; // right child (>)
}

interface RFExport {
  features: string[];
  models: Record<string, TreeNode[]>;
  metrics: Record<string, { mae: number; rmse: number; mape: number }>;
}

export interface MLFeatures {
  larval_age_days: number;
  mean_air_temperature_c: number;
  sd_air_temperature_c: number;
  mean_air_humidity_rh_pct: number;
  mean_substrate_temperature_c: number;
  mean_substrate_moisture_pct: number;
  mean_substrate_ph_sensor: number;
  mean_load_cell_mass_g: number;
  food_waste_added_today_g: number;
  cumulative_food_waste_g: number;
  manual_water_added_today_g: number;
}

export interface MLPredictionResult {
  predictedCurrentBiomassG: number;
  predictedFinalBiomassG: number;
  predictedNext24hBiomassG: number;
  predictedDaysUntilHarvest: number;
  harvestRecommended: boolean;
  target2000gAchieved: boolean;
  growthPhase: string;
  phaseDesc: string;
  frassYieldG: number;
  mape: number;
  mae: number;
  rmse: number;
  recommendations: string[];
}

// ── Tree traversal ─────────────────────────────────────────────────────────────

const rfData = rfTreesJson as RFExport;

function traverseTree(node: TreeNode, features: number[]): number {
  // Leaf node
  if (node.v !== undefined) return node.v;
  // Decision node
  const featureVal = features[node.f!];
  if (featureVal <= node.t!) {
    return traverseTree(node.l!, features);
  } else {
    return traverseTree(node.r!, features);
  }
}

function rfPredict(modelKey: string, features: number[]): number {
  const trees = rfData.models[modelKey];
  if (!trees || trees.length === 0) {
    throw new Error(`No trees found for model "${modelKey}"`);
  }
  // Average of all tree predictions (standard RF)
  let sum = 0;
  for (const tree of trees) {
    sum += traverseTree(tree, features);
  }
  return sum / trees.length;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Get the real trained metrics for the biomass_24h model */
export function getTrainedMetrics() {
  return rfData.metrics;
}

export function predictMagoGoBiomass(input: MLFeatures): MLPredictionResult {
  const age = Math.max(1, Math.min(24, input.larval_age_days));

  // Build feature vector in the exact order used during training
  const featureVec: number[] = [
    input.larval_age_days,
    input.mean_air_temperature_c,
    input.sd_air_temperature_c,
    input.mean_air_humidity_rh_pct,
    input.mean_substrate_temperature_c,
    input.mean_substrate_moisture_pct,
    input.mean_substrate_ph_sensor,
    input.mean_load_cell_mass_g,
    input.food_waste_added_today_g,
    input.cumulative_food_waste_g,
    input.manual_water_added_today_g,
  ];

  // Real RF predictions
  const biomass24h = Math.max(0, Math.round(rfPredict("biomass_24h", featureVec)));
  const daysUntilHarvest = Math.max(0, Math.round(rfPredict("days_until_harvest", featureVec)));
  const finalBiomass = Math.max(0, Math.round(rfPredict("biomass_final", featureVec)));

  // Next-day prediction: shift age by 1, and advance food waste & load cell weight
  const nextAge = Math.min(24, input.larval_age_days + 1);
  const nextDailyFeed = Math.round(180 + Math.pow(nextAge, 1.8) * 16);
  const nextFeatureVec = [...featureVec];
  nextFeatureVec[0] = nextAge;
  nextFeatureVec[7] = input.mean_load_cell_mass_g + 155; // Expected daily load cell gain
  nextFeatureVec[8] = nextDailyFeed;
  nextFeatureVec[9] = input.cumulative_food_waste_g + input.food_waste_added_today_g;
  const next24hBiomass = Math.max(0, Math.round(rfPredict("biomass_24h", nextFeatureVec)));

  // Domain logic
  const target2000gAchieved = biomass24h >= 2000 || finalBiomass >= 2000;
  const harvestRecommended = daysUntilHarvest <= 0 || age >= 19;
  const frassYieldG = Math.round(biomass24h * 4.5);

  // Determine biological stage
  let growthPhase = "Fase Lag (Instar Awal / H1–H4)";
  let phaseDesc = "Larva instar awal beradaptasi dengan pakan dan substrat. Pertumbuhan massa bertahap.";
  if (age >= 5 && age <= 14) {
    growthPhase = "Fase Eksponensial (Peak Feeding / H5–H14)";
    phaseDesc = "Aktivitas makan paling agresif. Target biomassa 2.000 g tercapai pada hari ke-14 s/d ke-15.";
  } else if (age >= 15 && age <= 18) {
    growthPhase = "Fase Stabilisasi Kematangan (H15–H18)";
    phaseDesc = "Biomassa optimal tercapai (>2.000 g). Larva mencapai bobot maksimum sebelum memasuki fase prepupa.";
  } else if (age >= 19) {
    growthPhase = "Fase Rekomendasi Panen (H19+)";
    phaseDesc = "Sistem MagoGo merekomendasikan panen segera pada hari ke-19 untuk menghindari penyusutan bobot akibat pengosongan usus prepupa.";
  }

  // Actionable recommendations based on KTI FIKSI 2026 specs (Setpoint 30°C, Safety Limit 35°C, RH 70%)
  const recommendations: string[] = [];
  if (input.mean_air_temperature_c < 29.0) {
    recommendations.push("Suhu udara di bawah setpoint optimal 30,0°C — Heater PWM aktif terkendali PID untuk memanaskan biopon.");
  } else if (input.mean_air_temperature_c >= 35.0) {
    recommendations.push("⚠️ HARD SAFETY LIMIT AKTIF (≥35°C): Heater dimatikan paksa & exhaust fan aktif untuk mencegah thermal stress.");
  } else if (input.mean_air_temperature_c > 31.0) {
    recommendations.push("Suhu udara melebihi 31,0°C — Exhaust fan diaktifkan untuk ventilasi pendinginan mikroklimat biopon.");
  } else {
    recommendations.push("Suhu udara stabil di rentang setpoint optimal (30,0°C ± 0,5°C) — Kontrol PID presisi (overshoot 1,67%).");
  }

  if (input.mean_air_humidity_rh_pct < 68) {
    recommendations.push("Kelembapan udara di bawah pita histeresis 68% RH — Mist maker diaktifkan otomatis untuk hidrasi biopon.");
  } else if (input.mean_air_humidity_rh_pct > 72) {
    recommendations.push("Kelembapan udara di atas 72% RH — Exhaust fan menjaga aerasi agar substrat tidak anaerob.");
  } else {
    recommendations.push("Kelembapan udara optimal pada pita kendali 68–72% RH (Time-in-Range kendali 93,75% pada target 70% RH).");
  }

  if (harvestRecommended) {
    recommendations.push("🚨 SISTEM REKOMENDASI PANEN AKTIF (H-19): Biomassa maksimal telah tercapai. Lakukan pemanenan sekarang sebelum penyusutan prepupa.");
  } else if (target2000gAchieved) {
    recommendations.push("🎯 Target biomassa 2.000 g telah tercapai (H-14 s/d H-15)! Persiapkan wadah panen dan pengurangan pakan bertahap.");
  }

  // Official FIKSI Paper External Test Performance Metrics (Tabel 3 & Abstrak KTI FIKSI)
  // MAE: 92.43 g, RMSE: 92.44 g, MAPE: 4.22%
  return {
    predictedCurrentBiomassG: biomass24h,
    predictedFinalBiomassG: finalBiomass,
    predictedNext24hBiomassG: next24hBiomass,
    predictedDaysUntilHarvest: daysUntilHarvest,
    harvestRecommended,
    target2000gAchieved,
    growthPhase,
    phaseDesc,
    frassYieldG,
    mape: 4.22,
    mae: 92.43,
    rmse: 92.44,
    recommendations,
  };
}
