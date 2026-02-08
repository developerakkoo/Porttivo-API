const mongoose = require('mongoose');
const PumpOwner = require('../src/models/PumpOwner');
const connectDB = require('../src/config/database');

// Pump Owner Details
const pumpOwnerData = {
  mobile: '9876543210',
  name: 'Test Pump Owner',
  email: 'pumpowner@test.com',
  pumpName: 'Test Petrol Pump',
  location: {
    address: '123 Test Street',
    coordinates: {
      latitude: 19.0760,
      longitude: 72.8777
    },
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001'
  },
  status: 'active', // Set to active so you can login immediately
  walletBalance: 0,
  commissionRate: 2.5, // 2.5% commission
  totalDriversVisited: 0,
  totalTransporters: 0,
  totalFuelValue: 0
};

async function createPumpOwner() {
  try {
    // Connect to database
    await connectDB();
    console.log('✅ Connected to database');

    // Check if pump owner already exists
    const existingOwner = await PumpOwner.findOne({ mobile: pumpOwnerData.mobile });
    
    if (existingOwner) {
      console.log('⚠️  Pump owner already exists with mobile:', pumpOwnerData.mobile);
      console.log('📝 Updating existing pump owner to active status...');
      
      existingOwner.status = 'active';
      existingOwner.name = pumpOwnerData.name;
      existingOwner.email = pumpOwnerData.email;
      existingOwner.pumpName = pumpOwnerData.pumpName;
      existingOwner.location = pumpOwnerData.location;
      existingOwner.commissionRate = pumpOwnerData.commissionRate;
      
      await existingOwner.save();
      console.log('✅ Pump owner updated successfully!');
      console.log('\n📋 Login Details:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Mobile Number: ' + pumpOwnerData.mobile);
      console.log('Status: ' + existingOwner.status);
      console.log('Pump Name: ' + existingOwner.pumpName);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } else {
      // Create new pump owner
      const pumpOwner = await PumpOwner.create(pumpOwnerData);
      console.log('✅ Pump owner created successfully!');
      console.log('\n📋 Login Details:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Mobile Number: ' + pumpOwnerData.mobile);
      console.log('Status: ' + pumpOwner.status);
      console.log('Pump Name: ' + pumpOwner.pumpName);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    console.log('\n💡 You can now login using:');
    console.log('   Mobile: ' + pumpOwnerData.mobile);
    console.log('   User Type: pump_owner');
    console.log('\n🚀 Ready to test!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating pump owner:', error);
    process.exit(1);
  }
}

// Run the script
createPumpOwner();
