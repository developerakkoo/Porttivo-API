const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d\s]).{8,}$/;
const CONTAINER_NUMBER_REGEX = /^[A-Z]{4}[0-9]{7}$/;

/**
 * Clean and format mobile number (remove spaces, special chars)
 * @param {String} mobile - Mobile number to clean
 * @returns {String} Cleaned mobile number
 */
const cleanMobile = (mobile) => {
  if (!mobile) return '';
  return String(mobile).trim().replace(/\D/g, '');
};

/**
 * Normalize email (trim and lowercase)
 * @param {String} email - Email to normalize
 * @returns {String} Normalized email
 */
const normalizeEmail = (email) => {
  if (!email) return '';
  return String(email).trim().toLowerCase();
};

/**
 * Validate mobile number format (10 digits, Indian format)
 * @param {String} mobile - Mobile number to validate
 * @returns {Boolean} True if valid
 */
const validateMobile = (mobile) => {
  const cleaned = cleanMobile(mobile);
  return /^[0-9]{10}$/.test(cleaned);
};

/**
 * Validate email format
 * @param {String} email - Email to validate
 * @returns {Boolean} True if valid
 */
const validateEmail = (email) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return EMAIL_REGEX.test(normalized);
};

/**
 * Validate password format for admin accounts
 * Policy: 8+ chars, uppercase, lowercase, number, special character
 * @param {String} password - Password to validate
 * @returns {Boolean} True if valid
 */
const validatePassword = (password) => {
  if (typeof password !== 'string' || password.length === 0) return false;
  return STRONG_PASSWORD_REGEX.test(password);
};

/**
 * Normalize container number (trim and uppercase)
 * @param {String} containerNumber - Container number to normalize
 * @returns {String} Normalized container number
 */
const normalizeContainerNumber = (containerNumber) => {
  if (!containerNumber) return '';
  return String(containerNumber).trim().toUpperCase();
};

/**
 * Validate container number format
 * Required format: first 4 alphabetic characters followed by 7 digits
 * Example: ABCD1234567
 * @param {String} containerNumber - Container number to validate
 * @returns {Boolean} True if valid
 */
const validateContainerNumber = (containerNumber) => {
  const normalized = normalizeContainerNumber(containerNumber);
  return CONTAINER_NUMBER_REGEX.test(normalized);
};

/**
 * Validate user type
 * @param {String} userType - User type to validate
 * @returns {Boolean} True if valid
 */
const validateUserType = (userType) => {
  return ['transporter', 'driver', 'pump_owner', 'pump_staff', 'customer'].includes(userType?.toLowerCase());
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
  normalizeEmail,
  validateEmail,
  validatePassword,
  normalizeContainerNumber,
  validateContainerNumber,
  validateUserType,
  validatePin,
};
