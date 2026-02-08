# Porttivo Admin Backend API - Complete Documentation

Complete API documentation for the Porttivo Admin Backend system, covering all admin endpoints, user management, trip management, vehicle management, fuel management, settlement management, fraud detection, and analytics.

## Table of Contents

1. [Base Configuration](#base-configuration)
2. [Authentication](#authentication)
3. [Admin Profile Management](#admin-profile-management)
4. [User Management](#user-management)
5. [Trip Management](#trip-management)
6. [Vehicle Management](#vehicle-management)
7. [Fuel Management](#fuel-management)
8. [Fuel Card Management](#fuel-card-management)
9. [Settlement Management](#settlement-management)
10. [Fraud Detection & Management](#fraud-detection--management)
11. [Notification Management](#notification-management)
12. [Dashboard & Analytics](#dashboard--analytics)
13. [Permissions & Roles](#permissions--roles)
14. [Data Models](#data-models)
15. [Error Handling](#error-handling)
16. [Complete Admin Flows](#complete-admin-flows)
17. [Admin Panel Use Cases](#admin-panel-use-cases)
18. [Frontend Integration Guide](#frontend-integration-guide)
19. [API Flow Diagrams](#api-flow-diagrams)

---

## Base Configuration

### Base URL
```
Development: http://localhost:3000/api
Production: https://api.porttivo.com/api
```

### Authentication Header
For all protected endpoints, include the JWT token in the Authorization header:
```
Authorization: Bearer <access_token>
```

**Example Request:**
```javascript
fetch('http://localhost:3000/api/admin/dashboard/stats', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    'Content-Type': 'application/json'
  }
})
```

### Response Format
All API responses follow this structure:
```json
{
  "success": true|false,
  "message": "Response message",
  "data": { ... }
}
```

**Success Response Example:**
```json
{
  "success": true,
  "message": "Data retrieved successfully",
  "data": {
    "items": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "pages": 5
    }
  }
}
```

### Error Response Format
```json
{
  "success": false,
  "message": "Error message",
  "error": "Detailed error information (optional)"
}
```

**Error Response Example:**
```json
{
  "success": false,
  "message": "Access denied. This endpoint is for admins only.",
  "error": "User type 'transporter' does not have admin privileges"
}
```

### Environment Setup

**Required Environment Variables:**
```env
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/porttivo
JWT_SECRET=your-secret-key-here
JWT_REFRESH_SECRET=your-refresh-secret-key-here
JWT_EXPIRE=24h
JWT_REFRESH_EXPIRE=7d
```

### Date Format
All dates should be in ISO 8601 format:
```
2024-01-15T10:30:00.000Z
```

### Pagination
Most list endpoints support pagination with these query parameters:
- `page` (default: 1) - Page number
- `limit` (default: 20) - Items per page

**Example:**
```
GET /api/transporters?page=2&limit=50
```

---

## Authentication

### 1. Admin Login

**POST** `/api/auth/admin-login`

Login with email and password (Admin only).

**Access**: Public

**Request Body**:
```json
{
  "email": "admin@porttivo.com",
  "password": "admin123"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "jwt-access-token",
    "refreshToken": "jwt-refresh-token",
    "user": {
      "id": "admin-id",
      "username": "admin",
      "email": "admin@porttivo.com",
      "role": "admin",
      "permissions": {
        "canManageUsers": true,
        "canManageTrips": true,
        "canManageVehicles": true,
        "canManageFuel": true,
        "canManageSettlements": true,
        "canViewReports": true,
        "canManagePumps": true,
        "canManageFraud": true
      },
      "userType": "admin",
      "status": "active"
    }
  }
}
```

**Error Responses**:
- `400` - Email and password are required
- `401` - Invalid credentials
- `403` - Account blocked or inactive

**Business Logic:**
- Admin accounts use email/password authentication (different from other user types)
- Password must be at least 6 characters
- Account status must be "active" to login
- Last login timestamp is updated on successful login
- Passwords are hashed using bcrypt before storage
- JWT tokens are generated with admin userType and permissions

**Frontend Integration Example:**
```javascript
// Admin Login Component
async function adminLogin(email, password) {
  try {
    const response = await fetch('http://localhost:3000/api/auth/admin-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();
    
    if (data.success) {
      // Store tokens in localStorage or secure storage
      localStorage.setItem('accessToken', data.data.accessToken);
      localStorage.setItem('refreshToken', data.data.refreshToken);
      localStorage.setItem('admin', JSON.stringify(data.data.user));
      
      // Redirect to admin dashboard
      window.location.href = '/admin/dashboard';
    } else {
      // Show error message
      alert(data.message);
    }
  } catch (error) {
    console.error('Login error:', error);
    alert('Login failed. Please try again.');
  }
}
```

**Error Handling:**
- `400` - Email and password are required
- `401` - Invalid credentials (wrong email/password)
- `403` - Account blocked or inactive
- `500` - Internal server error

---

### 2. Refresh Token

**POST** `/api/auth/refresh`

Refresh the access token using refresh token.

**Access**: Public

**Request Body**:
```json
{
  "refreshToken": "jwt-refresh-token"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "new-jwt-access-token",
    "refreshToken": "new-jwt-refresh-token"
  }
}
```

**Error Responses**:
- `400` - Refresh token required
- `401` - Invalid or expired refresh token

---

## Admin Profile Management

### 1. Get Admin Profile

**GET** `/api/admins/profile` or `/api/admin/profile`

**Note:** Admin routes are available at both `/api/admins` and `/api/admin` prefixes.

Get authenticated admin's profile.

**Access**: Private (Admin only)

**Headers**:
```
Authorization: Bearer <access_token>
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Profile retrieved successfully",
  "data": {
    "admin": {
      "id": "admin-id",
      "username": "admin",
      "email": "admin@porttivo.com",
      "role": "admin",
      "permissions": {
        "canManageUsers": true,
        "canManageTrips": true,
        "canManageVehicles": true,
        "canManageFuel": true,
        "canManageSettlements": true,
        "canViewReports": true,
        "canManagePumps": true,
        "canManageFraud": true
      },
      "status": "active",
      "lastLogin": "2024-01-15T10:30:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

---

### 2. Update Admin Profile

**PUT** `/api/admins/profile` or `/api/admin/profile`

Update admin profile information.

**Access**: Private (Admin only)

**Request Body**:
```json
{
  "username": "admin_updated",
  "email": "admin.updated@porttivo.com"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "admin": {
      "id": "admin-id",
      "username": "admin_updated",
      "email": "admin.updated@porttivo.com",
      "role": "admin"
    }
  }
}
```

**Error Responses**:
- `400` - Username or email already exists
- `404` - Admin not found

**Business Logic:**
- Username and email must be unique
- Email is automatically converted to lowercase
- Cannot change role or permissions through this endpoint
- Password updates require a separate endpoint (not included in profile update)
- Profile updates are logged for audit purposes

**Frontend Integration Example:**
```javascript
// Update Admin Profile
async function updateAdminProfile(username, email) {
  const token = localStorage.getItem('accessToken');
  
  try {
    const response = await fetch('http://localhost:3000/api/admins/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ username, email }),
    });

    const data = await response.json();
    
    if (data.success) {
      // Update stored admin data
      const admin = JSON.parse(localStorage.getItem('admin'));
      admin.username = data.data.admin.username;
      admin.email = data.data.admin.email;
      localStorage.setItem('admin', JSON.stringify(admin));
      
      // Show success message
      alert('Profile updated successfully');
    } else {
      alert(data.message);
    }
  } catch (error) {
    console.error('Update error:', error);
    alert('Failed to update profile');
  }
}
```

---

## User Management

### Admin Access to User Endpoints

Admins have full access to all user management endpoints with broader permissions:
- Can view all transporters, drivers, pump owners, and pump staff
- Can block/unblock any user
- Can view detailed information for any user
- Can access user-specific data (trips, vehicles, transactions) for any user

### Transporter Management

#### 1. List All Transporters

**GET** `/api/admin/transporters`

**Note:** When accessed by admin, this endpoint returns all transporters. Regular transporters accessing `/api/transporters` only see their own data.

**Access**: Private (Admin only - can access all transporters)

**Query Parameters**:
- `status` (optional) - Filter by status: `active`, `inactive`, `blocked`, `pending`
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)
- `search` (optional) - Search by name, mobile, email, or company

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "transporters": [
      {
        "id": "transporter-id",
        "mobile": "9876543210",
        "name": "John Doe",
        "email": "john@example.com",
        "company": "ABC Transport",
        "status": "active",
        "hasAccess": true,
        "hasPinSet": true,
        "walletBalance": 5000.00,
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "pages": 3
    }
  }
}
```

**Business Logic:**
- Admin can see all transporters across the system
- No filtering by transporterId (unlike transporter's own access)
- Search functionality uses case-insensitive regex matching
- Results are sorted by creation date (newest first)
- Pagination is applied to handle large datasets efficiently

**Frontend Integration Example:**
```javascript
// List Transporters with Search and Filters
async function getTransporters(filters = {}) {
  const token = localStorage.getItem('accessToken');
  const { status, search, page = 1, limit = 20 } = filters;
  
  let queryParams = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  
  if (status) queryParams.append('status', status);
  if (search) queryParams.append('search', search);
  
  try {
    const response = await fetch(
      `http://localhost:3000/api/admin/transporters?${queryParams}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();
    
    if (data.success) {
      return {
        transporters: data.data.transporters,
        pagination: data.data.pagination,
      };
    }
  } catch (error) {
    console.error('Error fetching transporters:', error);
  }
}
```

**Use Case: Admin User Management Dashboard**
```javascript
// React Component Example
function TransportersList() {
  const [transporters, setTransporters] = useState([]);
  const [pagination, setPagination] = useState({});
  const [filters, setFilters] = useState({ status: '', search: '' });
  
  useEffect(() => {
    loadTransporters();
  }, [filters]);
  
  const loadTransporters = async () => {
    const result = await getTransporters(filters);
    setTransporters(result.transporters);
    setPagination(result.pagination);
  };
  
  return (
    <div>
      <input
        placeholder="Search transporters..."
        onChange={(e) => setFilters({...filters, search: e.target.value})}
      />
      <select onChange={(e) => setFilters({...filters, status: e.target.value})}>
        <option value="">All Status</option>
        <option value="active">Active</option>
        <option value="blocked">Blocked</option>
      </select>
      {/* Render transporters list */}
    </div>
  );
}
```

---

#### 2. Get Transporter Details

**GET** `/api/admin/transporters/:id`

**Access**: Private (Admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "transporter": {
      "id": "transporter-id",
      "mobile": "9876543210",
      "name": "John Doe",
      "email": "john@example.com",
      "company": "ABC Transport",
      "status": "active",
      "hasAccess": true,
      "hasPinSet": true,
      "walletBalance": 5000.00,
      "totalVehicles": 15,
      "totalDrivers": 8,
      "totalTrips": 120,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

#### 3. Block/Unblock Transporter

**PUT** `/api/admin/transporters/:id/status`

**Access**: Private (Admin only)

**Request Body**:
```json
{
  "status": "blocked"
}
```

**Valid Status Values**:
- `active` - Active account
- `inactive` - Inactive account
- `blocked` - Blocked account
- `pending` - Pending approval

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Transporter status updated successfully",
  "data": {
    "transporter": {
      "id": "transporter-id",
      "status": "blocked"
    }
  }
}
```

---

### Driver Management

#### 1. List All Drivers

**GET** `/api/admin/drivers`

**Access**: Private (Admin only - can access all drivers)

**Query Parameters**:
- `status` (optional) - Filter by status: `pending`, `active`, `inactive`, `blocked`
- `riskLevel` (optional) - Filter by risk level: `low`, `medium`, `high`
- `transporterId` (optional) - Filter by transporter ID
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "drivers": [
      {
        "id": "driver-id",
        "mobile": "9876543211",
        "name": "Driver Name",
        "transporterId": "transporter-id",
        "transporter": {
          "id": "transporter-id",
          "name": "John Doe",
          "company": "ABC Transport"
        },
        "status": "active",
        "riskLevel": "low",
        "language": "en",
        "walletBalance": 1000.00,
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "pages": 5
    }
  }
}
```

---

#### 2. Get Driver Details

**GET** `/api/admin/drivers/:id`

**Access**: Private (Admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "driver": {
      "id": "driver-id",
      "mobile": "9876543211",
      "name": "Driver Name",
      "transporterId": "transporter-id",
      "transporter": {
        "id": "transporter-id",
        "name": "John Doe",
        "company": "ABC Transport"
      },
      "status": "active",
      "riskLevel": "low",
      "language": "en",
      "walletBalance": 1000.00,
      "totalTrips": 45,
      "activeTrips": 1,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

#### 3. Get Driver Timeline

**GET** `/api/admin/drivers/:id/timeline`

**Access**: Private (Admin only)

**Query Parameters**:
- `startDate` (optional) - Filter from date (ISO format)
- `endDate` (optional) - Filter to date (ISO format)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "timeline": [
      {
        "date": "2024-01-15T10:00:00.000Z",
        "event": "Trip Started",
        "tripId": "TRIP-2024-001",
        "vehicleNumber": "MH12AB1234"
      },
      {
        "date": "2024-01-14T15:30:00.000Z",
        "event": "Trip Completed",
        "tripId": "TRIP-2024-000",
        "vehicleNumber": "MH12AB1234"
      }
    ]
  }
}
```

---

#### 4. Block/Unblock Driver

**PUT** `/api/admin/drivers/:id/status`

**Access**: Private (Admin only)

**Request Body**:
```json
{
  "status": "blocked"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Driver status updated successfully",
  "data": {
    "driver": {
      "id": "driver-id",
      "status": "blocked"
    }
  }
}
```

---

### Pump Owner Management

#### 1. List All Pump Owners

**GET** `/api/admin/pump-owners`

**Access**: Private (Admin only)

**Query Parameters**:
- `status` (optional) - Filter by status: `active`, `inactive`, `blocked`, `pending`
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "pumpOwners": [
      {
        "id": "pump-owner-id",
        "mobile": "9876543210",
        "name": "John Doe",
        "email": "john@example.com",
        "pumpName": "ABC Petrol Pump",
        "status": "active",
        "walletBalance": 0,
        "commissionRate": 2.5,
        "totalFuelValue": 450000.50,
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 25,
      "pages": 2
    }
  }
}
```

---

#### 2. Get Pump Owner Details

**GET** `/api/admin/pump-owners/:id`

**Access**: Private (Admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "pumpOwner": {
      "id": "pump-owner-id",
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
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

#### 3. Block/Unblock Pump Owner

**PUT** `/api/admin/pump-owners/:id/status`

**Access**: Private (Admin only)

**Request Body**:
```json
{
  "status": "blocked"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Pump owner status updated successfully",
  "data": {
    "pumpOwner": {
      "id": "pump-owner-id",
      "status": "blocked"
    }
  }
}
```

---

### Pump Staff Management

#### 1. List All Pump Staff

**GET** `/api/admin/pump-staff`

**Access**: Private (Admin only)

**Query Parameters**:
- `pumpOwnerId` (optional) - Filter by pump owner ID
- `status` (optional) - Filter by status: `active`, `inactive`, `blocked`, `disabled`
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "staff": [
      {
        "id": "staff-id",
        "mobile": "9876543211",
        "name": "Rajesh Kumar",
        "pumpOwnerId": "pump-owner-id",
        "pumpOwner": {
          "id": "pump-owner-id",
          "name": "John Doe",
          "pumpName": "ABC Petrol Pump"
        },
        "status": "active",
        "permissions": {
          "canProcessFuel": true,
          "canViewTransactions": false,
          "canViewSettlements": false,
          "canManageStaff": false
        },
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "pages": 3
    }
  }
}
```

---

#### 2. Get Pump Staff Details

**GET** `/api/admin/pump-staff/:id`

**Access**: Private (Admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "staff": {
      "id": "staff-id",
      "mobile": "9876543211",
      "name": "Rajesh Kumar",
      "pumpOwnerId": "pump-owner-id",
      "pumpOwner": {
        "id": "pump-owner-id",
        "name": "John Doe",
        "pumpName": "ABC Petrol Pump"
      },
      "status": "active",
      "permissions": {
        "canProcessFuel": true,
        "canViewTransactions": false,
        "canViewSettlements": false,
        "canManageStaff": false
      },
      "totalTransactions": 150,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

### Company User Management

#### 1. List All Company Users

**GET** `/api/admin/company-users`

**Access**: Private (Admin only)

**Query Parameters**:
- `transporterId` (optional) - Filter by transporter ID
- `status` (optional) - Filter by status: `active`, `inactive`
- `hasAccess` (optional) - Filter by access: `true`, `false`
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "user-id",
        "name": "John Doe",
        "mobile": "9876543210",
        "email": "john@example.com",
        "transporterId": "transporter-id",
        "transporter": {
          "id": "transporter-id",
          "name": "ABC Transport",
          "company": "ABC Transport Ltd"
        },
        "hasAccess": true,
        "status": "active",
        "permissions": ["viewTrips", "createTrips"],
        "hasPinSet": true,
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 30,
      "pages": 2
    }
  }
}
```

---

#### 2. Get Company User Details

**GET** `/api/admin/company-users/:id`

**Access**: Private (Admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user-id",
      "name": "John Doe",
      "mobile": "9876543210",
      "email": "john@example.com",
      "transporterId": "transporter-id",
      "transporter": {
        "id": "transporter-id",
        "name": "ABC Transport",
        "company": "ABC Transport Ltd"
      },
      "hasAccess": true,
      "status": "active",
      "permissions": ["viewTrips", "createTrips"],
      "hasPinSet": true,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

## Fuel Card Management

### Admin Access to Fuel Card Endpoints

Admins have full access to fuel card management:
- Can view all fuel cards across all transporters
- Can create new fuel cards
- Can view fuel card transaction history
- Can see card assignment status

### 1. List All Fuel Cards

**GET** `/api/fuel-cards`

**Access**: Private (Admin only - can see all cards)

**Query Parameters**:
- `status` (optional) - Filter by status: `active`, `inactive`, `expired`, `blocked`
- `assigned` (optional) - Filter by assignment: `true`, `false`
- `transporterId` (optional) - Filter by transporter ID

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "id": "fuel-card-id",
      "cardNumber": "FC1234567890",
      "transporterId": {
        "id": "transporter-id",
        "name": "ABC Transport",
        "company": "ABC Transport Ltd"
      },
      "driverId": {
        "id": "driver-id",
        "name": "Driver Name",
        "mobile": "9876543211"
      },
      "balance": 50000.00,
      "status": "active",
      "expiryDate": "2025-12-31T00:00:00.000Z",
      "assignedAt": "2024-01-15T10:00:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

**Business Logic:**
- Admins can view all fuel cards in the system
- Cards can be filtered by status, assignment, or transporter
- Card numbers are stored in uppercase
- Balance represents available credit on the card

---

### 2. Create Fuel Card

**POST** `/api/fuel-cards`

**Access**: Private (Admin only)

**Request Body**:
```json
{
  "cardNumber": "FC1234567890",
  "transporterId": "transporter-id",
  "balance": 50000.00,
  "expiryDate": "2025-12-31T00:00:00.000Z"
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "message": "Fuel card created successfully",
  "data": {
    "id": "fuel-card-id",
    "cardNumber": "FC1234567890",
    "transporterId": {
      "id": "transporter-id",
      "name": "ABC Transport",
      "company": "ABC Transport Ltd"
    },
    "balance": 50000.00,
    "status": "active",
    "expiryDate": "2025-12-31T00:00:00.000Z",
    "createdAt": "2024-01-15T10:00:00.000Z"
  }
}
```

**Error Responses**:
- `400` - Card number and transporter ID are required
- `400` - Card number already exists
- `404` - Transporter not found

**Business Logic:**
- Card numbers must be unique
- Card numbers are automatically converted to uppercase
- Default status is "active"
- Balance can be set during creation or updated later

**Frontend Integration Example:**
```javascript
// Create Fuel Card
async function createFuelCard(cardData) {
  const token = localStorage.getItem('accessToken');
  
  try {
    const response = await fetch('http://localhost:3000/api/fuel-cards', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(cardData),
    });

    const data = await response.json();
    
    if (data.success) {
      return data.data;
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('Error creating fuel card:', error);
    throw error;
  }
}
```

---

### 3. Get Fuel Card Details

**GET** `/api/fuel-cards/:id`

**Access**: Private (Admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "fuel-card-id",
    "cardNumber": "FC1234567890",
    "transporterId": {...},
    "driverId": {...},
    "balance": 50000.00,
    "status": "active",
    "expiryDate": "2025-12-31T00:00:00.000Z",
    "assignedAt": "2024-01-15T10:00:00.000Z",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### 4. Get Fuel Card Transaction History

**GET** `/api/fuel-cards/:id/transactions`

**Access**: Private (Admin only)

**Query Parameters**:
- `startDate` (optional) - Filter from date (ISO format)
- `endDate` (optional) - Filter to date (ISO format)
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "id": "transaction-id",
      "transactionId": "FTX-2024-001",
      "amount": 5000.00,
      "status": "completed",
      "pumpOwnerId": {...},
      "driverId": {...},
      "createdAt": "2024-01-15T10:30:00.000Z"
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

**Business Logic:**
- Returns all transactions associated with the fuel card
- Can be filtered by date range
- Supports pagination for large transaction histories
- Includes transaction details with populated pump owner and driver information

---

## Trip Management

### Admin Access to Trip Endpoints

Admins have full access to all trip endpoints:
- Can view all trips across all transporters
- Can view trip details for any trip
- Can cancel any trip
- Can access trip analytics and reports

### 1. List All Trips

**GET** `/api/trips`

**Access**: Private (Admin only - can see all trips)

**Query Parameters**:
- `status` (optional) - Filter by status: `PLANNED`, `ACTIVE`, `COMPLETED`, `POD_PENDING`, `CANCELLED`
- `transporterId` (optional) - Filter by transporter ID
- `vehicleId` (optional) - Filter by vehicle ID
- `driverId` (optional) - Filter by driver ID
- `tripType` (optional) - Filter by trip type: `IMPORT`, `EXPORT`
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)
- `startDate` (optional) - Filter trips from date (ISO format)
- `endDate` (optional) - Filter trips to date (ISO format)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "trips": [
      {
        "tripId": "TRIP-2024-001",
        "id": "trip-id",
        "transporterId": {
          "id": "transporter-id",
          "name": "John Doe",
          "company": "ABC Transport"
        },
        "vehicleId": {
          "id": "vehicle-id",
          "vehicleNumber": "MH12AB1234",
          "trailerType": "20ft"
        },
        "driverId": {
          "id": "driver-id",
          "name": "Driver Name",
          "mobile": "9876543211"
        },
        "containerNumber": "CONTAINER123",
        "reference": "REF-001",
        "pickupLocation": {
          "address": "Port Mumbai",
          "coordinates": {
            "latitude": 19.0760,
            "longitude": 72.8777
          }
        },
        "dropLocation": {
          "address": "Factory Pune",
          "coordinates": {
            "latitude": 18.5204,
            "longitude": 73.8567
          }
        },
        "tripType": "IMPORT",
        "status": "ACTIVE",
        "milestones": [],
        "POD": null,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 500,
      "pages": 25
    }
  }
}
```

**Notes**:
- Admin can see all trips across all transporters
- Can filter by transporterId to see trips for specific transporter
- No automatic filtering by transporterId (unlike transporter's own access)

---

### 2. Get Trip Details

**GET** `/api/trips/:id`

**Access**: Private (Admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "trip": {
      "tripId": "TRIP-2024-001",
      "id": "trip-id",
      "transporterId": {
        "id": "transporter-id",
        "name": "John Doe",
        "company": "ABC Transport"
      },
      "vehicleId": {
        "id": "vehicle-id",
        "vehicleNumber": "MH12AB1234",
        "trailerType": "20ft"
      },
      "driverId": {
        "id": "driver-id",
        "name": "Driver Name",
        "mobile": "9876543211"
      },
      "containerNumber": "CONTAINER123",
      "reference": "REF-001",
      "pickupLocation": {...},
      "dropLocation": {...},
      "tripType": "IMPORT",
      "status": "ACTIVE",
      "milestones": [...],
      "POD": {...},
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

### 3. Cancel Any Trip

**PUT** `/api/trips/:id/cancel`

**Access**: Private (Admin only)

**Request Body** (optional):
```json
{
  "reason": "Admin cancellation reason"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Trip cancelled successfully",
  "data": {
    "trip": {
      "tripId": "TRIP-2024-001",
      "status": "CANCELLED"
    }
  }
}
```

**Business Logic:**
- Admin can cancel any trip regardless of status
- Unlike transporters, admin can cancel ACTIVE trips if needed
- Reason is optional but recommended for audit trail
- Cancellation updates trip status to "CANCELLED"
- Driver and transporter are notified of cancellation

**Frontend Integration Example:**
```javascript
// Cancel Trip
async function cancelTrip(tripId, reason) {
  const token = localStorage.getItem('accessToken');
  
  try {
    const response = await fetch(
      `http://localhost:3000/api/trips/${tripId}/cancel`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ reason }),
      }
    );

    const data = await response.json();
    
    if (data.success) {
      alert('Trip cancelled successfully');
      // Refresh trips list
      loadTrips();
    } else {
      alert(data.message);
    }
  } catch (error) {
    console.error('Error cancelling trip:', error);
  }
}
```

---

### 4. Get Active Trips

**GET** `/api/trips/active`

**Access**: Private (Admin only)

**Query Parameters**:
- `transporterId` (optional) - Filter by transporter ID

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "trips": [
      {
        "tripId": "TRIP-2024-001",
        "id": "trip-id",
        "status": "ACTIVE",
        "containerNumber": "CONTAINER123",
        "transporterId": {...},
        "vehicleId": {...},
        "driverId": {...}
      }
    ],
    "count": 25
  }
}
```

---

### 5. Search Trips

**GET** `/api/trips/search`

**Access**: Private (Admin only)

**Query Parameters**:
- `q` (required) - Search query (container number or reference)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "trips": [
      {
        "tripId": "TRIP-2024-001",
        "containerNumber": "CONTAINER123",
        "reference": "REF-001",
        "status": "ACTIVE",
        "transporterId": {...}
      }
    ],
    "count": 5
  }
}
```

**Notes**:
- Admin can search across all trips in the system
- Returns trips from all transporters matching the search query

---

### 6. Get Pending POD Trips

**GET** `/api/trips/pending-pod`

**Access**: Private (Admin only)

**Query Parameters**:
- `transporterId` (optional) - Filter by transporter ID
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "trips": [
      {
        "tripId": "TRIP-2024-001",
        "id": "trip-id",
        "containerNumber": "CONTAINER123",
        "reference": "REF-001",
        "status": "POD_PENDING",
        "transporterId": {
          "id": "transporter-id",
          "name": "John Doe",
          "company": "ABC Transport"
        },
        "vehicleId": {
          "id": "vehicle-id",
          "vehicleNumber": "MH12AB1234"
        },
        "driverId": {
          "id": "driver-id",
          "name": "Driver Name"
        },
        "completedAt": "2024-01-15T10:00:00.000Z",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "count": 50
  }
}
```

**Business Logic:**
- Returns trips that are completed but waiting for POD (Proof of Delivery) upload
- Status must be `POD_PENDING`
- Admin can see all pending POD trips across all transporters
- Useful for tracking trips that need POD approval
- Can filter by transporter to see specific transporter's pending POD trips

**Frontend Integration Example:**
```javascript
// Get Pending POD Trips
async function getPendingPODTrips(transporterId = null) {
  const token = localStorage.getItem('accessToken');
  
  let queryParams = new URLSearchParams();
  if (transporterId) queryParams.append('transporterId', transporterId);
  
  try {
    const response = await fetch(
      `http://localhost:3000/api/trips/pending-pod?${queryParams}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();
    
    if (data.success) {
      return data.data.trips;
    }
  } catch (error) {
    console.error('Error fetching pending POD trips:', error);
  }
}
```

---

### 7. Get Trips by Status

**GET** `/api/trips/status/:status`

**Access**: Private (Admin only)

**URL Parameters**:
- `status` (required) - Trip status: `PLANNED`, `ACTIVE`, `COMPLETED`, `POD_PENDING`, `CANCELLED`

**Query Parameters**:
- `transporterId` (optional) - Filter by transporter ID
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)
- `startDate` (optional) - Filter trips from date (ISO format)
- `endDate` (optional) - Filter trips to date (ISO format)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "trips": [
      {
        "tripId": "TRIP-2024-001",
        "id": "trip-id",
        "containerNumber": "CONTAINER123",
        "reference": "REF-001",
        "status": "COMPLETED",
        "transporterId": {...},
        "vehicleId": {...},
        "driverId": {...},
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-15T10:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 200,
      "pages": 10
    }
  }
}
```

**Business Logic:**
- Returns all trips with the specified status
- Admin can filter by transporter and date range
- Useful for generating status-specific reports
- Supports pagination for large result sets

**Valid Status Values:**
- `PLANNED` - Trip is planned but not started
- `ACTIVE` - Trip is currently in progress
- `COMPLETED` - Trip is completed
- `POD_PENDING` - Trip completed, waiting for POD upload
- `CANCELLED` - Trip was cancelled

**Frontend Integration Example:**
```javascript
// Get Trips by Status
async function getTripsByStatus(status, filters = {}) {
  const token = localStorage.getItem('accessToken');
  const { transporterId, startDate, endDate, page = 1, limit = 20 } = filters;
  
  let queryParams = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  
  if (transporterId) queryParams.append('transporterId', transporterId);
  if (startDate) queryParams.append('startDate', startDate);
  if (endDate) queryParams.append('endDate', endDate);
  
  try {
    const response = await fetch(
      `http://localhost:3000/api/trips/status/${status}?${queryParams}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();
    
    if (data.success) {
      return {
        trips: data.data.trips,
        pagination: data.data.pagination,
      };
    }
  } catch (error) {
    console.error('Error fetching trips by status:', error);
  }
}
```

---

## Vehicle Management

### Admin Access to Vehicle Endpoints

Admins have full access to all vehicle endpoints:
- Can view all vehicles across all transporters
- Can view vehicle details for any vehicle
- Can access vehicle documents
- Can view expiring documents

### 1. List All Vehicles

**GET** `/api/vehicles`

**Access**: Private (Admin only - can see all vehicles)

**Query Parameters**:
- `status` (optional) - Filter by status: `active`, `inactive`
- `ownerType` (optional) - Filter by owner type: `OWN`, `HIRED`
- `transporterId` (optional) - Filter by transporter ID
- `driverId` (optional) - Filter by assigned driver ID
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "vehicles": [
      {
        "id": "vehicle-id",
        "vehicleNumber": "MH12AB1234",
        "transporterId": {
          "id": "transporter-id",
          "name": "John Doe",
          "company": "ABC Transport"
        },
        "ownerType": "OWN",
        "driverId": {
          "id": "driver-id",
          "name": "Driver Name",
          "mobile": "9876543211"
        },
        "status": "active",
        "trailerType": "20ft",
        "documents": {...},
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 200,
      "pages": 10
    }
  }
}
```

---

### 2. Get Vehicle Details

**GET** `/api/vehicles/:id`

**Access**: Private (Admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "vehicle": {
      "id": "vehicle-id",
      "vehicleNumber": "MH12AB1234",
      "transporterId": {
        "id": "transporter-id",
        "name": "John Doe",
        "company": "ABC Transport"
      },
      "ownerType": "OWN",
      "driverId": {...},
      "status": "active",
      "trailerType": "20ft",
      "documents": {...},
      "totalTrips": 45,
      "activeTrip": null,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

### 3. Get Vehicle Trip History

**GET** `/api/vehicles/:id/trips`

**Access**: Private (Admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "trips": [
      {
        "tripId": "TRIP-2024-001",
        "id": "trip-id",
        "containerNumber": "CONTAINER123",
        "status": "COMPLETED",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "count": 45
  }
}
```

---

### 4. Get Expiring Documents

**GET** `/api/vehicles/documents/expiring`

**Access**: Private (Admin only)

**Query Parameters**:
- `days` (optional) - Number of days ahead to check (default: 30)
- `documentType` (optional) - Filter by document type: `rc`, `insurance`, `fitness`, `permit`

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "expiringDocuments": [
      {
        "vehicleId": "vehicle-id",
        "vehicleNumber": "MH12AB1234",
        "transporterId": {
          "id": "transporter-id",
          "name": "John Doe",
          "company": "ABC Transport"
        },
        "documentType": "rc",
        "expiryDate": "2024-02-15T00:00:00.000Z",
        "daysUntilExpiry": 15
      }
    ],
    "count": 10
  }
}
```

**Business Logic:**
- Returns vehicles with documents expiring within specified days
- Helps admin track and notify transporters about expiring documents
- Document types: RC (Registration Certificate), Insurance, Fitness, Permit
- Expiry dates are compared against current date plus specified days
- Results are sorted by days until expiry (most urgent first)

**Frontend Integration Example:**
```javascript
// Get Expiring Documents
async function getExpiringDocuments(days = 30, documentType = null) {
  const token = localStorage.getItem('accessToken');
  
  let queryParams = new URLSearchParams({ days: days.toString() });
  if (documentType) queryParams.append('documentType', documentType);
  
  try {
    const response = await fetch(
      `http://localhost:3000/api/vehicles/documents/expiring?${queryParams}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();
    
    if (data.success) {
      return data.data.expiringDocuments;
    }
  } catch (error) {
    console.error('Error fetching expiring documents:', error);
  }
}

// Use Case: Alert Dashboard
function ExpiringDocumentsAlert() {
  const [documents, setDocuments] = useState([]);
  
  useEffect(() => {
    loadExpiringDocuments();
  }, []);
  
  const loadExpiringDocuments = async () => {
    const docs = await getExpiringDocuments(30);
    setDocuments(docs);
  };
  
  return (
    <div>
      <h3>Documents Expiring Soon ({documents.length})</h3>
      {documents.map(doc => (
        <div key={doc.vehicleId}>
          <p>{doc.vehicleNumber} - {doc.documentType} expires in {doc.daysUntilExpiry} days</p>
        </div>
      ))}
    </div>
  );
}
```

---

## Fuel Management

### Admin Access to Fuel Transaction Endpoints

Admins have full access to all fuel transaction endpoints:
- Can view all fuel transactions across all transporters
- Can view transaction details
- Can access fraud detection and management endpoints

### 1. List All Fuel Transactions

**GET** `/api/fuel/transactions`

**Access**: Private (Admin only - can see all transactions)

**Query Parameters**:
- `status` (optional) - Filter by status: `pending`, `confirmed`, `completed`, `cancelled`, `flagged`
- `transporterId` (optional) - Filter by transporter ID
- `driverId` (optional) - Filter by driver ID
- `pumpOwnerId` (optional) - Filter by pump owner ID
- `fuelCardId` (optional) - Filter by fuel card ID
- `startDate` (optional) - Filter from date (ISO format)
- `endDate` (optional) - Filter to date (ISO format)
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "id": "transaction-id",
        "transactionId": "FTX-2024-001",
        "pumpOwnerId": {
          "id": "pump-owner-id",
          "name": "John Doe",
          "pumpName": "ABC Petrol Pump"
        },
        "pumpStaffId": {
          "id": "staff-id",
          "name": "Rajesh Kumar"
        },
        "vehicleNumber": "MH12AB1234",
        "driverId": {
          "id": "driver-id",
          "name": "Driver Name",
          "mobile": "9876543211"
        },
        "transporterId": {
          "id": "transporter-id",
          "name": "ABC Transport"
        },
        "fuelCardId": {
          "id": "fuel-card-id",
          "cardNumber": "FC1234567890"
        },
        "amount": 5000.00,
        "status": "completed",
        "location": {
          "latitude": 19.0760,
          "longitude": 72.8777,
          "address": "Mumbai, Maharashtra"
        },
        "createdAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1000,
      "pages": 50
    }
  }
}
```

---

### 2. Get Fuel Transaction Details

**GET** `/api/fuel/transactions/:id`

**Access**: Private (Admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "transaction": {
      "id": "transaction-id",
      "transactionId": "FTX-2024-001",
      "pumpOwnerId": {...},
      "pumpStaffId": {...},
      "vehicleNumber": "MH12AB1234",
      "driverId": {...},
      "transporterId": {...},
      "fuelCardId": {...},
      "amount": 5000.00,
      "status": "completed",
      "location": {...},
      "receipt": {
        "photo": "/uploads/receipts/receipt_transaction-id.jpg",
        "uploadedAt": "2024-01-15T10:35:00.000Z"
      },
      "fraudFlags": {
        "duplicateReceipt": false,
        "gpsMismatch": false,
        "expressUploads": false,
        "unusualPattern": false,
        "resolved": true
      },
      "createdAt": "2024-01-15T10:30:00.000Z",
      "completedAt": "2024-01-15T10:35:00.000Z"
    }
  }
}
```

**Business Logic:**
- Returns complete transaction details including all populated relationships
- Includes fraud flags if transaction was flagged
- Receipt information is included if uploaded
- Admin can view any transaction regardless of transporter

---

### 3. Get Fuel Receipt

**GET** `/api/fuel/receipt/:id`

**Access**: Private (Admin only)

**URL Parameters**:
- `id` (required) - Transaction ID

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "receipt": {
      "transactionId": "FTX-2024-001",
      "photo": "/uploads/receipts/receipt_transaction-id.jpg",
      "photoUrl": "https://api.porttivo.com/uploads/receipts/receipt_transaction-id.jpg",
      "uploadedAt": "2024-01-15T10:35:00.000Z",
      "transaction": {
        "id": "transaction-id",
        "amount": 5000.00,
        "pumpOwnerId": {...},
        "driverId": {...},
        "vehicleNumber": "MH12AB1234"
      }
    }
  }
}
```

**Error Responses**:
- `404` - Transaction not found or receipt not uploaded

**Business Logic:**
- Returns receipt photo URL and metadata
- Admin can access any receipt for verification purposes
- Useful for fraud investigation and settlement verification
- Photo URL is a direct link to the uploaded receipt image

**Frontend Integration Example:**
```javascript
// Get Fuel Receipt
async function getFuelReceipt(transactionId) {
  const token = localStorage.getItem('accessToken');
  
  try {
    const response = await fetch(
      `http://localhost:3000/api/fuel/receipt/${transactionId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();
    
    if (data.success) {
      return data.data.receipt;
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('Error fetching receipt:', error);
    throw error;
  }
}

// Use Case: Display Receipt in Modal
function ReceiptViewer({ transactionId }) {
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    loadReceipt();
  }, [transactionId]);
  
  const loadReceipt = async () => {
    try {
      const receiptData = await getFuelReceipt(transactionId);
      setReceipt(receiptData);
    } catch (error) {
      alert('Failed to load receipt');
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) return <div>Loading receipt...</div>;
  if (!receipt) return <div>Receipt not found</div>;
  
  return (
    <div>
      <img src={receipt.photoUrl} alt="Fuel Receipt" />
      <p>Uploaded: {new Date(receipt.uploadedAt).toLocaleString()}</p>
      <p>Amount: ₹{receipt.transaction.amount}</p>
    </div>
  );
}
```

---

## Settlement Management

### Admin-Only Settlement Endpoints

Admins have exclusive access to settlement calculation and processing endpoints.

### 1. Calculate Settlement

**POST** `/api/settlements/calculate`

**Access**: Private (Admin only)

**Request Body**:
```json
{
  "pumpOwnerId": "pump-owner-id",
  "startDate": "2024-01-01T00:00:00.000Z",
  "endDate": "2024-01-31T23:59:59.999Z",
  "period": "January 2024"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Settlement calculated successfully",
  "data": {
    "calculation": {
      "pumpOwnerId": "pump-owner-id",
      "period": "January 2024",
      "startDate": "2024-01-01T00:00:00.000Z",
      "endDate": "2024-01-31T23:59:59.999Z",
      "transactionCount": 150,
      "fuelValue": 450000.50,
      "commissionRate": 2.5,
      "commission": 11250.01,
      "netPayable": 438750.49
    }
  }
}
```

**Business Logic:**
- Calculates settlement based on completed fuel transactions in the period
- Uses pump owner's commission rate
- Only includes transactions with status "completed"
- Commission is calculated as: `(fuelValue * commissionRate) / 100`
- Net payable is calculated as: `fuelValue - commission`
- Period should typically be monthly (e.g., "January 2024")

**Settlement Calculation Flow:**
1. Admin selects pump owner and date range
2. System fetches all completed transactions in the period
3. Calculates total fuel value (sum of transaction amounts)
4. Applies pump owner's commission rate
5. Calculates net payable amount
6. Returns calculation summary (does not create settlement record)

**Frontend Integration Example:**
```javascript
// Calculate Settlement
async function calculateSettlement(pumpOwnerId, startDate, endDate, period) {
  const token = localStorage.getItem('accessToken');
  
  try {
    const response = await fetch('http://localhost:3000/api/settlements/calculate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        pumpOwnerId,
        startDate,
        endDate,
        period,
      }),
    });

    const data = await response.json();
    
    if (data.success) {
      return data.data.calculation;
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('Error calculating settlement:', error);
    throw error;
  }
}

// Use Case: Settlement Processing Form
function SettlementCalculator() {
  const [calculation, setCalculation] = useState(null);
  
  const handleCalculate = async () => {
    const result = await calculateSettlement(
      selectedPumpOwnerId,
      startDate,
      endDate,
      period
    );
    setCalculation(result);
  };
  
  return (
    <div>
      {/* Form inputs */}
      <button onClick={handleCalculate}>Calculate</button>
      {calculation && (
        <div>
          <p>Fuel Value: ₹{calculation.fuelValue}</p>
          <p>Commission ({calculation.commissionRate}%): ₹{calculation.commission}</p>
          <p>Net Payable: ₹{calculation.netPayable}</p>
        </div>
      )}
    </div>
  );
}
```

---

### 2. Process Settlement

**PUT** `/api/settlements/:id/process`

**Access**: Private (Admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Settlement processing initiated",
  "data": {
    "settlement": {
      "id": "settlement-id",
      "status": "PROCESSING",
      "processedAt": "2024-02-01T10:00:00.000Z",
      "processedBy": {
        "id": "admin-id",
        "username": "admin",
        "email": "admin@porttivo.com"
      }
    }
  }
}
```

**Error Responses**:
- `400` - Settlement is already PROCESSING or COMPLETED
- `404` - Settlement not found

**Business Logic:**
- Changes settlement status from PENDING to PROCESSING
- Records admin who processed it
- Must be in PENDING status to process
- Updates `processedAt` timestamp
- Stores admin ID in `processedBy` field for audit trail

**Settlement Status Flow:**
```
PENDING → PROCESSING → COMPLETED
           ↓
        FAILED/CANCELLED
```

**Frontend Integration Example:**
```javascript
// Process Settlement
async function processSettlement(settlementId) {
  const token = localStorage.getItem('accessToken');
  
  try {
    const response = await fetch(
      `http://localhost:3000/api/settlements/${settlementId}/process`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();
    
    if (data.success) {
      alert('Settlement processing initiated');
      // Refresh settlements list
      loadSettlements();
    } else {
      alert(data.message);
    }
  } catch (error) {
    console.error('Error processing settlement:', error);
  }
}
```

---

### 3. Complete Settlement

**PUT** `/api/settlements/:id/complete`

**Access**: Private (Admin only)

**Request Body**:
```json
{
  "utr": "UTR123456789",
  "notes": "Settlement processed successfully"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Settlement completed successfully",
  "data": {
    "settlement": {
      "id": "settlement-id",
      "status": "COMPLETED",
      "utr": "UTR123456789",
      "completedAt": "2024-02-01T12:00:00.000Z"
    }
  }
}
```

**Error Responses**:
- `400` - UTR is required
- `400` - Settlement must be in PROCESSING status
- `404` - Settlement not found

**Business Logic:**
- Changes settlement status from PROCESSING to COMPLETED
- UTR (Unique Transaction Reference) is required
- UTR is automatically converted to uppercase
- Updates `completedAt` timestamp
- Notes field can include additional information about the settlement

**Frontend Integration Example:**
```javascript
// Complete Settlement
async function completeSettlement(settlementId, utr, notes) {
  const token = localStorage.getItem('accessToken');
  
  try {
    const response = await fetch(
      `http://localhost:3000/api/settlements/${settlementId}/complete`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ utr, notes }),
      }
    );

    const data = await response.json();
    
    if (data.success) {
      alert('Settlement completed successfully');
      loadSettlements();
    } else {
      alert(data.message);
    }
  } catch (error) {
    console.error('Error completing settlement:', error);
  }
}
```

---

### 4. List All Settlements

**GET** `/api/settlements`

**Access**: Private (Admin only - can see all settlements)

**Query Parameters**:
- `status` (optional) - Filter by status: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED`
- `pumpOwnerId` (optional) - Filter by pump owner ID
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "settlements": [
      {
        "id": "settlement-id",
        "pumpOwner": {
          "id": "pump-owner-id",
          "name": "John Doe",
          "pumpName": "ABC Petrol Pump"
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
      "total": 50,
      "pages": 3
    }
  }
}
```

---

### 5. Get Settlement Details

**GET** `/api/settlements/:id`

**Access**: Private (Admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "settlement": {
      "id": "settlement-id",
      "pumpOwner": {...},
      "period": "January 2024",
      "startDate": "2024-01-01T00:00:00.000Z",
      "endDate": "2024-01-31T23:59:59.999Z",
      "fuelValue": 450000.50,
      "commission": 11250.01,
      "commissionRate": 2.5,
      "netPayable": 438750.49,
      "status": "COMPLETED",
      "utr": "UTR123456789",
      "transactions": [...],
      "transactionCount": 150,
      "processedAt": "2024-02-01T10:00:00.000Z",
      "processedBy": {
        "id": "admin-id",
        "username": "admin",
        "email": "admin@porttivo.com"
      },
      "completedAt": "2024-02-01T12:00:00.000Z",
      "notes": "Settlement processed successfully",
      "createdAt": "2024-02-01T09:00:00.000Z"
    }
  }
}
```

---

### 6. Get Pending Settlements

**GET** `/api/settlements/pending`

**Access**: Private (Admin only - can see all pending settlements)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "settlements": [
      {
        "id": "settlement-id",
        "pumpOwner": {...},
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

## Fraud Detection & Management

### Admin-Only Fraud Endpoints

Admins have exclusive access to fraud detection and management endpoints.

### 1. Get Fraud Alerts

**GET** `/api/fuel/fraud-alerts`

**Access**: Private (Admin only)

**Query Parameters**:
- `resolved` (optional) - Filter by resolved status: `true`, `false`
- `fraudType` (optional) - Filter by fraud type: `duplicateReceipt`, `gpsMismatch`, `expressUploads`, `unusualPattern`
- `startDate` (optional) - Filter from date (ISO format)
- `endDate` (optional) - Filter to date (ISO format)
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "alerts": [
      {
        "id": "transaction-id",
        "transactionId": "FTX-2024-001",
        "pumpOwnerId": {...},
        "driverId": {...},
        "fuelCardId": {...},
        "amount": 5000.00,
        "status": "flagged",
        "fraudFlags": {
          "duplicateReceipt": true,
          "gpsMismatch": false,
          "expressUploads": true,
          "unusualPattern": false,
          "flaggedBy": "admin-id",
          "flaggedAt": "2024-01-15T11:00:00.000Z",
          "resolved": false
        },
        "createdAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 25,
      "pages": 2
    }
  }
}
```

**Business Logic:**
- Returns transactions with fraud flags
- Can filter by resolved status and fraud type
- Includes populated driver, pump owner, and fuel card information
- Fraud types: duplicateReceipt, gpsMismatch, expressUploads, unusualPattern
- Unresolved alerts are prioritized for admin review

**Fraud Detection Rules:**
- **duplicateReceipt**: Same receipt photo used in multiple transactions
- **gpsMismatch**: Transaction location doesn't match pump location
- **expressUploads**: Receipt uploaded too quickly after transaction
- **unusualPattern**: Unusual spending pattern detected

**Frontend Integration Example:**
```javascript
// Get Fraud Alerts
async function getFraudAlerts(filters = {}) {
  const token = localStorage.getItem('accessToken');
  
  const { resolved, fraudType, startDate, endDate, page = 1, limit = 20 } = filters;
  
  let queryParams = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  
  if (resolved !== undefined) queryParams.append('resolved', resolved);
  if (fraudType) queryParams.append('fraudType', fraudType);
  if (startDate) queryParams.append('startDate', startDate);
  if (endDate) queryParams.append('endDate', endDate);
  
  try {
    const response = await fetch(
      `http://localhost:3000/api/fuel/fraud-alerts?${queryParams}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();
    
    if (data.success) {
      return {
        alerts: data.data.alerts,
        pagination: data.data.pagination,
      };
    }
  } catch (error) {
    console.error('Error fetching fraud alerts:', error);
  }
}
```

---

### 2. Get Fraud Alert Details

**GET** `/api/fuel/fraud-alerts/:id`

**Access**: Private (Admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "transaction": {
      "id": "transaction-id",
      "transactionId": "FTX-2024-001",
      "pumpOwnerId": {...},
      "pumpStaffId": {...},
      "driverId": {...},
      "transporterId": {...},
      "fuelCardId": {...},
      "amount": 5000.00,
      "status": "flagged",
      "location": {...},
      "receipt": {...},
      "fraudFlags": {
        "duplicateReceipt": true,
        "gpsMismatch": false,
        "gpsMismatchDistance": null,
        "expressUploads": true,
        "unusualPattern": false,
        "flaggedBy": "admin-id",
        "flaggedAt": "2024-01-15T11:00:00.000Z",
        "resolved": false,
        "resolvedAt": null,
        "resolvedBy": null
      },
      "notes": "Manual flag by admin",
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

**Error Responses**:
- `400` - Transaction does not have fraud flags
- `404` - Transaction not found

---

### 3. Flag Transaction as Fraud

**POST** `/api/fuel/transactions/:id/flag`

**Access**: Private (Admin only)

**Request Body**:
```json
{
  "fraudType": "duplicateReceipt",
  "reason": "Duplicate receipt detected"
}
```

**Fraud Types**:
- `duplicateReceipt` - Duplicate receipt photo detected
- `gpsMismatch` - GPS location mismatch
- `expressUploads` - Receipt uploaded too quickly
- `unusualPattern` - Unusual transaction pattern

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Transaction flagged as fraud",
  "data": {
    "transaction": {
      "id": "transaction-id",
      "status": "flagged",
      "fraudFlags": {
        "duplicateReceipt": true,
        "flaggedBy": "admin-id",
        "flaggedAt": "2024-01-15T11:00:00.000Z",
        "resolved": false
      },
      "notes": "Duplicate receipt detected"
    }
  }
}
```

**Notes**:
- Can flag specific fraud type or all types
- Records admin who flagged it
- Updates transaction status to "flagged"

---

### 4. Resolve Fraud Alert

**PUT** `/api/fuel/fraud-alerts/:id/resolve`

**Access**: Private (Admin only)

**Request Body**:
```json
{
  "isFraud": false,
  "resolution": "Transaction verified as legitimate"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Fraud alert resolved",
  "data": {
    "transaction": {
      "id": "transaction-id",
      "status": "completed",
      "fraudFlags": {
        "resolved": true,
        "resolvedAt": "2024-01-15T12:00:00.000Z",
        "resolvedBy": "admin-id",
        "duplicateReceipt": false,
        "gpsMismatch": false,
        "expressUploads": false,
        "unusualPattern": false
      },
      "notes": "Transaction verified as legitimate\nResolution: Transaction verified as legitimate"
    }
  }
}
```

**Business Logic:**
- If `isFraud` is false, clears all fraud flags and updates status to "completed"
- If `isFraud` is true, keeps flags but marks as resolved
- Records admin who resolved it
- Updates transaction status accordingly
- Resolution notes are appended to transaction notes

**Frontend Integration Example:**
```javascript
// Resolve Fraud Alert
async function resolveFraudAlert(transactionId, isFraud, resolution) {
  const token = localStorage.getItem('accessToken');
  
  try {
    const response = await fetch(
      `http://localhost:3000/api/fuel/fraud-alerts/${transactionId}/resolve`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ isFraud, resolution }),
      }
    );

    const data = await response.json();
    
    if (data.success) {
      alert('Fraud alert resolved');
      // Refresh fraud alerts list
      loadFraudAlerts();
    } else {
      alert(data.message);
    }
  } catch (error) {
    console.error('Error resolving fraud alert:', error);
  }
}
```

---

### 5. Get Fraud Statistics

**GET** `/api/fuel/fraud-stats`

**Access**: Private (Admin only)

**Query Parameters**:
- `startDate` (optional) - Filter from date (ISO format)
- `endDate` (optional) - Filter to date (ISO format)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "stats": {
      "totalFlagged": 25,
      "resolved": 20,
      "pending": 5,
      "byType": {
        "duplicateReceipt": 10,
        "gpsMismatch": 8,
        "expressUploads": 5,
        "unusualPattern": 2
      },
      "totalAmount": 125000.00,
      "averageAmount": 5000.00,
      "period": {
        "startDate": "2024-01-01T00:00:00.000Z",
        "endDate": "2024-01-31T23:59:59.999Z"
      }
    }
  }
}
```

**Notes**:
- Provides comprehensive fraud statistics
- Includes breakdown by fraud type
- Shows resolved vs pending alerts

---

## Notification Management

### Admin-Only Notification Endpoints

Admins can send notifications to any user in the system.

### 1. Send Notification

**POST** `/api/notifications/send`

**Access**: Private (Admin only)

**Request Body**:
```json
{
  "userId": "user-id",
  "userType": "TRANSPORTER",
  "type": "SETTLEMENT_COMPLETED",
  "title": "Settlement Completed",
  "message": "Your settlement for January 2024 has been processed.",
  "data": {
    "settlementId": "settlement-id",
    "amount": 438750.49
  },
  "priority": "high"
}
```

**User Types:**
- `TRANSPORTER` - Send to transporter
- `DRIVER` - Send to driver
- `PUMP_OWNER` - Send to pump owner
- `PUMP_STAFF` - Send to pump staff
- `COMPANY_USER` - Send to company user

**Notification Types:**
- `SETTLEMENT_COMPLETED` - Settlement processing completed
- `TRIP_CANCELLED` - Trip cancelled
- `DOCUMENT_EXPIRING` - Document expiring soon
- `FRAUD_ALERT` - Fraud alert
- `SYSTEM_UPDATE` - System update
- `GENERAL` - General notification

**Priority Levels:**
- `low` - Low priority
- `medium` - Medium priority (default)
- `high` - High priority
- `urgent` - Urgent priority

**Response** (201 Created):
```json
{
  "success": true,
  "message": "Notification sent successfully",
  "data": {
    "notification": {
      "id": "notification-id",
      "type": "SETTLEMENT_COMPLETED",
      "title": "Settlement Completed",
      "message": "Your settlement for January 2024 has been processed.",
      "createdAt": "2024-02-01T12:00:00.000Z"
    }
  }
}
```

**Error Responses:**
- `400` - userId, userType, type, title, and message are required
- `404` - User not found

**Business Logic:**
- Notifications are stored in the database
- Can include additional data payload for app-specific handling
- Priority affects notification display order
- Notifications can trigger push notifications if user has app installed

**Frontend Integration Example:**
```javascript
// Send Notification
async function sendNotification(notificationData) {
  const token = localStorage.getItem('accessToken');
  
  try {
    const response = await fetch('http://localhost:3000/api/notifications/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(notificationData),
    });

    const data = await response.json();
    
    if (data.success) {
      alert('Notification sent successfully');
      return data.data.notification;
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('Error sending notification:', error);
    throw error;
  }
}

// Use Case: Notify Transporter about Settlement
async function notifySettlementComplete(transporterId, settlementId, amount) {
  await sendNotification({
    userId: transporterId,
    userType: 'TRANSPORTER',
    type: 'SETTLEMENT_COMPLETED',
    title: 'Settlement Completed',
    message: `Your settlement of ₹${amount} has been processed successfully.`,
    data: {
      settlementId,
      amount,
    },
    priority: 'high',
  });
}
```

---

## Dashboard & Analytics

### Admin Dashboard Statistics

Admins can access system-wide analytics and dashboard statistics.

### 1. Get Dashboard Statistics

**GET** `/api/admin/dashboard/stats`

**Access**: Private (Admin only)

**Query Parameters**:
- `startDate` (optional) - Filter from date (ISO format)
- `endDate` (optional) - Filter to date (ISO format)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "dashboard": {
      "totalTransporters": 50,
      "activeTransporters": 45,
      "totalDrivers": 200,
      "activeDrivers": 180,
      "totalVehicles": 300,
      "activeVehicles": 280,
      "totalTrips": 5000,
      "activeTrips": 25,
      "completedTrips": 4800,
      "pendingPODTrips": 50,
      "totalFuelTransactions": 10000,
      "totalFuelValue": 50000000.00,
      "todayFuelValue": 500000.00,
      "totalPumpOwners": 25,
      "activePumpOwners": 20,
      "pendingSettlements": 5,
      "totalSettlements": 100,
      "fraudAlerts": 25,
      "pendingFraudAlerts": 5,
      "expiringDocuments": 10,
      "period": {
        "startDate": "2024-01-01T00:00:00.000Z",
        "endDate": "2024-01-31T23:59:59.999Z"
      }
    }
  }
}
```

**Business Logic:**
- Provides comprehensive system-wide statistics
- Can filter by date range
- Includes counts for all major entities
- Statistics are calculated in real-time (not cached)
- Date filtering applies to creation dates of entities

**Frontend Integration Example:**
```javascript
// Get Dashboard Stats
async function getDashboardStats(startDate = null, endDate = null) {
  const token = localStorage.getItem('accessToken');
  
  let queryParams = new URLSearchParams();
  if (startDate) queryParams.append('startDate', startDate);
  if (endDate) queryParams.append('endDate', endDate);
  
  try {
    const response = await fetch(
      `http://localhost:3000/api/admin/dashboard/stats?${queryParams}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();
    
    if (data.success) {
      return data.data.dashboard;
    }
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
  }
}

// Use Case: Dashboard Component
function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [dateRange, setDateRange] = useState({ start: null, end: null });
  
  useEffect(() => {
    loadDashboardStats();
  }, [dateRange]);
  
  const loadDashboardStats = async () => {
    const dashboardStats = await getDashboardStats(
      dateRange.start,
      dateRange.end
    );
    setStats(dashboardStats);
  };
  
  if (!stats) return <div>Loading...</div>;
  
  return (
    <div>
      <h1>Admin Dashboard</h1>
      <div className="stats-grid">
        <StatCard title="Total Transporters" value={stats.totalTransporters} />
        <StatCard title="Active Drivers" value={stats.activeDrivers} />
        <StatCard title="Active Trips" value={stats.activeTrips} />
        <StatCard title="Total Fuel Value" value={`₹${stats.totalFuelValue}`} />
        <StatCard title="Pending Settlements" value={stats.pendingSettlements} />
        <StatCard title="Fraud Alerts" value={stats.fraudAlerts} />
      </div>
    </div>
  );
}
```

---

### 2. Get System Analytics

**GET** `/api/admin/analytics`

**Access**: Private (Admin only)

**Query Parameters**:
- `type` (optional) - Analytics type: `trips`, `fuel`, `users`, `vehicles`
- `startDate` (optional) - Filter from date (ISO format)
- `endDate` (optional) - Filter to date (ISO format)
- `groupBy` (optional) - Group by: `day`, `week`, `month`

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "analytics": {
      "type": "trips",
      "groupBy": "day",
      "data": [
        {
          "date": "2024-01-01",
          "count": 150,
          "completed": 140,
          "active": 5,
          "cancelled": 5
        },
        {
          "date": "2024-01-02",
          "count": 160,
          "completed": 155,
          "active": 3,
          "cancelled": 2
        }
      ],
      "summary": {
        "total": 5000,
        "average": 161.29,
        "peak": 200
      }
    }
  }
}
```

**Business Logic:**
- Analytics can be grouped by day, week, or month
- Supports multiple analytics types: trips, fuel, users, vehicles
- Date filtering applies to creation dates
- Summary statistics include totals, averages, and peaks

**Frontend Integration Example:**
```javascript
// Get System Analytics
async function getSystemAnalytics(type = 'trips', groupBy = 'day', startDate = null, endDate = null) {
  const token = localStorage.getItem('accessToken');
  
  let queryParams = new URLSearchParams({
    type,
    groupBy,
  });
  
  if (startDate) queryParams.append('startDate', startDate);
  if (endDate) queryParams.append('endDate', endDate);
  
  try {
    const response = await fetch(
      `http://localhost:3000/api/admin/analytics?${queryParams}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();
    
    if (data.success) {
      return data.data.analytics;
    }
  } catch (error) {
    console.error('Error fetching analytics:', error);
  }
}

// Use Case: Analytics Chart Component
function AnalyticsChart() {
  const [analytics, setAnalytics] = useState(null);
  const [type, setType] = useState('trips');
  const [groupBy, setGroupBy] = useState('day');
  
  useEffect(() => {
    loadAnalytics();
  }, [type, groupBy]);
  
  const loadAnalytics = async () => {
    const data = await getSystemAnalytics(type, groupBy);
    setAnalytics(data);
  };
  
  if (!analytics) return <div>Loading...</div>;
  
  return (
    <div>
      <select value={type} onChange={(e) => setType(e.target.value)}>
        <option value="trips">Trips</option>
        <option value="fuel">Fuel</option>
        <option value="users">Users</option>
        <option value="vehicles">Vehicles</option>
      </select>
      <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
        <option value="day">Day</option>
        <option value="week">Week</option>
        <option value="month">Month</option>
      </select>
      {/* Render chart using analytics.data */}
      <Chart data={analytics.data} summary={analytics.summary} />
    </div>
  );
}
```

---

## Permissions & Roles

### Admin Roles

Admins can have one of three roles:

1. **super_admin** - Full access to all features
2. **admin** - Standard admin access
3. **moderator** - Limited admin access

### Permission System

Each admin has granular permissions:

```json
{
  "canManageUsers": true,
  "canManageTrips": true,
  "canManageVehicles": true,
  "canManageFuel": true,
  "canManageSettlements": true,
  "canViewReports": true,
  "canManagePumps": true,
  "canManageFraud": true
}
```

### Permission Checks

- Endpoints check `req.user.userType === 'admin'` for admin access
- Some endpoints may check specific permissions
- Admin routes use middleware to verify admin status

---

## Data Models

### Admin Model

```javascript
{
  _id: ObjectId,
  username: String (unique, required, lowercase),
  email: String (unique, required, lowercase, validated),
  password: String (required, minlength: 6, hashed),
  role: String (enum: ['super_admin', 'admin', 'moderator'], default: 'admin'),
  permissions: {
    canManageUsers: Boolean (default: true),
    canManageTrips: Boolean (default: true),
    canManageVehicles: Boolean (default: true),
    canManageFuel: Boolean (default: true),
    canManageSettlements: Boolean (default: true),
    canViewReports: Boolean (default: true),
    canManagePumps: Boolean (default: true),
    canManageFraud: Boolean (default: true)
  },
  status: String (enum: ['active', 'inactive', 'blocked'], default: 'active'),
  lastLogin: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### Transporter Model

```javascript
{
  _id: ObjectId,
  mobile: String (unique, required),
  name: String (required),
  email: String (unique, lowercase),
  company: String,
  status: String (enum: ['active', 'inactive', 'blocked', 'pending'], default: 'pending'),
  hasAccess: Boolean (default: false),
  pin: String (hashed, select: false),
  walletBalance: Number (default: 0),
  createdAt: Date,
  updatedAt: Date
}
```

### Driver Model

```javascript
{
  _id: ObjectId,
  mobile: String (unique, required),
  name: String (required),
  transporterId: ObjectId (ref: 'Transporter', required),
  status: String (enum: ['pending', 'active', 'inactive', 'blocked'], default: 'pending'),
  riskLevel: String (enum: ['low', 'medium', 'high'], default: 'low'),
  language: String (default: 'en'),
  walletBalance: Number (default: 0),
  createdAt: Date,
  updatedAt: Date
}
```

### Trip Model

```javascript
{
  _id: ObjectId,
  tripId: String (unique, required), // Format: TRIP-YYYY-XXX
  transporterId: ObjectId (ref: 'Transporter', required),
  vehicleId: ObjectId (ref: 'Vehicle'),
  driverId: ObjectId (ref: 'Driver'),
  containerNumber: String (required),
  reference: String,
  pickupLocation: {
    address: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    city: String,
    state: String,
    pincode: String
  },
  dropLocation: {
    address: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    city: String,
    state: String,
    pincode: String
  },
  tripType: String (enum: ['IMPORT', 'EXPORT'], required),
  status: String (enum: ['PLANNED', 'ACTIVE', 'COMPLETED', 'POD_PENDING', 'CANCELLED'], default: 'PLANNED'),
  milestones: [{
    milestoneNumber: Number,
    milestoneType: String,
    backendMeaning: String,
    timestamp: Date,
    photo: String,
    location: {
      latitude: Number,
      longitude: Number
    }
  }],
  POD: {
    photo: String,
    uploadedAt: Date,
    approvedAt: Date,
    approvedBy: ObjectId (ref: 'Admin')
  },
  createdAt: Date,
  updatedAt: Date
}
```

### Vehicle Model

```javascript
{
  _id: ObjectId,
  vehicleNumber: String (unique, required, uppercase),
  transporterId: ObjectId (ref: 'Transporter', required),
  ownerType: String (enum: ['OWN', 'HIRED'], required),
  driverId: ObjectId (ref: 'Driver'),
  status: String (enum: ['active', 'inactive'], default: 'active'),
  trailerType: String, // e.g., '20ft', '40ft'
  documents: {
    rc: {
      number: String,
      photo: String,
      expiryDate: Date
    },
    insurance: {
      number: String,
      photo: String,
      expiryDate: Date
    },
    fitness: {
      number: String,
      photo: String,
      expiryDate: Date
    },
    permit: {
      number: String,
      photo: String,
      expiryDate: Date
    }
  },
  createdAt: Date,
  updatedAt: Date
}
```

### FuelTransaction Model

```javascript
{
  _id: ObjectId,
  transactionId: String (unique, required), // Format: FTX-YYYY-XXX
  pumpOwnerId: ObjectId (ref: 'PumpOwner', required),
  pumpStaffId: ObjectId (ref: 'PumpStaff'),
  vehicleNumber: String (required),
  driverId: ObjectId (ref: 'Driver', required),
  transporterId: ObjectId (ref: 'Transporter', required),
  fuelCardId: ObjectId (ref: 'FuelCard'),
  amount: Number (required, min: 0),
  status: String (enum: ['pending', 'confirmed', 'completed', 'cancelled', 'flagged'], default: 'pending'),
  location: {
    latitude: Number,
    longitude: Number,
    address: String
  },
  receipt: {
    photo: String,
    uploadedAt: Date
  },
  fraudFlags: {
    duplicateReceipt: Boolean (default: false),
    gpsMismatch: Boolean (default: false),
    expressUploads: Boolean (default: false),
    unusualPattern: Boolean (default: false),
    flaggedBy: ObjectId (ref: 'Admin'),
    flaggedAt: Date,
    resolved: Boolean (default: false),
    resolvedBy: ObjectId (ref: 'Admin'),
    resolvedAt: Date
  },
  notes: String,
  createdAt: Date,
  updatedAt: Date,
  completedAt: Date
}
```

### Settlement Model

```javascript
{
  _id: ObjectId,
  pumpOwnerId: ObjectId (ref: 'PumpOwner', required),
  period: String (required), // e.g., "January 2024"
  startDate: Date (required),
  endDate: Date (required),
  fuelValue: Number (required, min: 0),
  commission: Number (required, min: 0),
  commissionRate: Number (required, min: 0, max: 100),
  netPayable: Number (required, min: 0),
  status: String (enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'], default: 'PENDING'),
  utr: String (uppercase), // Unique Transaction Reference
  transactionCount: Number (default: 0),
  transactions: [ObjectId (ref: 'FuelTransaction')],
  processedAt: Date,
  processedBy: ObjectId (ref: 'Admin'),
  completedAt: Date,
  notes: String,
  createdAt: Date,
  updatedAt: Date
}
```

### FuelCard Model

```javascript
{
  _id: ObjectId,
  cardNumber: String (unique, required, uppercase),
  transporterId: ObjectId (ref: 'Transporter', required),
  driverId: ObjectId (ref: 'Driver'),
  balance: Number (default: 0, min: 0),
  status: String (enum: ['active', 'inactive', 'expired', 'blocked'], default: 'active'),
  expiryDate: Date,
  assignedAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### PumpOwner Model

```javascript
{
  _id: ObjectId,
  mobile: String (unique, required),
  name: String (required),
  email: String (unique, lowercase),
  pumpName: String (required),
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
  status: String (enum: ['active', 'inactive', 'blocked', 'pending'], default: 'pending'),
  walletBalance: Number (default: 0),
  commissionRate: Number (default: 2.5, min: 0, max: 100),
  createdAt: Date,
  updatedAt: Date
}
```

### PumpStaff Model

```javascript
{
  _id: ObjectId,
  mobile: String (unique, required),
  name: String (required),
  pumpOwnerId: ObjectId (ref: 'PumpOwner', required),
  status: String (enum: ['active', 'inactive', 'blocked', 'disabled'], default: 'active'),
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

### CompanyUser Model

```javascript
{
  _id: ObjectId,
  name: String (required),
  mobile: String (unique, required),
  email: String (unique, lowercase),
  transporterId: ObjectId (ref: 'Transporter', required),
  hasAccess: Boolean (default: false),
  status: String (enum: ['active', 'inactive'], default: 'active'),
  permissions: [String], // e.g., ['viewTrips', 'createTrips']
  pin: String (hashed, select: false),
  createdAt: Date,
  updatedAt: Date
}
```

### Notification Model

```javascript
{
  _id: ObjectId,
  userId: ObjectId (required),
  userType: String (enum: ['TRANSPORTER', 'DRIVER', 'PUMP_OWNER', 'PUMP_STAFF', 'COMPANY_USER'], required),
  type: String (enum: ['SETTLEMENT_COMPLETED', 'TRIP_CANCELLED', 'DOCUMENT_EXPIRING', 'FRAUD_ALERT', 'SYSTEM_UPDATE', 'GENERAL'], required),
  title: String (required),
  message: String (required),
  data: Object, // Additional data payload
  priority: String (enum: ['low', 'medium', 'high', 'urgent'], default: 'medium'),
  read: Boolean (default: false),
  readAt: Date,
  createdAt: Date
}
```

### Entity Relationships

```
Admin
  └─> (manages) All entities

Transporter
  ├─> (has many) Drivers
  ├─> (has many) Vehicles
  ├─> (has many) Trips
  ├─> (has many) CompanyUsers
  └─> (has many) FuelCards

Driver
  ├─> (belongs to) Transporter
  ├─> (assigned to) Vehicle
  ├─> (has many) Trips
  └─> (has many) FuelTransactions

Vehicle
  ├─> (belongs to) Transporter
  ├─> (assigned to) Driver
  └─> (has many) Trips

Trip
  ├─> (belongs to) Transporter
  ├─> (assigned to) Vehicle
  ├─> (assigned to) Driver
  └─> (has) POD

FuelTransaction
  ├─> (belongs to) PumpOwner
  ├─> (processed by) PumpStaff
  ├─> (belongs to) Driver
  ├─> (belongs to) Transporter
  ├─> (uses) FuelCard
  └─> (flagged by) Admin (fraud)

Settlement
  ├─> (belongs to) PumpOwner
  ├─> (contains) FuelTransactions
  ├─> (processed by) Admin
  └─> (completed by) Admin

FuelCard
  ├─> (belongs to) Transporter
  └─> (assigned to) Driver

PumpOwner
  ├─> (has many) PumpStaff
  └─> (has many) FuelTransactions

PumpStaff
  └─> (belongs to) PumpOwner

CompanyUser
  └─> (belongs to) Transporter
```

---

## Error Handling

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid token)
- `403` - Forbidden (access denied, not admin)
- `404` - Not Found
- `409` - Conflict (duplicate entry)
- `500` - Internal Server Error

### Error Response Format

```json
{
  "success": false,
  "message": "Error message",
  "error": "Detailed error information (optional)"
}
```

### Common Error Messages

- `"Access denied. This endpoint is for admins only."` - Non-admin trying to access admin endpoint
- `"Invalid credentials"` - Wrong email or password
- `"Your account has been blocked or is inactive"` - Admin account blocked
- `"Settlement must be in PROCESSING status"` - Wrong settlement status
- `"Transaction does not have fraud flags"` - Transaction not flagged
- `"Transporter not found"` - Invalid transporter ID
- `"Driver not found"` - Invalid driver ID
- `"Trip not found"` - Invalid trip ID
- `"Vehicle not found"` - Invalid vehicle ID
- `"Pump owner not found"` - Invalid pump owner ID
- `"Settlement not found"` - Invalid settlement ID
- `"Card number already exists"` - Duplicate fuel card number
- `"Email and password are required"` - Missing login credentials
- `"Username or email already exists"` - Duplicate admin credentials
- `"Valid status is required"` - Invalid status value provided
- `"UTR is required"` - Missing UTR for settlement completion

### Troubleshooting Guide

#### Authentication Issues

**Problem:** Getting 401 Unauthorized errors
- **Solution:** Check if the access token is valid and not expired
- **Solution:** Ensure the Authorization header is formatted correctly: `Bearer <token>`
- **Solution:** Try refreshing the token using `/api/auth/refresh`
- **Solution:** Verify the admin account is active and not blocked

**Problem:** Getting 403 Forbidden errors
- **Solution:** Verify the user is logged in as an admin (userType === 'admin')
- **Solution:** Check admin account status is 'active'
- **Solution:** Verify admin permissions if endpoint requires specific permissions

#### Data Retrieval Issues

**Problem:** Empty results when filtering
- **Solution:** Check date format is ISO 8601: `2024-01-15T10:30:00.000Z`
- **Solution:** Verify filter values match expected enum values (e.g., status values)
- **Solution:** Check if data exists for the applied filters
- **Solution:** Verify transporterId/driverId/etc. are valid ObjectIds

**Problem:** Pagination not working correctly
- **Solution:** Ensure page and limit are positive integers
- **Solution:** Check if total count matches expected results
- **Solution:** Verify pagination parameters are in query string, not body

#### Settlement Processing Issues

**Problem:** Cannot process settlement
- **Solution:** Verify settlement status is 'PENDING' before processing
- **Solution:** Check if settlement already exists for the period
- **Solution:** Verify pump owner ID is valid
- **Solution:** Ensure date range is valid (startDate < endDate)

**Problem:** Cannot complete settlement
- **Solution:** Verify settlement status is 'PROCESSING' before completing
- **Solution:** Ensure UTR is provided and is a valid string
- **Solution:** Check if settlement was already completed

#### Fraud Management Issues

**Problem:** Cannot flag transaction
- **Solution:** Verify transaction exists and is not already flagged
- **Solution:** Check fraud type is valid: `duplicateReceipt`, `gpsMismatch`, `expressUploads`, `unusualPattern`
- **Solution:** Ensure admin has fraud management permissions

**Problem:** Cannot resolve fraud alert
- **Solution:** Verify transaction has fraud flags
- **Solution:** Check if alert is already resolved
- **Solution:** Ensure resolution notes are provided

#### User Management Issues

**Problem:** Cannot update user status
- **Solution:** Verify status value is valid for user type
- **Solution:** Check if user exists
- **Solution:** Ensure user ID is a valid ObjectId

**Problem:** Search not returning results
- **Solution:** Verify search query is not empty
- **Solution:** Check if search is case-sensitive (most searches are case-insensitive)
- **Solution:** Try broader search terms

#### General API Issues

**Problem:** Slow response times
- **Solution:** Use pagination to limit result sets
- **Solution:** Apply filters to reduce data volume
- **Solution:** Check database indexes on frequently queried fields
- **Solution:** Consider using date range filters for large datasets

**Problem:** CORS errors
- **Solution:** Ensure frontend origin is whitelisted in backend CORS configuration
- **Solution:** Verify API base URL is correct
- **Solution:** Check if request includes proper headers

**Problem:** Network errors
- **Solution:** Verify API server is running
- **Solution:** Check network connectivity
- **Solution:** Verify API base URL is accessible
- **Solution:** Check firewall/proxy settings

### Best Practices

1. **Token Management**
   - Store tokens securely (consider httpOnly cookies for production)
   - Implement token refresh before expiration
   - Handle token expiration gracefully with redirect to login

2. **Error Handling**
   - Always check `success` field in response
   - Display user-friendly error messages
   - Log errors for debugging
   - Implement retry logic for network failures

3. **Pagination**
   - Always use pagination for list endpoints
   - Set reasonable page limits (20-50 items)
   - Show pagination controls to users
   - Cache paginated results when appropriate

4. **Date Handling**
   - Always use ISO 8601 format for dates
   - Handle timezone conversions properly
   - Validate date ranges before sending requests

5. **Filtering**
   - Validate filter values before sending requests
   - Use appropriate filter combinations
   - Clear filters when switching contexts

6. **Performance**
   - Debounce search inputs
   - Cache frequently accessed data
   - Use loading states for better UX
   - Implement optimistic updates where appropriate

---

## Complete Admin Flows

### Flow 1: Admin Login and Dashboard Access

1. **Admin Login**
   ```
   POST /api/auth/admin-login
   Body: { email, password }
   Response: Access token + admin info
   ```

2. **Get Dashboard Statistics**
   ```
   GET /api/admin/dashboard/stats
   Headers: Authorization: Bearer <token>
   Response: System-wide statistics
   ```

3. **View Active Trips**
   ```
   GET /api/trips/active
   Headers: Authorization: Bearer <token>
   Response: All active trips
   ```

---

### Flow 2: User Management

1. **List All Transporters**
   ```
   GET /api/transporters
   Headers: Authorization: Bearer <token>
   Query: ?status=active&page=1&limit=20
   ```

2. **View Transporter Details**
   ```
   GET /api/transporters/:id
   Headers: Authorization: Bearer <token>
   ```

3. **Block Transporter**
   ```
   PUT /api/transporters/:id/status
   Body: { status: "blocked" }
   ```

---

### Flow 3: Settlement Processing

1. **Calculate Settlement**
   ```
   POST /api/settlements/calculate
   Body: {
     pumpOwnerId,
     startDate,
     endDate,
     period
   }
   ```

2. **Process Settlement**
   ```
   PUT /api/settlements/:id/process
   ```

3. **Complete Settlement**
   ```
   PUT /api/settlements/:id/complete
   Body: { utr, notes }
   ```

---

### Flow 4: Fraud Management

1. **View Fraud Alerts**
   ```
   GET /api/fuel/fraud-alerts
   Query: ?resolved=false&page=1&limit=20
   ```

2. **View Fraud Alert Details**
   ```
   GET /api/fuel/fraud-alerts/:id
   ```

3. **Resolve Fraud Alert**
   ```
   PUT /api/fuel/fraud-alerts/:id/resolve
   Body: { isFraud: false, resolution: "..." }
   ```

4. **View Fraud Statistics**
   ```
   GET /api/fuel/fraud-stats
   Query: ?startDate=...&endDate=...
   ```

---

### Flow 5: Vehicle Document Management

1. **View Expiring Documents**
   ```
   GET /api/vehicles/documents/expiring
   Query: ?days=30
   ```

2. **View Vehicle Details**
   ```
   GET /api/vehicles/:id
   ```

3. **View Vehicle Documents**
   ```
   GET /api/vehicles/:id/documents
   ```

---

## Notes

1. **Admin Access**: Admins can access all endpoints with broader permissions than regular users
2. **No Filtering**: Admin endpoints don't filter by transporterId automatically (unlike transporter endpoints)
3. **Settlement Processing**: Only admins can calculate, process, and complete settlements
4. **Fraud Management**: Only admins can view fraud alerts, flag transactions, and resolve fraud alerts
5. **User Management**: Admins can block/unblock any user in the system
6. **System-Wide View**: Admin dashboard provides system-wide statistics and analytics
7. **Permission System**: Admin permissions are granular and can be customized per admin
8. **Audit Trail**: Admin actions are logged (e.g., who processed settlement, who flagged fraud)

---

## Support

For API support or questions, please contact the development team.

---

## Admin Panel Use Cases

### Use Case 1: Daily Operations Dashboard

**Scenario:** Admin needs to monitor system health and key metrics daily.

**Implementation:**
1. Load dashboard statistics on page load
2. Display key metrics in cards/widgets
3. Show alerts for pending items (settlements, fraud alerts, expiring documents)
4. Refresh data every 5 minutes

**Example Flow:**
```javascript
// Dashboard Component
function DailyDashboard() {
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState([]);
  
  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 5 * 60 * 1000); // 5 minutes
    return () => clearInterval(interval);
  }, []);
  
  const loadDashboard = async () => {
    const dashboardStats = await getDashboardStats();
    const pendingSettlements = await getPendingSettlements();
    const fraudAlerts = await getFraudAlerts({ resolved: false });
    const expiringDocs = await getExpiringDocuments(30);
    
    setStats(dashboardStats);
    setAlerts([
      { type: 'settlements', count: pendingSettlements.length },
      { type: 'fraud', count: fraudAlerts.length },
      { type: 'documents', count: expiringDocs.length },
    ]);
  };
  
  return (
    <div>
      <DashboardStats stats={stats} />
      <AlertsPanel alerts={alerts} />
    </div>
  );
}
```

---

### Use Case 2: User Management Workflow

**Scenario:** Admin needs to review and manage user accounts.

**Implementation:**
1. List users with search and filter capabilities
2. View user details and activity timeline
3. Update user status (block/unblock)
4. View user-related data (trips, vehicles, transactions)

**Example Flow:**
```javascript
// User Management Component
function UserManagement() {
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({ status: '', search: '' });
  
  const handleBlockUser = async (userId) => {
    if (confirm('Are you sure you want to block this user?')) {
      await updateUserStatus(userId, 'blocked');
      loadUsers();
    }
  };
  
  const handleViewDetails = (userId) => {
    // Navigate to user details page
    window.location.href = `/admin/users/${userId}`;
  };
  
  return (
    <div>
      <UserFilters filters={filters} onChange={setFilters} />
      <UserList 
        users={users} 
        onBlock={handleBlockUser}
        onViewDetails={handleViewDetails}
      />
    </div>
  );
}
```

---

### Use Case 3: Settlement Processing Workflow

**Scenario:** Admin needs to process monthly settlements for pump owners.

**Implementation:**
1. Calculate settlement for a pump owner and period
2. Review calculation details
3. Process settlement (change status to PROCESSING)
4. Complete settlement with UTR after payment

**Example Flow:**
```javascript
// Settlement Processing Component
function SettlementProcessor() {
  const [calculation, setCalculation] = useState(null);
  const [settlement, setSettlement] = useState(null);
  
  const handleCalculate = async () => {
    const calc = await calculateSettlement(
      pumpOwnerId,
      startDate,
      endDate,
      period
    );
    setCalculation(calc);
  };
  
  const handleProcess = async () => {
    // Create settlement record and process it
    const newSettlement = await createSettlement(calculation);
    await processSettlement(newSettlement.id);
    setSettlement(newSettlement);
  };
  
  const handleComplete = async (utr) => {
    await completeSettlement(settlement.id, utr);
    // Send notification to pump owner
    await notifySettlementComplete(
      settlement.pumpOwnerId,
      settlement.id,
      settlement.netPayable
    );
  };
  
  return (
    <div>
      <SettlementCalculator onCalculate={handleCalculate} />
      {calculation && (
        <SettlementReview 
          calculation={calculation}
          onProcess={handleProcess}
        />
      )}
      {settlement && settlement.status === 'PROCESSING' && (
        <SettlementCompletion 
          settlement={settlement}
          onComplete={handleComplete}
        />
      )}
    </div>
  );
}
```

---

### Use Case 4: Fraud Detection and Resolution

**Scenario:** Admin needs to review and resolve fraud alerts.

**Implementation:**
1. View list of fraud alerts (filtered by unresolved)
2. Review transaction details and fraud flags
3. Investigate fraud (view receipt, location, transaction history)
4. Resolve fraud alert (mark as fraud or false positive)

**Example Flow:**
```javascript
// Fraud Management Component
function FraudManagement() {
  const [alerts, setAlerts] = useState([]);
  const [selectedAlert, setSelectedAlert] = useState(null);
  
  const handleResolve = async (transactionId, isFraud, resolution) => {
    await resolveFraudAlert(transactionId, isFraud, resolution);
    loadAlerts();
    setSelectedAlert(null);
  };
  
  return (
    <div>
      <FraudAlertsList 
        alerts={alerts}
        onSelect={setSelectedAlert}
      />
      {selectedAlert && (
        <FraudAlertDetails 
          alert={selectedAlert}
          onResolve={handleResolve}
        />
      )}
    </div>
  );
}
```

---

## Frontend Integration Guide

### Authentication Flow

**Step 1: Login**
```javascript
const login = async (email, password) => {
  const response = await fetch('/api/auth/admin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  
  const data = await response.json();
  if (data.success) {
    localStorage.setItem('accessToken', data.data.accessToken);
    localStorage.setItem('refreshToken', data.data.refreshToken);
    return data.data.user;
  }
  throw new Error(data.message);
};
```

**Step 2: API Request Interceptor**
```javascript
// Axios interceptor example
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Fetch wrapper example
const apiRequest = async (url, options = {}) => {
  const token = localStorage.getItem('accessToken');
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  
  if (response.status === 401) {
    // Token expired, try refresh
    await refreshToken();
    // Retry request
    return apiRequest(url, options);
  }
  
  return response.json();
};
```

**Step 3: Token Refresh**
```javascript
const refreshToken = async () => {
  const refreshToken = localStorage.getItem('refreshToken');
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  
  const data = await response.json();
  if (data.success) {
    localStorage.setItem('accessToken', data.data.accessToken);
    localStorage.setItem('refreshToken', data.data.refreshToken);
  } else {
    // Refresh failed, redirect to login
    window.location.href = '/admin/login';
  }
};
```

---

### Error Handling Pattern

```javascript
const handleApiError = (error) => {
  if (error.response) {
    // API responded with error
    switch (error.response.status) {
      case 400:
        return 'Invalid request. Please check your input.';
      case 401:
        return 'Session expired. Please login again.';
      case 403:
        return 'Access denied. You do not have permission.';
      case 404:
        return 'Resource not found.';
      case 500:
        return 'Server error. Please try again later.';
      default:
        return error.response.data.message || 'An error occurred.';
    }
  } else if (error.request) {
    // Request made but no response
    return 'Network error. Please check your connection.';
  } else {
    // Error in request setup
    return 'Request error. Please try again.';
  }
};
```

---

### Pagination Component

```javascript
function Pagination({ pagination, onPageChange }) {
  const { page, pages, total } = pagination;
  
  return (
    <div className="pagination">
      <button 
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <span>Page {page} of {pages} ({total} total)</span>
      <button 
        disabled={page === pages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
```

---

## API Flow Diagrams

### Authentication Flow

```mermaid
sequenceDiagram
    participant Admin
    participant Frontend
    participant API
    participant Database

    Admin->>Frontend: Enter email/password
    Frontend->>API: POST /api/auth/admin-login
    API->>Database: Verify admin credentials
    Database-->>API: Admin data
    API->>API: Generate JWT tokens
    API-->>Frontend: Access token + Refresh token
    Frontend->>Frontend: Store tokens
    Frontend->>Admin: Redirect to dashboard
```

---

### Settlement Processing Flow

```mermaid
sequenceDiagram
    participant Admin
    participant Frontend
    participant API
    participant Database

    Admin->>Frontend: Select pump owner & period
    Frontend->>API: POST /api/settlements/calculate
    API->>Database: Fetch completed transactions
    Database-->>API: Transactions
    API->>API: Calculate settlement
    API-->>Frontend: Calculation result
    Frontend->>Admin: Show calculation
    Admin->>Frontend: Confirm & process
    Frontend->>API: PUT /api/settlements/:id/process
    API->>Database: Update status to PROCESSING
    Database-->>API: Updated settlement
    API-->>Frontend: Processing confirmation
    Admin->>Frontend: Enter UTR
    Frontend->>API: PUT /api/settlements/:id/complete
    API->>Database: Update status to COMPLETED
    API->>API: Send notification
    API-->>Frontend: Completion confirmation
```

---

### Fraud Detection Flow

```mermaid
sequenceDiagram
    participant System
    participant API
    participant Database
    participant Admin
    participant Frontend

    System->>API: Transaction flagged
    API->>Database: Store fraud flags
    Admin->>Frontend: View fraud alerts
    Frontend->>API: GET /api/fuel/fraud-alerts
    API->>Database: Fetch flagged transactions
    Database-->>API: Fraud alerts
    API-->>Frontend: Alert list
    Frontend->>Admin: Display alerts
    Admin->>Frontend: Select alert to review
    Frontend->>API: GET /api/fuel/fraud-alerts/:id
    API->>Database: Fetch transaction details
    Database-->>API: Transaction with flags
    API-->>Frontend: Alert details
    Frontend->>Admin: Show details
    Admin->>Frontend: Resolve (fraud/false positive)
    Frontend->>API: PUT /api/fuel/fraud-alerts/:id/resolve
    API->>Database: Update fraud flags
    Database-->>API: Updated transaction
    API-->>Frontend: Resolution confirmation
```

---

### User Management Flow

```mermaid
sequenceDiagram
    participant Admin
    participant Frontend
    participant API
    participant Database

    Admin->>Frontend: Search/filter users
    Frontend->>API: GET /api/admin/transporters?search=...
    API->>Database: Query transporters
    Database-->>API: Transporters list
    API-->>Frontend: Paginated results
    Frontend->>Admin: Display users
    Admin->>Frontend: Select user to block
    Frontend->>API: PUT /api/admin/transporters/:id/status
    API->>Database: Update user status
    Database-->>API: Updated user
    API-->>Frontend: Status update confirmation
    Frontend->>Admin: Show success message
```

---

## Quick Reference Guide

### Endpoint Quick Reference

#### Authentication
- `POST /api/auth/admin-login` - Admin login
- `POST /api/auth/refresh` - Refresh access token

#### Admin Profile
- `GET /api/admins/profile` - Get admin profile
- `PUT /api/admins/profile` - Update admin profile

#### Dashboard & Analytics
- `GET /api/admin/dashboard/stats` - Get dashboard statistics
- `GET /api/admin/analytics` - Get system analytics

#### User Management
- `GET /api/admin/transporters` - List all transporters
- `GET /api/admin/transporters/:id` - Get transporter details
- `PUT /api/admin/transporters/:id/status` - Update transporter status
- `GET /api/admin/drivers` - List all drivers
- `GET /api/admin/drivers/:id` - Get driver details
- `GET /api/admin/drivers/:id/timeline` - Get driver timeline
- `PUT /api/admin/drivers/:id/status` - Update driver status
- `GET /api/admin/pump-owners` - List all pump owners
- `GET /api/admin/pump-owners/:id` - Get pump owner details
- `PUT /api/admin/pump-owners/:id/status` - Update pump owner status
- `GET /api/admin/pump-staff` - List all pump staff
- `GET /api/admin/pump-staff/:id` - Get pump staff details
- `GET /api/admin/company-users` - List all company users
- `GET /api/admin/company-users/:id` - Get company user details

#### Trip Management
- `GET /api/trips` - List all trips
- `GET /api/trips/:id` - Get trip details
- `PUT /api/trips/:id/cancel` - Cancel trip
- `GET /api/trips/search` - Search trips
- `GET /api/trips/active` - Get active trips
- `GET /api/trips/pending-pod` - Get pending POD trips
- `GET /api/trips/status/:status` - Get trips by status

#### Vehicle Management
- `GET /api/vehicles` - List all vehicles
- `GET /api/vehicles/:id` - Get vehicle details
- `GET /api/vehicles/:id/trips` - Get vehicle trip history
- `GET /api/vehicles/documents/expiring` - Get expiring documents

#### Fuel Management
- `GET /api/fuel/transactions` - List all fuel transactions
- `GET /api/fuel/transactions/:id` - Get transaction details
- `GET /api/fuel/receipt/:id` - Get fuel receipt

#### Fuel Card Management
- `GET /api/fuel-cards` - List all fuel cards
- `POST /api/fuel-cards` - Create fuel card
- `GET /api/fuel-cards/:id` - Get fuel card details
- `GET /api/fuel-cards/:id/transactions` - Get card transaction history

#### Settlement Management
- `GET /api/settlements` - List all settlements
- `GET /api/settlements/:id` - Get settlement details
- `POST /api/settlements/calculate` - Calculate settlement
- `PUT /api/settlements/:id/process` - Process settlement
- `PUT /api/settlements/:id/complete` - Complete settlement
- `GET /api/settlements/pending` - Get pending settlements

#### Fraud Detection
- `GET /api/fuel/fraud-alerts` - Get fraud alerts
- `GET /api/fuel/fraud-alerts/:id` - Get fraud alert details
- `POST /api/fuel/transactions/:id/flag` - Flag transaction
- `PUT /api/fuel/fraud-alerts/:id/resolve` - Resolve fraud alert
- `GET /api/fuel/fraud-stats` - Get fraud statistics

#### Notifications
- `POST /api/notifications/send` - Send notification

### Status Values Reference

#### Trip Status
- `PLANNED` - Trip is planned but not started
- `ACTIVE` - Trip is currently in progress
- `COMPLETED` - Trip is completed
- `POD_PENDING` - Trip completed, waiting for POD upload
- `CANCELLED` - Trip was cancelled

#### User Status
- `active` - Active account
- `inactive` - Inactive account
- `blocked` - Blocked account
- `pending` - Pending approval (transporters, pump owners)
- `disabled` - Disabled account (pump staff)

#### Settlement Status
- `PENDING` - Settlement is pending processing
- `PROCESSING` - Settlement is being processed
- `COMPLETED` - Settlement is completed
- `FAILED` - Settlement processing failed
- `CANCELLED` - Settlement was cancelled

#### Fuel Transaction Status
- `pending` - Transaction is pending
- `confirmed` - Transaction is confirmed
- `completed` - Transaction is completed
- `cancelled` - Transaction was cancelled
- `flagged` - Transaction is flagged for fraud

#### Vehicle Status
- `active` - Vehicle is active
- `inactive` - Vehicle is inactive

#### Fuel Card Status
- `active` - Card is active
- `inactive` - Card is inactive
- `expired` - Card has expired
- `blocked` - Card is blocked

### Common Query Parameters

#### Pagination
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20)

#### Date Filtering
- `startDate` - Start date (ISO 8601 format)
- `endDate` - End date (ISO 8601 format)

#### Common Filters
- `status` - Filter by status
- `transporterId` - Filter by transporter ID
- `driverId` - Filter by driver ID
- `vehicleId` - Filter by vehicle ID
- `pumpOwnerId` - Filter by pump owner ID
- `search` - Search query (text search)

### Response Structure

#### Success Response
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { ... }
}
```

#### Error Response
```json
{
  "success": false,
  "message": "Error message",
  "error": "Detailed error information (optional)"
}
```

#### Paginated Response
```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "pages": 5
    }
  }
}
```

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `500` - Internal Server Error

---

**Last Updated:** January 2024  
**API Version:** 1.0.0
