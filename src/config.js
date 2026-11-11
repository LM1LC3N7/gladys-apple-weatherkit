// -----------------------------------------------------------------------------
// The configuration screen, normalized. An invalid field is named, its value
// never repeated (the private key above all).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  BUDGET_DEFAULT,
  BUDGET_MAX,
  BUDGET_MIN,
  REFRESH_DEFAULT_MIN,
  REFRESH_MAX_MIN,
  REFRESH_MIN_MIN,
} from './constants.js';
import { parsePrivateKey, publicKeyHash } from './jwt.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function integer(value, { min, max, fallback }) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined;
  if (n < min || n > max) return undefined;
  return n;
}

/**
 * Returns `{ configured, errors, value }`. `configured` is false while the four
 * Apple fields are all empty (fresh install); `errors` lists the invalid keys.
 */
export function normalizeConfig(raw = {}) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const errors = [];
  const teamId = text(config.team_id).toUpperCase();
  const keyId = text(config.key_id).toUpperCase();
  const serviceId = text(config.service_id);
  const keyText = typeof config.private_key === 'string' ? config.private_key : '';
  const configured = Boolean(teamId || keyId || serviceId || keyText.trim());

  if (!/^[A-Z0-9]{10}$/.test(teamId)) errors.push('team_id');
  if (!/^[A-Z0-9]{10}$/.test(keyId)) errors.push('key_id');
  if (
    serviceId.length > 155 ||
    CONTROL.test(serviceId) ||
    !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(serviceId)
  ) {
    errors.push('service_id');
  }
  const key = parsePrivateKey(keyText);
  if (!key) errors.push('private_key');

  const country = text(config.country).toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) errors.push('country');
  const alerts = config.alerts === undefined || config.alerts === null ? true : config.alerts;
  if (typeof alerts !== 'boolean') errors.push('alerts');

  const refreshMinutes = integer(config.refresh_minutes, {
    min: REFRESH_MIN_MIN,
    max: REFRESH_MAX_MIN,
    fallback: REFRESH_DEFAULT_MIN,
  });
  if (refreshMinutes === undefined) errors.push('refresh_minutes');
  const monthlyBudget = integer(config.monthly_budget, {
    min: BUDGET_MIN,
    max: BUDGET_MAX,
    fallback: BUDGET_DEFAULT,
  });
  if (monthlyBudget === undefined) errors.push('monthly_budget');

  if (errors.length > 0) return { configured, errors, value: null };
  return {
    configured,
    errors,
    value: {
      teamId,
      keyId,
      serviceId,
      key,
      // Identifies the credentials (ids + PUBLIC key), salted in app.js: a
      // refused set is never sent again on its own, a new one always is.
      credentialsId: createHash('sha256')
        .update(`${teamId}\n${keyId}\n${serviceId}\n${publicKeyHash(key)}`)
        .digest('hex'),
      country: country || null,
      alerts: alerts && Boolean(country),
      refreshMs: refreshMinutes * 60_000,
      monthlyBudget,
    },
  };
}
