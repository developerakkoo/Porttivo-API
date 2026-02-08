# Pump Owner & Pump Staff API Documentation

Complete API documentation for Pump Owner and Pump Staff applications, including all endpoints, request/response formats, authentication flows, and use cases.

## Table of Contents

1. [Authentication](#authentication)
2. [Pump Owner API](#pump-owner-api)
3. [Pump Staff API](#pump-staff-api)
4. [Shared Endpoints](#shared-endpoints)
5. [Data Models](#data-models)
6. [User Flows](#user-flows)
7. [Error Handling](#error-handling)

---

## Authentication

### Base URL
```
http://localhost:3000/api
```

### Authentication Method
All endpoints (except login) require JWT Bearer token in the Authorization header:
```
Authorization: Bearer <accessToken>
```

### Pump Owner Login (OTP)

**Endpoint:** `POST /api/auth/send-otp`

**Request Body:**
```json
{
  "mobile": "9876543210",
  "userType": "pump_owner"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "mobile": "9876543210",
      "name": "John Doe",
      "email": "john@example.com",
      "pumpName": "ABC Petrol Pump",
      "userType": "pump_owner",
      "status": "active",
      "walletBalance": 0,
      "commissionRate": 2.5
    }
  }
}
```

**Error Responses:**
- `400` - Invalid mobile number or user type
- `403` - Account blocked or inactive
- `404` - Pump owner not registered

**Notes:**
- Mobile number must be 10 digits
- Account must be in "active" status (not "pending", "inactive", or "blocked")
- OTP is simplified - returns tokens directly (no separate OTP verification step)
- Currently supports: "transporter", "driver", "pump_owner"
- Pump Staff authentication not yet implemented (needs to be added)

---

## Pump Owner API

### 1. Dashboard

**Endpoint:** `GET /api/pump-owners/dashboard`

**Query Parameters (Optional):**
- `startDate` - ISO date string (e.g., "2024-01-01T00:00:00.000Z")
- `endDate` - ISO date string (e.g., "2024-01-31T23:59:59.999Z")

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Dashboard data retrieved successfully",
  "data": {
    "dashboard": {
      "porttivoTransactionCount": 150,
      "porttivoFuelValue": 450000.50,
      "recentTransactions": [
        {
          "id": "507f1f77bcf86cd799439011",
          "transactionId": "FTX-ABC123-XYZ",
          "date": "2024-01-15T10:30:00.000Z",
          "vehicle": "MH12AB1234",
          "amount": 5000,
          "attendant": {
            "id": "507f1f77bcf86cd799439012",
            "name": "Rajesh Kumar",
            "mobile": "9876543211"
          },
          "driver": {
            "id": "507f1f77bcf86cd799439013",
            "name": "Driver Name",
            "mobile": "9876543212"
          },
          "status": "completed"
        }
      ],
      "period": {
        "startDate": "2024-01-01T00:00:00.000Z",
        "endDate": "2024-01-31T23:59:59.999Z"
      }
    }
  }
}
```

**Notes:**
- `porttivoTransactionCount` - Count of ALL Porttivo transactions (all statuses)
- `porttivoFuelValue` - Sum of amounts from COMPLETED transactions only
- `recentTransactions` - Last 10 transactions (all statuses)
- Date filters are optional - if not provided, shows all-time data

---

### 2. View All Transactions

**Endpoint:** `GET /api/fuel/transactions`

**Query Parameters (Optional):**
- `status` - Filter by status: "pending", "confirmed", "completed", "cancelled", "flagged"
- `vehicleNumber` - Filter by vehicle number
- `startDate` - ISO date string
- `endDate` - ISO date string
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20)

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Success Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "transactionId": "FTX-ABC123-XYZ",
      "pumpOwnerId": {
        "_id": "507f1f77bcf86cd799439014",
        "name": "John Doe",
        "pumpName": "ABC Petrol Pump"
      },
      "pumpStaffId": {
        "_id": "507f1f77bcf86cd799439012",
        "name": "Rajesh Kumar",
        "mobile": "9876543211"
      },
      "vehicleNumber": "MH12AB1234",
      "driverId": {
        "_id": "507f1f77bcf86cd799439013",
        "name": "Driver Name",
        "mobile": "9876543212"
      },
      "fuelCardId": {
        "_id": "507f1f77bcf86cd799439015",
        "cardNumber": "CARD123456",
        "balance": 45000
      },
      "amount": 5000,
      "status": "completed",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "completedAt": "2024-01-15T10:35:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

**Notes:**
- Pump owners can only see their own transactions (automatically filtered by `pumpOwnerId`)
- Transactions are sorted by `createdAt` descending (newest first)
- Response includes populated fields: driver, attendant (pumpStaff), fuel card

---

### 3. View Transaction Details

**Endpoint:** `GET /api/fuel/transactions/:id`

**Path Parameters:**
- `id` - Transaction ID (MongoDB ObjectId)

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "transactionId": "FTX-ABC123-XYZ",
    "pumpOwnerId": {
      "_id": "507f1f77bcf86cd799439014",
      "name": "John Doe",
      "pumpName": "ABC Petrol Pump"
    },
    "pumpStaffId": {
      "_id": "507f1f77bcf86cd799439012",
      "name": "Rajesh Kumar",
      "mobile": "9876543211"
    },
    "vehicleNumber": "MH12AB1234",
    "driverId": {
      "_id": "507f1f77bcf86cd799439013",
      "name": "Driver Name",
      "mobile": "9876543212"
    },
    "fuelCardId": {
      "_id": "507f1f77bcf86cd799439015",
      "cardNumber": "CARD123456",
      "balance": 45000
    },
    "amount": 5000,
    "qrCode": "encrypted_qr_code_string",
    "status": "completed",
    "location": {
      "latitude": 19.0760,
      "longitude": 72.8777,
      "address": "Mumbai, Maharashtra",
      "accuracy": 10
    },
    "createdAt": "2024-01-15T10:30:00.000Z",
    "completedAt": "2024-01-15T10:35:00.000Z"
  }
}
```

**Error Responses:**
- `403` - Access denied (transaction doesn't belong to this pump owner)
- `404` - Transaction not found

---

### 4. Get Profile

**Endpoint:** `GET /api/pump-owners/profile`

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Profile retrieved successfully",
  "data": {
    "pumpOwner": {
      "id": "507f1f77bcf86cd799439014",
      "mobile": "9876543210",
      "name": "John Doe",
      "email": "john@example.com",
      "pumpName": "ABC Petrol Pump",
      "location": {
        "address": "123 Main Street",
        "coordinates": {
          "latitude": 19.0760,
          "longitude": 72.8777
        },
        "city": "Mumbai",
        "state": "Maharashtra",
        "pincode": "400001"
      },
      "status": "active",
      "walletBalance": 0,
      "commissionRate": 2.5,
      "totalDriversVisited": 50,
      "totalTransporters": 10,
      "totalFuelValue": 450000.50,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-15T10:00:00.000Z"
    }
  }
}
```

---

### 5. Update Profile

**Endpoint:** `PUT /api/pump-owners/profile`

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Request Body (All fields optional):**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "pumpName": "ABC Petrol Pump",
  "location": {
    "address": "123 Main Street",
    "coordinates": {
      "latitude": 19.0760,
      "longitude": 72.8777
    },
    "city": "Mumbai",
    "state": "Maharashtra",
    "pincode": "400001"
  }
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "pumpOwner": {
      "id": "507f1f77bcf86cd799439014",
      "mobile": "9876543210",
      "name": "John Doe",
      "email": "john@example.com",
      "pumpName": "ABC Petrol Pump",
      "location": { ... },
      "status": "active",
      "walletBalance": 0,
      "commissionRate": 2.5
    }
  }
}
```

---

### 6. Manage Attendants - List

**Endpoint:** `GET /api/pump-staff`

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Staff list retrieved successfully",
  "data": {
    "staff": [
      {
        "id": "507f1f77bcf86cd799439012",
        "mobile": "9876543211",
        "name": "Rajesh Kumar",
        "pumpOwnerId": "507f1f77bcf86cd799439014",
        "status": "active",
        "permissions": {
          "canProcessFuel": true,
          "canViewTransactions": false,
          "canViewSettlements": false,
          "canManageStaff": false
        },
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-15T10:00:00.000Z"
      }
    ]
  }
}
```

**Notes:**
- Returns all attendants for the logged-in pump owner
- Attendants have restricted permissions by default (cannot view transactions/settlements)

---

### 7. Manage Attendants - Add

**Endpoint:** `POST /api/pump-staff`

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Request Body:**
```json
{
  "name": "Rajesh Kumar",
  "mobile": "9876543211"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Staff added successfully",
  "data": {
    "staff": {
      "id": "507f1f77bcf86cd799439012",
      "mobile": "9876543211",
      "name": "Rajesh Kumar",
      "pumpOwnerId": "507f1f77bcf86cd799439014",
      "status": "active",
      "permissions": {
        "canProcessFuel": true,
        "canViewTransactions": false,
        "canViewSettlements": false,
        "canManageStaff": false
      }
    }
  }
}
```

**Error Responses:**
- `400` - Mobile or name missing, invalid mobile number, or staff already exists

**Notes:**
- Mobile number must be unique and 10 digits
- Permissions are automatically set (canProcessFuel: true, others: false)
- Cannot override restricted permissions (canViewTransactions, canViewSettlements)

---

### 8. Manage Attendants - Update

**Endpoint:** `PUT /api/pump-staff/:id`

**Path Parameters:**
- `id` - Staff ID (MongoDB ObjectId)

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Request Body (All fields optional):**
```json
{
  "name": "Rajesh Kumar Updated",
  "status": "active"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Staff updated successfully",
  "data": {
    "staff": {
      "id": "507f1f77bcf86cd799439012",
      "mobile": "9876543211",
      "name": "Rajesh Kumar Updated",
      "pumpOwnerId": "507f1f77bcf86cd799439014",
      "status": "active",
      "permissions": {
        "canProcessFuel": true,
        "canViewTransactions": false,
        "canViewSettlements": false,
        "canManageStaff": false
      }
    }
  }
}
```

**Notes:**
- Cannot update permissions to allow viewing transactions/settlements (enforced by backend)

---

### 9. Manage Attendants - Disable

**Endpoint:** `PUT /api/pump-staff/:id/disable`

**Path Parameters:**
- `id` - Staff ID (MongoDB ObjectId)

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Staff disabled successfully",
  "data": {
    "staff": {
      "id": "507f1f77bcf86cd799439012",
      "mobile": "9876543211",
      "name": "Rajesh Kumar",
      "status": "disabled"
    }
  }
}
```

**Notes:**
- Sets status to "disabled" (prevents misuse)
- Disabled attendants cannot process fuel transactions

---

### 10. View Settlements - List

**Endpoint:** `GET /api/settlements`

**Query Parameters (Optional):**
- `status` - Filter by status: "PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20)

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Settlements retrieved successfully",
  "data": {
    "settlements": [
      {
        "id": "507f1f77bcf86cd799439016",
        "pumpOwner": {
          "_id": "507f1f77bcf86cd799439014",
          "name": "John Doe",
          "pumpName": "ABC Petrol Pump",
          "mobile": "9876543210"
        },
        "period": "January 2024",
        "startDate": "2024-01-01T00:00:00.000Z",
        "endDate": "2024-01-31T23:59:59.999Z",
        "fuelValue": 450000.50,
        "commission": 11250.01,
        "commissionRate": 2.5,
        "netPayable": 438750.49,
        "status": "COMPLETED",
        "utr": "UTR123456789",
        "transactionCount": 150,
        "processedAt": "2024-02-01T10:00:00.000Z",
        "completedAt": "2024-02-01T12:00:00.000Z",
        "createdAt": "2024-02-01T09:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 5,
      "pages": 1
    }
  }
}
```

**Notes:**
- Pump owners can only see their own settlements (automatically filtered)
- Settlements are sorted by `createdAt` descending (newest first)

---

### 11. View Settlements - Details

**Endpoint:** `GET /api/settlements/:id`

**Path Parameters:**
- `id` - Settlement ID (MongoDB ObjectId)

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Settlement retrieved successfully",
  "data": {
    "settlement": {
      "id": "507f1f77bcf86cd799439016",
      "pumpOwner": {
        "_id": "507f1f77bcf86cd799439014",
        "name": "John Doe",
        "pumpName": "ABC Petrol Pump",
        "mobile": "9876543210"
      },
      "period": "January 2024",
      "startDate": "2024-01-01T00:00:00.000Z",
      "endDate": "2024-01-31T23:59:59.999Z",
      "fuelValue": 450000.50,
      "commission": 11250.01,
      "commissionRate": 2.5,
      "netPayable": 438750.49,
      "status": "COMPLETED",
      "utr": "UTR123456789",
      "transactions": [ ... ],
      "transactionCount": 150,
      "processedAt": "2024-02-01T10:00:00.000Z",
      "processedBy": {
        "_id": "507f1f77bcf86cd799439017",
        "username": "admin",
        "email": "admin@example.com"
      },
      "completedAt": "2024-02-01T12:00:00.000Z",
      "notes": "Settlement processed successfully",
      "createdAt": "2024-02-01T09:00:00.000Z",
      "updatedAt": "2024-02-01T12:00:00.000Z"
    }
  }
}
```

---

### 12. View Pending Settlements

**Endpoint:** `GET /api/settlements/pending`

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Pending settlements retrieved successfully",
  "data": {
    "settlements": [
      {
        "id": "507f1f77bcf86cd799439016",
        "pumpOwner": { ... },
        "period": "February 2024",
        "startDate": "2024-02-01T00:00:00.000Z",
        "endDate": "2024-02-29T23:59:59.999Z",
        "fuelValue": 500000,
        "commission": 12500,
        "netPayable": 487500,
        "createdAt": "2024-03-01T09:00:00.000Z"
      }
    ]
  }
}
```

---

## Pump Staff API

### 1. Submit Fuel Transaction (QR Scan)

**Endpoint:** `POST /api/fuel/submit`

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Request Body:**
```json
{
  "qrCode": "encrypted_qr_code_string",
  "amount": 5000,
  "latitude": 19.0760,
  "longitude": 72.8777,
  "accuracy": 10,
  "address": "Mumbai, Maharashtra"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Transaction submitted successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "transactionId": "FTX-ABC123-XYZ",
    "pumpOwnerId": {
      "_id": "507f1f77bcf86cd799439014",
      "name": "John Doe",
      "pumpName": "ABC Petrol Pump"
    },
    "pumpStaffId": {
      "_id": "507f1f77bcf86cd799439012",
      "name": "Rajesh Kumar",
      "mobile": "9876543211"
    },
    "vehicleNumber": "MH12AB1234",
    "driverId": {
      "_id": "507f1f77bcf86cd799439013",
      "name": "Driver Name",
      "mobile": "9876543212"
    },
    "fuelCardId": {
      "_id": "507f1f77bcf86cd799439015",
      "cardNumber": "CARD123456",
      "balance": 45000
    },
    "amount": 5000,
    "status": "completed",
    "location": {
      "latitude": 19.0760,
      "longitude": 72.8777,
      "address": "Mumbai, Maharashtra",
      "accuracy": 10
    },
    "createdAt": "2024-01-15T10:30:00.000Z",
    "completedAt": "2024-01-15T10:35:00.000Z"
  },
  "fraudDetected": false
}
```

**Error Responses:**
- `400` - Missing required fields, transaction not found, transaction not confirmed, insufficient card balance, QR code expired
- `403` - Access denied (not pump staff)

**Notes:**
- Only pump staff can submit transactions
- Transaction must be in "confirmed" status before submission
- QR code must be valid and not expired
- Fuel card balance is automatically deducted
- Fraud detection runs automatically
- GPS location is required for fraud detection

**Transaction Flow:**
1. Driver generates QR code (status: "pending")
2. Driver confirms transaction (status: "confirmed")
3. Pump staff scans QR and submits amount (status: "completed" or "flagged" if fraud detected)

---

## Shared Endpoints

### Refresh Token

**Endpoint:** `POST /api/auth/refresh`

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

## Data Models

### PumpOwner Model

```javascript
{
  _id: ObjectId,
  mobile: String (10 digits, unique, required),
  name: String,
  pumpName: String (required),
  email: String,
  location: {
    address: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    city: String,
    state: String,
    pincode: String
  },
  status: String (enum: "active", "inactive", "blocked", "pending", default: "pending"),
  walletBalance: Number (default: 0),
  commissionRate: Number (min: 0, max: 100, default: 0),
  totalDriversVisited: Number (default: 0),
  totalTransporters: Number (default: 0),
  totalFuelValue: Number (default: 0),
  createdAt: Date,
  updatedAt: Date
}
```

### PumpStaff Model

```javascript
{
  _id: ObjectId,
  mobile: String (10 digits, unique, required),
  name: String (required),
  pumpOwnerId: ObjectId (ref: "PumpOwner", required),
  status: String (enum: "active", "inactive", "blocked", "disabled", default: "active"),
  permissions: {
    canProcessFuel: Boolean (default: true),
    canViewTransactions: Boolean (default: false),
    canViewSettlements: Boolean (default: false),
    canManageStaff: Boolean (default: false)
  },
  createdAt: Date,
  updatedAt: Date
}
```

### FuelTransaction Model

```javascript
{
  _id: ObjectId,
  transactionId: String (unique, required),
  pumpOwnerId: ObjectId (ref: "PumpOwner", required),
  pumpStaffId: ObjectId (ref: "PumpStaff"),
  vehicleNumber: String (required, uppercase),
  driverId: ObjectId (ref: "Driver", required),
  fuelCardId: ObjectId (ref: "FuelCard", required),
  amount: Number (required, min: 0),
  qrCode: String (required, unique),
  qrCodeExpiry: Date (required),
  location: {
    latitude: Number (required),
    longitude: Number (required),
    address: String,
    accuracy: Number
  },
  status: String (enum: "pending", "confirmed", "completed", "cancelled", "flagged", default: "pending"),
  receipt: {
    photo: String,
    uploadedAt: Date,
    uploadedBy: ObjectId (ref: "Driver")
  },
  fraudFlags: {
    duplicateReceipt: Boolean,
    gpsMismatch: Boolean,
    gpsMismatchDistance: Number,
    expressUploads: Boolean,
    unusualPattern: Boolean,
    flaggedBy: ObjectId (ref: "Admin"),
    flaggedAt: Date,
    resolved: Boolean,
    resolvedAt: Date,
    resolvedBy: ObjectId (ref: "Admin")
  },
  confirmedAt: Date,
  completedAt: Date,
  cancelledAt: Date,
  cancelledBy: ObjectId (ref: "Driver"),
  notes: String,
  createdAt: Date,
  updatedAt: Date
}
```

### Settlement Model

```javascript
{
  _id: ObjectId,
  pumpOwnerId: ObjectId (ref: "PumpOwner", required),
  period: String (required),
  startDate: Date (required),
  endDate: Date (required),
  fuelValue: Number (required, min: 0, default: 0),
  commission: Number (required, min: 0, default: 0),
  commissionRate: Number (min: 0, max: 100, default: 0),
  netPayable: Number (required, min: 0, default: 0),
  status: String (enum: "PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED", default: "PENDING"),
  utr: String (uppercase),
  transactions: [ObjectId] (ref: "FuelTransaction"),
  processedAt: Date,
  processedBy: ObjectId (ref: "Admin"),
  completedAt: Date,
  notes: String,
  createdAt: Date,
  updatedAt: Date
}
```

---

## User Flows

### Pump Owner Flow

#### 1. Login Flow
```
1. User enters mobile number
2. App calls POST /api/auth/send-otp with userType: "pump_owner"
3. Backend validates mobile and checks account status
4. If valid, returns JWT tokens and user data
5. App stores tokens and navigates to dashboard
```

#### 2. Dashboard Flow
```
1. App calls GET /api/pump-owners/dashboard (with optional date filters)
2. Backend returns:
   - Total transaction count
   - Total fuel value (from completed transactions)
   - Recent 10 transactions
3. App displays dashboard with summary cards and recent transactions list
```

#### 3. View Transactions Flow
```
1. User navigates to "View Transactions" screen
2. App calls GET /api/fuel/transactions (with optional filters)
3. Backend returns paginated list of transactions
4. App displays list with: Date, Vehicle, Amount, Attendant, Status
5. User can tap transaction to view details
6. App calls GET /api/fuel/transactions/:id
7. Backend returns full transaction details
```

#### 4. Manage Attendants Flow
```
1. User navigates to "Manage Attendants" screen
2. App calls GET /api/pump-staff
3. Backend returns list of all attendants
4. User can:
   - Add new attendant: POST /api/pump-staff (name, mobile)
   - Update attendant: PUT /api/pump-staff/:id
   - Disable attendant: PUT /api/pump-staff/:id/disable
```

#### 5. View Settlements Flow
```
1. User navigates to "Settlement Status" screen
2. App calls GET /api/settlements
3. Backend returns list of settlements
4. App displays: Period, Porttivo fuel, Commission, Net payable, Status, UTR, Date
5. User can tap settlement to view details
6. App calls GET /api/settlements/:id
7. Backend returns full settlement details with transaction list
```

### Pump Staff Flow

#### 1. Login Flow
```
NOTE: Pump Staff authentication is not yet implemented in the backend.
Currently, pump staff would need to be authenticated through a different method
or the authentication endpoint needs to be extended to support pump_staff userType.

Once implemented, the flow would be:
1. User enters mobile number
2. App calls POST /api/auth/send-otp with userType: "pump_staff"
3. Backend validates mobile and checks account status
4. If valid, returns JWT tokens and user data
5. App stores tokens and navigates to QR scanner
```

#### 2. Scan QR and Submit Flow
```
1. Staff scans QR code from driver's app
2. App extracts QR code string
3. App gets GPS location
4. Staff enters fuel amount
5. App calls POST /api/fuel/submit with:
   - qrCode
   - amount
   - latitude, longitude
6. Backend validates QR code and transaction status
7. Backend updates transaction (status: "completed")
8. Backend deducts amount from fuel card
9. Backend runs fraud detection
10. Backend returns transaction details
11. App displays success message
```

**Important Notes:**
- Pump staff CANNOT view transactions list
- Pump staff CANNOT view settlements
- Pump staff CAN ONLY scan QR and submit fuel amount

---

## Error Handling

### Standard Error Response Format

```json
{
  "success": false,
  "message": "Error message description"
}
```

### Common HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors, missing fields)
- `401` - Unauthorized (invalid or missing token)
- `403` - Forbidden (access denied, account blocked)
- `404` - Not Found (resource doesn't exist)
- `409` - Conflict (duplicate entry)
- `500` - Internal Server Error

### Error Scenarios

#### Authentication Errors
- **401** - Token expired or invalid
  - Solution: Call refresh token endpoint or re-login
- **403** - Account blocked or inactive
  - Solution: Contact admin for activation

#### Validation Errors
- **400** - Invalid mobile number format
  - Solution: Ensure 10-digit mobile number
- **400** - Missing required fields
  - Solution: Check request body includes all required fields

#### Business Logic Errors
- **400** - Transaction not in confirmed status
  - Solution: Driver must confirm transaction first
- **400** - Insufficient card balance
  - Solution: Check fuel card balance
- **400** - QR code expired
  - Solution: Generate new QR code

#### Authorization Errors
- **403** - Access denied
  - Solution: Ensure user has correct permissions
  - Pump owners can only access their own data
  - Pump staff cannot view transactions/settlements

---

## Security Considerations

1. **JWT Tokens**
   - Access tokens expire (check token expiry)
   - Use refresh tokens to get new access tokens
   - Store tokens securely (use secure storage)

2. **Authorization**
   - All endpoints require authentication
   - Pump owners can only access their own data
   - Pump staff have restricted permissions

3. **Data Filtering**
   - Backend automatically filters data by `pumpOwnerId`
   - No need to pass `pumpOwnerId` in requests (extracted from token)

4. **GPS Location**
   - Required for fraud detection
   - Transactions without GPS may be flagged

5. **QR Code Security**
   - QR codes are encrypted
   - QR codes expire after 1 hour
   - Each QR code can only be used once

---

## Best Practices for App Development

### 1. Token Management
- Store tokens securely (use secure storage, not plain text)
- Implement token refresh before expiry
- Handle token expiration gracefully (redirect to login)

### 2. Error Handling
- Display user-friendly error messages
- Log errors for debugging
- Handle network errors (retry logic)

### 3. Loading States
- Show loading indicators during API calls
- Disable buttons during submission
- Provide feedback for all user actions

### 4. Data Caching
- Cache dashboard data (refresh periodically)
- Cache profile data
- Implement pull-to-refresh

### 5. Offline Support
- Store critical data locally
- Queue actions when offline
- Sync when connection restored

### 6. GPS Location
- Request location permissions
- Handle location errors gracefully
- Show location accuracy to user

### 7. QR Code Scanning
- Use camera permissions
- Handle QR code scanning errors
- Validate QR code format before submission

---

## API Rate Limiting

Currently, there are no rate limits implemented. However, consider:
- Implementing rate limiting for production
- Caching frequently accessed data
- Batching requests where possible

---

## Testing Endpoints

### Test Pump Owner Account
```
Mobile: 9876543210
Status: active
```

### Test Pump Staff Account
```
Mobile: 9876543211
Status: active
Pump Owner ID: <pump_owner_id>
```

### Test Transaction Flow
1. Create a driver account
2. Generate QR code (driver app)
3. Confirm transaction (driver app)
4. Scan QR and submit (pump staff app)
5. View transaction (pump owner app)

---

## Support & Contact

For API issues or questions:
- Check error messages for details
- Verify request format matches documentation
- Ensure authentication tokens are valid
- Contact backend team for assistance

---

**Last Updated:** January 2024
**API Version:** 1.0.0
