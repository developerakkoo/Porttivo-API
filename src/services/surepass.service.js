const env = require('../config/env');
const { normalizeIndianVehicleRegistration } = require('../utils/vehicleValidation');

const buildFailureResult = ({ status, message, statusCode = null, rawResponse = null }) => ({
  ok: false,
  verified: false,
  status,
  statusCode,
  message,
  messageCode: rawResponse?.message_code || null,
  rawResponse,
  data: rawResponse?.data || null,
  verifiedAt: null,
  source: 'surepass',
});

const verifyRcFull = async (vehicleNumber) => {
  const normalizedId = normalizeIndianVehicleRegistration(vehicleNumber);

  if (!normalizedId) {
    return buildFailureResult({
      status: 'invalid-input',
      message: 'Vehicle number is required',
    });
  }

  if (!env.surepassApiToken) {
    return buildFailureResult({
      status: 'not-configured',
      message: 'SurePass API token is not configured',
    });
  }

  if (typeof fetch !== 'function') {
    return buildFailureResult({
      status: 'unsupported',
      message: 'Fetch is not available in this runtime',
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, env.surepassRequestTimeoutMs));

  try {
    const response = await fetch(env.surepassRcFullUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.surepassApiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ id_number: normalizedId }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    const rawData = payload?.data || null;
    const verified = response.ok && payload?.success === true && !!rawData?.rc_number;

    if (verified) {
      return {
        ok: true,
        verified: true,
        status: 'verified',
        statusCode: response.status,
        message: payload?.message || 'Vehicle verified successfully',
        messageCode: payload?.message_code || null,
        rawResponse: payload,
        data: rawData,
        verifiedAt: new Date(),
        source: 'surepass',
      };
    }

    if (response.ok) {
      return {
        ok: true,
        verified: false,
        status: 'not_verified',
        statusCode: response.status,
        message: payload?.message || 'Vehicle could not be verified',
        messageCode: payload?.message_code || null,
        rawResponse: payload,
        data: rawData,
        verifiedAt: null,
        source: 'surepass',
      };
    }

    return buildFailureResult({
      status: 'error',
      statusCode: response.status,
      message: payload?.message || 'SurePass RC verification failed',
      rawResponse: payload,
    });
  } catch (error) {
    const isAbort = error?.name === 'AbortError';
    return buildFailureResult({
      status: isAbort ? 'timeout' : 'error',
      message: isAbort
        ? 'SurePass RC verification timed out'
        : error?.message || 'SurePass RC verification failed',
    });
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  verifyRcFull,
};
