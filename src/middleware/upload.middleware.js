const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const uploadDirs = {
  pod: path.join(__dirname, '../../uploads/pod'),
  milestones: path.join(__dirname, '../../uploads/milestones'),
  receipts: path.join(__dirname, '../../uploads/receipts'),
  chat: path.join(__dirname, '../../uploads/chat'),
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
    } else if (file.fieldname === 'photo' || file.fieldname === 'photos' || file.fieldname === 'milestonePhoto') {
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

// Middleware for milestone photo upload (single file, optional) - backward compat
const uploadMilestonePhoto = upload.single('photo');

// Middleware for milestone photos - accepts both 'photo' (single) and 'photos' (array, up to 10)
const uploadMilestonePhotos = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'photos', maxCount: 10 },
]);

// Middleware for receipt upload (single file)
const uploadReceipt = upload.single('receipt');

const chatAllowedMimes = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
];

const chatFileFilter = (req, file, cb) => {
  if (chatAllowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        'Invalid file type. Allowed: JPEG, PNG, WebP images and PDF.'
      ),
      false
    );
  }
};

const chatStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDirs.chat),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '';
    cb(null, `chat_${uniqueSuffix}${ext}`);
  },
});

const uploadChatFiles = multer({
  storage: chatStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: chatFileFilter,
}).array('files', 5);

// Spreadsheet upload (bulk fleet import) - parsed in-memory, never persisted to disk
const spreadsheetAllowedMimes = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls / some .csv
  'text/csv',
  'application/csv',
  'text/plain', // some browsers/OSes report .csv as text/plain
  'application/octet-stream', // fallback for csv/xlsx with unknown mime
];

const spreadsheetFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const extAllowed = ['.xlsx', '.xls', '.csv'].includes(ext);
  if (spreadsheetAllowedMimes.includes(file.mimetype) || extAllowed) {
    cb(null, true);
  } else {
    cb(
      new Error('Invalid file type. Only .xlsx, .xls and .csv files are allowed.'),
      false
    );
  }
};

const uploadSpreadsheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: spreadsheetFileFilter,
}).single('file');

// Error handler for multer errors
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large for this upload.',
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
  uploadMilestonePhotos,
  uploadReceipt,
  upload,
  uploadChatFiles,
  uploadSpreadsheet,
  handleMulterError,
};
