const crypto = require('crypto');
const env = require('../config/env');
const { normalizeIndianVehicleRegistration } = require('../utils/vehicleValidation');

const buildFailureResult = ({
  status,
  message,
  statusCode = null,
  rawResponse = null,
}) => ({
  ok: false,
  verified: false,
  status,
  statusCode,
  message,
  rawResponse,
  data: rawResponse?.cardData?.result || null,
  verifiedAt: null,
  source: 'rechargekit',
});

const verifyRechargeKitRc  = async (vehicleNumber) => {
  const normalizedId = normalizeIndianVehicleRegistration(vehicleNumber);

  if (!normalizedId) {
    return buildFailureResult({
      status: 'invalid-input',
      message: 'Vehicle number is required',
    });
  }

  if (!env.rechargeKitAuthToken) {
    return buildFailureResult({
      status: 'not-configured',
      message: 'RechargeKit token is not configured',
    });
  }

  if (typeof fetch !== 'function') {
    return buildFailureResult({
      status: 'unsupported',
      message: 'Fetch is not available',
    });
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, env.rechargeKitRequestTimeoutMs)
  );

  try {
    const partnerRequestId = `RC-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

    const response = await fetch(env.rechargeKitRcVerifyUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.rechargeKitAuthToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        rc_no: normalizedId,
        partner_request_id: partnerRequestId,
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);

    const rawData = payload?.cardData?.result || null;

    const verified =
      response.ok &&
      payload?.status === 1 &&
      payload?.error === 0 &&
      !!rawData?.reg_no;

    if (verified) {
      return {
        ok: true,
        verified: true,
        status: 'verified',
        statusCode: response.status,
        message: payload?.msg || 'Vehicle verified successfully',
        rawResponse: payload,
        data: rawData,
        verifiedAt: new Date(),
        source: 'rechargekit',
      };
    }

    if (response.ok) {
      return {
        ok: true,
        verified: false,
        status: 'not_verified',
        statusCode: response.status,
        message: payload?.msg || 'Vehicle could not be verified',
        rawResponse: payload,
        data: rawData,
        verifiedAt: null,
        source: 'rechargekit',
      };
    }

    return buildFailureResult({
      status: 'error',
      statusCode: response.status,
      message: payload?.msg || 'RechargeKit verification failed',
      rawResponse: payload,
    });
  } catch (error) {
    const isAbort = error.name === 'AbortError';

    return buildFailureResult({
      status: isAbort ? 'timeout' : 'error',
      message: isAbort
        ? 'RechargeKit request timed out'
        : error.message,
    });
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  verifyRechargeKitRc ,
};