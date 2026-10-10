export interface LivenessStatus {
  status: 'ok';
}

export interface ReadinessCheck {
  name: string;
  status: 'up' | 'down';
  message?: string;
}

export interface ReadinessStatus {
  status: 'ok' | 'error';
  checks: ReadinessCheck[];
}
