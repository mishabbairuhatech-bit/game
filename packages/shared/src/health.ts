export type HealthState = 'ok' | 'degraded' | 'down';

export interface DependencyHealth {
  status: HealthState;
  latencyMs?: number;
  error?: string;
}

/** GET /health - liveness. Cheap, no dependency calls. */
export interface LivenessResponse {
  status: 'ok';
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

/** GET /ready - readiness. Verifies Postgres + Redis before reporting ok. */
export interface ReadinessResponse {
  status: HealthState;
  service: string;
  version: string;
  timestamp: string;
  dependencies: {
    database: DependencyHealth;
    redis: DependencyHealth;
  };
}
