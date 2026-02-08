const QRCode = require('qrcode');
const crypto = require('crypto');

/**
 * Generate QR code for fuel transaction
 * @param {Object} transactionData - Transaction data to encode
 * @param {String} transactionData.transactionId - Transaction ID
 * @param {String} transactionData.driverId - Driver ID
 * @param {String} transactionData.fuelCardId - Fuel card ID
 * @param {Number} transactionData.amount - Amount
 * @param {String} transactionData.vehicleNumber - Vehicle number
 * @returns {Promise<Object>} QR code data URL and encrypted data
 */
const generateQRCode = async (transactionData) => {
  try {
    // Create encrypted payload
    const payload = {
      transactionId: transactionData.transactionId,
      driverId: transactionData.driverId,
      fuelCardId: transactionData.fuelCardId,
      amount: transactionData.amount,
      vehicleNumber: transactionData.vehicleNumber,
      timestamp: Date.now(),
    };

    // Encrypt payload (using AES-256-CBC)
    const secretKey = process.env.QR_SECRET_KEY || 'porttivo-qr-secret-key-change-in-production-32chars!!';
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(secretKey.substring(0, 32).padEnd(32, '0')), iv);
    let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    // Prepend IV to encrypted data
    encrypted = iv.toString('hex') + ':' + encrypted;

    // Generate QR code image
    const qrCodeDataURL = await QRCode.toDataURL(encrypted, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      width: 300,
      margin: 1,
    });

    return {
      qrCode: encrypted, // Store encrypted string in database
      qrCodeImage: qrCodeDataURL, // Base64 image for immediate use
      payload,
    };
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw new Error('Failed to generate QR code');
  }
};

/**
 * Validate and decrypt QR code
 * @param {String} encryptedQR - Encrypted QR code string
 * @returns {Object} Decrypted transaction data
 */
const validateQRCode = (encryptedQR) => {
  try {
    const secretKey = process.env.QR_SECRET_KEY || 'porttivo-qr-secret-key-change-in-production-32chars!!';
    // Extract IV and encrypted data
    const parts = encryptedQR.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid QR code format');
    }
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(secretKey.substring(0, 32).padEnd(32, '0')), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    const payload = JSON.parse(decrypted);

    // Validate timestamp (QR codes expire after 1 hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    if (payload.timestamp < oneHourAgo) {
      throw new Error('QR code has expired');
    }

    return payload;
  } catch (error) {
    if (error.message === 'QR code has expired') {
      throw error;
    }
    throw new Error('Invalid QR code');
  }
};

/**
 * Generate unique transaction ID
 * @returns {String} Unique transaction ID
 */
const generateTransactionId = () => {
  return `FTX-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
};

module.exports = {
  generateQRCode,
  validateQRCode,
  generateTransactionId,
};
