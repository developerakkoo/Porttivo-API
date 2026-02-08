const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const uploadDirs = {
  pod: path.join(__dirname, '../../uploads/pod'),
  milestones: path.join(__dirname, '../../uploads/milestones'),
  receipts: path.join(__dirname, '../../uploads/receipts'),
};

Object.values(uploadDirs).forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Determine destination based on route or field name
    if (file.fieldname === 'pod') {
      cb(null, uploadDirs.pod);
    } else if (file.fieldname === 'receipt') {
      cb(null, uploadDirs.receipts);
    } else if (file.fieldname === 'photo' || file.fieldname === 'milestonePhoto') {
      cb(null, uploadDirs.milestones);
    } else {
      cb(null, uploadDirs.pod); // Default
    }
  },
  filename: function (req, file, cb) {
    // Generate unique filename: {tripId}_{timestamp}_{random}.{ext}
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const tripId = req.params.id || req.body.tripId || 'trip';
    const milestoneNumber = req.params.milestoneNumber || '';
    
    let filename;
    if (file.fieldname === 'pod') {
      filename = `pod_${tripId}_${uniqueSuffix}${ext}`;
    } else if (file.fieldname === 'receipt') {
      const transactionId = req.params.id || 'txn';
      filename = `receipt_${transactionId}_${uniqueSuffix}${ext}`;
    } else {
      filename = `milestone_${tripId}_${milestoneNumber}_${uniqueSuffix}${ext}`;
    }
    
    cb(null, filename);
  },
});

// File filter for image validation
const fileFilter = (req, file, cb) => {
  // Allowed MIME types
  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png'];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, JPG, and PNG images are allowed.'), false);
  }
};

// Multer configuration
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: fileFilter,
});

// Middleware for POD upload (single file)
const uploadPOD = upload.single('pod');

// Middleware for milestone photo upload (single file, optional)
const uploadMilestonePhoto = upload.single('photo');

// Middleware for receipt upload (single file)
const uploadReceipt = upload.single('receipt');

// Error handler for multer errors
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 5MB.',
      });
    }
    return res.status(400).json({
      success: false,
      message: `Upload error: ${err.message}`,
    });
  }
  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'File upload failed',
    });
  }
  next();
};

module.exports = {
  uploadPOD,
  uploadMilestonePhoto,
  uploadReceipt,
  upload,
  handleMulterError,
};
