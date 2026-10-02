export type HealthStatus = { status: "ok"; service: "farji" };

export function getHealthStatus(): HealthStatus {
  return { status: "ok", service: "farji" };
}
