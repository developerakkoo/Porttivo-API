const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const os = require('os');
const { engine } = require('express-handlebars');
const connectDB = require('./src/config/database');
const { port } = require('./src/config/env');
const { errorHandler, notFound } = require('./src/middleware/error.middleware');
const { initializeSocketIO } = require('./src/services/socket.service');

// Import routes
const authRoutes = require('./src/routes/auth.routes');
const transporterRoutes = require('./src/routes/transporter.routes');
const driverRoutes = require('./src/routes/driver.routes');
const vehicleRoutes = require('./src/routes/vehicle.routes');
const tripRoutes = require('./src/routes/trip.routes');
const fuelCardRoutes = require('./src/routes/fuelCard.routes');
const fuelRoutes = require('./src/routes/fuel.routes');
const companyUserRoutes = require('./src/routes/companyUser.routes');
const pumpOwnerRoutes = require('./src/routes/pumpOwner.routes');
const pumpStaffRoutes = require('./src/routes/pumpStaff.routes');
const adminRoutes = require('./src/routes/admin.routes');
const walletRoutes = require('./src/routes/wallet.routes');
const settlementRoutes = require('./src/routes/settlement.routes');
const notificationRoutes = require('./src/routes/notification.routes');

// Initialize Express app
const app = express();

// Create HTTP server
const httpServer = http.createServer(app);

// Initialize Socket.IO
initializeSocketIO(httpServer);

// Configure Handlebars view engine
app.engine('html', engine({
  extname: '.html',
  defaultLayout: false,
  layoutsDir: path.join(__dirname, 'src/views'),
}));
app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'src/views'));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Porttivo API is running',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/transporters', transporterRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/fuel-cards', fuelCardRoutes);
app.use('/api/fuel', fuelRoutes);
app.use('/api/company-users', companyUserRoutes);
app.use('/api/pump-owners', pumpOwnerRoutes);
app.use('/api/pump-staff', pumpStaffRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/admin', adminRoutes); // Admin dashboard routes
app.use('/api/wallets', walletRoutes);
app.use('/api/settlements', settlementRoutes);
app.use('/api/notifications', notificationRoutes);

// 404 handler
app.use(notFound);

// Error handler (must be last)
app.use(errorHandler);

// Helper function to get local IP address
const getLocalIPAddress = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
};

// Connect to database and start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Start HTTP server (Socket.IO is attached to it)
    // Listen on 0.0.0.0 to make it accessible over WiFi network
    httpServer.listen(port, '0.0.0.0', () => {
      const localIP = getLocalIPAddress();
      console.log(`🚀 Server is running on port ${port}`);
      console.log(`📡 API endpoints available at:`);
      console.log(`   - Local:   http://localhost:${port}/api`);
      console.log(`   - Network: http://${localIP}:${port}/api`);
      console.log(`🔌 Socket.IO server initialized`);
      console.log(`\n💡 To access from your device, use: http://${localIP}:${port}/api`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  // Close server gracefully
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});