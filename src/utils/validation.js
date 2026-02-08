/**
 * Validate mobile number format (10 digits, Indian format)
 * @param {String} mobile - Mobile number to validate
 * @returns {Boolean} True if valid
 */
const validateMobile = (mobile) => {
  if (!mobile) return false;
  const cleaned = mobile.trim().replace(/\D/g, '');
  return /^[0-9]{10}$/.test(cleaned);
};

/**
 * Clean and format mobile number (remove spaces, special chars)
 * @param {String} mobile - Mobile number to clean
 * @returns {String} Cleaned mobile number
 */
const cleanMobile = (mobile) => {
  if (!mobile) return '';
  return mobile.trim().replace(/\D/g, '');
};

/**
 * Validate user type
 * @param {String} userType - User type to validate
 * @returns {Boolean} True if valid
 */
const validateUserType = (userType) => {
  return ['transporter', 'driver', 'pump_owner'].includes(userType?.toLowerCase());
};

/**
 * Validate PIN format (4 digits)
 * @param {String} pin - PIN to validate
 * @returns {Boolean} True if valid
 */
const validatePin = (pin) => {
  if (!pin) return false;
  return /^[0-9]{4}$/.test(pin);
};

module.exports = {
  validateMobile,
  cleanMobile,
  validateUserType,
  validatePin,
};
