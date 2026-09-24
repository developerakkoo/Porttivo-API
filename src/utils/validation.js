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

/**
 * Normalize PAN number (trim and uppercase)
 * @param {String} pan - PAN number
 * @returns {String} Normalized PAN
 */
const normalizePAN = (pan) => {
  if (!pan) return '';
  return String(pan).trim().toUpperCase();
};

/**
 * Validate PAN format (5 letters, 4 digits, 1 letter)
 * Example: ABCDE1234F
 * @param {String} pan - PAN number to validate
 * @returns {Boolean} True if valid
 */
const validatePAN = (pan) => {
  const normalized = normalizePAN(pan);
  return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(normalized);
};

/**
 * Clean Aadhaar number (remove spaces and hyphens)
 * @param {String} aadhaar - Aadhaar number
 * @returns {String} Cleaned Aadhaar
 */
const cleanAadhaar = (aadhaar) => {
  if (!aadhaar) return '';
  return String(aadhaar).trim().replace(/[\s-]/g, '');
};

/**
 * Validate Aadhaar format (12 digits)
 * @param {String} aadhaar - Aadhaar number to validate
 * @returns {Boolean} True if valid
 */
const validateAadhaar = (aadhaar) => {
  const cleaned = cleanAadhaar(aadhaar);
  return /^[0-9]{12}$/.test(cleaned);
};

/**
 * Validate IFSC code format (4 letters, 0, 6 alphanumeric)
 * Example: HDFC0001234
 * @param {String} ifsc - IFSC to validate
 * @returns {Boolean} True if valid
 */
const validateIFSC = (ifsc) => {
  if (!ifsc) return false;
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(ifsc).trim().toUpperCase());
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
  normalizePAN,
  validatePAN,
  cleanAadhaar,
  validateAadhaar,
  validateIFSC,
};

