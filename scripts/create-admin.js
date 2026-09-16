const mongoose = require('mongoose');
const Admin = require('../src/models/Admin');
const connectDB = require('../src/config/database');

// Admin Details - You can modify these
const adminData = {
  username: 'admin',
  email: 'admin@porttivo.com',
  password: 'admin123', // Minimum 6 characters
  role: 'super_admin', // Options: 'super_admin', 'admin', 'moderator'
  status: 'active', // Options: 'active', 'inactive', 'blocked'
  permissions: {
    canManageUsers: true,
    canManageTrips: true,
    canManageVehicles: true,
    canManageFuel: true,
    canManageSettlements: true,
    canViewReports: true,
    canManagePumps: true,
    canManageFraud: true,
  },
};

async function createAdmin() {
  try {
    // Connect to database
    await connectDB();
    console.log('✅ Connected to database');

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({
      $or: [
        { email: adminData.email.toLowerCase() },
        { username: adminData.username.toLowerCase() }
      ]
    });
    
    if (existingAdmin) {
      console.log('⚠️  Admin already exists with email:', adminData.email, 'or username:', adminData.username);
      console.log('📝 Updating existing admin...');
      
      existingAdmin.username = adminData.username.toLowerCase();
      existingAdmin.email = adminData.email.toLowerCase();
      existingAdmin.password = adminData.password; // Will be hashed by pre-save hook
      existingAdmin.role = adminData.role;
      existingAdmin.status = adminData.status;
      existingAdmin.permissions = adminData.permissions;
      
      await existingAdmin.save();
      console.log('✅ Admin updated successfully!');
      console.log('\n📋 Login Details:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Email: ' + adminData.email);
      console.log('Username: ' + adminData.username);
      console.log('Password: ' + adminData.password);
      console.log('Role: ' + existingAdmin.role);
      console.log('Status: ' + existingAdmin.status);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } else {
      // Create new admin
      const admin = await Admin.create(adminData);
      console.log('✅ Admin created successfully!');
      console.log('\n📋 Login Details:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Email: ' + adminData.email);
      console.log('Username: ' + adminData.username);
      console.log('Password: ' + adminData.password);
      console.log('Role: ' + admin.role);
      console.log('Status: ' + admin.status);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    console.log('\n💡 You can now login to the admin panel using:');
    console.log('   Email: ' + adminData.email);
    console.log('   Password: ' + adminData.password);
    console.log('\n🚀 Ready to login!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin:', error.message);
    if (error.code === 11000) {
      console.error('   Duplicate key error - Admin with this email or username already exists');
    }
    process.exit(1);
  }
}

// Run the script
createAdmin();
