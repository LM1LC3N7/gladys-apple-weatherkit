// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, test button) in English
// and French. They name fields, never their values.
// -----------------------------------------------------------------------------

const minutes = (ms) => Math.max(1, Math.ceil(ms / 60_000));

const FIELD_NAMES = {
  team_id: { en: 'Team ID', fr: 'Team ID' },
  key_id: { en: 'Key ID', fr: 'Key ID' },
  service_id: { en: 'Service ID', fr: 'Service ID' },
  private_key: { en: 'private key (.p8)', fr: 'clé privée (.p8)' },
  country: { en: 'country', fr: 'pays' },
  alerts: { en: 'alerts', fr: 'alertes' },
  refresh_minutes: { en: 'refresh interval', fr: 'intervalle de lecture' },
  monthly_budget: { en: 'monthly budget', fr: 'budget mensuel' },
};

const names = (fields, lang) => fields.map((f) => FIELD_NAMES[f]?.[lang] ?? f).join(', ');

export const T = {
  notConfigured: {
    en: 'Enter the Team ID, Key ID, Service ID and private key of your Apple Developer account.',
    fr: 'Saisissez le Team ID, le Key ID, le Service ID et la clé privée de votre compte Apple Developer.',
  },
  invalid: (fields) => ({
    en: `Invalid configuration: ${names(fields, 'en')}. Nothing is sent to Apple until it is fixed.`,
    fr: `Configuration invalide : ${names(fields, 'fr')}. Rien n'est envoyé à Apple avant correction.`,
  }),
  ready: {
    en: 'Ready: waiting for the first weather request of Gladys.',
    fr: 'Prêt : en attente de la première demande météo de Gladys.',
  },
  ok: {
    en: 'WeatherKit answers.',
    fr: 'WeatherKit répond.',
  },
  refused: {
    en: 'Apple refused these credentials twice in a row (HTTP 401/403): nothing more is sent with them. Check the Team ID, Key ID, Service ID, the key and the WeatherKit subscription, then save or press "Test WeatherKit".',
    fr: "Apple a refusé ces identifiants deux fois de suite (HTTP 401/403) : plus rien n'est envoyé avec eux. Vérifiez le Team ID, le Key ID, le Service ID, la clé et l'abonnement WeatherKit, puis enregistrez ou appuyez sur « Tester WeatherKit ».",
  },
  paused429: (ms) => ({
    en: `WeatherKit asked to slow down (HTTP 429): next request in ${minutes(ms)} min.`,
    fr: `WeatherKit a demandé de ralentir (HTTP 429) : prochaine requête dans ${minutes(ms)} min.`,
  }),
  pausedError: (reason, ms) => ({
    en: `WeatherKit did not answer properly (${reason}): next request in ${minutes(ms)} min.`,
    fr: `WeatherKit n'a pas répondu correctement (${reason}) : prochaine requête dans ${minutes(ms)} min.`,
  }),
  budget: (budget) => ({
    en: `Monthly budget reached (${budget} calls): no request to Apple until the 1st of next month (UTC).`,
    fr: `Budget mensuel atteint (${budget} appels) : aucune requête à Apple avant le 1er du mois prochain (UTC).`,
  }),
  stateUnreadable: {
    en: '/data/state.json is unreadable: read again every 10 s, nothing is sent to Apple meanwhile.',
    fr: "/data/state.json est illisible : relu toutes les 10 s, rien n'est envoyé à Apple en attendant.",
  },
  configUnread: (ms) => ({
    en: `The configuration could not be read from Gladys: new try in ${Math.ceil(ms / 1000)} s.`,
    fr: `La configuration n'a pas pu être lue depuis Gladys : nouvel essai dans ${Math.ceil(ms / 1000)} s.`,
  }),
  badLocation: {
    en: 'Invalid coordinates.',
    fr: 'Coordonnées invalides.',
  },
  testWait: (ms) => ({
    en: `A test ran less than 30 s ago: try again in ${Math.ceil(ms / 1000)} s.`,
    fr: `Un test a eu lieu il y a moins de 30 s : réessayez dans ${Math.ceil(ms / 1000)} s.`,
  }),
  testOk: ({ sets, calls, budget, country, alerts }) => {
    const hasAlerts = sets.includes('weatherAlerts');
    const alertEn = !country
      ? 'No country set: no alerts.'
      : hasAlerts
        ? `Alerts available for ${country}${alerts ? '' : ' (turned off)'}.`
        : `No alerts from WeatherKit for ${country} at this location.`;
    const alertFr = !country
      ? "Aucun pays saisi : pas d'alertes."
      : hasAlerts
        ? `Alertes disponibles pour ${country}${alerts ? '' : ' (désactivées)'}.`
        : `Pas d'alertes WeatherKit pour ${country} à cet endroit.`;
    return {
      en: `WeatherKit accepted the credentials. Data sets here: ${sets.join(', ') || 'none'}. ${alertEn} Calls this month: ${calls} of ${budget}.`,
      fr: `WeatherKit a accepté les identifiants. Données disponibles ici : ${sets.join(', ') || 'aucune'}. ${alertFr} Appels ce mois-ci : ${calls} sur ${budget}.`,
    };
  },
};

/** The English text of a message, for the errors that Gladys logs. */
export const en = (message) => message.en;
