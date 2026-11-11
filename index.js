// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the WeatherKitApp (src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { WeatherKitApp } from './src/app.js';
import { ACTIONS } from './src/constants.js';

const gladys = new GladysIntegration();
const app = new WeatherKitApp({ gladys });

// --- Weather provider (manifest type "weather") ----------------------------------
// Answered under 15 s: from the copy of the location, or after one call.
gladys.onWeatherGet((options) => app.getWeather(options));

// --- Configuration screen button ------------------------------------------------
gladys.onAction(ACTIONS.TEST, () => app.testConnection());

// --- Configuration changed by the user ----------------------------------------
gladys.onConfigUpdated(async (config) => {
  logger.info('Configuration updated: restarting');
  await app.start(config);
  gladys.requestWeatherRefresh();
});

// --- Connection lifecycle ------------------------------------------------------
gladys.on('connected', () => app.onConnected());
gladys.on('disconnected', () => app.onDisconnected());
gladys.handleShutdown(() => app.stop());

logger.info('Starting the Apple WeatherKit integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
