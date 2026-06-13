/** ISO 3166-1 alpha-2 codes supported as transporter operating countries. */
const OPERATING_COUNTRIES = ['IN', 'AE', 'SA', 'OM', 'QA', 'KW', 'BH'];

const DEFAULT_OPERATING_COUNTRY = 'IN';

const isValidOperatingCountry = (code) => {
  if (!code || typeof code !== 'string') return false;
  return OPERATING_COUNTRIES.includes(code.trim().toUpperCase());
};

const normalizeOperatingCountry = (code) => {
  if (!code || typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  return isValidOperatingCountry(normalized) ? normalized : null;
};

module.exports = {
  OPERATING_COUNTRIES,
  DEFAULT_OPERATING_COUNTRY,
  isValidOperatingCountry,
  normalizeOperatingCountry,
};
