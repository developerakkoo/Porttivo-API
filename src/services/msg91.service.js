const https = require('https');
const env = require('../config/env');

/**
 * Format 10-digit mobile number with country code for MSG91
 * @param {string} mobile - 10 digit mobile number
 * @returns {string} Mobile number formatted with country code (e.g., 919403884093)
 */
const formatMobileWithCountryCode = (mobile) => {
  if (!mobile) return '';
  const digits = String(mobile).replace(/\D/g, '');
  const countryCode = (env.msg91DefaultCountryCode || '91').replace(/\D/g, '');

  if (digits.length === 10) {
    return `${countryCode}${digits}`;
  }
  return digits;
};

/**
 * Perform HTTP request to MSG91 API
 * @param {string} url 
 * @param {object} options 
 * @returns {Promise<object>}
 */
const msg91HttpRequest = async (url, options = {}) => {
  if (typeof fetch === 'function') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: options.headers || {},
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await response.json().catch(() => null);
      return { status: response.status, ok: response.ok, data };
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  // Fallback to native Node https module if fetch is unavailable
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let data = null;
        try {
          data = JSON.parse(body);
        } catch (e) {
          data = body;
        }
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data });
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('MSG91 API request timed out'));
    });
    req.end();
  });
};

/**
 * Send OTP via MSG91
 * Endpoint: POST https://control.msg91.com/api/v5/otp?template_id=...&mobile=...&authkey=...
 * @param {string} mobile - 10-digit mobile number
 * @returns {Promise<{success: boolean, message: string, requestId?: string}>}
 */
const sendOtp = async (mobile) => {
  const formattedMobile = formatMobileWithCountryCode(mobile);
  if (!formattedMobile || formattedMobile.length < 10) {
    return { success: false, message: 'Invalid mobile number for OTP' };
  }

  // Check test mode bypass
  if (env.msg91EnableTestOtp) {
    return {
      success: true,
      message: 'OTP sent successfully (Test Mode)',
      requestId: 'test_request_id_' + Date.now(),
      isTestMode: true,
    };
  }

  const authKey = env.msg91AuthKey;
  const templateId = env.msg91TemplateId;

  if (!authKey || !templateId) {
    console.error('MSG91 Configuration error: Missing authKey or templateId');
    return { success: false, message: 'SMS Gateway service configuration error' };
  }

  const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(templateId)}&mobile=${encodeURIComponent(formattedMobile)}&authkey=${encodeURIComponent(authKey)}`;

  try {
    const res = await msg91HttpRequest(url, { method: 'POST' });
    const responseData = res.data || {};

    if (res.ok && responseData.type === 'success') {
      return {
        success: true,
        message: 'OTP sent successfully',
        requestId: responseData.request_id || null,
      };
    }

    const errorMsg = responseData.message || responseData.error || 'Failed to send OTP via MSG91';
    console.error('MSG91 sendOtp error response:', responseData);
    return { success: false, message: errorMsg };
  } catch (error) {
    console.error('MSG91 sendOtp exception:', error.message);
    return { success: false, message: 'Failed to communicate with SMS gateway' };
  }
};

/**
 * Verify OTP via MSG91
 * Endpoint: GET https://control.msg91.com/api/v5/otp/verify?otp=...&mobile=... (Header: authkey)
 * @param {string} mobile - 10-digit mobile number
 * @param {string} otp - OTP to verify
 * @returns {Promise<{success: boolean, message: string}>}
 */
const verifyOtp = async (mobile, otp) => {
  const formattedMobile = formatMobileWithCountryCode(mobile);
  const cleanedOtp = String(otp || '').trim();

  if (!formattedMobile || !cleanedOtp) {
    return { success: false, message: 'Mobile number and OTP are required' };
  }

  // Test mode bypass check
  if (env.msg91EnableTestOtp && cleanedOtp === env.msg91TestOtp) {
    return { success: true, message: 'OTP verified successfully (Test Mode)' };
  }

  const authKey = env.msg91AuthKey;
  if (!authKey) {
    console.error('MSG91 Configuration error: Missing authKey');
    return { success: false, message: 'SMS Gateway service configuration error' };
  }

  const url = `https://control.msg91.com/api/v5/otp/verify?otp=${encodeURIComponent(cleanedOtp)}&mobile=${encodeURIComponent(formattedMobile)}`;

  try {
    const res = await msg91HttpRequest(url, {
      method: 'GET',
      headers: {
        authkey: authKey,
      },
    });

    const responseData = res.data || {};

    if (res.ok && responseData.type === 'success') {
      return {
        success: true,
        message: responseData.message || 'OTP verified successfully',
      };
    }

    const errorMsg = responseData.message || 'Invalid or expired OTP';
    return { success: false, message: errorMsg };
  } catch (error) {
    console.error('MSG91 verifyOtp exception:', error.message);
    return { success: false, message: 'Failed to verify OTP with SMS gateway' };
  }
};

/**
 * Resend OTP via MSG91
 * Endpoint: POST https://control.msg91.com/api/v5/otp/retry?authkey=...&retrytype=...&mobile=...
 * @param {string} mobile - 10-digit mobile number
 * @param {string} [retryType='text'] - 'text' or 'voice'
 * @returns {Promise<{success: boolean, message: string}>}
 */
const resendOtp = async (mobile, retryType = 'text') => {
  const formattedMobile = formatMobileWithCountryCode(mobile);
  const type = retryType === 'voice' ? 'voice' : 'text';

  if (!formattedMobile || formattedMobile.length < 10) {
    return { success: false, message: 'Invalid mobile number for OTP resend' };
  }

  if (env.msg91EnableTestOtp) {
    return {
      success: true,
      message: 'OTP resent successfully (Test Mode)',
      isTestMode: true,
    };
  }

  const authKey = env.msg91AuthKey;
  if (!authKey) {
    console.error('MSG91 Configuration error: Missing authKey');
    return { success: false, message: 'SMS Gateway service configuration error' };
  }

  const url = `https://control.msg91.com/api/v5/otp/retry?authkey=${encodeURIComponent(authKey)}&retrytype=${encodeURIComponent(type)}&mobile=${encodeURIComponent(formattedMobile)}`;

  try {
    const res = await msg91HttpRequest(url, { method: 'POST' });
    const responseData = res.data || {};

    if (res.ok && responseData.type === 'success') {
      return {
        success: true,
        message: responseData.message || 'OTP resent successfully',
      };
    }

    const errorMsg = responseData.message || 'Failed to resend OTP via MSG91';
    return { success: false, message: errorMsg };
  } catch (error) {
    console.error('MSG91 resendOtp exception:', error.message);
    return { success: false, message: 'Failed to communicate with SMS gateway' };
  }
};

module.exports = {
  formatMobileWithCountryCode,
  sendOtp,
  verifyOtp,
  resendOtp,
};

